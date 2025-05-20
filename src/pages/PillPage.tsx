console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
console.log("!!!! PILL PAGE - VERSION X - LOADED !!!!");
console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
// ... rest of your file
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { RecordingState } from '../types'; // Assuming types.ts is in ../
import RecordingPill from '../components/RecordingPill'; // Assuming RecordingPill is in ../components/
import { toast } from "react-hot-toast";
import { supabase } from '@/lib/supabaseClient';

// Define the structure for the state update payload from the backend
interface StateUpdatePayload {
    state: RecordingState | string; // Allow string initially for mapping
    duration_ms: number;
    transcription_result: string | null;
    error_message: string | null;
}

// --- THIS IS THE CORRECTED PillPage COMPONENT ---
function PillPage() {
    // console.log(`%c[PillPage Render] currentState: ${RecordingState[currentState]}, error: ${error}, errorMessage: ${errorMessage}`, "color: magenta;"); // MOVED
    const [currentState, setCurrentState] = useState<RecordingState>(RecordingState.IDLE);
    const [duration, setDuration] = useState<number>(0);
    // Note: Removing transcription state from here as it's not directly displayed by the pill itself anymore
    // const [transcription, setTranscription] = useState<string | null>(null);
    const [lastTranscriptionText, setLastTranscriptionText] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null); // For backend process errors
    const [errorMessage, setErrorMessage] = useState<string | null>(null); // For dedicated error state display
    const startTimeRef = useRef<number | null>(null);
    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const editReadyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // MOVED TO THE TOP and SIMPLIFIED for diagnostics
    // useEffect(() => {
    //     console.log("%c[PillPage CRITICAL LOG] DIAGNOSTIC useEffect (first one) ENTERED", "background: lime; color: black; font-weight: bold;");
    //     return () => {
    //         console.log('%c[PillPage CRITICAL LOG] DIAGNOSTIC useEffect (first one) CLEANUP', "background: red; color: white; font-weight: bold;");
    //     };
    // }, []); // Empty dependency array

    const handleErrorDismiss_MEMOIZED = useCallback(() => {
        console.log(`%c[PillPage handleErrorDismiss_MEMOIZED CALLED] State: ${RecordingState[currentState]}, Error: ${error}, Message: ${errorMessage}`, "color: orange; font-weight: bold;");
        if (errorTimeoutRef.current) {
            clearTimeout(errorTimeoutRef.current);
            errorTimeoutRef.current = null;
            console.log("[PillPage handleErrorDismiss] Cleared errorTimeoutRef.");
        }
        if (editReadyTimeoutRef.current) {
            clearTimeout(editReadyTimeoutRef.current);
            editReadyTimeoutRef.current = null;
            console.log("[PillPage handleErrorDismiss] Cleared editReadyTimeoutRef.");
        }

        setError(null);
        setErrorMessage(null);
        setLastTranscriptionText(null); 
        setCurrentState(RecordingState.IDLE);
        console.log("[PillPage handleErrorDismiss] All frontend states reset to idle/null.");

        invoke('signal_reset_complete')
            .then(() => {
                console.log("[PillPage handleErrorDismiss] Backend reset signal SUCCEEDED.");
            })
            .catch(err => {
                console.error("[PillPage handleErrorDismiss] Backend reset signal FAILED:", err);
            });
    }, [setCurrentState, setError, setErrorMessage, setLastTranscriptionText]); // Added setLastTranscriptionText

    // New useEffect for the robust global fallback - RESTORED with empty dependency array for now
    useEffect(() => {
        console.log("%c[PillPage CRITICAL LOG] Entering useEffect to define TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT", "background: yellow; color: black; font-weight: bold;");
        (window as any).TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT = () => {
            console.log(`%c[PillPage TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT CALLED!] CurrentState (at definition time): ${RecordingState[currentState]}`, "color: purple; font-size: 1.3em; font-weight: bold;");
            // Note: currentState here will be stale due to the empty dependency array for this diagnostic step.
            // The actual dismissal logic might need to be adapted or this effect reverted once the assignment issue is solved.
            if (errorTimeoutRef.current) {
                clearTimeout(errorTimeoutRef.current);
                errorTimeoutRef.current = null;
                console.log("[PillPage GlobalEffectFn] Cleared errorTimeoutRef.");
            }
            if (editReadyTimeoutRef.current) {
                clearTimeout(editReadyTimeoutRef.current);
                editReadyTimeoutRef.current = null;
                console.log("[PillPage GlobalEffectFn] Cleared editReadyTimeoutRef.");
            }
            setError(null);
            setErrorMessage(null);
            setLastTranscriptionText(null);
            setCurrentState(RecordingState.IDLE); // This will use the initial setCurrentState
            console.log("[PillPage GlobalEffectFn] All frontend states reset to idle/null.");
            invoke('signal_reset_complete')
                .then(() => console.log("[PillPage GlobalEffectFn] Backend reset signal SUCCEEDED."))
                .catch(err => console.error("[PillPage GlobalEffectFn] Backend reset signal FAILED:", err));
        };
        console.log('[PillPage useEffect] Assigned (window as any).TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT. Type:', typeof (window as any).TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT);
    
        return () => {
            delete (window as any).TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT;
            console.log('%c[PillPage CRITICAL LOG] Cleaned up (window as any).TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT', "background: orange; color: black; font-weight: bold;");
        };
    }, []); // Empty dependency array for now

    // --- Handler for Edit Icon Click ---
    const handleEditClick = useCallback(() => {
        console.log("PillPage: Edit clicked!");
        // Cancel timeout that would revert to IDLE
        if (editReadyTimeoutRef.current) {
            clearTimeout(editReadyTimeoutRef.current);
            editReadyTimeoutRef.current = null;
        }
        if (lastTranscriptionText) {
            console.log("PillPage: Invoking open_editor_window for:", lastTranscriptionText);
            invoke('open_editor_window', { textToEdit: lastTranscriptionText })
                .catch(err => console.error("PillPage: Failed to open editor window:", err));
        } else {
            console.error("PillPage: Edit clicked but no last transcription text found!");
        }
        // Go back to standard IDLE immediately and signal reset
        const finalIdleState = RecordingState.IDLE;
        console.log(`%c[PillPage STATE] Attempting to set state to: ${RecordingState[finalIdleState]} (${finalIdleState}) after edit click`, "color: orange;");
        setCurrentState(finalIdleState);
        setLastTranscriptionText(null);
        invoke('signal_reset_complete').catch(err => console.error("PillPage: Failed to signal reset complete after edit click:", err));
    }, [lastTranscriptionText]); // Dependency on lastTranscriptionText

    // --- Handler for processing transcription results ---
    const handleTranscriptionResult = useCallback((resultPromise: Promise<string>) => {
        console.log("PillPage: Entering handleTranscriptionResult...");
        setError(null);

        resultPromise
            .then(resultText => {
                if (!resultText || resultText.trim() === '') {
                    console.warn("PillPage: Backend returned empty result");
                    setError('Transcription empty');
                    setLastTranscriptionText(null);
                    setCurrentState(RecordingState.ERROR);

                    if (editReadyTimeoutRef.current) clearTimeout(editReadyTimeoutRef.current);
                    editReadyTimeoutRef.current = setTimeout(() => {
                        console.log("PillPage: Empty result/Error timeout. Reverting to IDLE.");
                        handleErrorDismiss_MEMOIZED(); // Use central handler
                    }, 3000);
                } else {
                    console.log("[PillPage RESULT] Got successful transcription. Storing text.");
                    setError(null);
                    setLastTranscriptionText(resultText);
                }
            })
            .catch(errorObj => {
                console.error("PillPage: stop_backend_recording promise rejected:", errorObj);
                const errorMsg = `Transcription error: ${errorObj instanceof Error ? errorObj.message : String(errorObj)}`;
                setError(errorMsg);
                toast.error(errorMsg.substring(0, 100));
                setLastTranscriptionText(null);
                setCurrentState(RecordingState.ERROR);

                if (editReadyTimeoutRef.current) clearTimeout(editReadyTimeoutRef.current);
                editReadyTimeoutRef.current = setTimeout(() => {
                    console.log("PillPage: Transcription error timeout. Reverting to IDLE.");
                    handleErrorDismiss_MEMOIZED(); // Use central handler
                }, 3000);
            })
            .finally(() => {
                console.log("PillPage: Transcription attempt complete (finally block).");
            });
    }, [handleErrorDismiss_MEMOIZED]);

    // --- Main useEffect for listeners ---
    useEffect(() => {
        // ADD THE CRITICAL LOG HERE AS THE VERY FIRST LINE
        console.log("%c[PillPage CRITICAL LOG] DIAGNOSTIC LOG INSIDE MAIN LISTENER useEffect", "background: cyan; color: black; font-weight: bold;");

        console.log("PillPage: useEffect running - setting up listeners (External File - Corrected)");
        let isMounted = true; // Add mount check flag
        const unlisteners: Array<() => void> = [];

        const setupListeners = async () => {
            try {
                // --- Listener for Backend Errors ---
                const handleErrorOccurred = (event: { payload: string }) => {
                    if (!isMounted) return;
                    const errorMsg = event.payload;
                    console.log(`PillPage: Received fethr-error-occurred: "${errorMsg}"`);
                    if (editReadyTimeoutRef.current) clearTimeout(editReadyTimeoutRef.current);
                    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
                    editReadyTimeoutRef.current = null;
                    successTimeoutRef.current = null;
                    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
                    setErrorMessage(errorMsg || "An unknown error occurred.");
                    setCurrentState(RecordingState.ERROR);
                    errorTimeoutRef.current = setTimeout(() => {
                        if (!isMounted) return;
                        console.log("PillPage: Backend error display timeout. Reverting to IDLE.");
                        handleErrorDismiss_MEMOIZED(); // Use central handler
                    }, 4000);
                };
                const unlistenError = await listen<string>('fethr-error-occurred', handleErrorOccurred);
                unlisteners.push(unlistenError);
                console.log("PillPage: Error listener setup.");

                // --- Listener for Copy Success (Triggers SUCCESS -> IDLE_EDIT_READY) ---
                 const unlistenCopied = await listen<void>('fethr-copied-to-clipboard', () => {
                    if (!isMounted) return; // Check mount status
                    console.log("%c[PillPage EVENT LISTENER] <<< Received fethr-copied-to-clipboard! >>>", "color: lime; font-size: 1.2em; font-weight: bold;");

                     // Clear any previous timeouts
                    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
                    if (editReadyTimeoutRef.current) clearTimeout(editReadyTimeoutRef.current);
                    successTimeoutRef.current = null;
                    editReadyTimeoutRef.current = null;

                    // Set state to SUCCESS
                    const successState = RecordingState.SUCCESS;
                    console.log(`%c[PillPage STATE] Attempting to set state to: ${RecordingState[successState]} (${successState}) from copy event`, "color: green;");
                    setCurrentState(successState);

                    // Set the first timeout (Success -> IdleEditReady)
                    successTimeoutRef.current = setTimeout(() => {
                        if (!isMounted) return; // Check mount inside timeout
                        const idleEditReadyState = RecordingState.IDLE_EDIT_READY;
                        console.log("PillPage: Success timeout finished. Transitioning to Idle Edit Ready.");
                        console.log(`%c[PillPage STATE] Attempting to set state to: ${RecordingState[idleEditReadyState]} (${idleEditReadyState})`, "color: blue;");
                        setCurrentState(idleEditReadyState);
                        successTimeoutRef.current = null;

                        // Set the second timeout (IdleEditReady -> Idle)
                        editReadyTimeoutRef.current = setTimeout(() => {
                            if (!isMounted) return; // Check mount inside timeout
                            const finalIdleState = RecordingState.IDLE;
                            console.log("PillPage: Edit Ready timeout finished. Reverting to IDLE.");
                            console.log(`%c[PillPage STATE] Attempting to set state to: ${RecordingState[finalIdleState]} (${finalIdleState})`, "color: orange;");
                            setCurrentState(finalIdleState);
                            setLastTranscriptionText(null); // Clear stored text
                            // Signal backend reset ONLY after the full sequence completes
                            invoke('signal_reset_complete').catch(err => console.error("PillPage: Failed to signal reset complete:", err));
                            editReadyTimeoutRef.current = null;
                        }, 7000); // 7 seconds in Edit Ready state (Adjusted from 10)

                    }, 1500); // 1.5 seconds in Success state
                 });
                 unlisteners.push(unlistenCopied);
                 console.log("PillPage: Copied event listener setup.");

                // --- State Update Listener (Handles basic state changes from backend) ---
                const unlistenState = await listen<StateUpdatePayload>('fethr-update-ui-state', (event) => {
                    if (!isMounted) return;
                    console.log('PillPage: Received fethr-update-ui-state:', event.payload);
                    const { state: receivedState } = event.payload; // Only need state here

                    let newTsState: RecordingState = RecordingState.IDLE;
                    if (typeof receivedState === 'string') {
                        const stateUppercase = receivedState.toUpperCase();
                         switch (stateUppercase) {
                            case "RECORDING": newTsState = RecordingState.RECORDING; break;
                            case "LOCKEDRECORDING": newTsState = RecordingState.LOCKED_RECORDING; break;
                            case "TRANSCRIBING": newTsState = RecordingState.TRANSCRIBING; break;
                            case "IDLE": newTsState = RecordingState.IDLE; break; // Explicitly handle IDLE
                            default: 
                                console.warn(`PillPage: State listener received unknown state string: ${receivedState}. Defaulting to IDLE.`);
                                newTsState = RecordingState.IDLE; // Default to IDLE for unknown states
                                break;
                         }
                    } else {
                        console.error(`PillPage: Received non-string state type: ${typeof receivedState}. Defaulting to IDLE.`);
                        newTsState = RecordingState.IDLE; // Default to IDLE for non-string states
                    }
                    console.log(`PillPage: Mapped received state "${receivedState}" to TS Enum value: ${RecordingState[newTsState]} (${newTsState})`);

                    // Always set the state after mapping, allowing IDLE through
                    console.log(`%c[PillPage STATE] Attempting to set state to: ${RecordingState[newTsState]} (${newTsState}) from backend update (IDLE state processed)`, "color: purple;");
                    setCurrentState(newTsState);

                    // --- Timer Logic ---
                    const shouldBeRunning = newTsState === RecordingState.RECORDING || newTsState === RecordingState.LOCKED_RECORDING;
                    const isRunning = timerIntervalRef.current !== null;

                    if (shouldBeRunning && !isRunning) {
                        console.log("PillPage: Starting timer");
                        startTimeRef.current = Date.now();
                        setDuration(0);
                        timerIntervalRef.current = setInterval(() => {
                            if (startTimeRef.current) { setDuration(Date.now() - startTimeRef.current); }
                            else { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); timerIntervalRef.current = null; }
                        }, 100);
                    } else if (!shouldBeRunning && isRunning) {
                        console.log("PillPage: Stopping timer");
                        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
                        timerIntervalRef.current = null;
                        startTimeRef.current = null;
                        // UPDATED Condition: Reset duration if timer shouldn't be running
                        if (!shouldBeRunning) { 
                            console.log(`PillPage: Resetting duration display for state: ${RecordingState[newTsState]}`);
                            setDuration(0);
                        }
                    }
                    // --- End Timer Logic ---
                });
                unlisteners.push(unlistenState);
                console.log("PillPage: State Update listener setup.");

                // --- Start/Stop Listeners ---
                const unlistenStart = await listen<void>("fethr-start-recording", () => {
                    if (!isMounted) return;
                    console.log("PillPage: Received fethr-start-recording. Invoking backend...");
                    // REMOVED: setTranscription(null);
                    setError(null); setLastTranscriptionText(null);
                    invoke('start_backend_recording')
                        .then(() => console.log("PillPage: start_backend_recording invoked successfully."))
                        .catch(err => { /* ... error handling ... */ });
                });
                unlisteners.push(unlistenStart);
                console.log("PillPage: Start Recording listener setup.");

                const unlistenStop = await listen<boolean>("fethr-stop-and-transcribe", 
                // START OF MODIFIED ASYNC CALLBACK
                async (event) => { 
                    if (!isMounted) return; 
                    const autoPasteCurrentValue = event.payload;
                    
                    console.log(`[PillPage] Event: fethr-stop-and-transcribe. autoPaste: ${autoPasteCurrentValue}.`);
                    console.log('[PillPage] Attempting to get Supabase session for stop_backend_recording...');
                    let userId = null;
                    let accessToken = null;

                    try {
                        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

                        if (sessionError) {
                            console.error('[PillPage] Error getting Supabase session:', sessionError.message);
                        } else if (sessionData && sessionData.session) {
                            userId = sessionData.session.user.id;
                            accessToken = sessionData.session.access_token;
                            console.log('[PillPage] User ID obtained:', userId);
                            console.log('[PillPage] Access Token obtained:', accessToken ? 'Yes' : 'No (session might be null or token not present)');
                        } else {
                            console.log('[PillPage] No active Supabase session found (sessionData.session is null). User might be logged out.');
                        }
                    } catch (e: any) {
                        console.error('[PillPage] Exception during supabase.auth.getSession():', e.message);
                    }

                    console.log(`[PillPage] Preparing to invoke 'stop_backend_recording' with userId: ${userId}, accessToken: ${accessToken ? 'Provided' : 'Not Provided/Null'}, autoPaste: ${autoPasteCurrentValue}`);

                    try {
                        const stopPromise = invoke<string>('stop_backend_recording', {
                            autoPaste: autoPasteCurrentValue // Pass autoPaste directly as a top-level key
                        });
                        console.log('[PillPage] "stop_backend_recording" invoked.');
                        handleTranscriptionResult(stopPromise); 
                    } catch (invokeError: any) { 
                        console.error('[PillPage] Error invoking "stop_backend_recording":', invokeError);
                        setError(`Failed to stop recording: ${invokeError.message}`);
                        setCurrentState(RecordingState.ERROR);
                        if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
                        errorTimeoutRef.current = setTimeout(() => {
                            handleErrorDismiss_MEMOIZED();
                        }, 4000);
                    }
                }
                // END OF MODIFIED ASYNC CALLBACK
                );
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

        // Cleanup function
        return () => {
             console.log("PillPage: Main useEffect cleanup function running (External File - Corrected)");
             isMounted = false;
             console.log(`PillPage: Cleaning up ${unlisteners.length} listeners...`);
             unlisteners.forEach(unlisten => unlisten());
             // Clear all timeouts on unmount
             if (timerIntervalRef.current) { clearInterval(timerIntervalRef.current); }
             if (errorTimeoutRef.current) { clearTimeout(errorTimeoutRef.current); }
             if (successTimeoutRef.current) { clearTimeout(successTimeoutRef.current); }
             if (editReadyTimeoutRef.current) { clearTimeout(editReadyTimeoutRef.current); }
        };
    }, [handleTranscriptionResult]); // Add handleTranscriptionResult to dependencies

    // Format duration
    const formatDuration = (ms: number): string => {
        if (ms <= 0) return "0s";
        return Math.floor(ms / 1000).toString() + "s";
    };

    // Log state just before rendering
    console.log(`%c[PillPage Render] currentState: ${RecordingState[currentState]}, error: ${error}, errorMessage: ${errorMessage}`, "color: magenta;");

    // ADD DIAGNOSTIC LOG HERE
    console.log("%c[PillPage PRE-RENDER CHECK VERY VISIBLE LOG] Type of handleErrorDismiss_MEMOIZED:", "color: lime; font-weight: bold; font-size: 1.2em;", typeof handleErrorDismiss_MEMOIZED, "Value:", handleErrorDismiss_MEMOIZED);

    return (
        <div id="pill-container-restored" className="pill-container bg-transparent flex items-center justify-center h-screen w-screen select-none p-4">
             <RecordingPill
                currentState={currentState}
                duration={formatDuration(duration)}
                transcription={lastTranscriptionText || undefined}
                error={error || undefined}
                backendError={errorMessage || undefined}
                onEditClick={handleEditClick}
                onErrorDismiss={handleErrorDismiss_MEMOIZED}
            />
        </div>
    );
}

export default PillPage;