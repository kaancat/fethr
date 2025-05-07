import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import { RecordingState } from './types';
import RecordingPill from './components/RecordingPill';
import { toast } from "react-hot-toast"; // Keep react-hot-toast for now as it's still used for notifications
import { Toaster } from "@/components/ui/toaster"; // Import shadcn/ui Toaster
import { TooltipProvider } from "@/components/ui/tooltip"; // Import TooltipProvider
import SettingsPage from './pages/SettingsPage';
import './index.css';
import { supabase } from '@/lib/supabaseClient'; // Import the Supabase client
import { Session, User } from '@supabase/supabase-js'; // Import Session and User types

// Log to confirm Supabase client module is loaded
console.log('[App.tsx] Supabase client module loaded.', supabase ? 'Instance exists.' : 'Instance MISSING.');

// Define interface for the test utility
interface FethrDragTestInterface {
    start: () => void;
    end: () => void;
}

// Extend Window interface to include our test utility
declare global {
    interface Window {
        FethrDragTest?: FethrDragTestInterface;
    }
}

// Define the structure for the state update payload from the backend
interface StateUpdatePayload {
    state: RecordingState | string; // Allow string initially for mapping
    duration_ms: number;
    transcription_result: string | null;
    error_message: string | null;
}

function PillPage() {
    console.log("PillPage: Component rendering (Adding SUCCESS_EDIT_PENDING)");
    const [currentState, setCurrentState] = useState<RecordingState>(RecordingState.IDLE);
    const [duration, setDuration] = useState<number>(0);
    const [transcription, setTranscription] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const startTimeRef = useRef<number | null>(null);
    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const editPendingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const handleTranscriptionResult = useCallback((resultPromise: Promise<string>) => {
        console.log("PillPage: Entering handleTranscriptionResult...");
        setError(null);

        if (editPendingTimeoutRef.current) {
            clearTimeout(editPendingTimeoutRef.current);
            editPendingTimeoutRef.current = null;
        }

        resultPromise
            .then(resultText => {
                console.log("PillPage: stop_backend_recording promise resolved:", resultText);
                if (!resultText || resultText.trim() === '') {
                    console.warn("PillPage: Backend returned empty result");
                    setError('Transcription empty');
                    setTranscription(null);
                    setCurrentState(RecordingState.ERROR);
                } else {
                    console.log("PillPage: Setting transcription result, length:", resultText.length);
                    setTranscription(resultText);
                    setError(null);
                    
                    console.log(`%c[PillPage STATE] Setting state to: SUCCESS_EDIT_PENDING`, "color: cyan;");
                    setCurrentState(RecordingState.SUCCESS_EDIT_PENDING);

                    editPendingTimeoutRef.current = setTimeout(() => {
                        console.log("PillPage: Edit Pending timeout finished. Resetting...");
                        setCurrentState(prevStatus =>
                            prevStatus === RecordingState.SUCCESS_EDIT_PENDING ? RecordingState.IDLE : prevStatus
                        );
                        setTranscription(null);
                        editPendingTimeoutRef.current = null;
                    }, 7000);
                }
            })
            .catch(error => {
                console.error("PillPage: stop_backend_recording promise rejected:", error);
                const errorMsg = `Transcription error: ${error instanceof Error ? error.message : String(error)}`;
                setError(errorMsg);
                toast.error(errorMsg.substring(0, 100));
                setTranscription(null);
            })
            .finally(() => {
                console.log("PillPage: Transcription attempt complete (finally block).");
            });
    }, []);

    const handleImmediateEditClick = useCallback(() => {
        console.log("[PillPage] Immediate Edit clicked!");

        // Clear the timeout
        if (editPendingTimeoutRef.current) {
            clearTimeout(editPendingTimeoutRef.current);
            editPendingTimeoutRef.current = null;
            console.log("[PillPage] Cleared edit pending timeout.");
        }

        // --- Emit event BEFORE showing window --- 
        console.log("[PillPage] Emitting fethr-edit-latest-history...");
        emit('fethr-edit-latest-history')
             .then(() => console.log('[PillPage] Emitted fethr-edit-latest-history event.'))
             .catch(err => console.error('[PillPage] Failed to emit fethr-edit-latest-history:', err));
        // ----------------------------------------
        
        // Call the backend command to show the window 
        console.log("[PillPage] Invoking show_settings_window_and_focus...");
        invoke('show_settings_window_and_focus')
            .then(() => console.log("[PillPage] Successfully invoked show_settings_window_and_focus."))
            .catch(err => {
                 console.error("[PillPage] Failed to show/focus settings:", err);
                 toast.error(`Could not open settings: ${err}`);
             });

        // Reset state to IDLE after click
        setCurrentState(RecordingState.IDLE);
        setTranscription(null);

    }, []);

    useEffect(() => {
        console.log("PillPage: useEffect running - setting up ALL listeners (Edit Pending Added)");
        let isMounted = true;
        const unlisteners: Array<() => void> = [];

        const setupListeners = async () => {
            try {
                const handleErrorOccurred = (event: { payload: string }) => {
                    const errorMsg = event.payload;
                    console.log(`PillPage: Received fethr-error-occurred: "${errorMsg}"`);
                    if (errorTimeoutRef.current) {
                        clearTimeout(errorTimeoutRef.current);
                    }
                    setErrorMessage(errorMsg || "An unknown error occurred.");

                    errorTimeoutRef.current = setTimeout(() => {
                        setErrorMessage(null);
                        console.log("PillPage: Error display timeout finished.");
                        errorTimeoutRef.current = null;
                    }, 4000);
                };

                console.log("PillPage: Setting up Error listener.");
                const unlistenError = await listen<string>('fethr-error-occurred', handleErrorOccurred);
                unlisteners.push(unlistenError);
                console.log("PillPage: Error listener setup.");

                const unlistenState = await listen<StateUpdatePayload>('fethr-update-ui-state', (event) => {
                    if (!isMounted) return;
                    console.log('PillPage: Received fethr-update-ui-state:', event.payload);
                    console.log(`PillPage: Received state VALUE: ${event.payload.state}`);
                    console.log(`PillPage: Received state TYPE: ${typeof event.payload.state}`);

                    const { state: receivedState, duration_ms, transcription_result, error_message } = event.payload;

                    let newTsState: RecordingState = RecordingState.IDLE;
                    if (typeof receivedState === 'string') {
                        const stateUppercase = receivedState.toUpperCase();
                         switch (stateUppercase) {
                            case "RECORDING": newTsState = RecordingState.RECORDING; break;
                            case "LOCKEDRECORDING": newTsState = RecordingState.LOCKED_RECORDING; break;
                            case "TRANSCRIBING": newTsState = RecordingState.TRANSCRIBING; break;
                            case "PASTING": newTsState = RecordingState.PASTING; break;
                            case "ERROR": newTsState = RecordingState.ERROR; break;
                            case "IDLE": newTsState = RecordingState.IDLE; break;
                            default: 
                                console.warn(`PillPage: Received unknown state string: ${receivedState}`);
                                newTsState = RecordingState.IDLE; 
                                break;
                         }
                    } else { 
                        console.error(`PillPage: Received non-string state type: ${typeof receivedState}`, receivedState);
                        newTsState = RecordingState.IDLE; 
                    }
                    console.log(`PillPage: Mapped received state "${receivedState}" to TS Enum value: ${RecordingState[newTsState]} (${newTsState})`);

                    if (newTsState === RecordingState.IDLE) {
                        console.log("PillPage: Clearing transcription/error immediately as IDLE state received.");
                        setTranscription(null);
                        setError(null);
                    }

                    setCurrentState(newTsState);

                    if (transcription_result !== undefined) setTranscription(transcription_result);
                    if (error_message !== undefined) setError(error_message);

                    const shouldBeRunning = newTsState === RecordingState.RECORDING || newTsState === RecordingState.LOCKED_RECORDING;
                    const isRunning = timerIntervalRef.current !== null;

                    if (shouldBeRunning && !isRunning) {
                        console.log("PillPage: Starting timer");
                        startTimeRef.current = Date.now();
                        setDuration(0);
                        timerIntervalRef.current = setInterval(() => {
                            if (startTimeRef.current) {
                                setDuration(Date.now() - startTimeRef.current);
                            } else {
                                if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
                                timerIntervalRef.current = null;
                            }
                        }, 100);

                    } else if (!shouldBeRunning && isRunning) {
                        console.log("PillPage: Stopping timer");
                        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
                        timerIntervalRef.current = null;
                        startTimeRef.current = null;

                        if (newTsState === RecordingState.IDLE || newTsState === RecordingState.ERROR) {
                             console.log(`PillPage: Resetting duration display for state: ${RecordingState[newTsState]}`);
                             setDuration(0);
                        }
                    }
                });
                unlisteners.push(unlistenState);
                console.log("PillPage: State Update listener setup.");

                const unlistenStart = await listen<void>("fethr-start-recording", () => {
                    if (!isMounted) return;
                    console.log("PillPage: Received fethr-start-recording. Invoking backend...");
                    if (editPendingTimeoutRef.current) {
                        clearTimeout(editPendingTimeoutRef.current);
                        editPendingTimeoutRef.current = null;
                        console.log("[PillPage] Cleared edit pending timeout due to new recording start.");
                    }
                    setTranscription(null);
                    setError(null);
                    invoke('start_backend_recording')
                        .then(() => console.log("PillPage: start_backend_recording invoked successfully."))
                        .catch(err => {
                            console.error("PillPage: Error invoking start_backend_recording:", err);
                            setError(`Start Error: ${err}`);
                            toast.error(`Start Error: ${err}`);
                            setCurrentState(RecordingState.IDLE);
                        });
                });
                unlisteners.push(unlistenStart);
                console.log("PillPage: Start Recording listener setup.");

                const unlistenStop = await listen<boolean>("fethr-stop-and-transcribe", (event) => {
                    if (!isMounted) return;
                    const autoPaste = event.payload;
                    console.log(`PillPage: Received fethr-stop-and-transcribe (autoPaste: ${autoPaste}). Invoking backend...`);
                    const stopPromise = invoke<string>('stop_backend_recording', { autoPaste });
                    handleTranscriptionResult(stopPromise);
                });
                unlisteners.push(unlistenStop);
                console.log("PillPage: Stop/Transcribe listener setup.");

                console.log("PillPage: All listeners setup successful.");

            } catch (error) {
                 console.error("PillPage: Error setting up Tauri listeners:", error);
                 setError(`Listener setup error: ${error}`);
                 toast.error(`Listener setup error: ${error}`);
            }
        };

        setupListeners();

        return () => {
             console.log("PillPage: Main useEffect cleanup function running (Invoke Logic Added)");
             isMounted = false;
             console.log(`PillPage: Cleaning up ${unlisteners.length} listeners...`);
             unlisteners.forEach(unlisten => unlisten());
             if (timerIntervalRef.current) {
                 console.log("PillPage: Clearing timer interval in cleanup.");
                 clearInterval(timerIntervalRef.current);
             }
             if (errorTimeoutRef.current) {
                 console.log("PillPage: Clearing error timeout on unmount.");
                 clearTimeout(errorTimeoutRef.current);
             }
             if (editPendingTimeoutRef.current) {
                 clearTimeout(editPendingTimeoutRef.current);
                 console.log("[PillPage] Cleared edit pending timeout on unmount.");
             }
        };

    }, [handleTranscriptionResult, handleImmediateEditClick]);

    const formatDuration = (ms: number): string => {
        if (ms <= 0) return "0s";
        return Math.floor(ms / 1000).toString() + "s";
    };

    console.log("PillPage: Rendering with State:", RecordingState[currentState], "Duration:", duration);

    return (
        <div id="pill-container-restored" className="pill-container bg-transparent flex items-center justify-center h-screen w-screen select-none p-4">
             <RecordingPill
                currentState={currentState}
                duration={formatDuration(duration)}
                transcription={transcription ?? undefined}
                error={error ?? undefined}
                backendError={errorMessage}
                onEditClick={handleImmediateEditClick}
            />
        </div>
    );
}

