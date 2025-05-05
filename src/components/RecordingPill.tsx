import React, { useState } from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
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
}

// --- Animation Variants ---
const pillContainerVariants = {
  idle: {
    width: "28px",
    height: "28px",
    padding: "4px",
    minWidth: "28px",
    borderRadius: "9999px"
  },
  ready: {
    width: "auto",
    height: "32px",
    padding: "4px 8px",
    minWidth: "110px",
    borderRadius: "9999px"
  },
  recording: {
    width: "auto",
    height: "32px",
    padding: "4px 8px",
    minWidth: "110px",
    borderRadius: "9999px"
  },
  processing: {
    width: "auto",
    height: "32px",
    padding: "4px 8px",
    minWidth: "70px",
    borderRadius: "9999px"
  },
  error: {
    width: "auto",
    height: "32px",
    padding: "4px 8px",
    minWidth: "110px",
    borderRadius: "9999px"
  }
};

const iconVariant = {
  idle: { opacity: 1, scale: 1, x: 0 },
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

const RecordingPill: React.FC<RecordingPillProps> = ({ currentState, duration, transcription, error }) => {
    const isIdle = currentState === RecordingState.IDLE;
    const isRecording = currentState === RecordingState.RECORDING || currentState === RecordingState.LOCKED_RECORDING;
    const isProcessing = currentState === RecordingState.TRANSCRIBING || currentState === RecordingState.PASTING;
    const isError = currentState === RecordingState.ERROR;
    const showTranscription = isIdle && transcription && !error;
    
    // Track hover state
    const [isHovered, setIsHovered] = useState(false);
    
    // Determine the target variant: idle, ready (on hover), recording, processing, error
    let targetVariant = "idle";
    if (isIdle && isHovered) targetVariant = "ready";
    else if (isRecording) targetVariant = "recording";
    else if (isProcessing) targetVariant = "processing";
    else if (isError) targetVariant = "error";

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

    // State classes for non-layout styles
    let stateClasses = "text-white"; // Base text color
    if (isIdle && isHovered) {
        // Only apply dark background when idle AND hovered
        stateClasses += " bg-gradient-to-br from-[#0A0F1A] to-[#020409] shadow-[0_0_5px_#A6F6FF33] hover:shadow-[0_0_10px_#A6F6FF66] border border-[#A6F6FF]/10";
    } else if (isIdle && !isHovered) {
        // No background when idle and not hovered, just minimal styling
        stateClasses += " shadow-[0_0_5px_#A6F6FF33] hover:shadow-[0_0_10px_#A6F6FF66]";
    } else if (isRecording) {
        stateClasses += " bg-[#020409] border border-[#FF4D6D]/50 shadow-[0_0_8px_#FF4D6D44] hover:shadow-[0_0_12px_#FF4D6D77] text-xs font-mono";
    } else if (isProcessing) {
        stateClasses += " bg-[#020409] border border-[#8B9EFF]/50 shadow-[0_0_10px_#8B9EFF66] text-[#8B9EFF]";
    } else if (isError) {
        stateClasses += " bg-orange-700/20 border border-orange-500/50 shadow-[0_0_8px_#FF8B6644] text-xs font-mono";
    }
    
    // Log the props received by this component render
    console.log(`---> RecordingPill Rendering: State=${RecordingState[currentState]}(${currentState}), Duration=${duration}, Trans=${transcription ? transcription.substring(0,10)+'...' : 'none'}, Err=${error || 'none'}, Hovered=${isHovered}`);

    return (
        <motion.div
            layout // Animate layout: size, position, padding, border-radius
            variants={pillContainerVariants}
            initial="idle"
            animate={targetVariant} // Animate based on hover OR actual state
            onHoverStart={() => { if (isIdle) setIsHovered(true); }}
            onHoverEnd={() => setIsHovered(false)}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={`flex items-center ${targetVariant === 'idle' ? 'justify-center' : 'justify-start'} relative overflow-hidden ${stateClasses} outline outline-1 outline-transparent`}
        >
            {/* Icon - always present, part of flex, animates scale/opacity */}
            <motion.div
                layoutId="feather-icon"
                variants={iconVariant}
                onClick={handleIconClick}
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
                className={`flex-shrink-0 flex items-center justify-center z-10 ${
                    targetVariant === 'ready' || targetVariant === 'recording' ? 'cursor-pointer' : ''
                }`}
            >
                <img
                    src="/feather-logo.png"
                    alt="Fethr"
                    className="w-5 h-5 object-contain filter drop-shadow-[0_0_4px_#A6F6FF]"
                />
            </motion.div>

            {/* Content Area - only render when not in idle state */}
            {targetVariant !== 'idle' && (
                <div className="flex-grow h-full flex items-center overflow-hidden relative min-w-0 ml-2">
                    <AnimatePresence mode="wait" initial={false}>
                        {/* Show content ONLY if not idle */}
                        {(targetVariant !== 'idle') && (
                            <motion.div
                                key="content"
                                variants={contentVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                className="flex items-center justify-end w-full h-full space-x-1.5"
                            >
                                {/* Show LiveWaveform during both hover and actual recording */}
                                {(isRecording || targetVariant === 'ready') && <LiveWaveform />}
                                {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                                {isError && <span className="truncate text-xs font-mono" title={error}>⚠️ Error</span>}
                                {isRecording && <span className="flex-shrink-0 font-mono text-xs">{duration}</span>}
                                {(targetVariant === 'ready' && !isRecording) && <span className="flex-shrink-0 font-mono text-xs text-gray-500">0s</span>}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}
        </motion.div>
    );
};

export default RecordingPill; 