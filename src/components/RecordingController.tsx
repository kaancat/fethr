console.log("%c---> EXECUTING RecordingController.tsx <---", "background: yellow; color: black; font-weight: bold; font-size: 14px; padding: 5px;");

import React, { useEffect, useRef, useState } from 'react';
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
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const durationInterval = useRef<number | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);

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
        setIsInitialized(true);

        console.log('[RecordingController] --->>> ATTEMPTING TO ADD DIRECT hotkey-pressed LISTENER <<<---');
        try {
            directHotkeyUnlistener.current = await listen('hotkey-pressed', (_event) => {
                console.log('%c>>> DIRECT LISTENER: Hotkey Pressed! <<<-', 'background: yellow; color: black; font-size: 16px; font-weight: bold;');

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
        setIsInitialized(false);
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

  // Function to handle result/error from backend invoke
  const handleTranscriptionResult = async (resultPromise: Promise<string>) => {
    let resultTextReceived: string | null = null;
    try {
        console.log('[RecordingController] Awaiting transcription result from backend...');
        resultTextReceived = await resultPromise;
        console.log('[RecordingController] Backend returned result:', resultTextReceived);

        if (!resultTextReceived || resultTextReceived.trim() === '' || resultTextReceived === "Whisper transcription completed successfully.") {
             console.warn('%c[RecordingController] ⚠️ Backend returned empty or generic result', 'color: orange; font-weight: bold');
             setErrorMessage(resultTextReceived.trim() === '' ? 'Transcription empty' : 'No speech detected');
             setTranscription('');
        } else {
             console.log('[RecordingController] Setting transcription result, length:', resultTextReceived.length);
             setTranscription(resultTextReceived);
             setErrorMessage(null);

             if (configOptions.autoCopyToClipboard) {
                 console.log('[RecordingController] Attempting auto-copy...');
                 try {
                     await copyToClipboard(resultTextReceived);
                     console.log('[RecordingController] Copy OK');
                 }
                 catch (copyError) {
                     console.error('[RecordingController] Copy FAIL:', copyError);
                     toast.error("Failed to copy to clipboard.");
                 }
             }
        }
    } catch (error) {
        console.error(`%c[RecordingController] ---> ERROR received from backend invoke <---`, 'color: red; font-weight: bold;', error);
        setErrorMessage(`Transcription error: ${error instanceof Error ? error.message : String(error)}`);
        setTranscription('');
    } finally {
        console.log('%c[RecordingController] 🏁 Transcription attempt complete, resetting state to IDLE in finally block', 'color: green; font-weight: bold');
        setCurrentRecordingState(RecordingState.IDLE);
        setIsTranscribing(false);
    }
  };

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
          setIsTranscribing(true);
          setErrorMessage(null);

          console.log('[RecordingController] Invoking stop_backend_recording...');
          const stopPromise = invoke<string>('stop_backend_recording', {
              autoPaste: configOptions.autoPasteTranscription
          });
          handleTranscriptionResult(stopPromise);
          break;
      }
    } catch (error) {
      console.error('%c[RecordingController] ❌ Sync Error in state change handler:', 'color: red; font-weight: bold', error);
      setErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
      stopTimer();
      setCurrentRecordingState(RecordingState.IDLE);
      setIsTranscribing(false);
    }
  }, [currentRecordingState, configOptions.autoPasteTranscription, configOptions.autoCopyToClipboard]);

  const startRecordingProcess = async () => {
    console.log('%c[RecordingController] ➡️ STARTING Recording Process...', 'color: green; font-weight: bold');

    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }
    setRecordingDuration(0);
    setErrorMessage(null);
    setTranscription('');
    setIsTranscribing(false);

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
      setIsTranscribing(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const saveBlobToFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    console.log(`[RecordingController] Attempted to save blob to ${filename}`);
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