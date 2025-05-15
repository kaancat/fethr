import React, { useState } from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertTriangle } from "lucide-react";
import { RecordingState } from '../types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import LiveWaveform from './LiveWaveform'; // Import the new LiveWaveform component
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window'; // <-- Import appWindow

/**
 * RecordingPill is a floating UI component that shows recording status and hotkey info
 * 
 * What it does: Provides visual feedback about recording state
 * Why it exists: Users need to know when recording is active and what hotkey to use
 */

// Example Placeholder Waveform (replace later with actual audio visualization)
const WaveformPlaceholder = () => (
     <div className="flex items-center space-x-0.5 h-3">
         <span className="block w-0.5 h-1 bg-white rounded-full"></span>
         <span className="block w-0.5 h-2 bg-white/80 rounded-full"></span>
         <span className="block w-0.5 h-3 bg-white/90 rounded-full"></span>
         <span className="block w-0.5 h-2 bg-white/80 rounded-full"></span>
         <span className="block w-0.5 h-1 bg-white rounded-full"></span>
     </div>
);

// Define the props the component will accept
interface RecordingPillProps {
    currentState: RecordingState;
    duration: string; // Expecting pre-formatted string like "0s"
    transcription?: string; // Optional transcription text
    error?: string; // Optional error message
    backendError?: string | null; // Optional backend error message from Rust
    onEditClick?: () => void; // <-- Add prop back
    onErrorDismiss?: () => void; // Make sure this prop exists
}

// Add edit_pending to variants
type PillVariant = 'idle' | 'ready' | 'recording' | 'processing' | 'error' | 'edit_pending';

// --- Animation Variants (with explicit styling) ---
const pillContainerVariants = {
  idle: { 
    width: "28px", 
    height: "28px", 
    padding: "4px", // This should result in a 28+4+4 = 36px total outer size if box-sizing is content-box, or 28px if border-box
    borderRadius: "50%", 
    backgroundColor: "rgba(10, 15, 26, 0.0)", 
    boxShadow: "0 0 5px rgba(166, 246, 255, 0.2)", 
    border: "1px solid transparent", 
    opacity: 1 
  },
  edit_pending: { 
    width: "28px", 
    height: "28px", 
    padding: "4px", 
    borderRadius: "50%", 
    backgroundColor: "rgba(10, 15, 26, 0.0)", 
    boxShadow: "0 0 6px rgba(34, 197, 94, 0.4)", 
    border: "1px solid rgba(34, 197, 94, 0.3)", 
    opacity: 1 
  },
  ready: { 
    width: "120px", height: "32px", 
    padding: "4px 8px", 
    borderRadius: "16px", 
    backgroundColor: "rgba(10, 15, 26, 0.9)", 
    // boxShadow: "0 0 10px rgba(166, 246, 255, 0.4)", // <<< TEMPORARILY COMMENT OUT
    // border: "1px solid rgba(166, 246, 255, 0.1)",    // <<< TEMPORARILY COMMENT OUT
    opacity: 1 
  },
  recording: { 
    width: "120px", height: "32px", 
    padding: "4px 8px", 
    borderRadius: "16px",
    backgroundColor: "rgba(2, 4, 9, 1)", 
    // boxShadow: "0 0 8px rgba(255, 77, 109, 0.26)", // <<< TEMPORARILY COMMENT OUT
    // border: "1px solid rgba(255, 77, 109, 0.5)",    // <<< TEMPORARILY COMMENT OUT
    opacity: 1 
  },
  processing: { 
    width: "auto", height: "32px", padding: "4px 8px", minWidth: "50px", borderRadius: "16px",
    backgroundColor: "rgba(2, 4, 9, 1)", boxShadow: "0 0 10px rgba(139, 158, 255, 0.4)", 
    border: "1px solid rgba(139, 158, 255, 0.5)", opacity: 1 
  },
  error: { 
    width: "auto", height: "32px", padding: "4px 8px", minWidth: "100px", borderRadius: "16px",
    backgroundColor: "rgba(194, 65, 12, 0.2)", boxShadow: "0 0 8px rgba(255, 139, 102, 0.26)", 
    border: "1px solid rgba(249, 115, 22, 0.5)", opacity: 1 
  }
};

