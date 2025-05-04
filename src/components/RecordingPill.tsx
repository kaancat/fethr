import React from 'react';
// Make sure the path to types is correct, likely '../types' if types.ts is in src/
import { RecordingState } from '../types';

/**
 * RecordingPill is a floating UI component that shows recording status and hotkey info
 * 
 * What it does: Provides visual feedback about recording state
 * Why it exists: Users need to know when recording is active and what hotkey to use
 */

// Define the props the component will accept
interface RecordingPillProps {
    currentState: RecordingState;
    duration: string; // Expecting pre-formatted string "0.0s"
    transcription?: string; // Optional transcription text
    error?: string; // Optional error message
}

// Helper to get display text based on state
const getStateText = (state: RecordingState, error?: string): string => {
    switch (state) {
        case RecordingState.IDLE:
            return "Idle"; // Or maybe "" or "."
        case RecordingState.RECORDING:
        case RecordingState.LOCKED_RECORDING:
            return "Rec";
        case RecordingState.TRANSCRIBING:
            return "Proc";
        case RecordingState.PASTING: // Assuming this state exists
            return "Paste";
        case RecordingState.ERROR:
            // Show truncated error, or just "Error"
            return error ? `Error: ${error.substring(0,15)}...` : "Error";
        default:
            console.warn("RecordingPill: Unknown currentState received:", state);
            return "???";
    }
};

// Helper to get background color based on state
const getBackgroundColor = (state: RecordingState): string => {
    switch (state) {
        case RecordingState.IDLE:
            return "bg-slate-600 hover:bg-slate-500";
        case RecordingState.RECORDING:
        case RecordingState.LOCKED_RECORDING:
            return "bg-red-600 hover:bg-red-500";
        case RecordingState.TRANSCRIBING:
        case RecordingState.PASTING:
            return "bg-blue-600 hover:bg-blue-500";
        case RecordingState.ERROR:
            return "bg-orange-700 hover:bg-orange-600";
        default:
            return "bg-gray-700";
    }
}

const RecordingPill: React.FC<RecordingPillProps> = ({ currentState, duration, transcription, error }) => {
    const statusText = getStateText(currentState, error);
    const bgColor = getBackgroundColor(currentState);
    const showTimer = currentState === RecordingState.RECORDING || currentState === RecordingState.LOCKED_RECORDING;
    // Show transcription ONLY if state is IDLE and transcription prop is present and no error
    const showTranscription = currentState === RecordingState.IDLE && transcription && !error;

    // Log the props received by this component render
    console.log(`---> RecordingPill Rendering: State=${RecordingState[currentState]}(${currentState}), Duration=${duration}, Trans=${transcription ? transcription.substring(0,10)+'...' : 'none'}, Err=${error || 'none'}`);

    return (
        // Main pill container: rounded, background, padding, layout, transition, font
        <div className={`min-w-[70px] h-[32px] ${bgColor} text-white rounded-full px-3 py-1 flex items-center justify-center shadow-md transition-colors duration-200 ease-in-out text-sm font-mono`}>
            {/* --- Conditional Rendering Logic --- */}

            {/* Priority 1: Show Error */}
            {currentState === RecordingState.ERROR && (
                 <span className="truncate max-w-[200px] text-xs" title={error || 'Unknown Error'}>
                    {statusText} {/* Shows "Error: ..." */}
                 </span>
            )}

            {/* Priority 2: Show Transcription Result (only when back to Idle, no error) */}
            {showTranscription && ( // currentState is implicitly IDLE here
                <span className="truncate max-w-[200px] text-xs" title={transcription}>
                     {transcription}
                </span>
            )}

             {/* Priority 3: Show Recording Status and Timer */}
            {(currentState === RecordingState.RECORDING || currentState === RecordingState.LOCKED_RECORDING) && (
                <div className="flex items-center space-x-1.5">
                     {/* Optional: Add a recording icon/dot here */}
                     <span className="font-bold">{statusText}</span>
                    {showTimer && <span>{duration}</span>}
                </div>
            )}

            {/* Priority 4: Show Processing/Pasting Status (if not error/idle/recording) */}
             {(currentState === RecordingState.TRANSCRIBING || currentState === RecordingState.PASTING) && (
                <span className="font-bold">{statusText}</span>
             )}

            {/* Priority 5: Show Idle Status (only if Idle and not showing transcription/error) */}
             {currentState === RecordingState.IDLE && !showTranscription && !error && (
                 <span className="font-bold">{statusText}</span>
             )}

        </div>
    );
};

export default RecordingPill; 