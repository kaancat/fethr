console.log("%c---> EXECUTING RecordingController.tsx <---", "background: yellow; color: black; font-weight: bold; font-size: 14px; padding: 5px;");

import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAudioManager } from '../utils/AudioManager';
import { LocalTranscriptionManager } from '../utils/LocalTranscriptionManager';
import { RecordingState, HotkeyManager } from '../HotkeyManager';
import { copyToClipboard } from '../utils/clipboardUtils';
import RecordingPill from './RecordingPill';
import { toast } from 'react-hot-toast';

// Define ConfigOptions interface locally instead of importing from types
interface ConfigOptions {
  useWhisperAPI: boolean;
  autoCopyToClipboard: boolean;
  autoPasteTranscription: boolean;
}

/**
 * RecordingController component
 * 
 * What it does: Controls recording and transcription flow
 * Why it exists: Central controller for the audio recording and transcription flow
 */
const RecordingController: React.FC<{ configOptions: ConfigOptions }> = ({ configOptions }) => {
  const transcriptionManager = useRef<LocalTranscriptionManager | null>(null);
  const hotkeyManager = useRef<HotkeyManager | null>(null);
  
  const [currentRecordingState, setCurrentRecordingState] = useState<RecordingState>(RecordingState.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const durationInterval = useRef<number | null>(null);
  const transcriptionTriggered = useRef<boolean>(false);

  // Initialize the audio manager hook with ref-based callback
  const { startRecording, stopRecording, isRecording, cleanup: cleanupAudio } = useAudioManager({
    onRecordingComplete: async (blob: Blob) => {
      const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.log(`%c[${timestamp}] [RecordingController] ---> AUDIO BLOB RECEIVED from Hook <---`, 'background: #ff9800; color: black; font-weight: bold; padding: 3px;');
      console.log('[RecordingController] Blob size:', blob.size, 'bytes, type:', blob.type);

      // Log states but don't block blob saving
      console.log('[RecordingController] Current states - Hook isRecording:', isRecording, 'Component state:', RecordingState[currentRecordingState]);

      // Save the blob first
      if (blob.size > 0) {
        saveBlobToFile(blob, `raw_recording_${timestamp.replace(/:/g, '-')}.webm`);
        console.log('[RecordingController] Saved blob to file, size:', (blob.size / 1024).toFixed(2), 'KB');
      } else {
        console.error('[RecordingController] Received empty blob!');
        return;
      }

      // Process transcription
      console.log("[RecordingController] Starting transcription process...");
      transcriptionTriggered.current = true;
      await handleTranscription(blob);
    }
  });

  useEffect(() => {
    const initializeComponents = async () => {
      console.log('%c[RecordingController] Component Mounting - Initializing...', 'color: blue; font-weight: bold');
      try {
        console.log('[RecordingController] --> Creating LocalTranscriptionManager instance...');
        transcriptionManager.current = LocalTranscriptionManager.getInstance();
        console.log('[RecordingController] --> LocalTranscriptionManager initialized successfully');
        
        console.log('[RecordingController] --> Getting HotkeyManager instance...');
        hotkeyManager.current = HotkeyManager.getInstance();
        console.log('[RecordingController] --> Calling HotkeyManager.initialize()...');
        await hotkeyManager.current.initialize();
        console.log('[RecordingController] --> HotkeyManager.initialize() completed successfully');
        
        if (hotkeyManager.current) {
          const initialState = hotkeyManager.current.getCurrentState();
          console.log(`%c[RecordingController] CHECK INITIAL STATE: HotkeyManager state immediately after init is: ${initialState}`,
            initialState === RecordingState.IDLE ? 'color: green; font-weight: bold;' : 'color: red; font-weight: bold;');
          if (initialState !== RecordingState.IDLE) {
            console.warn(`[RecordingController] HotkeyManager initial state was ${initialState}, overriding component state.`);
            setCurrentRecordingState(initialState);
          }
        } else {
          console.error('[RecordingController] Cannot check initial state - HotkeyManager ref is null');
        }
        
        console.log('%c[RecordingController] All components initialization sequence COMPLETE.', 'color: green; font-weight: bold');
      } catch (error) {
        console.error('%c[RecordingController] FATAL ERROR initializing components:', 'color: red; font-weight: bold', error);
        setErrorMessage(`Failed to initialize recording components: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    
    initializeComponents();
    
    // Cleanup on unmount
    return () => {
      const unmountTimestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.log(`%c[${unmountTimestamp}] [RecordingController] >>> UNMOUNT CLEANUP RUNNING <<<`, 'background: red; color: white; font-weight: bold;');
      
      if (durationInterval.current) {
        console.log('[RecordingController] Clearing duration interval');
        clearInterval(durationInterval.current);
      }
      if (hotkeyManager.current) {
        console.log('[RecordingController] Cleaning up HotkeyManager');
        hotkeyManager.current.cleanup();
      }
      console.log('[RecordingController] Calling cleanupAudio...');
      cleanupAudio(); // Clean up audio recording
      console.log('[RecordingController] Component unmount cleanup complete');
    };
  }, [cleanupAudio]);
  
  // Listen for state changes FROM HotkeyManager
  useEffect(() => {
    if (!hotkeyManager.current) {
      console.log('[RecordingController] Unable to set up state listeners - HotkeyManager not initialized');
      return;
    }
    
    const unlisten: Array<() => void> = [];
    
    const setupListener = async () => {
      console.log('[RecordingController] Setting up event listeners for recording-state-changed');
      try {
        const unlistenState = await listen('recording-state-changed', (event) => {
          const payload = event.payload as { state: RecordingState, oldState: RecordingState, timestamp: number };
          console.log(`%c[RecordingController] 📣 State change event received from HotkeyManager: ${RecordingState[payload.oldState]} → ${RecordingState[payload.state]}`, 'color: #4a0; font-weight: bold');
          
          console.log(`%c[RecordingController] ✅ Applying state change: Calling setCurrentRecordingState(${payload.state})`, 'color: green; font-weight: bold');
          setCurrentRecordingState(payload.state);
        });
        
        console.log('[RecordingController] recording-state-changed listener registered successfully');
        unlisten.push(unlistenState);
      } catch (error) {
        console.error('[RecordingController] Error setting up recording-state-changed listener:', error);
      }
    };
    
    setupListener();
    
    return () => {
      console.log('[RecordingController] Removing recording-state-changed listeners');
      unlisten.forEach(fn => fn());
    };
  }, []);
  
  // Handle state changes based on useState variable
  useEffect(() => {
    console.log(`%c[RecordingController] 🔄 State handler EFFECT triggered for state: ${RecordingState[currentRecordingState]}`, 'color: purple; font-weight: bold');
    
    const handleStateChange = async () => {
      try {
        switch (currentRecordingState) {
          case RecordingState.IDLE:
            if (isRecording) {
              console.log('[RecordingController] State is IDLE but still recording - stopping...');
              stopRecording();
            }
            break;
          case RecordingState.RECORDING:
            if (!isRecording) {
              console.log('[RecordingController] Starting recording from RECORDING state');
              await startRecordingProcess();
            }
            break;
          case RecordingState.LOCKED_RECORDING:
            if (!isRecording) {
              console.log('[RecordingController] Starting recording from LOCKED_RECORDING state');
              await startRecordingProcess();
            }
            break;
          case RecordingState.TRANSCRIBING:
            if (isRecording) {
              console.log('[RecordingController] Stopping recording from TRANSCRIBING state');
              stopRecording();
            }
            break;
        }
      } catch (error) {
        console.error('%c[RecordingController] ❌ Error in state change handler:', 'color: red; font-weight: bold', error);
        setErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
        if (hotkeyManager.current) {
          hotkeyManager.current.forceReset();
        }
      }
    };
    handleStateChange();
  }, [currentRecordingState, startRecording, stopRecording, isRecording]);

  // Helper for starting recording - SIMPLIFIED FOR TESTING
  const startRecordingProcess = async () => {
    if (isRecording) {
      const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.warn(`%c[${timestamp}] [RecordingController] startRecordingProcess called, but already recording. Skipping redundant start.`, 'color: orange; font-weight: bold;');
      return;
    }
    try {
      console.log('[RecordingController] Starting audio recording');
      startRecording();
      console.log('[RecordingController] Audio recording started successfully');
      
      if (durationInterval.current) {
        console.log('[RecordingController] Clearing existing duration interval');
        clearInterval(durationInterval.current);
      }
      
      const startTime = Date.now();
      console.log('[RecordingController] Starting duration tracking interval');
      
      durationInterval.current = window.setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        setRecordingDuration(elapsed);
      }, 100);
    } catch (err: any) {
      console.error('%c[RecordingController] ❌ Failed to start recording:', 'color: red; font-weight: bold', err);
      setErrorMessage(`Failed to start recording: ${err instanceof Error ? err.message : String(err)}`);
      if (hotkeyManager.current) {
        console.log('[RecordingController] Forcing reset due to recording start failure');
        hotkeyManager.current.forceReset();
      }
    }
  };
  
  // Handle transcription (called from AudioManager callback)
  const handleTranscription = async (audioBlob: Blob) => {
    console.log('[RecordingController] Starting handleTranscription...');
    let result: string | null = null;

    try {
      if (!transcriptionManager.current) {
        throw new Error('Transcription manager not initialized');
      }

      // Start transcription
      console.log('[RecordingController] Calling transcriptionManager.transcribeAudio...');
      result = await transcriptionManager.current.transcribeAudio(audioBlob);
      console.log('[RecordingController] Transcription result received, length:', result?.length ?? 0);

      // Handle empty or generic results
      if (!result || result.trim() === '' || result === "Whisper transcription completed successfully.") {
        console.warn('%c[RecordingController] ⚠️ Transcription produced empty or generic result', 'color: orange; font-weight: bold');
        setErrorMessage(result.trim() === '' ? 'Transcription produced empty result' : 'No speech detected');
        setTranscription('');
      } else {
        console.log('[RecordingController] Setting transcription result, length:', result.length);
        setTranscription(result);
        setErrorMessage(null);

        // Auto-copy to clipboard if enabled
        if (configOptions.autoCopyToClipboard) {
          console.log('[RecordingController] Attempting auto-copy...');
          try {
            await copyToClipboard(result);
            console.log('[RecordingController] Transcription copied to clipboard successfully');
          } catch (copyError) {
            console.error('[RecordingController] Auto-copy FAILED:', copyError);
            // Don't throw - just show a toast and continue
            toast.error("Failed to copy to clipboard.");
          }
        }

        // Temporarily disable auto-paste for debugging
        /* 
        if (configOptions.autoPasteTranscription) {
          console.log('[RecordingController] Attempting auto-paste...');
          try {
            await PasteCopiedText();
            console.log('[RecordingController] Transcription pasted successfully');
          } catch (pasteError) {
            console.error('[RecordingController] Auto-paste FAILED:', pasteError);
            // Don't throw - just show a toast and continue
            toast.error("Failed to auto-paste.");
          }
        }
        */
      }
    } catch (error) {
      console.error('[RecordingController] Error in handleTranscription:', error);
      setErrorMessage(`Transcription error: ${error instanceof Error ? error.message : String(error)}`);
      setTranscription('');
    } finally {
      console.log('[RecordingController] Transcription handling complete, resetting state...');
      // Only reset if we're still in TRANSCRIBING state
      if (hotkeyManager.current && hotkeyManager.current.getCurrentState() === RecordingState.TRANSCRIBING) {
        hotkeyManager.current.forceReset();
      }
      transcriptionTriggered.current = false;
    }
  };
  
  // Helper function to format recording duration
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Add this helper function somewhere in the component scope
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
};

export default RecordingController; 