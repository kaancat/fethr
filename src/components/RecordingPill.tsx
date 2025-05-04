import React from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { RecordingState } from '../types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import LiveWaveform from './LiveWaveform'; // Import the new LiveWaveform component

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
  idle: { opacity: 1, scale: 1 },
  recording: { opacity: 1, scale: 0.9 },
  processing: { opacity: 0.6, scale: 0.8 },
  error: { opacity: 1, scale: 0.9 }
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
    
    let containerVariant = "idle";
    if (isRecording) containerVariant = "recording";
    else if (isProcessing) containerVariant = "processing";
    else if (isError) containerVariant = "error";

    // State classes for non-layout styles
    let stateClasses = "text-white"; // Base text color
    if (isIdle) {
        stateClasses += " bg-gradient-to-br from-[#0A0F1A] to-[#020409] shadow-[0_0_5px_#A6F6FF33] hover:shadow-[0_0_10px_#A6F6FF66] border border-[#A6F6FF]/10";
    } else if (isRecording) {
        stateClasses += " bg-[#020409] border border-[#FF4D6D]/50 shadow-[0_0_8px_#FF4D6D44] hover:shadow-[0_0_12px_#FF4D6D77] text-xs font-mono";
    } else if (isProcessing) {
        stateClasses += " bg-[#020409] border border-[#8B9EFF]/50 shadow-[0_0_10px_#8B9EFF66] text-[#8B9EFF]";
    } else if (isError) {
        stateClasses += " bg-orange-700/20 border border-orange-500/50 shadow-[0_0_8px_#FF8B6644] text-xs font-mono";
    }
    
    // Log the props received by this component render
    console.log(`---> RecordingPill Rendering: State=${RecordingState[currentState]}(${currentState}), Duration=${duration}, Trans=${transcription ? transcription.substring(0,10)+'...' : 'none'}, Err=${error || 'none'}`);

    return (
        <motion.div
            layout // Animate layout: size, position, padding, border-radius
            variants={pillContainerVariants}
            initial={false}
            animate={containerVariant}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={`flex items-center ${isIdle ? 'justify-center' : 'justify-start'} relative overflow-hidden ${stateClasses} outline outline-1 outline-transparent`}
        >
            {/* Icon - always present, part of flex, animates scale/opacity */}
            <motion.div
                layout="position" // Allow slight position adjustment within flex
                variants={iconVariant}
                animate={containerVariant}
                transition={{ duration: 0.2 }}
                className="flex-shrink-0 flex items-center justify-center z-10"
            >
                <img
                    src="/feather-logo.png"
                    alt="Fethr"
                    className="w-5 h-5 object-contain filter drop-shadow-[0_0_4px_#A6F6FF]"
                />
            </motion.div>

            {/* Animated Content Area */}
            <div className="flex-grow h-full flex items-center overflow-hidden relative">
                <AnimatePresence mode="wait" initial={false}>
                    {/* Recording Content */}
                    {isRecording && (
                        <motion.div
                            key="content-recording"
                            variants={contentVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="flex items-center justify-between w-full h-full space-x-1.5 pl-1 pr-1"
                        >
                            <div className="flex-grow w-full flex justify-center">
                                <LiveWaveform />
                            </div>
                            <span className="flex-shrink-0 font-mono text-xs">{duration}</span>
                        </motion.div>
                    )}

                    {/* Processing Content */}
                    {isProcessing && (
                        <motion.div
                            key="content-processing"
                            variants={contentVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="absolute inset-0 flex items-center justify-center"
                        >
                            <Loader2 className="w-4 h-4 animate-spin" />
                        </motion.div>
                    )}

                    {/* Error Content */}
                    {isError && (
                        <motion.div
                            key="content-error"
                            variants={contentVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="absolute inset-0 flex items-center justify-center px-1"
                        >
                            <span className="truncate text-xs font-mono" title={error}>
                                ⚠️ {error ? `Error: ${error.substring(0,15)}...` : "Error"}
                            </span>
                        </motion.div>
                    )}

                    {/* Transcription Result */}
                    {showTranscription && (
                        <motion.div
                            key="content-transcription"
                            variants={contentVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="absolute inset-0 flex items-center justify-center px-1"
                        >
                            <span className="truncate max-w-[200px] text-xs" title={transcription}>
                                {transcription}
                            </span>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
};

export default RecordingPill; 