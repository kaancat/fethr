console.log("%c---> EXECUTING RecordingController.tsx <---", "background: yellow; color: black; font-weight: bold; font-size: 14px; padding: 5px;");

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { LocalTranscriptionManager } from '../utils/LocalTranscriptionManager';
import { RecordingState, HotkeyManager } from '../HotkeyManager';
import { copyToClipboard } from '../utils/clipboardUtils';
import RecordingPill from './RecordingPill';
import { toast } from 'react-hot-toast';

interface ConfigOptions {
  useWhisperAPI: boolean;
  autoCopyToClipboard: boolean;
  autoPasteTranscription: boolean;
}

const RecordingController: React.FC<{ configOptions: ConfigOptions }> = ({ configOptions }) => {
  const transcriptionManager = useRef<LocalTranscriptionManager | null>(null);
  const hotkeyManager = useRef<HotkeyManager | null>(null);
  const directHotkeyUnlistener = useRef<(() => void) | null>(null);

  const [currentRecordingState, setCurrentRecordingState] = useState<RecordingState>(RecordingState.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const durationInterval = useRef<number | null>(null);

  // Effect for initializing non-audio managers and setting up listeners
  useEffect(() => {
    const initializeComponents = async () => {
      console.log('%c[RecordingController] Component Mounting - Initializing Managers...', 'color: blue; font-weight: bold');
      try {
        console.log('[RecordingController] --> Creating LocalTranscriptionManager instance...');
        transcriptionManager.current = LocalTranscriptionManager.getInstance();
        console.log('[RecordingController] --> LocalTranscriptionManager initialized successfully');

        console.log('[RecordingController] --> Getting HotkeyManager instance (SIMPLIFIED)...');
        hotkeyManager.current = HotkeyManager.getInstance();
        console.log('[RecordingController] --> Calling HotkeyManager.initialize() (SIMPLIFIED)...');
        await hotkeyManager.current.initialize();
        console.log('[RecordingController] --> HotkeyManager.initialize() (SIMPLIFIED) completed successfully');

        console.log('%c[RecordingController] Non-audio components initialization sequence COMPLETE.', 'color: green; font-weight: bold');

        console.log('[RecordingController] --->>> ATTEMPTING TO ADD DIRECT hotkey-pressed LISTENER <<<---');
        try {
            directHotkeyUnlistener.current = await listen('hotkey-pressed', (_event) => {
                console.log('%c>>> DIRECT LISTENER: Hotkey Pressed! <<<- ', 'background: yellow; color: black; font-size: 16px; font-weight: bold;');

                setCurrentRecordingState(prevState => {
                   console.log(`[RecordingController] Direct Listener: Current state is ${prevState}`);
                   let nextState = prevState;
                   switch (prevState) {
                     case RecordingState.IDLE:
                       nextState = RecordingState.RECORDING;
                       break;
                     case RecordingState.RECORDING:
                     case RecordingState.LOCKED_RECORDING:
                       nextState = RecordingState.TRANSCRIBING;
                       break;
                     case RecordingState.TRANSCRIBING:
                       console.log('[RecordingController] Direct Listener: Ignoring press while TRANSCRIBING.');
                       break;
                   }
                   console.log(`[RecordingController] Direct Listener: Transitioning to ${nextState}`);
                   return nextState;
                });
            });
            console.log('[RecordingController] --->>> SUCCESSFULLY ATTACHED DIRECT hotkey-pressed LISTENER <<<---');
        } catch (listenError) {
            console.error('%c>>> FAILED TO ATTACH DIRECT hotkey-pressed LISTENER <<< ', 'background: red; color: white;', listenError);
            setErrorMessage(`Failed to listen for hotkey: ${listenError instanceof Error ? listenError.message : String(listenError)}`);
        }
        // --- END DIRECT LISTENER ---

      } catch (error) {
        console.error('%c[RecordingController] FATAL ERROR initializing components:', 'color: red; font-weight: bold', error);
        setErrorMessage(`Failed to initialize components: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    initializeComponents();

    // Cleanup on unmount
    return () => {
      const unmountTimestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
       console.log(`%c[${unmountTimestamp}] [RecordingController] >>> UNMOUNT CLEANUP RUNNING <<<`, 'background: red; color: white; font-weight: bold;');

      if (directHotkeyUnlistener.current) {
        console.log('[RecordingController] Cleaning up DIRECT hotkey listener');
        directHotkeyUnlistener.current();
        directHotkeyUnlistener.current = null;
      }

      if (durationInterval.current) {
        console.log('[RecordingController] Clearing duration interval');
        clearInterval(durationInterval.current);
      }
      if (hotkeyManager.current) {
        console.log('[RecordingController] Cleaning up HotkeyManager (SIMPLIFIED)');
        hotkeyManager.current.cleanup();
      }
      console.log('[RecordingController] Component unmount cleanup complete');
    };
  }, []);

  // Handle updates from Rust backend (transcription results)
  const handleTranscriptionResult = useCallback(async (resultTextReceived: string | null, error: string | null) => {
    console.log('[RecordingController] Handling transcription result...', { resultTextReceived, error });
    setCurrentRecordingState(RecordingState.IDLE); // Always return to idle after attempt

    if (error) {
      console.error('[RecordingController] Transcription FAIL:', error);
      setErrorMessage(`Transcription failed: ${error}`);
      toast.error(`Transcription Error: ${error}`); // Show toast
      setTranscription('');
    } else if (!resultTextReceived) {
      console.warn('[RecordingController] Transcription returned null/empty result.');
      setErrorMessage('Transcription produced no text.');
      toast('Transcription produced no text.', { icon: '⚠️' });
      setTranscription('');
    } else {
      console.log('[RecordingController] Setting transcription result, length:', resultTextReceived.length);
      setTranscription(resultTextReceived); // Update UI state
      setErrorMessage(null);

      // Clipboard/Paste logic
      let didCopy = false;
      if (configOptions.autoCopyToClipboard) {
        console.log('[RecordingController] Attempting auto-copy...');
        try {
          await copyToClipboard(resultTextReceived); // Uses Rust command internally now
          console.log('[RecordingController] Copy OK');
          toast.success("Copied to clipboard!");
          didCopy = true; // Mark copy as successful
        } catch (copyError) {
          console.error('[RecordingController] Auto-copy FAIL:', copyError);
          toast.error("Auto-copy failed.");
          // Keep didCopy as false
        }
      } else {
        // If auto-copy is disabled, we can still consider paste successful for the next step
        // OR require copy to succeed? Let's allow paste even if copy is off for now.
        didCopy = true; // Treat as "ok to paste" if copy is disabled
      }

      // --- ADD AUTO-PASTE LOGIC ---
      // Only attempt paste if the previous step allows it (copy succeeded or was disabled)
      // and if auto-paste is enabled in config
      if (didCopy && configOptions.autoPasteTranscription) { 
        console.log('[RecordingController] Attempting auto-paste via Rust command...');
        try {
          // Invoke the Rust command responsible *only* for simulating the paste keystroke
          await invoke('paste_text_to_cursor', { text: resultTextReceived }); // Pass text for consistency, Rust side ignores it now
          console.log('[RecordingController] Rust paste command invoked successfully.');
          // Maybe a subtle success indicator?
        } catch (pasteError) {
          console.error('[RecordingController] Invoke paste_text_to_cursor FAIL:', pasteError);
          toast.error("Auto-paste command failed.");
        }
      }
      // --- END AUTO-PASTE LOGIC ---
    }
  }, [configOptions, copyToClipboard]); // Dependencies: config options and the copy function

  useEffect(() => {
    const stateToProcess = currentRecordingState;

    console.log(`%c[RecordingController] 🔄 State handler EFFECT triggered for state: ${RecordingState[stateToProcess]}`, 'color: purple; font-weight: bold;');

    const stopTimer = () => {
      if (durationInterval.current) {
        console.log(`[RecordingController] Clearing duration interval on state: ${RecordingState[stateToProcess]}`);
        clearInterval(durationInterval.current);
        durationInterval.current = null;
      }
    };

    console.log(`[RecordingController] Effect Processing State: ${stateToProcess} ('${RecordingState[stateToProcess]}')`);

    try {
      switch (stateToProcess) {
        case RecordingState.IDLE:
          console.log('%c[RecordingController] 💤 Handling IDLE state', 'color: gray; font-weight: bold');
          stopTimer();
          setRecordingDuration(0);
          break;

        case RecordingState.RECORDING:
           console.log(`%c[RecordingController] >>>>>>>>>> ENTERED RECORDING CASE LOGIC <<<<<<<<<<`, 'background: #ff0; color: black; font-weight: bold;');
           startRecordingProcess();
          break;

        case RecordingState.LOCKED_RECORDING:
          console.log(`%c[RecordingController] Handling ${RecordingState[stateToProcess]} state - letting recording continue (UNREACHABLE)`, 'color: blue; font-weight: bold;');
          break;

        case RecordingState.TRANSCRIBING:
          console.log('%c[RecordingController] 🔄 Handling TRANSCRIBING state', 'color: blue; font-weight: bold');
          stopTimer();
          setErrorMessage(null);

          console.log('[RecordingController] Invoking stop_backend_recording...');
          const stopPromise = invoke<string>('stop_backend_recording', {
              autoPaste: configOptions.autoPasteTranscription
          });
          handleTranscriptionResult(null, null);
          break;
      }
    } catch (error) {
      console.error('%c[RecordingController] ❌ Sync Error in state change handler:', 'color: red; font-weight: bold', error);
      setErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
      stopTimer();
      setCurrentRecordingState(RecordingState.IDLE);
    }
  }, [currentRecordingState, configOptions.autoPasteTranscription, configOptions.autoCopyToClipboard, handleTranscriptionResult]);

  const startRecordingProcess = async () => {
    console.log('%c[RecordingController] ➡️ STARTING Recording Process...', 'color: green; font-weight: bold');

    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }
    setRecordingDuration(0);
    setErrorMessage(null);
    setTranscription('');

    try {
      console.log('[RecordingController] Invoking start_backend_recording...');
      await invoke('start_backend_recording');
      console.log('[RecordingController] Backend start command successful. Starting timer.');

      durationInterval.current = window.setInterval(() => {
        setRecordingDuration((prevDuration) => prevDuration + 1);
      }, 1000);

    } catch (error) {
      console.error('%c[RecordingController] ❌ Error invoking start_backend_recording:', 'color: red; font-weight: bold', error);
      setErrorMessage(`Start Error: ${error instanceof Error ? error.message : String(error)}`);
      setCurrentRecordingState(RecordingState.IDLE);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center">
      <RecordingPill
        currentState={currentRecordingState}
        recordingDuration={formatDuration(recordingDuration)}
        transcription={transcription}
        error={errorMessage}
      />
    </div>
  );

}; // End of RecordingController component

export default RecordingController;