/**
 * AudioManager.ts
 * 
 * Audio recording manager for Fethr app using react-audio-voice-recorder.
 * Provides a simplified interface for recording high-quality audio with reliable cleanup.
 */

import { useAudioRecorder } from 'react-audio-voice-recorder';
import { useEffect, useRef } from 'react';

type RecordingCompleteCallback = (blob: Blob) => void;

interface AudioManagerHookOptions {
  onRecordingComplete?: RecordingCompleteCallback;
}

/**
 * Custom hook that provides audio recording functionality.
 * This replaces the previous singleton pattern with a more React-friendly approach.
 */
export function useAudioManager(options: AudioManagerHookOptions = {}) {
  const { onRecordingComplete } = options;
  const callbackRef = useRef<RecordingCompleteCallback | undefined>(onRecordingComplete);

  const {
    startRecording,
    stopRecording,
    recordingBlob,
    isRecording,
    mediaRecorder
  } = useAudioRecorder({
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 44100,
    sampleSize: 16
  });

  useEffect(() => {
    callbackRef.current = onRecordingComplete;
  }, [onRecordingComplete]);

  useEffect(() => {
    if (recordingBlob && callbackRef.current) {
      callbackRef.current(recordingBlob);
    }
  }, [recordingBlob]);

  const cleanup = () => {
    // Log added inside the cleanup function itself
    const cleanupTimestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.log(`%c[${cleanupTimestamp}] [useAudioManager] >>> CLEANUP FUNCTION EXECUTING <<< (isRecording: ${isRecording})`, 'background: red; color: white; font-weight: bold;');
    
    if (mediaRecorder && isRecording) {
      console.log(`[useAudioManager] Cleanup calling stopRecording because recorder exists and isRecording=true...`);
      stopRecording();
    } else {
      console.log(`[useAudioManager] Cleanup: No stop needed (recorder exists: ${!!mediaRecorder}, isRecording: ${isRecording})`);
    }
  };

  useEffect(() => {
    const mountTimestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    // Log when the effect initially runs (component mounts)
    console.log(`%c[${mountTimestamp}] [useAudioManager] Mount/Effect Setup RUNNING`, 'color: green; font-weight: bold;');

    // Return the cleanup function
    return () => {
      const unmountTimestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      // Log specifically when the RETURN function (cleanup trigger) is executed
      console.log(`%c[${unmountTimestamp}] [useAudioManager] >>> EFFECT CLEANUP TRIGGERED (Component Unmounting?) <<<`, 'background: orange; color: black; font-weight: bold;');
      cleanup(); // Call the actual cleanup logic
    };
  }, []); // Empty deps array - cleanup should ONLY run on unmount

  return {
    /**
     * Start recording audio
     */
    startRecording,

    /**
     * Stop recording audio
     */
    stopRecording,

    /**
     * Check if currently recording
     */
    isRecording,

    /**
     * Clean up all resources
     */
    cleanup
  };
}

// Export types for components that need them
export type AudioManager = ReturnType<typeof useAudioManager>;
