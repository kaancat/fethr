import { useState, useRef, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { LocalTranscriptionManager } from '../utils/LocalTranscriptionManager';

/**
 * Recorder component for audio recording and transcription
 * 
 * What it does: Records audio, transcribes it, and displays the results
 * Why it exists: To provide a user interface for audio recording and transcription
 */
export function Recorder() {
  const [recording, setRecording] = useState(false);
  const [transcribedText, setTranscribedText] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const transcriberRef = useRef<LocalTranscriptionManager | null>(null);
  
  // Initialize the transcription manager
  useEffect(() => {
    transcriberRef.current = LocalTranscriptionManager.getInstance();
    
    // Configure with sensitivity options
    transcriberRef.current.configure({
      ignoreBlankAudio: true,     // Ignore blank audio detection
      minDurationThreshold: 500   // Minimum duration threshold in bytes
    });
    
    // Listen for transcription status events
    const unlistenTranscriptionStatus = listen('transcription-status-changed', (event) => {
      const status = event.payload as any;
      
      if (status.type === 'progress') {
        console.log('Transcription progress:', status.progress);
      } else if (status.type === 'complete') {
        setTranscribedText(status.text);
        setIsTranscribing(false);
      } else if (status.type === 'failed') {
        setError(`Transcription failed: ${status.error}`);
        setIsTranscribing(false);
      }
    });
    
    return () => {
      unlistenTranscriptionStatus.then(unlisten => unlisten());
    };
  }, []);

  // Start recording
  const startRecording = async () => {
    setError(null);
    try {
      await invoke('start_recording');
      setRecording(true);
    } catch (err) {
      setError(`Failed to start recording: ${err}`);
    }
  };

  // Stop recording and transcribe
  const stopRecording = async () => {
    try {
      setIsTranscribing(true);
      const audioBlob = await invoke<Uint8Array>('stop_recording');
      setRecording(false);
      
      if (!audioBlob || audioBlob.length === 0) {
        setError('No audio recorded');
        setIsTranscribing(false);
        return;
      }
      
      // Convert uint8array to blob
      const blob = new Blob([audioBlob], { type: 'audio/webm' });
      
      // Transcribe using the LocalTranscriptionManager
      if (transcriberRef.current) {
        const text = await transcriberRef.current.transcribeAudio(blob);
        
        if (text.trim()) {
          setTranscribedText(text);
        } else {
          setTranscribedText('(No speech detected)');
        }
        
        // Clean up temp files
        await transcriberRef.current.cleanupTempFiles();
      }
      
      setIsTranscribing(false);
    } catch (err) {
      setError(`Error: ${err}`);
      setIsTranscribing(false);
      setRecording(false);
    }
  };

  return (
    <div className="recorder-container">
      <h2>Audio Recorder</h2>
      
      <div className="controls">
        {!recording ? (
          <button 
            onClick={startRecording} 
            disabled={isTranscribing}
            className="record-btn"
          >
            Start Recording
          </button>
        ) : (
          <button 
            onClick={stopRecording} 
            className="stop-btn"
          >
            Stop Recording
          </button>
        )}
      </div>
      
      {isTranscribing && (
        <div className="transcribing-indicator">
          Transcribing audio...
        </div>
      )}
      
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
      
      {transcribedText && (
        <div className="transcription-result">
          <h3>Transcription:</h3>
          <div className="result-text">
            {transcribedText}
          </div>
        </div>
      )}
      
      <div className="info-text">
        <p>
          Recording will use your system's default microphone. 
          Click "Start Recording" and speak, then click "Stop Recording" when finished.
        </p>
      </div>
    </div>
  );
} 