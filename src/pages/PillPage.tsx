import { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/shell';
import { RecordingState } from '../types';
import RecordingPill from '../components/RecordingPill';
import { toast } from "react-hot-toast";
import { supabase } from '@/lib/supabaseClient';
import { emit } from '@tauri-apps/api/event';
import { useSubscription } from '@/hooks/useSubscription';

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
    const [isResizing, setIsResizing] = useState<boolean>(false);
    const [userId, setUserId] = useState<string | undefined>();
    const startTimeRef = useRef<number | null>(null);
    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const editReadyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isEditSequenceActiveRef = useRef<boolean>(false); 
    const authFailureActiveRef = useRef<boolean>(false); // Track auth failure state

    // Removed extensive debugging code that was causing dimension tooltips

    // Get user ID from Supabase
    useEffect(() => {
        const fetchUser = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setUserId(session.user.id);
            }
        };
        fetchUser();
    }, []);

    // Use subscription hook
    const { 
        refetch: refetchSubscription 
    } = useSubscription(userId);

    // Effect to keep currentStateRef updated
    useEffect(() => {
        console.log(`[PillPage] State changed to: ${RecordingState[currentState]} (${currentState})`);
        currentStateRef.current = currentState;
    }, [currentState]);

    // 🎯 DYNAMIC WINDOW RESIZING: Pre-resize window before state changes to prevent jumping
    const resizeWindowForState = (state: RecordingState) => {
        let width: number, height: number;
        const PADDING = 24; // 12px padding on each side
        
        switch (state) {
            case RecordingState.IDLE:
            case RecordingState.IDLE_EDIT_READY:
                // Pre-size for hover expansion: ready variant is 120px wide + padding
                // Need extra space to accommodate hover and glow
                width = 160 + PADDING;
                height = 60 + PADDING;
                break;
            case RecordingState.RECORDING:
            case RecordingState.LOCKED_RECORDING:
            case RecordingState.TRANSCRIBING:
            case RecordingState.PASTING:
            case RecordingState.SUCCESS:
                width = 160 + PADDING;
                height = 60 + PADDING;
                break;
            case RecordingState.ERROR:
                if (showUpgradePrompt) {
                    width = 200 + PADDING;
                    height = 100 + PADDING;
                } else {
                    width = 180 + PADDING;
                    height = 80 + PADDING;
                }
                break;
            default:
                // Default to hover-ready size
                width = 160 + PADDING;
                height = 60 + PADDING;
                break;
        }
        
        try {
            // Resize logging removed for performance
            setIsResizing(true);
            invoke('resize_pill_window', { width, height }).catch(e => 
                console.error(`Failed to resize window for state ${RecordingState[state]}:`, e)
            );
            setIsResizing(false);
        } catch (e) {
            console.error(`Failed to resize window for state ${RecordingState[state]}:`, e);
        }
    };

    useEffect(() => {
        resizeWindowForState(currentState);
    }, [currentState, showUpgradePrompt]);

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
        setErrorMessage(null); // Clear backend error too
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
        authFailureActiveRef.current = false; // Clear auth failure flag
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
            authFailureActiveRef.current = false; // Clear auth failure flag
            invoke('signal_reset_complete').catch(err => console.error("[PillPage GlobalEffectFn] Backend reset signal FAILED:", err));
        };
        return () => { delete (window as any).TRIGGER_PILL_PAGE_DISMISS_VIA_EFFECT; };
    }, [endEditSequence]); 

    // FIXED: Stable handleEditClick that captures text at click time
    const handleEditClick = useCallback(() => {
        console.log("PillPage: Edit clicked!");
        
        if (lastTranscriptionText) { // Use lastTranscriptionText directly from state
            console.log("[PillPage] Invoking show_history_with_latest_entry command...");
            invoke('show_history_with_latest_entry')
                .then(() => console.log('[PillPage] Successfully invoked show_history_with_latest_entry.'))
                .catch(err => {
                    console.error('[PillPage] Error invoking show_history_with_latest_entry:', err);
                    toast.error('Could not open history window.');
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
                // Handle backend returning empty string for duplicate stop requests
                if (resultText === '') {
                    console.log("[PillPage] Backend returned empty string - likely duplicate stop request, ignoring");
                    return;
                }
                
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
                const errorString = errorObj instanceof Error ? errorObj.message : String(errorObj);
                
                // Ignore "already idle" errors from duplicate stop requests
                if (errorString.includes("Not currently recording") || errorString.includes("Already stopping")) {
                    console.log("[PillPage] Ignoring expected error from duplicate stop request:", errorString);
                    return;
                }
                
                console.error("[PillPage] Transcription error:", errorObj);
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

    // Handler for upgrade/sign-in button
    const handleUpgradeOrSignIn = useCallback(async () => {
        // Check if this is a sign-in case
        if (!userId) {
            console.log("[PillPage] User not logged in, opening settings for sign in");
            // Navigate to account tab first
            await invoke('navigate_to_settings_section', { section: 'account' });
            await invoke('show_settings_window_and_focus');
            // Clear error state and auth failure flag after opening settings
            authFailureActiveRef.current = false;
            handleErrorDismiss_MEMOIZED();
            return;
        }
        
        // Otherwise handle subscription
        console.log("[PillPage] Initiating subscription...");
        toast.loading("Redirecting to checkout...", { id: "stripe-checkout-toast" });

        try {
            const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

            if (sessionError || !sessionData?.session) {
                toast.dismiss("stripe-checkout-toast");
                toast.error("Please log in to subscribe.");
                console.error("Error getting session or no session:", sessionError);
                return;
            }

            const priceId = "price_pro_monthly_usd_7"; // Internal price ID

            console.log(`[PillPage] Calling Edge Function for user: ${sessionData.session.user.id}, price: ${priceId}`);
            
            // Call Supabase Edge Function
            const { data, error } = await supabase.functions.invoke('create-checkout', {
                body: { priceId },
                headers: {
                    Authorization: `Bearer ${sessionData.session.access_token}`,
                },
            });

            toast.dismiss("stripe-checkout-toast");

            if (error) {
                throw new Error(error.message);
            }

            if (data?.url) {
                console.log("[PillPage] Received checkout URL, opening:", data.url);
                await open(data.url);
                
                // Set up a listener for when user returns from checkout
                const handleFocus = () => {
                    console.log("[PillPage] Window regained focus, checking subscription status...");
                    setTimeout(() => {
                        refetchSubscription();
                    }, 2000); // Wait 2 seconds for webhook to process
                };
                
                window.addEventListener('focus', handleFocus);
                
                // Clean up after 5 minutes
                setTimeout(() => {
                    window.removeEventListener('focus', handleFocus);
                }, 300000);
            } else {
                toast.error("Could not retrieve checkout session URL. Please try again.");
                console.error("[PillPage] Checkout URL was null or empty.");
            }
        } catch (error: any) {
            toast.dismiss("stripe-checkout-toast");
            const errorMessage = error?.message || String(error);
            toast.error(`Failed to start subscription: ${errorMessage.substring(0,100)}`);
            console.error("[PillPage] Error initiating subscription:", error);
        }
    }, [refetchSubscription, userId, handleErrorDismiss_MEMOIZED]);

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

                // Listen for auth-required event from backend
                const unlistenAuthRequired = await listen<void>('fethr-auth-required', async () => {
                    if (!isMounted) return;
                    console.log("[PillPage] Received fethr-auth-required event from backend");
                    
                    setErrorMessage("Sign in required");
                    setCurrentState(RecordingState.ERROR);
                    setShowUpgradePrompt(true);
                    authFailureActiveRef.current = true;
                    
                    // Auto-dismiss after 10 seconds
                    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
                    errorTimeoutRef.current = setTimeout(() => {
                        authFailureActiveRef.current = false;
                        handleErrorDismiss_MEMOIZED();
                    }, 10000);
                    
                    // Only temporarily show pill if it's currently hidden (respects manual show)
                    invoke('temporarily_show_pill_if_hidden', { duration: 10000 })
                        .catch(err => console.error("Failed to temporarily show pill:", err));
                });
                unlisteners.push(unlistenAuthRequired);

                // FIXED: Enhanced clipboard event handler
                const unlistenCopied = await listen<void>('fethr-copied-to-clipboard', async () => {
                    if (!isMounted) return; 
                    console.log("%c[PillPage EVENT LISTENER] <<< Received fethr-copied-to-clipboard! >>>", "color: lime; font-size: 1.2em; font-weight: bold;");
                    
                    // End any existing edit sequence first, then start new one
                    if (isEditSequenceActiveRef.current) {
                        console.log("[PillPage] Ending previous edit sequence before starting new one");
                        clearEditSequenceTimeouts();
                    }
                    
                    isEditSequenceActiveRef.current = true; // Claim the sequence
                    
                    // Clear any error states when starting edit sequence
                    setError(null);
                    setErrorMessage(null);
                    setShowUpgradePrompt(false);
                    
                    // CRITICAL FIX: Immediately signal backend reset to ensure hotkeys work during edit mode
                    console.log("[PillPage] Edit sequence starting - ensuring backend hotkey state is clean for immediate hotkey functionality.");
                    invoke('signal_reset_complete').catch(err => console.error("[PillPage] Failed to signal reset at edit sequence start:", err));
                    
                    // Resize for SUCCESS state (async, non-blocking)
                    resizeWindowForState(RecordingState.SUCCESS);
                    setCurrentState(RecordingState.SUCCESS);
                    console.log(`[PillPage STATE] Set to SUCCESS, isEditActive: ${isEditSequenceActiveRef.current}`);

                    successTimeoutRef.current = setTimeout(async () => {
                        if (!isMounted) return;
                        if (!isEditSequenceActiveRef.current) {
                            console.log("[PillPage] Edit sequence cancelled before success timeout fired.");
                            return;
                        }
                        // Resize for IDLE_EDIT_READY state (async, non-blocking)
                        resizeWindowForState(RecordingState.IDLE_EDIT_READY);
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

                const unlistenState = await listen<StateUpdatePayload>('fethr-update-ui-state', async (event) => {
                    if (!isMounted) return;
                    
                    // Ignore backend state updates during auth failure
                    if (authFailureActiveRef.current) {
                        console.log("[PillPage] Ignoring backend state update during auth failure");
                        return;
                    }
                    
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
                            // Resize for IDLE state (async, non-blocking)
                            resizeWindowForState(RecordingState.IDLE);
                            console.log('[PillPage] --> Actually calling setCurrentState(IDLE)');
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
                        // Resize for new state (async, non-blocking)
                        resizeWindowForState(newTsState);
                        console.log(`[PillPage] --> Actually calling setCurrentState(${RecordingState[newTsState]})`);
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

                const unlistenStart = await listen<void>("fethr-start-recording", async () => {
                    if (!isMounted) return;
                    console.log("PillPage: Received fethr-start-recording.");
                    
                    if (isEditSequenceActiveRef.current) {
                        console.log("[PillPage] New recording starting during active edit sequence. Ending edit sequence first.");
                        endEditSequence();
                        
                        // CRITICAL FIX: Ensure backend state is properly synchronized after ending edit sequence
                        console.log("[PillPage] Forcing backend reset to ensure clean state for hotkey recording.");
                        try {
                            await invoke('signal_reset_complete');
                            console.log("[PillPage] Backend reset completed, proceeding with recording start.");
                        } catch (err) {
                            console.error("[PillPage] Backend reset failed, proceeding anyway:", err);
                        }
                    }
                    
                    // Clear other relevant states for a new recording
                    setErrorMessage(null);
                    setShowUpgradePrompt(false);
                    setLastTranscriptionText(null);
                    setError(null);
                    
                    // Backend has already checked auth and allowed recording to start
                    // No need to check auth here anymore
                    
                    // Get auth credentials
                    let authUserId = null;
                    let authAccessToken = null;
                    try {
                        const { data: sessionData } = await supabase.auth.getSession();
                        if (sessionData && sessionData.session) {
                            authUserId = sessionData.session.user.id;
                            authAccessToken = sessionData.session.access_token;
                            console.log('[PillPage] Got auth credentials for recording');
                        }
                    } catch (e) {
                        console.error('[PillPage] Failed to get auth session:', e);
                    }
                    
                    invoke('start_backend_recording', {
                        args: {
                            user_id: authUserId,
                            access_token: authAccessToken
                        }
                    })
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
                    
                    // Ignore stop event during auth failure
                    if (authFailureActiveRef.current) {
                        console.log("[PillPage] Ignoring stop-and-transcribe during auth failure");
                        return;
                    }
                    if (isEditSequenceActiveRef.current) {
                        console.log("[PillPage] Stop transcribe received during edit sequence. Ending edit sequence first.");
                        endEditSequence();
                    }
                    
                    // IMMEDIATELY call stop without waiting for auth
                    try {
                        // Get fresh auth token for transcription
                        let authAccessToken = null;
                        try {
                            const { data: sessionData } = await supabase.auth.getSession();
                            if (sessionData && sessionData.session) {
                                authAccessToken = sessionData.session.access_token;
                            }
                        } catch (e) {
                            console.error('[PillPage] Failed to get auth session for stop:', e);
                        }
                        
                        const stopPromise = invoke<string>('stop_backend_recording', { 
                            args: { 
                                auto_paste: event.payload, 
                                user_id: userId, // Use existing userId from component state
                                access_token: authAccessToken // Pass the actual access token
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

    // Removed debug logging to prevent dimension tooltips

    // Debug: Log current state on render
    console.log(`[PillPage] RENDER - currentState: ${RecordingState[currentState]} (${currentState})`);
    
    return (
        <div 
            id="pill-container-restored" 
            className="pill-container bg-transparent fixed inset-0 flex items-start justify-center select-none"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                paddingTop: '12px',  // Increased from 0 to ensure glow is visible
                paddingLeft: '12px',
                paddingRight: '12px',
                paddingBottom: '12px',
                margin: 0
            }}
        >
            <div className="relative">
                <RecordingPill
                    currentState={currentState}
                    duration={formatDuration(duration)}
                    transcription={lastTranscriptionText || undefined}
                    error={error || undefined}
                    backendError={errorMessage || undefined}
                    showUpgradePrompt={showUpgradePrompt}
                    isResizing={isResizing}
                    onEditClick={handleEditClick}
                    onErrorDismiss={handleErrorDismiss_MEMOIZED}
                    onUpgradeClick={handleUpgradeOrSignIn}
                />
            </div>
        </div>
    );
}

export default PillPage;