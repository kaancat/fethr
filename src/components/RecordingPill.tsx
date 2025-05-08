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
}

// Add edit_pending to variants
type PillVariant = 'idle' | 'ready' | 'recording' | 'processing' | 'error' | 'edit_pending';

// --- Animation Variants (with explicit styling) ---
const pillContainerVariants = {
  idle: { width: "28px", height: "28px", padding: "4px", borderRadius: "9999px", backgroundColor: "rgba(10, 15, 26, 0.0)", boxShadow: "0 0 5px rgba(166, 246, 255, 0.2)", border: "1px solid transparent", opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
  edit_pending: { width: "28px", height: "28px", padding: "4px", borderRadius: "9999px", backgroundColor: "rgba(10, 15, 26, 0.0)", boxShadow: "0 0 6px rgba(34, 197, 94, 0.4)", border: "1px solid rgba(34, 197, 94, 0.3)", opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
  ready: { width: "auto", height: "32px", padding: "4px", minWidth: "100px", borderRadius: "9999px", backgroundColor: "rgba(10, 15, 26, 0.9)", boxShadow: "0 0 10px rgba(166, 246, 255, 0.4)", border: "1px solid rgba(166, 246, 255, 0.1)", opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
  recording: { width: "auto", height: "32px", padding: "4px", minWidth: "100px", borderRadius: "9999px", backgroundColor: "rgba(2, 4, 9, 1)", boxShadow: "0 0 8px rgba(255, 77, 109, 0.26)", border: "1px solid rgba(255, 77, 109, 0.5)", opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
  processing: { width: "auto", height: "32px", padding: "4px 8px", minWidth: "50px", borderRadius: "9999px", backgroundColor: "rgba(2, 4, 9, 1)", boxShadow: "0 0 10px rgba(139, 158, 255, 0.4)", border: "1px solid rgba(139, 158, 255, 0.5)", opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
  error: { width: "auto", height: "32px", padding: "4px 8px", minWidth: "100px", borderRadius: "9999px", backgroundColor: "rgba(194, 65, 12, 0.2)", boxShadow: "0 0 8px rgba(255, 139, 102, 0.26)", border: "1px solid rgba(249, 115, 22, 0.5)", opacity: 1, transition: { duration: 0.3, ease: "easeOut" } }
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
    initial: { opacity: 0, scale: 0.9, x: -8 }, 
    animate: { opacity: 1, scale: 1, x: 0, transition:{ duration: 0.2, ease: "circOut" } }, 
    exit: { opacity:0, scale:0.9, x: 8, transition:{ duration:0.1, ease: "circIn" }} 
};

const featherIconPath = "/feather-logo.png";
const editIconPath = "/Icons/edit icon.png";

const RecordingPill: React.FC<RecordingPillProps> = ({ currentState, duration, transcription, error, backendError, onEditClick }) => {
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

    const handleContentAreaClick = async () => {
        console.log(`[Pill Inner Click] Action based on targetVariant: ${targetVariant}`);
        if (targetVariant === 'edit_pending') {
            if (onEditClick) onEditClick();
        } else if (targetVariant === 'ready') {
            try { await invoke('trigger_press_event'); } 
            catch (err) { console.error('Error invoking trigger_press_event:', err); }
        } else if (targetVariant === 'recording') {
            try { await invoke('trigger_release_event'); } 
            catch (err) { console.error('Error invoking trigger_release_event:', err); }
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
                <motion.div key="idle" {...contentAnimationVariants} className="flex items-center justify-center w-full h-full">
                    <img src={featherIconPath} alt="Fethr" className={`${iconClass} filter drop-shadow-[0_0_4px_#A6F6FF]`} />
                </motion.div>
            );
            break;
        case 'edit_pending':
            pillContent = (
                <motion.div key="edit" {...contentAnimationVariants} className="flex items-center justify-center w-full h-full">
                    <img src={editIconPath} alt="Edit" className={`${iconClass} filter brightness-125 saturate-150`} />
                </motion.div>
            );
            break;
        case 'error':
            pillContent = (
                <motion.div key="error" {...contentAnimationVariants} className="flex items-center justify-start w-full h-full px-2 space-x-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <span className={textClass}>Error</span>
                </motion.div>
            );
            break;
        case 'ready':
            pillContent = (
                <motion.div key="ready" {...contentAnimationVariants} className="flex items-center justify-between w-full h-full space-x-1.5">
                    <img src={featherIconPath} alt="Fethr Ready" className={`${iconClass} filter drop-shadow-[0_0_4px_#A6F6FF]`} />
                    <div className="flex-grow h-[55%] min-w-[35px]">
                        <LiveWaveform barColor="#A6F6FF" idleHeight={10} barWidth={3.5} gap={2} isRecording={true} />
                    </div>
                    <span className={`text-sky-300 tabular-nums`}>0s</span>
                </motion.div>
            );
            break;
        case 'recording':
            pillContent = (
                <motion.div key="recording" {...contentAnimationVariants} className="flex items-center justify-between w-full h-full space-x-1.5">
                    <img src={featherIconPath} alt="Stop Recording" className={`${iconClass} filter drop-shadow-[0_0_4px_#FF4D6D]`} />
                    <div className="flex-grow h-[65%] min-w-[50px]">
                        <LiveWaveform barColor="#FF4D6D" idleHeight={10} barWidth={4} gap={2.5} isRecording={true} />
                    </div>
                    <span className={`tabular-nums flex-shrink-0`}>{duration}</span>
                </motion.div>
            );
            break;
        case 'processing':
            pillContent = (
                <motion.div key="processing" {...contentAnimationVariants} className="flex items-center justify-center w-full h-full">
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-300 flex-shrink-0" />
                </motion.div>
            );
            break;
        default:
            pillContent = (
                <motion.div key="default" {...contentAnimationVariants} className="flex items-center justify-center w-full h-full">
                     <img src={featherIconPath} alt="Fethr" className={`${iconClass} opacity-50`} />
                </motion.div>
            );
            break;
    }

    const basePillClasses = "flex items-center justify-center relative overflow-hidden outline outline-1 outline-transparent select-none";

    return (
        <motion.div
            data-tauri-drag-region
            layout
            variants={pillContainerVariants}
            initial={false}
            animate={targetVariant}
            onHoverStart={() => { if (isIdle) setIsHovered(true); }}
            onHoverEnd={() => setIsHovered(false)}
            transition={{ type: "tween", duration: 0.3, ease: "easeInOut" }}
            className={`${basePillClasses} ${stateClasses}`}
            title={backendError ? String(backendError) : (targetVariant === 'edit_pending' ? "Edit Transcription" : "Fethr")}
            style={{ cursor: 'grab' }}
            onMouseDown={(e) => {
                const interactiveInner = targetVariant === 'edit_pending' || targetVariant === 'ready' || targetVariant === 'recording';
                const clickedInteractiveArea = (e.target as HTMLElement).closest('.pill-interactive-content-area');
                if (interactiveInner && clickedInteractiveArea) return;
                appWindow.startDragging().catch(err => console.error("[Pill Main Drag] Error:", err));
            }}
        >
            <div
                className={`pill-interactive-content-area w-full h-full relative`} 
                onClick={handleContentAreaClick}
                onMouseDown={(e) => {
                    if (targetVariant === 'edit_pending' || targetVariant === 'ready' || targetVariant === 'recording') {
                        e.stopPropagation();
                    }
                }}
                style={{
                    cursor: (targetVariant === 'edit_pending' || targetVariant === 'ready' || targetVariant === 'recording') ? 'pointer' : 'default' 
                }}
            >
                <AnimatePresence mode='wait' initial={false}>
                    {pillContent}
                </AnimatePresence>
            </div>
        </motion.div>
    );
};

export default RecordingPill; 