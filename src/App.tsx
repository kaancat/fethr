import React, { useState, useEffect, useRef } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import { RecordingState } from './types';
import RecordingPill from './components/RecordingPill';
import { toast } from "react-hot-toast"; // Keep react-hot-toast for now as it's still used for notifications
import { Toaster } from "@/components/ui/toaster"; // Import shadcn/ui Toaster
import { TooltipProvider } from "@/components/ui/tooltip"; // Import TooltipProvider
import SettingsPage from './pages/SettingsPage';
import './index.css';

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
    console.log("PillPage: Component rendering (Corrected Listener)"); // Log component render
    const [currentState, setCurrentState] = useState<RecordingState>(RecordingState.IDLE);
    const [duration, setDuration] = useState<number>(0);
    const [transcription, setTranscription] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const startTimeRef = useRef<number | null>(null);
    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        console.log("PillPage: useEffect running - setting up ALL listeners (Invoke Logic Added)");

        let isMounted = true;
        const unlisteners: Array<() => void> = []; // Array to store unlisten functions

        // --- Handler for transcription result ---
        const handleTranscriptionResult = (resultPromise: Promise<string>) => {
            console.log("PillPage: Entering handleTranscriptionResult...");
            setError(null); // Clear previous error

            resultPromise
                .then(resultText => {
                    if (!isMounted) return;
                    console.log("PillPage: stop_backend_recording promise resolved:", resultText);
                    if (!resultText || resultText.trim() === '') {
                        console.warn("PillPage: Backend returned empty result");
                        setError('Transcription empty');
                        // toast('Transcription empty or no speech detected.', { icon: '🔇' }); // Optional toast
                        setTranscription(null);
                    } else {
                        console.log("PillPage: Setting transcription result, length:", resultText.length);
                        setTranscription(resultText); // Keep result
                        setError(null);
                        // We can rely on the timeout in the state listener to clear this later
                    }
                })
                .catch(error => {
                    if (!isMounted) return;
                    console.error("PillPage: stop_backend_recording promise rejected:", error);
                    const errorMsg = `Transcription error: ${error instanceof Error ? error.message : String(error)}`;
                    setError(errorMsg);
                    toast.error(errorMsg.substring(0, 100)); // Show toast on error
                    setTranscription(null);
                    // Don't force state to IDLE here, let the reset signal handle it
                })
                .finally(() => {
                    if (!isMounted) return;
                    console.log("PillPage: Transcription attempt complete (finally block).");

                    // --- ADD BACK EXPLICIT FRONTEND RESET ---
                    console.log("PillPage: Explicitly setting frontend state to IDLE in finally block.");
                    setCurrentState(RecordingState.IDLE);
                    setDuration(0);
                    // Keep transcription visible; timeout in state listener will clear it.
                    // --- END ADD BACK ---

                    console.log("PillPage: Signaling backend reset...");
                    invoke('signal_reset_complete')
                         .then(() => console.log("PillPage: signal_reset_complete invoked successfully."))
                         .catch(err => console.error("PillPage: Failed to invoke signal_reset_complete:", err));
                });
        };
        // --- End Handler ---


        const setupListeners = async () => {
            try {
                // --- State Update Listener ---
                const unlistenState = await listen<StateUpdatePayload>('fethr-update-ui-state', (event) => {
                    if (!isMounted) return;
                    console.log('PillPage: Received fethr-update-ui-state:', event.payload);
                    console.log(`PillPage: Received state VALUE: ${event.payload.state}`);
                    console.log(`PillPage: Received state TYPE: ${typeof event.payload.state}`);

                    const { state: receivedState, duration_ms, transcription_result, error_message } = event.payload;

                    let newTsState: RecordingState = RecordingState.IDLE; // Default
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

                    // --- ADD Immediate Clear on IDLE ---
                    if (newTsState === RecordingState.IDLE) {
                        console.log("PillPage: Clearing transcription/error immediately as IDLE state received.");
                        setTranscription(null);
                        setError(null);
                    }
                    // --- END Immediate Clear on IDLE ---

                    setCurrentState(newTsState); // Set the correct TS enum value

                    // Update transcription/error based on payload ONLY if they are explicitly provided
                    // (avoid clearing them just because the state changed)
                     if (transcription_result !== undefined) setTranscription(transcription_result);
                     if (error_message !== undefined) setError(error_message);


                    // --- Timer Logic (Revised) ---
                    const shouldBeRunning = newTsState === RecordingState.RECORDING || newTsState === RecordingState.LOCKED_RECORDING;
                    const isRunning = timerIntervalRef.current !== null;

                    if (shouldBeRunning && !isRunning) {
                        // Start Timer
                        console.log("PillPage: Starting timer");
                        startTimeRef.current = Date.now();
                        setDuration(0); // Reset duration ONLY when starting fresh
                        timerIntervalRef.current = setInterval(() => {
                            if (startTimeRef.current) {
                                setDuration(Date.now() - startTimeRef.current);
                            } else {
                                // Safety clear if startTime became null unexpectedly
                                if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
                                timerIntervalRef.current = null; // Ensure ref is cleared
                            }
                        }, 100); // Update duration every 100ms

                    } else if (!shouldBeRunning && isRunning) {
                        // Stop Timer
                        console.log("PillPage: Stopping timer");
                        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
                        timerIntervalRef.current = null;
                        startTimeRef.current = null;

                        // Reset duration display ONLY if the new state is truly Idle or Error
                        if (newTsState === RecordingState.IDLE || newTsState === RecordingState.ERROR) {
                             console.log(`PillPage: Resetting duration display for state: ${RecordingState[newTsState]}`);
                             setDuration(0);
                        }
                        // Otherwise (e.g., Transcribing), keep the last duration displayed
                    }
                    // --- End Timer Logic (Revised) ---
                });
                unlisteners.push(unlistenState); // Add to cleanup array
                console.log("PillPage: State Update listener setup.");

                // --- Start Recording Listener ---
                const unlistenStart = await listen<void>("fethr-start-recording", () => {
                    if (!isMounted) return;
                    console.log("PillPage: Received fethr-start-recording. Invoking backend...");
                    // Clear previous results/errors when starting
                    setTranscription(null);
                    setError(null);
                    invoke('start_backend_recording')
                        .then(() => console.log("PillPage: start_backend_recording invoked successfully."))
                        .catch(err => {
                            console.error("PillPage: Error invoking start_backend_recording:", err);
                            setError(`Start Error: ${err}`);
                            toast.error(`Start Error: ${err}`);
                            setCurrentState(RecordingState.IDLE); // Force idle on start error
                            invoke('signal_reset_complete').catch(e=>console.error(e)); // Also reset backend
                        });
                });
                unlisteners.push(unlistenStart); // Add to cleanup array
                console.log("PillPage: Start Recording listener setup.");

                // --- Stop and Transcribe Listener ---
                const unlistenStop = await listen<boolean>("fethr-stop-and-transcribe", (event) => {
                    if (!isMounted) return;
                    const autoPaste = event.payload; // Backend sends boolean flag
                    console.log(`PillPage: Received fethr-stop-and-transcribe (autoPaste: ${autoPaste}). Invoking backend...`);
                    // Call stop backend (which returns promise with transcription string) and handle result
                    const stopPromise = invoke<string>('stop_backend_recording', { autoPaste }); // Pass autoPaste flag
                    handleTranscriptionResult(stopPromise); // Handle the promise chain
                });
                unlisteners.push(unlistenStop); // Add to cleanup array
                console.log("PillPage: Stop/Transcribe listener setup.");

                console.log("PillPage: All listeners setup successful.");

            } catch (error) {
                 console.error("PillPage: Error setting up Tauri listeners:", error);
                 setError(`Listener setup error: ${error}`);
                 toast.error(`Listener setup error: ${error}`);
            }
        };

        setupListeners(); // Call the async setup function

        // --- Remove Drag Logic ---
        // The drag logic is now handled directly in the RecordingPill component

        // Combined cleanup function for BOTH listeners and drag handler
        return () => {
             console.log("PillPage: Main useEffect cleanup function running (Invoke Logic Added)");
             isMounted = false;
             // Clean up all listeners
             console.log(`PillPage: Cleaning up ${unlisteners.length} listeners...`);
             unlisteners.forEach(unlisten => unlisten());
             // Clean up timer
             if (timerIntervalRef.current) {
                 console.log("PillPage: Clearing timer interval in cleanup.");
                 clearInterval(timerIntervalRef.current);
             }
             // No longer need to clean up drag listener, as it's been moved to RecordingPill
        };

    }, []); // Empty dependency array ensures this runs only once on mount

    // Format duration
    const formatDuration = (ms: number): string => {
        if (ms <= 0) return "0s";
        return Math.floor(ms / 1000).toString() + "s";
    };

    console.log("PillPage: Rendering with State:", RecordingState[currentState], "Duration:", duration);

    // Render container and RecordingPill
    return (
        <div id="pill-container-restored" className="pill-container bg-transparent flex items-center justify-center h-screen w-screen select-none p-4">
             <RecordingPill
                currentState={currentState}
                duration={formatDuration(duration)}
                // Use nullish coalescing ?? for undefined fallback
                transcription={transcription ?? undefined}
                error={error ?? undefined}
            />
        </div>
    );
}

// Main App component
function App() {
  // Get the current pathname when the component mounts
  // This should be '/' for the main window and '/pill' for the pill window
  // after our explicit Rust navigation commands.
  const initialPathname = window.location.pathname;
  console.log(`[App] Rendering. Initial Pathname detected: ${initialPathname}`);

  return (
    <TooltipProvider>
      {/* Pass the detected pathname as the initial route */}
      <MemoryRouter initialEntries={[initialPathname]}>
        <Routes>
          <Route path="/" element={<SettingsPage />} />
          {/* Ensure PillPage component (the simplified green/red one) is rendered here */}
          <Route path="/pill" element={<PillPage />} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App; 