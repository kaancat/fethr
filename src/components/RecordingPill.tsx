import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertTriangle, Settings, History, Type, Globe, EyeOff, Clipboard } from "lucide-react";
import { RecordingState } from '../types';
import LiveWaveform from './LiveWaveform'; // Import the new LiveWaveform component
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window'; // <-- Import appWindow
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

/**
 * RecordingPill is a floating UI component that shows recording status and hotkey info
 * 
 * What it does: Provides visual feedback about recording state
 * Why it exists: Users need to know when recording is active and what hotkey to use
 */

// Define the props the component will accept
interface RecordingPillProps {
    currentState: RecordingState;
    duration: string; // Expecting pre-formatted string like "0s"
    transcription?: string; // Optional transcription text
    error?: string; // Optional error message
    backendError?: string | null; // Optional backend error message from Rust
    showUpgradePrompt?: boolean; // New prop for showing upgrade UI
    isResizing?: boolean; // New prop to control animations during window resize
    onEditClick?: () => void; // <-- Add prop back
    onErrorDismiss?: () => void; // Make sure this prop exists
    onUpgradeClick?: () => void; // Optional callback for the upgrade action
}

// Add edit_pending to variants
type PillVariant = 'idle' | 'ready' | 'recording' | 'processing' | 'error' | 'edit_pending';

// --- Animation Variants (with explicit styling) ---
const pillContainerVariants = {
  idle: { 
    width: "28px", 
    height: "28px", 
    padding: "4px",
    borderRadius: "50%", 
    backgroundColor: "rgba(10, 15, 26, 0.0)", 
    boxShadow: "0 0 5px rgba(166, 246, 255, 0.2)", 
    border: "1px solid transparent", 
    opacity: 1,
    x: 0,
    y: 0
  },
  edit_pending: { 
    width: "28px", 
    height: "28px", 
    padding: "4px", 
    borderRadius: "50%", 
    backgroundColor: "rgba(10, 15, 26, 0.0)", 
    boxShadow: "0 0 6px rgba(34, 197, 94, 0.4)", 
    border: "1px solid rgba(34, 197, 94, 0.3)", 
    opacity: 1,
    x: 0,
    y: 0
  },
  ready: { 
    width: "120px", height: "32px", 
    padding: "4px 8px", 
    borderRadius: "16px", 
    backgroundColor: "rgba(10, 15, 26, 0.9)", 
    opacity: 1,
    x: 0,
    y: 0
  },
  recording: { 
    width: "120px", height: "32px", 
    padding: "4px 8px", 
    borderRadius: "16px",
    backgroundColor: "rgba(2, 4, 9, 1)", 
    opacity: 1,
    x: 0,
    y: 0
  },
  processing: { 
    width: "36px", height: "36px", padding: "6px", borderRadius: "18px",
    backgroundColor: "rgba(2, 4, 9, 1)", boxShadow: "0 0 10px rgba(139, 158, 255, 0.4)", 
    border: "1px solid rgba(139, 158, 255, 0.5)", opacity: 1,
    x: 0,
    y: 0
  },
  error: { 
    width: "180px", 
    height: "60px", 
    padding: "4px 8px", 
    borderRadius: "16px",
    backgroundColor: "rgba(194, 65, 12, 0.2)", 
    boxShadow: "0 0 8px rgba(255, 139, 102, 0.26)", 
    border: "1px solid rgba(249, 115, 22, 0.5)", 
    opacity: 1,
    x: 0,
    y: 0
  }
};

// Animation variants for the inner content; controls fade/scale transitions when the pill switches content blocks.
// Why: Keeps content transitions smooth and visually consistent between states.
const contentAnimationVariants = {
    initial: { opacity: 0, scale: 0.9 },
    animate: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: "circOut" } },
    exit: { opacity: 0, scale: 0.9, transition: { duration: 0.1, ease: "circIn" } }
};

const featherIconPath = "/feather-logo.png";
const editIconPath = "/Icons/edit icon.png";

