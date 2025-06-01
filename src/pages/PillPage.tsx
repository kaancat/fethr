import React, { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { RecordingState } from '../types';
import RecordingPill from '../components/RecordingPill';
import { toast } from "react-hot-toast";
import { supabase } from '@/lib/supabaseClient';
import { emit } from '@tauri-apps/api/event';

interface StateUpdatePayload {
    state: RecordingState | string;
    duration_ms: number;
    transcription_result: string | null;
    error_message: string | null;
}

function PillPage() {
    const [currentState, setCurrentState] = useState<RecordingState>(RecordingState.IDLE);
    const currentStateRef = useRef(currentState);
    const [duration, setDuration] = useState<number>(0);
    const [lastTranscriptionText, setLastTranscriptionText] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null); 
    const [errorMessage, setErrorMessage] = useState<string | null>(null); 
    const [showUpgradePrompt, setShowUpgradePrompt] = useState<boolean>(false);
    const startTimeRef = useRef<number | null>(null);
    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const editReadyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isEditSequenceActiveRef = useRef<boolean>(false); 

    // Effect to keep currentStateRef updated
    useEffect(() => {
        currentStateRef.current = currentState;
    }, [currentState]);

    // FIXED: Consolidated timeout management helpers with no dependencies
    const clearEditSequenceTimeouts = useCallback(() => {
        if (successTimeoutRef.current) {
            clearTimeout(successTimeoutRef.current);
            successTimeoutRef.current = null;
        }
        if (editReadyTimeoutRef.current) {
            clearTimeout(editReadyTimeoutRef.current);
            editReadyTimeoutRef.current = null;
        }
        console.log("[PillPage] Cleared edit sequence timeouts.");
    }, []);

    // FIXED: Enhanced endEditSequence to clear error state
    const endEditSequence = useCallback(() => {
        console.log("[PillPage] Ending edit sequence explicitly.");
        clearEditSequenceTimeouts();
        isEditSequenceActiveRef.current = false;
        setCurrentState(RecordingState.IDLE);
        setLastTranscriptionText(null);
        setError(null); // FIXED: Clear error state too
        setShowUpgradePrompt(false);
    }, [clearEditSequenceTimeouts]);

    const handleErrorDismiss_MEMOIZED = useCallback(() => {
        if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
        if (isEditSequenceActiveRef.current) {
            console.log("[PillPage handleErrorDismiss] Edit sequence was active, ending it.");
            endEditSequence();
        } else {
            setCurrentState(RecordingState.IDLE);
        }
        setError(null);
        setErrorMessage(null);
        setShowUpgradePrompt(false);
        invoke('signal_reset_complete').catch(err => console.error("[PillPage handleErrorDismiss] Backend reset signal FAILED:", err));
    }, [endEditSequence]);

    useEffect(() => {
        (window as any).TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT = () => {
            if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
            if (isEditSequenceActiveRef.current) {
                endEditSequence();
            } else {
                setCurrentState(RecordingState.IDLE);
            }
            setError(null);
            setErrorMessage(null);
            setLastTranscriptionText(null);
            setShowUpgradePrompt(false);
            invoke('signal_reset_complete').catch(err => console.error("[PillPage GlobalEffectFn] Backend reset signal FAILED:", err));
        };
        return () => { delete (window as any).TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT; };
    }, [endEditSequence]); 

    // FIXED: Stable handleEditClick that captures text at click time
    const handleEditClick = useCallback(() => {
        console.log("PillPage: Edit clicked!");
        
        if (lastTranscriptionText) { // Use lastTranscriptionText directly from state
            console.log("[PillPage] Emitting fethr-edit-latest-history for text:", lastTranscriptionText.substring(0,30) + "...");
            emit('fethr-edit-latest-history', { text: lastTranscriptionText })
                .then(() => console.log('[PillPage] Successfully emitted fethr-edit-latest-history.'))
                .catch(err => console.error('[PillPage] Failed to emit fethr-edit-latest-history:', err));

            console.log("[PillPage] Invoking show_settings_window_and_focus command...");
            invoke('show_settings_window_and_focus')
                .then(() => console.log('[PillPage] Successfully invoked show_settings_window_and_focus.'))
                .catch(err => {
                    console.error('[PillPage] Error invoking show_settings_window_and_focus:', err);
                    toast.error('Could not open settings window.');
                });
        } else {
            console.warn("[PillPage] Edit clicked, but no lastTranscriptionText was available.");
        }

        endEditSequence();
        invoke('signal_reset_complete').catch(err => console.error("PillPage: Failed to signal reset complete after edit click:", err));
    }, [lastTranscriptionText, endEditSequence]); // CORRECTED: Add lastTranscriptionText to dependencies

    // FIXED: Don't reset edit sequence flag prematurely
    const handleTranscriptionResult = useCallback((resultPromise: Promise<string>) => {
        console.log("[PillPage] handleTranscriptionResult called");
        // FIXED: Don't reset edit sequence flag here - let the copy event handle it
        
        resultPromise
            .then(resultText => {
                if (!resultText || resultText.trim() === '') {
                    console.warn("[PillPage] Empty transcription result");
                    setError('Transcription empty');
                    setLastTranscriptionText(null);
                    setCurrentState(RecordingState.ERROR);
                    setShowUpgradePrompt(false);
                    // Only end edit sequence if one was active
                    if (isEditSequenceActiveRef.current) {
                        console.log("[PillPage] Ending edit sequence due to empty result");
                        endEditSequence();
                    }
                    if (editReadyTimeoutRef.current) clearTimeout(editReadyTimeoutRef.current);
                    editReadyTimeoutRef.current = setTimeout(handleErrorDismiss_MEMOIZED, 3000);
                } else {
                    console.log("[PillPage] Successful transcription result:", resultText.substring(0, 50) + "...");
                    setError(null);
                    setLastTranscriptionText(resultText);
                    // Don't change state here - let the copy event handle the sequence
                }
            })
            .catch(errorObj => {
                console.error("[PillPage] Transcription error:", errorObj);
                const errorString = errorObj instanceof Error ? errorObj.message : String(errorObj);
                // End any active edit sequence on error
                if (isEditSequenceActiveRef.current) {
                    console.log("[PillPage] Ending edit sequence due to transcription error");
                    endEditSequence();
                }
                setShowUpgradePrompt(false); 
                if (errorString.includes("Word limit exceeded")) {
                    setErrorMessage("Word limit reached!"); 
                    setShowUpgradePrompt(true);
                    setCurrentState(RecordingState.ERROR);
                    toast.error("You've reached your transcription limit for this period."); 
                } else if (errorString.includes("No active subscription found")) { 
                    setErrorMessage("Subscription required"); 
                    setShowUpgradePrompt(true);
                    setCurrentState(RecordingState.ERROR);
                    toast.error("An active subscription is required to continue.");
                } else {
                    setError(`Transcription error: ${errorString}`); 
                    setErrorMessage(errorString); 
                    toast.error(`Transcription error: ${errorString}`.substring(0, 100));
                    setCurrentState(RecordingState.ERROR);
                }
                setLastTranscriptionText(null); 
                if (editReadyTimeoutRef.current) clearTimeout(editReadyTimeoutRef.current);
                if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
                errorTimeoutRef.current = setTimeout(handleErrorDismiss_MEMOIZED, 7000); 
            });
    }, [handleErrorDismiss_MEMOIZED, endEditSequence]);

    // FIXED: Main listener setup with minimal, stable dependencies
    useEffect(() => {
        console.log("[PillPage] Setting up main event listeners");
        let isMounted = true; 
        const unlisteners: Array<() => void> = [];
        
        const setupListeners = async () => {
            try {
                const handleErrorOccurred = (event: { payload: string }) => {
                    if (!isMounted) return;
                    console.log("[PillPage] Error occurred:", event.payload);
                    if (isEditSequenceActiveRef.current) {
                        endEditSequence();
                    }
                    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
                    setErrorMessage(event.payload || "An unknown error occurred.");
                    setCurrentState(RecordingState.ERROR);
                    errorTimeoutRef.current = setTimeout(handleErrorDismiss_MEMOIZED, 4000);
                };
                unlisteners.push(await listen<string>('fethr-error-occurred', handleErrorOccurred));

                // FIXED: Enhanced clipboard event handler
                const unlistenCopied = await listen<void>('fethr-copied-to-clipboard', () => {
                    if (!isMounted) return; 
                    console.log("%c[PillPage EVENT LISTENER] <<< Received fethr-copied-to-clipboard! >>>", "color: lime; font-size: 1.2em; font-weight: bold;");
                    
                    // End any existing edit sequence first, then start new one
                    if (isEditSequenceActiveRef.current) {
                        console.log("[PillPage] Ending previous edit sequence before starting new one");
                        clearEditSequenceTimeouts();
                    }
                    
                    isEditSequenceActiveRef.current = true; // Claim the sequence
                    
                    setCurrentState(RecordingState.SUCCESS);
                    console.log(`[PillPage STATE] Set to SUCCESS, isEditActive: ${isEditSequenceActiveRef.current}`);

                    successTimeoutRef.current = setTimeout(() => {
                        if (!isMounted) return;
                        if (!isEditSequenceActiveRef.current) {
                            console.log("[PillPage] Edit sequence cancelled before success timeout fired.");
                            return;
                        }
                        setCurrentState(RecordingState.IDLE_EDIT_READY);
                        console.log(`[PillPage STATE] Set to IDLE_EDIT_READY, isEditActive: ${isEditSequenceActiveRef.current}`);
                        successTimeoutRef.current = null;
                        
                        editReadyTimeoutRef.current = setTimeout(() => {
                            if (!isMounted) return;
                            if (!isEditSequenceActiveRef.current) {
                                console.log("[PillPage] Edit sequence cancelled before editReady timeout fired.");
                                return;
                            }
                            console.log("PillPage: Edit Ready timeout finished. Reverting to IDLE via endEditSequence.");
                            endEditSequence();
                            invoke('signal_reset_complete').catch(err => console.error("PillPage: Failed to signal reset complete from editReadyTimeout:", err));
                        }, 7000); // 7 seconds in Edit Ready state
                    }, 1500); // 1.5 seconds in Success state
                });
                unlisteners.push(unlistenCopied);

                const unlistenState = await listen<StateUpdatePayload>('fethr-update-ui-state', (event) => {
                    if (!isMounted) return;
                    const { state: receivedState } = event.payload; 
                    let newTsState: RecordingState = RecordingState.IDLE;
                    
                    if (typeof receivedState === 'string') {
                        const stateUppercase = receivedState.toUpperCase();
                         switch (stateUppercase) {
                            case "RECORDING": newTsState = RecordingState.RECORDING; break;
                            case "LOCKEDRECORDING": newTsState = RecordingState.LOCKED_RECORDING; break;
                            case "TRANSCRIBING": newTsState = RecordingState.TRANSCRIBING; break;
                            case "IDLE": newTsState = RecordingState.IDLE; break; 
                            case "ERROR": newTsState = RecordingState.ERROR; break; 
                            default: newTsState = RecordingState.IDLE; break;
                         }
                    } else { 
                        newTsState = RecordingState.IDLE; 
                    }

                    console.log(`[PillPage] Backend state update: ${RecordingState[newTsState]}, editActive: ${isEditSequenceActiveRef.current}`);

                    if (newTsState === RecordingState.IDLE) {
                        if (isEditSequenceActiveRef.current) {
                            console.log(`[PillPage STATE] Backend pushed IDLE, but edit sequence is active. IGNORING backend IDLE.`);
                            // DO NOTHING - let the edit sequence timeouts or handleEditClick call endEditSequence()
                            return;
                        } else {
                            console.log(`[PillPage STATE] Backend pushed IDLE. Edit sequence not active. Setting to clean IDLE.`);
                            setCurrentState(RecordingState.IDLE);
                            setLastTranscriptionText(null);
                            setErrorMessage(null);
                            setError(null); 
                            setShowUpgradePrompt(false);
                        }
                    } else { // For non-IDLE states (RECORDING, TRANSCRIBING, ERROR etc.)
                        if (isEditSequenceActiveRef.current) {
                            console.log(`[PillPage STATE] Backend pushed ${RecordingState[newTsState]} during active edit sequence. Ending edit sequence.`);
                            endEditSequence(); // Gracefully end the edit sequence
                        }
                        console.log(`[PillPage STATE] Setting state to: ${RecordingState[newTsState]} from backend update`);
                        setCurrentState(newTsState);
                        // Clear relevant state based on new state
                        if (newTsState === RecordingState.ERROR) {
                            setLastTranscriptionText(null); 
                        } else {
                            setLastTranscriptionText(null); 
                            setErrorMessage(null);
                            setError(null);
                            setShowUpgradePrompt(false);
                        }
                    }

                    // Timer management
                    const shouldBeRunning = newTsState === RecordingState.RECORDING || newTsState === RecordingState.LOCKED_RECORDING;
                    const isRunning = timerIntervalRef.current !== null;
                    if (shouldBeRunning && !isRunning) {
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
                        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
                        timerIntervalRef.current = null;
                        startTimeRef.current = null;
                        if (!shouldBeRunning) { setDuration(0); }
                    }
                });
                unlisteners.push(unlistenState);

                const unlistenStart = await listen<void>("fethr-start-recording", () => {
                    if (!isMounted) return;
                    console.log("PillPage: Received fethr-start-recording.");
                    if (isEditSequenceActiveRef.current) {
                        console.log("[PillPage] New recording starting during active edit sequence. Ending edit sequence first.");
                        endEditSequence();
                    }
                    // Clear other relevant states for a new recording
                    setErrorMessage(null);
                    setShowUpgradePrompt(false);
                    setLastTranscriptionText(null);
                    setError(null);
                    
                    invoke('start_backend_recording')
                        .then(() => console.log("PillPage: start_backend_recording invoked successfully."))
                        .catch(err => { 
                            setError(`Start recording failed: ${err}`);
                            setCurrentState(RecordingState.ERROR);
                            toast.error(`Start recording failed: ${err}`);
                        });
                });
                unlisteners.push(unlistenStart);

                const unlistenStop = await listen<boolean>("fethr-stop-and-transcribe", async (event) => { 
                    if (!isMounted) return; 
                    console.log("PillPage: Received fethr-stop-and-transcribe.");
                    if (isEditSequenceActiveRef.current) {
                        console.log("[PillPage] Stop transcribe received during edit sequence. Ending edit sequence first.");
                        endEditSequence();
                    }
                    let userId = null;
                    let accessToken = null;
                    try {
                        const { data: sessionData } = await supabase.auth.getSession();
                        if (sessionData && sessionData.session) {
                            userId = sessionData.session.user.id;
                            accessToken = sessionData.session.access_token;
                        }
                    } catch (e) { 
                        console.error('[PillPage] Exception during supabase.auth.getSession():', e); 
                    }
                    try {
                        const stopPromise = invoke<string>('stop_backend_recording', { 
                            args: { 
                                auto_paste: event.payload, 
                                user_id: userId, 
                                access_token: accessToken 
                            }
                        });
                        handleTranscriptionResult(stopPromise); 
                    } catch (invokeError: any) { 
                        setError(`Failed to stop recording: ${invokeError.message}`);
                        setCurrentState(RecordingState.ERROR);
                        if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
                        errorTimeoutRef.current = setTimeout(handleErrorDismiss_MEMOIZED, 4000);
                    }
                });
                unlisteners.push(unlistenStop);
            } catch (error) {
                 setError(`Listener setup error: ${error}`);
                 toast.error(`Listener setup error: ${error}`);
            }
        };
        
        setupListeners();
        
        return () => {
             console.log("[PillPage] Cleaning up main event listeners");
             isMounted = false;
             unlisteners.forEach(unlisten => unlisten());
             if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
             if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current); 
             if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current); 
             if (editReadyTimeoutRef.current) clearTimeout(editReadyTimeoutRef.current);
             isEditSequenceActiveRef.current = false; 
        };
    }, []); // FIXED: Empty dependency array - listeners only set up once

    const formatDuration = (ms: number): string => {
        if (ms <= 0) return "0s";
        return Math.floor(ms / 1000).toString() + "s";
    };

    console.log(`%c[PillPage Render] currentState: ${RecordingState[currentState]}, ref: ${RecordingState[currentStateRef.current]}, isEditActive: ${isEditSequenceActiveRef.current}`, "color: magenta;");

    return (
        <div id="pill-container-restored" className="pill-container bg-transparent flex items-center justify-center h-screen w-screen select-none p-4">
             <RecordingPill
                currentState={currentState}
                duration={formatDuration(duration)}
                transcription={lastTranscriptionText || undefined}
                error={error || undefined}
                backendError={errorMessage || undefined}
                showUpgradePrompt={showUpgradePrompt}
                onEditClick={handleEditClick}
                onErrorDismiss={handleErrorDismiss_MEMOIZED}
                onUpgradeClick={() => { toast.success("Upgrade clicked! (TODO: Implement navigation)", { duration: 3000 }); }}
            />
        </div>
    );
}

export default PillPage;