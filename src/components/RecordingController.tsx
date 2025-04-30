console.log("%c---> EXECUTING RecordingController.tsx <---", "background: yellow; color: black; font-weight: bold; font-size: 14px; padding: 5px;");

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { RecordingState, HotkeyManager } from '../HotkeyManager';
import RecordingPill from './RecordingPill';
import { toast } from 'react-hot-toast';

interface ConfigOptions {
  useWhisperAPI: boolean;
  autoCopyToClipboard: boolean;
  autoPasteTranscription: boolean;
}

const RecordingController: React.FC<{ configOptions: ConfigOptions }> = ({ configOptions }) => {
  const hotkeyManager = useRef<HotkeyManager | null>(null);
  const directHotkeyUnlistener = useRef<(() => void) | null>(null);

  const [currentRecordingState, setCurrentRecordingState] = useState<RecordingState>(RecordingState.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const durationInterval = useRef<number | null>(null);

  // Effect for initializing HotkeyManager and setting up listeners
  useEffect(() => {
    const initializeComponents = async () => {
      console.log('%c[RecordingController] Component Mounting - Initializing Hotkey Manager...', 'color: blue; font-weight: bold');
      try {
        console.log('[RecordingController] --> Getting HotkeyManager instance...');
        hotkeyManager.current = HotkeyManager.getInstance();
        console.log('[RecordingController] --> Calling HotkeyManager.initialize()...');
        await hotkeyManager.current.initialize();
        console.log('[RecordingController] --> HotkeyManager initialized successfully');

        console.log('[RecordingController] --->>> ATTEMPTING TO ADD DIRECT hotkey-pressed LISTENER <<<---');
        try {
            directHotkeyUnlistener.current = await listen('hotkey-pressed', (_event) => {
                console.log('%c>>> DIRECT LISTENER: Hotkey Pressed! <<<- ', 'background: yellow; color: black; font-size: 16px; font-weight: bold;');
                setCurrentRecordingState(prevState => {
                   console.log(`[RecordingController] Direct Listener: Current state is ${RecordingState[prevState]}`);
                   let nextState = prevState;
                   switch (prevState) {
                     case RecordingState.IDLE:
                       nextState = RecordingState.RECORDING;
                       break;
                     case RecordingState.RECORDING:
                       nextState = RecordingState.TRANSCRIBING;
                       break;
                     case RecordingState.TRANSCRIBING:
                       console.warn('[RecordingController] Direct Listener: Ignoring press while TRANSCRIBING.');
                       break;
                     default:
                        console.warn(`[RecordingController] Direct Listener: Unhandled state ${RecordingState[prevState]}`);
                   }
                   if (nextState !== prevState) {
                       console.log(`[RecordingController] Direct Listener: Transitioning from ${RecordingState[prevState]} to ${RecordingState[nextState]}`);
                       return nextState;
                   }
                   return prevState;
                });
            });
            console.log('[RecordingController] --->>> SUCCESSFULLY ATTACHED DIRECT hotkey-pressed LISTENER <<<---');
        } catch (listenError) {
            console.error('%c>>> FAILED TO ATTACH DIRECT hotkey-pressed LISTENER <<< ', 'background: red; color: white;', listenError);
            setErrorMessage(`Failed to listen for hotkey: ${listenError instanceof Error ? listenError.message : String(listenError)}`);
        }

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
        console.log('[RecordingController] Cleaning up HotkeyManager');
        hotkeyManager.current.cleanup();
      }
      console.log('[RecordingController] Component unmount cleanup complete');
    };
  }, []);

  // Simplified handler for results/errors coming *directly* from the backend stop/transcribe invoke
  const handleTranscriptionResult = useCallback((resultPromise: Promise<string>) => {
    console.log('[RecordingController] Entering handleTranscriptionResult...');
    setErrorMessage(null);

    resultPromise.then(resultTextReceived => {
        console.log('[RecordingController] Backend returned result:', resultTextReceived);

        if (!resultTextReceived || resultTextReceived.trim() === '') {
            console.warn('%c[RecordingController] ⚠️ Backend returned empty result', 'color: orange; font-weight: bold');
            setErrorMessage('Transcription empty');
            toast('Transcription empty or no speech detected.', { icon: '🔇' });
            setTranscription('');
        } else {
            console.log('[RecordingController] Setting transcription result, length:', resultTextReceived.length);
            setTranscription(resultTextReceived);
            setErrorMessage(null);
        }
    }).catch(error => {
        console.error('%c[RecordingController] ---> ERROR received from backend invoke <---', 'color: red; font-weight: bold;', error);
        const errorMsg = `Transcription error: ${error instanceof Error ? error.message : String(error)}`;
        setErrorMessage(errorMsg);
        toast.error(errorMsg);
        setTranscription('');
    }).finally(() => {
        console.log('%c[RecordingController] 🏁 Transcription attempt complete, resetting state to IDLE in finally block', 'color: #ddd;');
        setCurrentRecordingState(RecordingState.IDLE);
        if (hotkeyManager.current) {
            console.log('[RecordingController] Letting HotkeyManager handle its own reset based on events.');
        }
    });
  }, []);

  useEffect(() => {
    const stateToProcess = currentRecordingState;
    console.log(`%c[RecordingController] 🔄 State handler EFFECT triggered for state: ${RecordingState[stateToProcess]}`, 'color: purple; font-weight: bold;');

    const stopTimer = () => {
      if (durationInterval.current) {
        console.log(`[RecordingController] Clearing duration interval on state transition from: ${RecordingState[stateToProcess]}`);
        clearInterval(durationInterval.current);
        durationInterval.current = null;
      }
    };

    console.log(`[RecordingController] Effect Processing State: ${stateToProcess} ('${RecordingState[stateToProcess]}')`);

    (async () => {
        try {
          switch (stateToProcess) {
            case RecordingState.IDLE:
              console.log('%c[RecordingController] 💤 Handling IDLE state', 'color: gray; font-weight: bold');
              stopTimer();
              setRecordingDuration(0);
              break;

            case RecordingState.RECORDING:
               console.log('%c[RecordingController] ▶️ Handling RECORDING state', 'color: green; font-weight: bold;');
               await startRecordingProcess();
              break;

            case RecordingState.LOCKED_RECORDING:
              console.log(`%c[RecordingController] Handling ${RecordingState[stateToProcess]} state - Recording continues...`, 'color: darkorange; font-weight: bold;');
              break;

            case RecordingState.TRANSCRIBING:
              console.log('%c[RecordingController] 🔄 Handling TRANSCRIBING state', 'color: blue; font-weight: bold');
              stopTimer();
              setErrorMessage(null);

              console.log('[RecordingController] Invoking stop_backend_recording...');
              const stopPromise = invoke<string>('stop_backend_recording', {
                  autoPaste: configOptions.autoPasteTranscription
              });

              handleTranscriptionResult(stopPromise);
              break;

            default:
                console.warn(`[RecordingController] Unhandled state in effect: ${RecordingState[stateToProcess]}`);
          }
        } catch (error) {
          console.error('%c[RecordingController] ❌ Sync/Async Error in state change handler:', 'color: red; font-weight: bold', error);
          setErrorMessage(`Error during state transition: ${error instanceof Error ? error.message : String(error)}`);
          stopTimer();
          setCurrentRecordingState(RecordingState.IDLE);
        }
    })();

  }, [currentRecordingState, configOptions.autoPasteTranscription, handleTranscriptionResult]);

  const startRecordingProcess = async () => {
    console.log('%c[RecordingController] ➡️ startRecordingProcess invoked...', 'color: green;');

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
      console.log('[RecordingController] Backend start_backend_recording command successful. Starting timer.');

      durationInterval.current = window.setInterval(() => {
        setRecordingDuration((prevDuration) => prevDuration + 1);
      }, 1000);

    } catch (error) {
      const errorMsg = `Start Recording Error: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`%c[RecordingController] ❌ ${errorMsg}`, 'color: red; font-weight: bold');
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
      setCurrentRecordingState(RecordingState.IDLE);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="recording-controller p-4 bg-gray-800 rounded-lg shadow-md text-gray-100 flex flex-col items-center space-y-4">
        <h2 className="text-xl font-semibold">Fethr Recording</h2>

        <RecordingPill 
            currentState={currentRecordingState} 
            recordingDuration={formatDuration(recordingDuration)} 
            transcription={transcription}
            error={errorMessage}
        />

        {/* Error Message Area - Now handled inside RecordingPill */}
        {/* {errorMessage && (
          <div className="error-message bg-red-700 text-white p-3 rounded-md shadow-sm w-full text-center">
            <p className="font-bold">Error:</p>
            <p className="text-sm">{errorMessage}</p>
          </div>
        )} */}

        {/* Transcription Display Area - Now handled inside RecordingPill */}
        {/* {transcription && (
            <div className="transcription-output mt-4 p-3 bg-gray-700 rounded-md shadow-sm w-full">
                <h3 className="text-lg font-medium mb-2 text-gray-300">Last Transcription:</h3>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">{transcription}</p>
            </div>
        )} */}

        {/* Debug Info (Optional) */}
        {/* {transcription && (
          <div className="transcription-output mt-4 p-3 bg-gray-700 rounded-md shadow-sm w-full">
            <h3 className="text-lg font-medium mb-2 text-gray-300">Last Transcription:</h3>
            <p className="text-sm text-gray-200 whitespace-pre-wrap">{transcription}</p>
          </div>
        )} */}
    </div>
  );
};

export default RecordingController;