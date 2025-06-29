// RecordingController module entry logging removed for performance

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import RecordingPill from './RecordingPill';
import { toast } from 'react-hot-toast';
import { RecordingState } from '../types';

// Generate a simple random ID for this instance
const controllerInstanceId = Math.random().toString(36).substring(2, 8); // e.g., "a1b2c3"

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
  // Instance logging removed for performance

  const unlisteners = useRef<UnlistenFn[]>([]);

  const [currentRecordingState, setCurrentRecordingState] = useState<RecordingState>(RecordingState.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const durationInterval = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Simplified handler for results/errors coming directly from the backend stop/transcribe invoke
  const handleTranscriptionResult = useCallback((resultPromise: Promise<string>) => {
    console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Entering handleTranscriptionResult...`);
    setErrorMessage(null);

    resultPromise.then(resultTextReceived => {
        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Backend returned result:`, resultTextReceived);

        if (!resultTextReceived || resultTextReceived.trim() === '') {
            console.warn(`%c[RecordingController INSTANCE: ${controllerInstanceId}] ⚠️ Backend returned empty result`, 'color: orange; font-weight: bold');
            setErrorMessage('Transcription empty');
            toast('Transcription empty or no speech detected.', { icon: '🔇' });
            setTranscription('');
        } else {
            console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Setting transcription result, length:`, resultTextReceived.length);
            setTranscription(resultTextReceived);
            setErrorMessage(null);
        }
    }).catch(error => {
        console.error(`%c[RecordingController INSTANCE: ${controllerInstanceId}] ---> ERROR received from backend invoke <---`, 'color: red; font-weight: bold;', error);
        const errorMsg = `Transcription error: ${error instanceof Error ? error.message : String(error)}`;
        setErrorMessage(errorMsg);
        toast.error(errorMsg);
        setTranscription('');
        setCurrentRecordingState(RecordingState.IDLE);
    }).finally(() => {
        console.log(`%c[RecordingController INSTANCE: ${controllerInstanceId}] 🏁 Transcription attempt complete`, 'color: #ddd;');
        
        // CRITICAL FIX: Don't force IDLE state here - let PillPage handle edit sequence transitions
        // The edit sequence will handle state transitions properly without this unwanted IDLE flash
        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Skipping IDLE state set to prevent unwanted feather icon flash before edit mode`);

        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Signaling backend to reset hotkey state...`);
        invoke('signal_reset_complete')
            .then(() => console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Hotkey state reset signal sent to backend.`))
            .catch(err => console.error(`[RecordingController INSTANCE: ${controllerInstanceId}] Failed to send hotkey state reset signal:`, err));
    });
  }, []);

  // Effect for setting up listeners - removed HotkeyManager initialization
  useEffect(() => {
    const effectTimestamp = new Date().toISOString();
    // --- ADD Instance ID to log ---
    console.log(`%c[RecordingController INSTANCE: ${controllerInstanceId}] MOUNT/EFFECT RUN at ${effectTimestamp} - Setting up listeners...`, 'color: magenta; font-weight: bold');
    
    const initializeComponents = async () => {
      // --- ADD Instance ID to log ---
      console.log(`%c[RecordingController INSTANCE: ${controllerInstanceId}] initializeComponents running...`, 'color: blue; font-weight: bold');
      try {
        // --- Listen for Backend Events ---
        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Setting up backend event listeners...`);
        
        const updateStateUnlistener = await listen("fethr-update-ui-state", (event) => {
            const payload = event.payload as { state: string };
            // UI state update logging removed for performance
            
            // Convert string state to enum
            let newState: RecordingState | null = null;
            switch (payload.state) {
                case "IDLE":
                    newState = RecordingState.IDLE;
                    break;
                case "RECORDING":
                    newState = RecordingState.RECORDING;
                    break;
                case "LOCKED_RECORDING":
                    newState = RecordingState.LOCKED_RECORDING;
                    break;
                case "TRANSCRIBING":
                    newState = RecordingState.TRANSCRIBING;
                    break;
                default:
                    console.warn(`[RecordingController INSTANCE: ${controllerInstanceId}] Received unknown state from backend:`, payload.state);
            }

            if (newState !== null) {
                setCurrentRecordingState(newState);
            }
        });
        unlisteners.current.push(updateStateUnlistener);

        const startRecordingUnlistener = await listen("fethr-start-recording", () => {
            startRecordingProcess();
        });
        unlisteners.current.push(startRecordingUnlistener);

        const stopTranscribeUnlistener = await listen("fethr-stop-and-transcribe", (event) => {
            const autoPaste = event.payload as boolean;
            
            // Override config option if provided by backend
            const effectiveAutoPaste = autoPaste !== undefined ? autoPaste : configOptions.autoPasteTranscription;
            
            // Call stop backend (which returns promise) and handle result
            const stopPromise = invoke<string>('stop_backend_recording', { 
                autoPaste: effectiveAutoPaste 
            });
            handleTranscriptionResult(stopPromise);
        });
        unlisteners.current.push(stopTranscribeUnlistener);

        const cancelRecordingUnlistener = await listen("fethr-cancel-recording", () => {
            console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Received Cancel Recording command from backend timeout.`);
            invoke('cancel_backend_recording')
              .then(() => {
                console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] cancel_backend_recording invoked successfully.`);
                // No need to reset RDEV state here, timeout logic already set it to Idle.
                // UI should have already been set to Idle by the timeout emit_state_update.
              })
              .catch(err => {
                console.error(`[RecordingController INSTANCE: ${controllerInstanceId}] Error invoking cancel_backend_recording:`, err);
                // Maybe force UI to Idle on error?
                setCurrentRecordingState(RecordingState.IDLE);
              });
        });
        unlisteners.current.push(cancelRecordingUnlistener);

        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Backend event listeners attached.`);
        // --- End Listeners ---

      } catch (error) {
        console.error(`%c[RecordingController INSTANCE: ${controllerInstanceId}] FATAL ERROR initializing components:`, 'color: red; font-weight: bold', error);
        setErrorMessage(`Failed to initialize components: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    initializeComponents();

    // Cleanup on unmount
    return () => {
      // --- ADD Instance ID to log ---
      console.log(`%c[RecordingController INSTANCE: ${controllerInstanceId}] CLEANUP function for listener effect running at ${new Date().toISOString()}`, 'background: orange; color: black; font-weight: bold;');

      // Unsubscribe from all event listeners
      if (unlisteners.current.length > 0) {
        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Cleaning up ${unlisteners.current.length} event listeners`);
        unlisteners.current.forEach(unlisten => {
          try {
            unlisten();
          } catch (err) {
            console.error(`[RecordingController INSTANCE: ${controllerInstanceId}] Error unlistening:`, err);
          }
        });
        unlisteners.current = [];
      }

      if (durationInterval.current) {
        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Clearing duration interval`);
        clearInterval(durationInterval.current);
        durationInterval.current = null;
      }
      
      console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Component unmount cleanup complete`);
    };
    // --- IMPORTANT: Ensure dependency array is EMPTY ---
  }, []); // <<< MUST be an empty array [] to run only on mount/unmount
  // --- END IMPORTANT ---

  // Effect to handle UI updates based on recording state
  useEffect(() => {
    const stateToProcess = currentRecordingState;
    console.log(`%c[RecordingController INSTANCE: ${controllerInstanceId}] 🔄 UI EFFECT triggered for state: ${RecordingState[stateToProcess]}`, 'color: darkcyan; font-weight: bold;');

    const stopTimer = () => {
      if (durationInterval.current) {
        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Stopping timer - clearing interval ID: ${durationInterval.current}`);
        clearInterval(durationInterval.current);
        durationInterval.current = null;
        
        if (startTimeRef.current) {
          const finalDuration = (Date.now() - startTimeRef.current) / 1000;
          console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Timer stopped. Final duration: ${finalDuration.toFixed(2)}s`);
        }
      } else {
        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] stopTimer called but no active interval found.`);
      }
      startTimeRef.current = null;
    };

    const startTimer = () => {
      // Clear any existing timer
      if (durationInterval.current) {
        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Clearing existing timer interval ID: ${durationInterval.current} before starting new one.`);
        clearInterval(durationInterval.current);
        durationInterval.current = null;
      }
      
      // Reset duration and start time
      setRecordingDuration(0);
      startTimeRef.current = Date.now();
      const startTimestamp = new Date().toISOString();
      
      console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Starting UI duration timer display at ${startTimestamp}. Start time: ${startTimeRef.current}`);
      const intervalId = window.setInterval(() => {
        if (startTimeRef.current) {
          const now = Date.now();
          const elapsedMs = now - startTimeRef.current;
          const newDuration = elapsedMs / 1000;
          
          // Timer logging removed for performance
          
          setRecordingDuration(newDuration);
        } else {
          console.warn(`[RecordingController INSTANCE: ${controllerInstanceId} Timer] Timer fired but startTimeRef is null! Clearing interval.`);
          if (durationInterval.current) {
               clearInterval(durationInterval.current);
               durationInterval.current = null;
          }
        }
      }, 100); // Update 10 times per second for smoother display
      durationInterval.current = intervalId;
      console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Timer started with interval ID: ${intervalId}`);
    };

    // Handle logic for current state
    if (stateToProcess === RecordingState.RECORDING || stateToProcess === RecordingState.LOCKED_RECORDING) {
      // Start or ensure timer is running
      if (startTimeRef.current === null) {
        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Starting timer (not already running)`);
        startTimer();
      } else {
        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Timer already running, not restarting`);
      }
      setErrorMessage(null); // Clear any error messages when recording starts
    } else if (stateToProcess === RecordingState.IDLE || stateToProcess === RecordingState.TRANSCRIBING) {
      // Stop timer if it's running
      if (startTimeRef.current !== null) {
        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Stopping timer for state: ${RecordingState[stateToProcess]}`);
        stopTimer();
      } else {
        console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Timer already stopped for state: ${RecordingState[stateToProcess]}`);
      }
    }

    // Cleanup for this effect
    return () => {
      console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] UI Update useEffect cleanup running.`);
    };
  }, [currentRecordingState, recordingDuration]);

  // Format seconds as MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecordingProcess = async () => {
    // --- ADD Instance ID to log ---
    console.log(`%c[RecordingController INSTANCE: ${controllerInstanceId}] ➡️ startRecordingProcess invoked...`, 'color: green;');
    
    // Clear previous transcription when starting new recording
    if (transcription) {
      console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Clearing previous transcription of length:`, transcription.length);
      setTranscription('');
    }
    
    // Clear errors from previous recordings
    setErrorMessage(null);
    
    try {
      console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Invoking start_backend_recording...`);
      await invoke('start_backend_recording');
      console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Backend start_backend_recording command successful.`);
    } catch (error) {
      const errorMsg = `Start Recording Error: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`%c[RecordingController INSTANCE: ${controllerInstanceId}] ❌ ${errorMsg}`, 'color: red; font-weight: bold');
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
      
      // Force state to IDLE if error occurs
      console.log(`[RecordingController INSTANCE: ${controllerInstanceId}] Error resulted in forcing state to IDLE`);
      setCurrentRecordingState(RecordingState.IDLE);
    }
  };

  return (
    <div className="relative p-1 z-10">
      <RecordingPill
        currentState={currentRecordingState}
        error={errorMessage || undefined}
        transcription={transcription}
        duration={formatDuration(recordingDuration)}
      />
    </div>
  );
};

export default RecordingController;