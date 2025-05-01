console.log("%c---> EXECUTING RecordingController.tsx <---", "background: yellow; color: black; font-weight: bold; font-size: 14px; padding: 5px;");

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import RecordingPill from './RecordingPill';
import { toast } from 'react-hot-toast';
import { RecordingState } from '../types';

// Define RecordingState enum is now removed and imported from types.ts

interface ConfigOptions {
  useWhisperAPI: boolean;
  autoCopyToClipboard: boolean;
  autoPasteTranscription: boolean;
}

interface UnlistenFn {
  (): void;
}

const RecordingController: React.FC<{ configOptions: ConfigOptions }> = ({ configOptions }) => {
  const unlisteners = useRef<UnlistenFn[]>([]);

  const [currentRecordingState, setCurrentRecordingState] = useState<RecordingState>(RecordingState.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const durationInterval = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Simplified handler for results/errors coming directly from the backend stop/transcribe invoke
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
        
        // Signal backend RDEV thread to reset
        console.log('[RecordingController] Signaling backend to reset rdev state...');
        invoke('signal_reset_complete')
            .then(() => console.log("[RecordingController] Signal reset complete sent to backend."))
            .catch(err => console.error("[RecordingController] Failed to send reset signal:", err));
    });
  }, []);

  // Effect for setting up listeners - removed HotkeyManager initialization
  useEffect(() => {
    const initializeComponents = async () => {
      console.log('%c[RecordingController] Component Mounting - Setting up event listeners...', 'color: blue; font-weight: bold');
      try {
        // --- Listen for Backend Events ---
        console.log('[RecordingController] Setting up backend event listeners...');
        
        const updateStateUnlistener = await listen("fethr-update-ui-state", (event) => {
            const payload = event.payload as { state: string };
            console.log(`[RecordingController] === Received UI State Update Event === Payload:`, payload);
            
            // Convert string state to enum
            let newState: RecordingState | null = null;
            switch (payload.state) {
                case "IDLE":
                    console.log(`[RecordingController] Matched state: "IDLE". Setting frontend state.`);
                    newState = RecordingState.IDLE;
                    break;
                case "RECORDING":
                    console.log(`[RecordingController] Matched state: "RECORDING". Setting frontend state.`);
                    newState = RecordingState.RECORDING;
                    break;
                case "LOCKED_RECORDING":
                    console.log(`[RecordingController] Matched state: "LOCKED_RECORDING". Setting frontend state.`);
                    newState = RecordingState.LOCKED_RECORDING;
                    break;
                case "TRANSCRIBING":
                    console.log(`[RecordingController] Matched state: "TRANSCRIBING". Setting frontend state.`);
                    newState = RecordingState.TRANSCRIBING;
                    break;
                default:
                    console.warn("[RecordingController] Received unknown state from backend:", payload.state);
            }

            if (newState !== null) {
                console.log(`[RecordingController] Calling setCurrentRecordingState with: ${RecordingState[newState]} (${newState})`);
                setCurrentRecordingState(newState);
            } else {
                 console.warn("[RecordingController] newState was null after switch, not updating state.");
            }
        });
        unlisteners.current.push(updateStateUnlistener);

        const startRecordingUnlistener = await listen("fethr-start-recording", () => {
            console.log("[RecordingController] Received Start Recording command.");
            startRecordingProcess();
        });
        unlisteners.current.push(startRecordingUnlistener);

        const stopTranscribeUnlistener = await listen("fethr-stop-and-transcribe", (event) => {
            console.log("[RecordingController] Received Stop and Transcribe command.");
            const autoPaste = event.payload as boolean;
            console.log(`[RecordingController] AutoPaste flag from backend: ${autoPaste}`);
            
            // Override config option if provided by backend
            const effectiveAutoPaste = autoPaste !== undefined ? autoPaste : configOptions.autoPasteTranscription;
            
            // Call stop backend (which returns promise) and handle result
            const stopPromise = invoke<string>('stop_backend_recording', { 
                autoPaste: effectiveAutoPaste 
            });
            handleTranscriptionResult(stopPromise);
        });
        unlisteners.current.push(stopTranscribeUnlistener);

        console.log('[RecordingController] Backend event listeners attached.');
        // --- End Listeners ---

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

      // Unsubscribe from all event listeners
      if (unlisteners.current.length > 0) {
        console.log(`[RecordingController] Cleaning up ${unlisteners.current.length} event listeners`);
        unlisteners.current.forEach(unlisten => {
          try {
            unlisten();
          } catch (err) {
            console.error('[RecordingController] Error unlistening:', err);
          }
        });
        unlisteners.current = [];
      }

      if (durationInterval.current) {
        console.log('[RecordingController] Clearing duration interval');
        clearInterval(durationInterval.current);
        durationInterval.current = null;
      }
      
      console.log('[RecordingController] Component unmount cleanup complete');
    };
  }, []);

  // Effect to handle UI updates based on recording state
  useEffect(() => {
    const stateToProcess = currentRecordingState;
    console.log(`%c[RecordingController] 🔄 UI EFFECT triggered for state: ${RecordingState[stateToProcess]}`, 'color: darkcyan; font-weight: bold;');

    const stopTimer = () => {
      if (durationInterval.current) {
        console.log(`[RecordingController] Stopping timer - clearing interval ID: ${durationInterval.current}`);
        clearInterval(durationInterval.current);
        durationInterval.current = null;
        
        if (startTimeRef.current) {
          const finalDuration = (Date.now() - startTimeRef.current) / 1000;
          console.log(`[RecordingController] Timer stopped. Final duration: ${finalDuration.toFixed(2)}s`);
        }
      } else {
        console.log('[RecordingController] stopTimer called but no active interval found.');
      }
      startTimeRef.current = null;
    };

    const startTimer = () => {
      // Clear any existing timer
      if (durationInterval.current) {
        console.log(`[RecordingController] Clearing existing timer interval ID: ${durationInterval.current} before starting new one.`);
        clearInterval(durationInterval.current);
        durationInterval.current = null;
      }
      
      // Reset duration and start time
      setRecordingDuration(0);
      startTimeRef.current = Date.now();
      const startTimestamp = new Date().toISOString();
      
      console.log(`[RecordingController] Starting UI duration timer display at ${startTimestamp}. Start time: ${startTimeRef.current}`);
      const intervalId = window.setInterval(() => {
        if (startTimeRef.current) {
          const now = Date.now();
          const elapsedMs = now - startTimeRef.current;
          const newDuration = elapsedMs / 1000;
          
          // Reduce logging frequency (only log every second)
          if (Math.floor(newDuration) !== Math.floor(recordingDuration)) {
            console.log(`[RecordingController Timer] Start: ${startTimeRef.current}, Now: ${now}, Elapsed: ${elapsedMs}ms, Duration: ${newDuration.toFixed(1)}s`);
          }
          
          setRecordingDuration(newDuration);
        } else {
          console.warn('[RecordingController Timer] Timer fired but startTimeRef is null! Clearing interval.');
          if (durationInterval.current) {
               clearInterval(durationInterval.current);
               durationInterval.current = null;
          }
        }
      }, 100);
      
      console.log(`[RecordingController] Timer started with interval ID: ${intervalId}`);
      durationInterval.current = intervalId;
    };

    switch (stateToProcess) {
      case RecordingState.IDLE:
        stopTimer();
        setRecordingDuration(0);
        break;
      case RecordingState.RECORDING:
      case RecordingState.LOCKED_RECORDING:
        startTimer();
        break;
      case RecordingState.TRANSCRIBING:
        stopTimer();
        break;
    }
  }, [currentRecordingState]);

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
      console.log('[RecordingController] Backend start_backend_recording command successful.');
    } catch (error) {
      const errorMsg = `Start Recording Error: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`%c[RecordingController] ❌ ${errorMsg}`, 'color: red; font-weight: bold');
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
      setCurrentRecordingState(RecordingState.IDLE);
      
      // Reset the rdev state in the backend
      invoke('reset_rdev_state').catch(err => {
        console.error('[RecordingController] Failed to reset rdev state:', err);
      });
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
    </div>
  );
};

export default RecordingController;