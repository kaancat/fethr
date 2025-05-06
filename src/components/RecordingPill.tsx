import React, { useState } from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertTriangle } from "lucide-react";
import { RecordingState } from '../types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import LiveWaveform from './LiveWaveform'; // Import the new LiveWaveform component
import { invoke } from '@tauri-apps/api/tauri';

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
  idle: {
    width: "28px", height: "28px", padding: "4px", minWidth: "28px", borderRadius: "9999px",
    backgroundColor: "rgba(10, 15, 26, 0.0)", // Use transparent equivalent for gradient start/end for animation, or a solid color
    // backgroundColor: "linear-gradient(135deg, #0A0F1A 0%, #020409 100%)", // Gradient might not animate smoothly
    boxShadow: "0 0 5px rgba(166, 246, 255, 0.2)", // #A6F6FF33
    border: "1px solid transparent",
    borderColor: "transparent",
    opacity: 1,
    transition: { duration: 0.3, ease: "easeOut" }
  },
  edit_pending: {
    width: "28px", height: "28px", padding: "4px", minWidth: "28px", borderRadius: "9999px",
    backgroundColor: "rgba(10, 15, 26, 0.0)", // Keep consistent with idle for size transition
    boxShadow: "0 0 6px rgba(34, 197, 94, 0.4)", // #22C55E66
    border: "1px solid rgba(34, 197, 94, 0.3)", // border-green-500/30
    borderColor: "rgba(34, 197, 94, 0.3)",
    opacity: 1,
    transition: { duration: 0.3, ease: "easeOut" }
  },
  ready: {
    width: "auto", height: "32px", padding: "4px 8px", minWidth: "110px", borderRadius: "9999px",
    backgroundColor: "rgba(10, 15, 26, 0.9)", // bg-gradient-to-br from-[#0A0F1A] to-[#020409] (approximation)
    boxShadow: "0 0 10px rgba(166, 246, 255, 0.4)", // hover:shadow-[0_0_10px_#A6F6FF66]
    border: "1px solid rgba(166, 246, 255, 0.1)", // border-[#A6F6FF]/10
    borderColor: "rgba(166, 246, 255, 0.1)",
    opacity: 1,
    transition: { duration: 0.3, ease: "easeOut" }
   },
  recording: {
    width: "auto", height: "32px", padding: "4px 8px", minWidth: "110px", borderRadius: "9999px",
    backgroundColor: "rgba(2, 4, 9, 1)", // bg-[#020409]
    boxShadow: "0 0 8px rgba(255, 77, 109, 0.26)", // shadow-[0_0_8px_#FF4D6D44]
    border: "1px solid rgba(255, 77, 109, 0.5)", // border-[#FF4D6D]/50
    borderColor: "rgba(255, 77, 109, 0.5)",
    opacity: 1,
    transition: { duration: 0.3, ease: "easeOut" }
  },
  processing: {
    width: "auto", height: "32px", padding: "4px 8px", minWidth: "70px", borderRadius: "9999px",
    backgroundColor: "rgba(2, 4, 9, 1)", // bg-[#020409]
    boxShadow: "0 0 10px rgba(139, 158, 255, 0.4)", // shadow-[0_0_10px_#8B9EFF66]
    border: "1px solid rgba(139, 158, 255, 0.5)", // border-[#8B9EFF]/50
    borderColor: "rgba(139, 158, 255, 0.5)",
    opacity: 1,
    transition: { duration: 0.3, ease: "easeOut" }
  },
  error: {
    width: "auto", height: "32px", padding: "4px 8px", minWidth: "110px", borderRadius: "9999px",
    backgroundColor: "rgba(194, 65, 12, 0.2)", // bg-orange-700/20
    boxShadow: "0 0 8px rgba(255, 139, 102, 0.26)", // shadow-[0_0_8px_#FF8B6644]
    border: "1px solid rgba(249, 115, 22, 0.5)", // border-orange-500/50
    borderColor: "rgba(249, 115, 22, 0.5)",
    opacity: 1,
    transition: { duration: 0.3, ease: "easeOut" }
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

const contentVariants = {
  hidden: { opacity: 0, scale: 0.95, x: 5 },
  visible: { 
    opacity: 1, 
    scale: 1, 
    x: 0, 
    transition: { duration: 0.2, delay: 0.1 } 
  },
  exit: { 
    opacity: 0, 
    scale: 0.95, 
    x: -5, 
    transition: { duration: 0.1 } 
  }
};

const RecordingPill: React.FC<RecordingPillProps> = ({ currentState, duration, transcription, error, backendError, onEditClick }) => {
    const isIdle = currentState === RecordingState.IDLE;
    const isRecording = currentState === RecordingState.RECORDING || currentState === RecordingState.LOCKED_RECORDING;
    const isProcessing = currentState === RecordingState.TRANSCRIBING || currentState === RecordingState.PASTING;
    const isEditPending = currentState === RecordingState.SUCCESS_EDIT_PENDING;
    const isError = currentState === RecordingState.ERROR || !!backendError;
    const showTranscription = isIdle && transcription && !error && !backendError;
    
    // Track hover state
    const [isHovered, setIsHovered] = useState(false);
    
    // Determine the target variant
    let targetVariant: PillVariant = 'idle';

    if (backendError) {
        targetVariant = 'error';
    } else if (isEditPending) {
        targetVariant = 'edit_pending';
    } else if (isIdle && isHovered) {
        targetVariant = 'ready';
    } else if (isRecording) {
        targetVariant = 'recording';
    } else if (isProcessing) {
        targetVariant = 'processing';
    } else if (isError) {
        targetVariant = 'error';
    } else {
        targetVariant = 'idle';
    }

    // Click handler for the feather icon
    const handleIconClick = async () => {
        console.log(`Icon clicked in state: ${targetVariant}`); // Keep overall log

        if (targetVariant === 'ready') {
            try {
                // Start recording by simulating a press
                console.log('Invoking trigger_press_event via UI click...');
                await invoke('trigger_press_event');
                console.log('trigger_press_event invoked successfully.');
            } catch (error) {
                console.error('Error invoking trigger_press_event:', error);
            }
        } else if (targetVariant === 'recording') {
            try {
                // Stop recording by simulating a release
                console.log('Invoking trigger_release_event (to stop) via UI click...'); // Log updated
                await invoke('trigger_release_event'); // USE RELEASE HERE
                console.log('trigger_release_event (to stop) invoked successfully.'); // Log updated
            } catch (error) {
                console.error('Error invoking trigger_release_event (to stop):', error); // Log updated
            }
        } else {
            console.log('Icon click ignored in current state.'); // Keep this part
        }
    };

    // Simplified stateClasses - only add non-layout/non-variant styles
    let stateClasses = "text-white"; // Base text color
    if (targetVariant === 'recording' || targetVariant === 'error') {
        stateClasses += " text-xs font-mono"; // Specific text style for these states
    } else if (targetVariant === 'processing') {
        stateClasses += " text-[#8B9EFF]"; // Specific text color
    }
    // Add hover effects not handled by variants if needed
    if (targetVariant === 'idle' && !isHovered) {
        stateClasses += " hover:shadow-[0_0_10px_#A6F6FF66]"; // Idle non-hover needs hover shadow
    } else if (targetVariant === 'edit_pending') {
        stateClasses += " hover:shadow-[0_0_10px_#22C55E99]"; // Edit pending hover shadow
    } // Other hover shadows are handled by the 'ready'/'recording' etc. variants
    
    // Log the props received by this component render
    console.log(`---> RecordingPill Rendering: State=${RecordingState[currentState]}(${currentState}), Duration=${duration}, Trans=${transcription ? transcription.substring(0,10)+'...' : 'none'}, Err=${error || 'none'}, BackendErr=${backendError || 'none'}, Hovered=${isHovered}`);

    // --- Determine Content Before Return --- 
    let iconElement: React.ReactNode = null;
    let mainContentElement: React.ReactNode = null;

    switch (targetVariant) {
        case 'idle':
            iconElement = (
                <motion.div layoutId="feather-icon-idle" className="absolute inset-0 flex items-center justify-center">
                    <img src="/feather-logo.png" alt="Fethr" className="w-5 h-5 object-contain filter drop-shadow-[0_0_4px_#A6F6FF]" />
                </motion.div>
            );
            break;
        case 'edit_pending':
            iconElement = (
                <motion.div layoutId="edit-icon-pending" className="absolute inset-0 flex items-center justify-center">
                    <img src="/Icons/edit icon.png" alt="Edit" className="w-5 h-5 filter brightness-125 saturate-150 hover:opacity-80" />
                </motion.div>
            );
            break;
        case 'error':
            iconElement = (
                 <div className="flex-shrink-0 flex items-center justify-center z-10 ml-3 mr-2">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                 </div>
            );
            // Optionally add error message text to mainContentElement here if desired
             mainContentElement = (
                 <div className="flex-grow h-full flex items-center overflow-hidden relative min-w-0 ml-1 mr-2">
                     <span className="text-xs text-red-400 truncate">Error</span>
                 </div>
             );
            break;
        case 'ready':
        case 'recording':
        case 'processing':
            // Icon for active states
             iconElement = (
                <motion.div
                    layoutId="feather-icon-active"
                    variants={iconVariant} 
                    animate={{
                        ...iconVariant[targetVariant as keyof typeof iconVariant],
                        rotate: targetVariant === 'ready' ? [0, -10, 10, -5, 5, 0] : 0,
                        scale: iconVariant[targetVariant as keyof typeof iconVariant].scale,
                    }}
                    transition={{
                        duration: 0.2,
                        rotate: targetVariant === 'ready'
                            ? {
                                duration: 1.2,
                                repeat: Infinity,
                                ease: "easeInOut",
                              }
                            : {
                                duration: 0.2,
                                ease: "easeOut",
                              }
                    }}
                    className={`flex-shrink-0 flex items-center justify-center z-10 ${targetVariant === 'ready' || targetVariant === 'recording' ? 'cursor-pointer' : ''}`}
                    onClick={targetVariant === 'ready' || targetVariant === 'recording' ? handleIconClick : undefined}
                 >
                    <img src="/feather-logo.png" alt="Fethr" className="w-5 h-5 object-contain filter drop-shadow-[0_0_4px_#A6F6FF]" />
                 </motion.div>
            );
            // Content for active states
            mainContentElement = (
                 <div className="flex-grow h-full flex items-center overflow-hidden relative min-w-0 ml-2">
                     <AnimatePresence mode="wait" initial={false}>
                         <motion.div
                             key={targetVariant} // Animate based on variant change
                             variants={contentVariants}
                             initial="hidden"
                             animate="visible"
                             exit="exit"
                             className="flex items-center justify-end w-full h-full space-x-1.5"
                         >
                             {(targetVariant === 'recording' || targetVariant === 'ready') && <LiveWaveform />} {/* Show for ready too */}
                             {targetVariant === 'processing' && <Loader2 className="w-4 h-4 animate-spin" />} 
                             {targetVariant === 'recording' && <span className="flex-shrink-0 font-mono text-xs">{duration}</span>} 
                             {targetVariant === 'ready' && <span className="flex-shrink-0 font-mono text-xs text-gray-500">0s</span>} 
                         </motion.div>
                     </AnimatePresence>
                 </div>
            );
            break;
    }

    // Define base classes for the motion.div
    const basePillClasses = "flex items-center relative overflow-hidden outline outline-1 outline-transparent";
    const justificationClass = (targetVariant === 'idle' || targetVariant === 'edit_pending') ? 'justify-center' : 'justify-start';

    return (
        <motion.div
            layout
            variants={pillContainerVariants}
            initial="idle"
            animate={targetVariant}
            onHoverStart={() => { if (currentState === RecordingState.IDLE) setIsHovered(true); }}
            onHoverEnd={() => setIsHovered(false)}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={`${basePillClasses} ${justificationClass} ${stateClasses}`}
            title={backendError ? backendError : (targetVariant === 'edit_pending' ? "Edit Last Transcription (Click Pill)" : undefined)}
            onClick={targetVariant === 'edit_pending' ? (e) => { e.stopPropagation(); onEditClick?.(); } : undefined}
            style={{ cursor: targetVariant === 'edit_pending' ? 'pointer' : 'default' }}
        >
            {/* Render the determined icon and content */} 
            {iconElement}
            {mainContentElement}

            {/* Transcription bubble logic can remain the same */}
            {/* {showTranscription && ( ... )} */}
        </motion.div>
    );
};

export default RecordingPill; 