const iconVariant = {
  idle: { opacity: 1, scale: 1, x: 0 },
  edit_pending: { opacity: 1, scale: 1, x: 0 },
  ready: { opacity: 0.9, scale: 0.9, x: 0 }, // Keep icon in flow, don't translate
  recording: { opacity: 0.9, scale: 0.9, x: 0 }, // Keep it in flow
  processing: { opacity: 0.6, scale: 0.8, x: 0 }, // Centered when processing
  error: { opacity: 1, scale: 0.9, x: 0 } // Centered on error
};

const contentAnimationVariants = { 
    initial: { opacity: 0, scale: 0.9 }, 
    animate: { opacity: 1, scale: 1, transition:{ duration: 0.2, ease: "circOut" } }, 
    exit: { opacity:0, scale:0.9, transition:{ duration:0.1, ease: "circIn" }} 
};

const featherIconPath = "/feather-logo.png";
const editIconPath = "/Icons/edit icon.png";

const RecordingPill: React.FC<RecordingPillProps> = ({ currentState, duration, transcription, error, backendError, onEditClick, onErrorDismiss }) => {
    const isIdle = currentState === RecordingState.IDLE;
    const isRecordingState = currentState === RecordingState.RECORDING || currentState === RecordingState.LOCKED_RECORDING;
    const isProcessingState = currentState === RecordingState.TRANSCRIBING || currentState === RecordingState.PASTING;
    const isEditPending = currentState === RecordingState.SUCCESS_EDIT_PENDING;
    const isErrorUiState = currentState === RecordingState.ERROR || !!backendError;
    
    const [isHovered, setIsHovered] = useState(false);
    
    let targetVariant: PillVariant = 'idle';
    if (backendError) targetVariant = 'error';
    else if (isEditPending) targetVariant = 'edit_pending';
    else if (isIdle && isHovered) targetVariant = 'ready';
    else if (isRecordingState) targetVariant = 'recording';
    else if (isProcessingState) targetVariant = 'processing';
    else if (isErrorUiState) targetVariant = 'error';
    else targetVariant = 'idle';

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
            pillContent = (
                <motion.div 
                    key="error_content_block"
                    variants={contentAnimationVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="flex items-center justify-start w-full h-full px-2 space-x-1.5"
                >
                    <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <span className={textClass}>Error</span>
                </motion.div>
            );
            break;
        case 'ready':
            pillContent = (
                <motion.div 
                    key="ready_content_block"
                    variants={contentAnimationVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="flex items-center justify-between w-full h-full space-x-1.5 px-1.5"
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
                    className="flex items-center justify-between w-full h-full space-x-1.5 px-1.5"
                >
                    <img 
                        src={featherIconPath} 
                        alt="Stop Recording" 
                        className={`${iconClass} filter drop-shadow-[0_0_4px_#FF4D6D]`}
                    />
                    <div className="flex-grow h-[65%] min-w-[50px]">
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

    const basePillClasses = "flex items-center justify-center relative overflow-hidden outline outline-1 outline-transparent select-none";

    return (
        <motion.div
            data-tauri-drag-region
            variants={pillContainerVariants}
            initial={false}
            animate={targetVariant}
            onHoverStart={() => { if (isIdle) setIsHovered(true); }}
            onHoverEnd={() => setIsHovered(false)}
            transition={{ type: "tween", duration: 0.3, ease: "easeInOut" }}
            className={`${basePillClasses} ${stateClasses}`}
            title={backendError ? String(backendError) : (targetVariant === 'edit_pending' ? "Edit Transcription" : "Fethr")}
            style={{ 
                cursor: 'grab', 
                overflow: "hidden"
            }}
            onContextMenu={(e: React.MouseEvent) => e.preventDefault()}
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
                title={ currentState === RecordingState.ERROR ? (error || backendError || 'Error - Click to dismiss') : 
                        (targetVariant === 'edit_pending' ? 'Edit Last Transcription' : 
                        (currentState === RecordingState.IDLE ? 'Click to Record' : 
                        (currentState === RecordingState.RECORDING || currentState === RecordingState.LOCKED_RECORDING ? 'Click to Stop' : 'Fethr')))
                      }
            >
                <AnimatePresence mode='popLayout' initial={false}>
                    {pillContent}
                </AnimatePresence>
            </div>
        </motion.div>
    );
};

export default RecordingPill; 