const RecordingPill: React.FC<RecordingPillProps> = ({ currentState, duration, transcription, error, backendError, showUpgradePrompt, isResizing, onEditClick, onErrorDismiss, onUpgradeClick }) => {
    const isIdle = currentState === RecordingState.IDLE;
    const isRecordingState = currentState === RecordingState.RECORDING || currentState === RecordingState.LOCKED_RECORDING;
    const isProcessingState = currentState === RecordingState.TRANSCRIBING || currentState === RecordingState.PASTING;
    const isSuccessState = currentState === RecordingState.SUCCESS; // CRITICAL FIX: Handle SUCCESS state
    const isEditPending = currentState === RecordingState.IDLE_EDIT_READY;
    const isErrorUiState = currentState === RecordingState.ERROR || !!backendError;
    
    const [isHovered, setIsHovered] = useState(false);
    const [showContextMenu, setShowContextMenu] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
    const [lastTranscription, setLastTranscription] = useState<string | null>(null);
    const pillRef = useRef<HTMLDivElement>(null);
    
    let targetVariant: PillVariant = 'idle';
    if (backendError) targetVariant = 'error';
    else if (isEditPending) targetVariant = 'edit_pending';
    else if (isIdle && isHovered) targetVariant = 'ready';
    else if (isRecordingState) targetVariant = 'recording';
    else if (isProcessingState || isSuccessState) targetVariant = 'processing'; // CRITICAL FIX: SUCCESS shows processing spinner
    else if (isErrorUiState) targetVariant = 'error';
    else targetVariant = 'idle';

    // Add comprehensive logging for state transitions
    console.log(`🎭 [PILL VARIANT] State: ${RecordingState[currentState]} → Variant: ${targetVariant} | isResizing: ${isResizing} | isHovered: ${isHovered}`);
    
    // Log variant dimension changes
    const variantDimensions = pillContainerVariants[targetVariant];
    console.log(`📐 [PILL DIMENSIONS] Variant ${targetVariant}: ${variantDimensions.width} × ${variantDimensions.height} | Y: ${variantDimensions.y}`);
    
    // Track DOM position changes
    useEffect(() => {
        if (pillRef.current) {
            const rect = pillRef.current.getBoundingClientRect();
            console.log(`📍 [DOM POSITION] State: ${RecordingState[currentState]} | Top: ${rect.top.toFixed(1)}px | Left: ${rect.left.toFixed(1)}px | Width: ${rect.width.toFixed(1)}px | Height: ${rect.height.toFixed(1)}px`);
        }
    }, [currentState, targetVariant, isResizing]);

    // Store last transcription for paste functionality
    useEffect(() => {
        if (transcription) {
            setLastTranscription(transcription);
        }
    }, [transcription]);

    // Close context menu when clicking outside
    useEffect(() => {
        const handleClickOutside = () => setShowContextMenu(false);
        if (showContextMenu) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [showContextMenu]);

    // Context menu handlers
    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenuPosition({ x: e.clientX, y: e.clientY });
        setShowContextMenu(true);
    };

    const handleHideFor1Hour = async () => {
        setShowContextMenu(false);
        try {
            await invoke('set_pill_visibility', { visible: false });
            // Set a timer to show again after 1 hour
            setTimeout(async () => {
                await invoke('set_pill_visibility', { visible: true });
            }, 60 * 60 * 1000); // 1 hour in milliseconds
        } catch (err) {
            console.error('Failed to hide pill:', err);
        }
    };

    const handlePasteLastTranscript = async () => {
        setShowContextMenu(false);
        if (lastTranscription) {
            try {
                await navigator.clipboard.writeText(lastTranscription);
                // Could also trigger auto-paste here if needed
            } catch (err) {
                console.error('Failed to copy to clipboard:', err);
            }
        }
    };

    const handleOpenSettings = async () => {
        setShowContextMenu(false);
        try {
            await invoke('navigate_to_settings_section', { section: 'general' });
        } catch (err) {
            console.error('Failed to open settings:', err);
        }
    };

    const handleOpenHistory = async () => {
        setShowContextMenu(false);
        try {
            await invoke('navigate_to_settings_section', { section: 'history' });
        } catch (err) {
            console.error('Failed to open history:', err);
        }
    };

    // Handle clicks on the pill depending on the current recording state
    // Why: Centralizes the logic for starting/stopping recording via pill interaction.
    const handleContentAreaClick = (currentPillState: RecordingState) => {
        console.log(`[RecordingPill handleContentAreaClick] Called for state: ${RecordingState[currentPillState]}`);
        if (currentPillState === RecordingState.IDLE) {
            invoke('trigger_press_event').catch(err => console.error("Error invoking trigger_press_event:", err));
        } else if (currentPillState === RecordingState.RECORDING || currentPillState === RecordingState.LOCKED_RECORDING) {
            invoke('trigger_release_event').catch(err => console.error("Error invoking trigger_release_event:", err));
        }
    };

    let stateClasses = "text-white";
    if ([ 'ready', 'recording', 'error', 'processing'].includes(targetVariant) ) {
        stateClasses += " text-xs font-mono";
    }
    if (targetVariant === 'processing') stateClasses += " text-indigo-300";
    if (targetVariant === 'idle' && !isHovered) stateClasses += " hover:shadow-[0_0_10px_#A6F6FF66]";
    else if (targetVariant === 'edit_pending') stateClasses += " hover:shadow-[0_0_10px_#22C55E99]";
            
    let pillContent: React.ReactNode = null;
    const iconClass = "w-5 h-5 object-contain flex-shrink-0";
    const textClass = "truncate";

    switch (targetVariant) {
        case 'idle':
            pillContent = (
                <motion.div 
                    key="idle_content_block"
                    variants={contentAnimationVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="flex items-center justify-center w-full h-full"
                >
                    <img 
                        src={featherIconPath} 
                        alt="Fethr" 
                        className={`${iconClass} filter drop-shadow-[0_0_4px_#A6F6FF]`} 
                    />
                </motion.div>
            );
            break;
        case 'edit_pending':
            pillContent = (
                <motion.div 
                    key="edit_content_block"
                    variants={contentAnimationVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="flex items-center justify-center w-full h-full"
                >
                    <img 
                        src={editIconPath} 
                        alt="Edit" 
                        className={`${iconClass} filter brightness-125 saturate-150`} 
                    />
                </motion.div>
            );
            break;
        case 'error':
            if (showUpgradePrompt) {
                let buttonText = "Upgrade";
                if (backendError === "Subscription required") {
                    buttonText = "Subscribe";
                }

                pillContent = (
                    <motion.div 
                        key="error_prompt_content_block"
                        variants={contentAnimationVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="flex flex-col items-center justify-center w-full p-1 space-y-0.5 max-w-[180px]"
                    >
                        <div className="flex items-center space-x-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" /> 
                            <span className="text-yellow-400 text-xs font-medium text-center break-words">
                                {backendError}
                            </span>
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation(); 
                                console.log("Button clicked inside RecordingPill for prompt!");
                                onUpgradeClick?.();
                            }}
                            className="px-2 py-0.5 bg-blue-500 text-white text-[10px] font-semibold rounded hover:bg-blue-600 transition-colors duration-150 whitespace-nowrap leading-tight"
                        >
                            {buttonText}
                        </button>
                    </motion.div>
                );
            } else {
                pillContent = (
                    <motion.div 
                        key="error_generic_content_block"
                        variants={contentAnimationVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="flex flex-row items-center justify-start w-full h-full px-2 space-x-1.5"
                    >
                        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                        <span className={`${textClass} text-xs`}>{backendError || error || "Error"}</span>
                    </motion.div>
                );
            }
            break;
        case 'ready':
            pillContent = (
                <motion.div 
                    key="ready_content_block"
                    variants={contentAnimationVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="flex items-center justify-start w-full h-full space-x-2 pl-2 pr-6"
                    style={{ transform: 'translateY(0px)' }} // Force consistent vertical alignment
                >
                    <img 
                        src={featherIconPath} 
                        alt="Fethr Ready" 
                        className={`${iconClass} filter drop-shadow-[0_0_4px_#A6F6FF]`} 
                    />
                    <div className="flex-grow h-[55%] min-w-[35px]">
                        <LiveWaveform barColor="#A6F6FF" idleHeight={10} barWidth={3.5} gap={2} isRecording={true} />
                    </div>
                    <span className={`text-sky-300 tabular-nums`}> 
                        0s
                    </span>
                </motion.div>
            );
            break;
        case 'recording':
            pillContent = (
                <motion.div 
                    key="recording_content_block"
                    variants={contentAnimationVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="flex items-center justify-start w-full h-full space-x-2 pl-2 pr-6"
                    style={{ transform: 'translateY(0px)' }} // Force consistent vertical alignment
                >
                    <img 
                        src={featherIconPath} 
                        alt="Stop Recording" 
                        className={`${iconClass} filter drop-shadow-[0_0_4px_#FF4D6D]`}
                    />
                    <div className="flex-grow h-[55%] min-w-[35px]">
                        <LiveWaveform barColor="#FF4D6D" idleHeight={10} barWidth={4} gap={2.5} isRecording={true} />
                    </div>
                    <span className={`tabular-nums flex-shrink-0`}>
                        {duration}
                    </span>
                </motion.div>
            );
            break;
        case 'processing':
            pillContent = (
                <motion.div 
                    key="processing_content_block"
                    variants={contentAnimationVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="flex items-center justify-center w-full h-full"
                >
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-300 flex-shrink-0" />
                </motion.div>
            );
            break;
        default:
            pillContent = (
                <motion.div 
                    key="default_content_block"
                    variants={contentAnimationVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="flex items-center justify-center w-full h-full"
                >
                     <img src={featherIconPath} alt="Fethr" className={`${iconClass} opacity-50`} />
                </motion.div>
            );
            break;
    }

    const basePillClasses = "flex items-center justify-center relative outline outline-1 outline-transparent select-none";

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <motion.div
            ref={pillRef}
            data-tauri-drag-region
            variants={pillContainerVariants}
            initial={false}
            animate={isResizing ? false : targetVariant}
            onHoverStart={() => { if (isIdle && !isResizing) setIsHovered(true); }}
            onHoverEnd={() => setIsHovered(false)}
            layout={false}  // Disable layout animations to prevent jumps
            onAnimationStart={() => {
                console.log(`🎬 [ANIMATION START] Variant: ${targetVariant} | isResizing: ${isResizing} | Duration: 0.3s`);
            }}
            onAnimationComplete={() => {
                console.log(`🎬 [ANIMATION COMPLETE] Variant: ${targetVariant} | isResizing: ${isResizing}`);
            }}
            transition={{ 
                type: "tween", 
                duration: 0.3, 
                ease: "easeInOut",
                delay: isResizing ? 0.2 : 0  // Add delay when resizing
            }}
            className={`${basePillClasses} ${stateClasses}`}
            title={backendError ? String(backendError) : (targetVariant === 'edit_pending' ? "Edit Transcription" : "Fethr")}
            style={{ 
                cursor: 'grab'
            }}
            onContextMenu={handleContextMenu}
            onMouseDown={(e) => {
                const interactiveInner = targetVariant === 'edit_pending' || targetVariant === 'ready' || targetVariant === 'recording' || currentState === RecordingState.ERROR;
                const clickedInteractiveArea = (e.target as HTMLElement).closest('.pill-interactive-content-area');
                if (interactiveInner && clickedInteractiveArea) return;
                appWindow.startDragging().catch(err => console.error("[Pill Main Drag] Error:", err));
            }}
        >
            <div
                onClick={() => {
                    console.log(`[RecordingPill] Inner div clicked. Actual currentState: ${RecordingState[currentState]}, TargetVariant: ${targetVariant}`);
                    if (currentState === RecordingState.ERROR) {
                        console.log("%c[RecordingPill NATIVE CLICK HANDLER] ERROR state confirmed. Attempting to call prop / GLOBAL FALLBACK.", "color: red; font-size: 1.2em; font-weight: bold;");
                        console.log("[RecordingPill NATIVE CLICK HANDLER] Type of onErrorDismiss prop:", typeof onErrorDismiss);
                        if (typeof onErrorDismiss === 'function') {
                            console.log("[RecordingPill NATIVE CLICK HANDLER] onErrorDismiss is a function, calling it.");
                            onErrorDismiss(); // Try the prop first
                        } else {
                            console.error("[RecordingPill NATIVE CLICK HANDLER] onErrorDismiss is NOT a function or is undefined/null. Type:", typeof onErrorDismiss, "Value:", onErrorDismiss);
                            console.log("[RecordingPill NATIVE CLICK HANDLER] Attempting FALLBACK to window.TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT...");
                            if (typeof (window as any).TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT === 'function') {
                                console.log("[RecordingPill NATIVE CLICK HANDLER] Global fallback (via effect) function found! Calling it.");
                                (window as any).TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT();
                            } else {
                                console.error("[RecordingPill NATIVE CLICK HANDLER] Global fallback (via effect) function NOT found either. Type:", typeof (window as any).TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT);
                            }
                        }
                    } else if (targetVariant === 'edit_pending') {
                        console.log("[RecordingPill] EDIT_PENDING state clicked, calling onEditClick.");
                        onEditClick?.();
                    } else if (
                        currentState === RecordingState.IDLE ||
                        currentState === RecordingState.RECORDING ||
                        currentState === RecordingState.LOCKED_RECORDING
                    ) {
                        console.log("[RecordingPill] Operational state click. Calling handleContentAreaClick with actual currentState.");
                        handleContentAreaClick(currentState);
                    } else {
                        console.log(`[RecordingPill] Click in state ${RecordingState[currentState]} / variant ${targetVariant} not handled by primary actions.`);
                    }
                }}
                onMouseDown={(e) => {
                    if (currentState === RecordingState.ERROR || targetVariant === 'edit_pending' || 
                        targetVariant === 'idle' || targetVariant === 'ready' || 
                        targetVariant === 'recording') {
                        e.stopPropagation();
                    }
                }}
                className={`pill-interactive-content-area w-full h-full relative flex items-center justify-center`}
                style={{
                    cursor: (
                        currentState === RecordingState.ERROR ||
                        targetVariant === 'edit_pending' ||
                        targetVariant === 'idle' ||
                        targetVariant === 'ready' ||
                        targetVariant === 'recording'
                    ) ? 'pointer' : 'grab'
                }}
                // Removed title attribute as we're using Tooltip component now
            >
                <AnimatePresence mode='popLayout' initial={false}>
                    {pillContent}
                </AnimatePresence>
            </div>
                    </motion.div>
                </TooltipTrigger>
                {isIdle && (
                    <TooltipContent 
                        side="top" 
                        className="bg-neutral-900 border-neutral-800 text-neutral-100 px-3 py-2 text-sm"
                    >
                        Click to begin dictation
                    </TooltipContent>
                )}
            </Tooltip>
            
            {/* Context Menu */}
            {showContextMenu && (
                <DropdownMenu 
                    className="fixed" 
                    style={{ 
                        top: `${contextMenuPosition.y}px`, 
                        left: `${contextMenuPosition.x}px` 
                    }}
                >
                    <DropdownMenuItem onClick={handleHideFor1Hour}>
                        <EyeOff className="w-4 h-4 mr-2" />
                        Hide for 1 hour
                    </DropdownMenuItem>
                    
                    <DropdownMenuSeparator />
                    
                    <DropdownMenuItem onClick={handleOpenSettings}>
                        <Settings className="w-4 h-4 mr-2" />
                        Go to Settings
                    </DropdownMenuItem>
                    
                    <DropdownMenuItem>
                        <Globe className="w-4 h-4 mr-2" />
                        Select Language
                    </DropdownMenuItem>
                    
                    <DropdownMenuItem onClick={handleOpenHistory}>
                        <History className="w-4 h-4 mr-2" />
                        Transcription History
                    </DropdownMenuItem>
                    
                    <DropdownMenuSeparator />
                    
                    <DropdownMenuItem 
                        onClick={handlePasteLastTranscript}
                        disabled={!lastTranscription}
                    >
                        <Clipboard className="w-4 h-4 mr-2" />
                        Paste Last Transcript
                    </DropdownMenuItem>
                </DropdownMenu>
            )}
        </TooltipProvider>
    );
};

export default RecordingPill; 