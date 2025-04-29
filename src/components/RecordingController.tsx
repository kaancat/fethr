console.log("%c---> EXECUTING RecordingController.tsx <---", "background: yellow; color: black; font-weight: bold; font-size: 14px; padding: 5px;");

import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAudioManager } from '../utils/AudioManager';
import { LocalTranscriptionManager } from '../utils/LocalTranscriptionManager';
import { RecordingState, HotkeyManager } from '../HotkeyManager';
import { PasteCopiedText, copyToClipboard } from '../utils/clipboardUtils';
import RecordingPill from './RecordingPill';

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
    try {
      console.log('%c[RecordingController] 🔄 handleTranscription process START', 'color: blue; font-weight: bold');
      console.log('[RecordingController] Received raw audioBlob size:', audioBlob.size, 'bytes, type:', audioBlob.type);
      setErrorMessage(null);

      // **** BYPASS WAV CONVERSION ****
      console.log('[RecordingController] Skipping webmToWavBlob conversion.');
      // const wavBlob = await webmToWavBlob(audioBlob); // COMMENTED OUT
      // console.log('[RecordingController] Audio converted successfully, size:', wavBlob.size, 'bytes'); // COMMENTED OUT

      // Use the original audioBlob instead of wavBlob
      const blobToTranscribe = audioBlob; // Use original blob

      // **** COMMENT OUT or Adjust SIZE CHECK ****
      if (blobToTranscribe.size < 5000) { // Adjust threshold maybe? Check if *any* data
        console.error('[RecordingController] Original audioBlob is too small or empty. Size:', blobToTranscribe.size);
        throw new Error('Recorded audio is empty or too short');
      }
      // if (wavBlob.size < 100) { // COMMENTED OUT
      //   console.error('[RecordingController] Generated WAV blob is too small or empty. Size:', wavBlob.size);
      //   throw new Error('Recorded audio is empty or too short');
      // }
      // **** END BYPASS ****

      if (blobToTranscribe.size > 25 * 1024 * 1024) {
        console.error('[RecordingController] Audio file is too large:', (blobToTranscribe.size / (1024 * 1024)).toFixed(2), 'MB');
        throw new Error('Audio file too large (>25MB)');
      }

      let result = '';
      console.log('[RecordingController] Using local Whisper model for transcription');
      if (!transcriptionManager.current) {
        console.error('[RecordingController] Transcription manager not initialized');
        throw new Error('Transcription manager not initialized');
      }
      console.log('[RecordingController] Sending raw audioBlob to local transcription engine');
      result = await transcriptionManager.current.transcribeAudio(blobToTranscribe);

      console.log('%c[RecordingController] ✅ Transcription completed:', 'color: green; font-weight: bold', result);

      if (!result || result.trim() === '') {
        console.warn('%c[RecordingController] ⚠️ Transcription produced empty result', 'color: orange; font-weight: bold');
        setErrorMessage('Transcription produced empty result');
        setTranscription('');
      } else {
        console.log('[RecordingController] Setting transcription result, length:', result.length);
        setTranscription(result);
        setErrorMessage(null);

        // Auto-copy to clipboard if enabled
        if (configOptions.autoCopyToClipboard) {
          console.log('[RecordingController] Auto-copying transcription to clipboard');
          await copyToClipboard(result);
          console.log('[RecordingController] Transcription copied to clipboard successfully');
        }
        
        // Auto-paste if enabled
        if (configOptions.autoPasteTranscription) {
          console.log('[RecordingController] Auto-pasting transcription');
          await PasteCopiedText();
          console.log('[RecordingController] Transcription pasted successfully');
        }
      }
    } catch (error) {
      const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.error(`%c[${timestamp}] [RecordingController] ---> ENTERED CATCH block in handleTranscription <---`, 'color: red; font-weight: bold;', error);
      setErrorMessage(`Transcription error: ${error instanceof Error ? error.message : String(error)}`);
      setTranscription('');
    } finally {
      console.log('%c[RecordingController] 🏁 handleTranscription process FINALLY block', 'color: green; font-weight: bold');
      transcriptionTriggered.current = false;
      console.log('[RecordingController] Transcription triggered flag reset');

      // Check HotkeyManager state BEFORE resetting
      if (hotkeyManager.current) {
        const currentHotkeyState = hotkeyManager.current.getCurrentState();
        console.log(`[RecordingController] Checking HotkeyManager state before reset: ${RecordingState[currentHotkeyState]}`);
        
        if (currentHotkeyState === RecordingState.TRANSCRIBING) {
          console.log('[RecordingController] Calling HotkeyManager.forceReset() to return to IDLE.');
          hotkeyManager.current.forceReset();
          console.log('[RecordingController] ---> HotkeyManager.forceReset() call completed.');
        } else {
          console.warn(`[RecordingController] Skipping forceReset in finally block because HotkeyManager state is already ${RecordingState[currentHotkeyState]}`);
        }
      } else {
        console.error('[RecordingController] Cannot force reset - HotkeyManager ref is null in finally block!');
      }
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