import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { RecordingState } from '../HotkeyManager';

/**
 * RecordingPill is a floating UI component that shows recording status and hotkey info
 * 
 * What it does: Provides visual feedback about recording state
 * Why it exists: Users need to know when recording is active and what hotkey to use
 */
interface RecordingPillProps {
  currentState: RecordingState;
  recordingDuration: string;
  transcription: string;
  error: string | null;
}

function RecordingPill({ 
  currentState,
  recordingDuration,
  transcription,
  error
}: RecordingPillProps) {
  const [registeredHotkey, setRegisteredHotkey] = useState<string>("Alt+Shift+A");
  const [hotkeyRegistrationFailed, setHotkeyRegistrationFailed] = useState<boolean>(false);

  useEffect(() => {
    // Listen for hotkey registration
    const unlistenHotkey = listen('hotkey-registered', (event) => {
      const { hotkey } = event.payload as { hotkey: string };
      setRegisteredHotkey(hotkey);
      setHotkeyRegistrationFailed(false);
    });

    // Listen for hotkey registration failures
    const unlistenFailure = listen('hotkey-registration-failed', () => {
      setHotkeyRegistrationFailed(true);
    });

    return () => {
      // Clean up listeners
      unlistenHotkey.then(fn => fn());
      unlistenFailure.then(fn => fn());
    };
  }, []);

  // Determine the appropriate classes based on state
  let pillClass = "fixed bottom-4 right-4 px-4 py-2 rounded-full transition-all duration-300 pointer-events-auto";
  let pillContent = "";

  switch (currentState) {
    case RecordingState.RECORDING:
      pillClass += " bg-red-500 text-white animate-pulse";
      pillContent = `Recording... ${recordingDuration} • Release to stop`;
      break;
    case RecordingState.LOCKED_RECORDING:
      pillClass += " bg-red-600 text-white";
      pillContent = `Recording ${recordingDuration} • Press hotkey to stop`;
      break;
    case RecordingState.TRANSCRIBING:
      pillClass += " bg-blue-500 text-white";
      pillContent = "Transcribing...";
      break;
    default: // IDLE
      pillClass += " bg-gray-100 text-gray-800";
      if (hotkeyRegistrationFailed) {
        pillContent = "❌ No hotkeys available - manual recording only";
      } else {
        pillContent = `Press ${registeredHotkey} to record`;
      }
      break;
  }

  // Show error message if exists
  const errorDisplay = error ? (
    <div className="text-red-500 text-sm mt-1">{error}</div>
  ) : null;

  // Show transcription if exists
  const transcriptionDisplay = transcription ? (
    <div className="text-gray-700 text-sm mt-1 max-w-md truncate">{transcription}</div>
  ) : null;

  return (
    <div className={pillClass}>
      <div className="flex items-center space-x-2">
        {currentState === RecordingState.RECORDING && (
          <div className="w-3 h-3 bg-red-700 rounded-full animate-ping" />
        )}
        {currentState === RecordingState.LOCKED_RECORDING && (
          <div className="w-3 h-3 bg-red-700 rounded-full" />
        )}
        <span>{pillContent}</span>
      </div>
      {errorDisplay}
      {transcriptionDisplay}
    </div>
  );
}

export default RecordingPill; 