function App() {
  const initialPathname = window.location.pathname;
  console.log(`[App] Rendering. Initial Pathname detected: ${initialPathname}`);

  // Add State for Auth Session/User:
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState<boolean>(true); // Track initial loading

  // Add useEffect to Listen for Auth Changes:
  useEffect(() => {
      console.log('[Auth Listener] Setting up Supabase auth listener.');
      setLoadingAuth(true);

      // Get initial session
      supabase.auth.getSession().then(({ data: { session } }) => {
          setSession(session);
          setUser(session?.user ?? null);
          setLoadingAuth(false);
          console.log('[Auth Listener] Initial session loaded:', session ? 'Exists' : 'None');
      }).catch(error => {
           console.error('[Auth Listener] Error getting initial session:', error);
           setLoadingAuth(false);
      });

      // Set up the listener for future changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          console.log('[Auth Listener] Auth state changed. New session:', session ? 'Exists' : 'None', 'Event:', _event);
          setSession(session);
          setUser(session?.user ?? null);
          setLoadingAuth(false); // Ensure loading is set to false on changes too
      });

      // Cleanup function to unsubscribe
      return () => {
          console.log('[Auth Listener] Unsubscribing from auth changes.');
          subscription?.unsubscribe();
      };
  }, []); // Run only once on mount

  return (
    <TooltipProvider>
      <MemoryRouter initialEntries={[initialPathname]}>
        <Routes>
          {/* Pass Auth State to SettingsPage */}
          <Route path="/" element={<SettingsPage user={user} loadingAuth={loadingAuth} />} />
          <Route path="/pill" element={<PillPage />} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App; 