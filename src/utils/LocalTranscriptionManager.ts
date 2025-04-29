import { invoke } from '@tauri-apps/api/tauri';
import { appDataDir } from '@tauri-apps/api/path';
import { listen } from '@tauri-apps/api/event';

/**
 * LocalTranscriptionManager handles local transcription using Whisper.cpp
 * 
 * What it does: Manages transcription of audio recordings using local Whisper.cpp binary
 * Why it exists: To provide offline transcription without requiring network connection
 */
export class LocalTranscriptionManager {
  private static instance: LocalTranscriptionManager;
  private initialized: boolean = false;
  private tempAudioPath: string = '';
  private eventListeners: Array<() => void> = [];
  private isTranscribing: boolean = false;
  private setupInProgress: boolean = false;

  // Transcription settings for handling blank audio
  private ignoreBlankAudio: boolean = true; // Default to ignore blank audio detection
  private minDurationThreshold: number = 500; // Milliseconds - anything below is considered too short

  private constructor() {
    console.log('[LocalTranscriptionManager] Creating new instance');
    this.initializeAppDataDir();
  }

  /**
   * Get singleton instance of the LocalTranscriptionManager
   */
  public static getInstance(): LocalTranscriptionManager {
    if (!LocalTranscriptionManager.instance) {
      console.log('[LocalTranscriptionManager] Initializing singleton instance');
      LocalTranscriptionManager.instance = new LocalTranscriptionManager();
    }
    return LocalTranscriptionManager.instance;
  }

  /**
   * Initialize the transcription manager
   * 
   * What it does: Checks if the transcription service is ready and sets up event listeners
   * Why it exists: To prepare the manager for transcription requests
   */
  public async initialize(): Promise<boolean> {
    // If already initialized or initialization is in progress, don't reinitialize
    if (this.initialized || this.setupInProgress) {
      console.log('[LocalTranscriptionManager] Already initialized or setup in progress, skipping');
      return this.initialized;
    }

    this.setupInProgress = true;
    
    try {
      console.log('[LocalTranscriptionManager] Initializing...');
      
      // Clean up any existing listeners before setting up new ones
      this.cleanupEventListeners();
      
      // Get app data directory for temporary files
      const appDataDirPath = await appDataDir();
      this.tempAudioPath = `${appDataDirPath}temp_audio.wav`;
      console.log(`[LocalTranscriptionManager] Temp WAV path: ${this.tempAudioPath}`);
      
      // Get current transcription status
      const status = await invoke('get_transcription_status');
      console.log('[LocalTranscriptionManager] Current transcription status:', status);
      
      // Set up event listeners for transcription events
      await this.setupEventListeners();
      
      this.initialized = true;
      this.setupInProgress = false;
      console.log('[LocalTranscriptionManager] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[LocalTranscriptionManager] Initialization error:', error);
      this.setupInProgress = false;
      return false;
    }
  }

  /**
   * Set up event listeners for transcription events
   */
  private async setupEventListeners(): Promise<void> {
    console.log('[LocalTranscriptionManager] Setting up event listeners');
    
    try {
      // Listen for transcription status changes
      const unlistenStatus = await listen('transcription-status-changed', (event) => {
        console.log('[LocalTranscriptionManager] Transcription status event received:', JSON.stringify(event.payload));
        console.trace('[LocalTranscriptionManager] Trace for transcription-status-changed event');
        
        // Update transcribing state based on status
        if (event.payload === 'Processing' || 
            (typeof event.payload === 'object' && event.payload.hasOwnProperty('Processing'))) {
          console.log('[LocalTranscriptionManager] Setting isTranscribing=true based on PROCESSING status');
          this.isTranscribing = true;
          console.log('[LocalTranscriptionManager] ⚠️ IMPORTANT: Check if this is happening during startup and causing issues');
        } else if (event.payload === 'Idle' || event.payload === 'Done' || 
                  (typeof event.payload === 'object' && 
                  (event.payload.hasOwnProperty('Idle') || event.payload.hasOwnProperty('Done')))) {
          console.log('[LocalTranscriptionManager] Setting isTranscribing=false based on IDLE/DONE status');
          this.isTranscribing = false;
        }
      });
      
      // Listen for transcription results
      const unlistenResult = await listen('transcription-result', (event) => {
        console.log('[LocalTranscriptionManager] Transcription result event received!');
        
        // Reset transcribing state after receiving result
        this.isTranscribing = false;
        
        if (typeof event.payload === 'object' && event.payload.text) {
          console.log('[LocalTranscriptionManager] Transcription text sample:', 
            event.payload.text.substring(0, 100) + (event.payload.text.length > 100 ? '...' : ''));
        } else if (typeof event.payload === 'string') {
          console.log('[LocalTranscriptionManager] Transcription text (string):', 
            event.payload.substring(0, 100) + (event.payload.length > 100 ? '...' : ''));
        }
      });
      
      // Listen for clipboard fallback
      const unlistenClipboard = await listen('copy-to-clipboard', (event) => {
        console.log('[LocalTranscriptionManager] Copy-to-clipboard fallback event received:',
          JSON.stringify(event.payload));
      });
      
      // Listen for transcription errors
      const unlistenError = await listen('transcription-error', (event) => {
        console.error(`%c[LocalTranscriptionManager] --- PERMANENT LISTENER Received 'transcription-error' ---`, 'color: red; background: black; font-weight: bold; padding: 3px;');
        console.error('[LocalTranscriptionManager] Transcription error event received:', JSON.stringify(event.payload));
      });
      
      console.log('[LocalTranscriptionManager] Event listeners set up successfully');
      this.eventListeners.push(unlistenStatus, unlistenResult, unlistenClipboard, unlistenError);
    } catch (error) {
      console.error('[LocalTranscriptionManager] Error setting up event listeners:', error);
      throw error;
    }
  }

  /**
   * Clean up event listeners
   */
  private cleanupEventListeners(): void {
    console.log('[LocalTranscriptionManager] Cleaning up event listeners...');
    
    // Call all unlisten functions
    this.eventListeners.forEach(unlisten => {
      try {
        unlisten();
      } catch (error) {
        console.warn('[LocalTranscriptionManager] Error cleaning up listener:', error);
      }
    });
    
    // Clear the array
    this.eventListeners = [];
    console.log('[LocalTranscriptionManager] Event listeners cleaned up');
  }

  /**
   * Initialize the app data directory path
   */
  private async initializeAppDataDir(): Promise<void> {
    try {
      const appDataDirPath = await appDataDir();
      console.log('[LocalTranscriptionManager] App data dir initialized:', appDataDirPath);
    } catch (error) {
      console.error('[LocalTranscriptionManager] Failed to initialize app data dir:', error);
    }
  }

  /**
   * Configure transcription settings
   * 
   * What it does: Sets options for handling blank/short audio files
   * Why it exists: To provide fine-tuning for the transcription process
   */
  public configure(options: { 
    ignoreBlankAudio?: boolean, 
    minDurationThreshold?: number 
  }): void {
    if (options.ignoreBlankAudio !== undefined) {
      this.ignoreBlankAudio = options.ignoreBlankAudio;
    }
    if (options.minDurationThreshold !== undefined) {
      this.minDurationThreshold = options.minDurationThreshold;
    }
    console.log('[LocalTranscriptionManager] Configuration updated:', { 
      ignoreBlankAudio: this.ignoreBlankAudio,
      minDurationThreshold: this.minDurationThreshold
    });
  }

  /**
   * Transcribe audio using local Whisper.cpp
   * 
   * What it does: Saves audio to a unique temp file and invokes Whisper.cpp for transcription
   * Why it exists: To provide offline transcription capability with reliable error handling
   */
  public async transcribeAudio(audioBlob: Blob, autoPaste: boolean = true): Promise<string> {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.log(`%c[${timestamp}] [LocalTranscriptionManager] transcribeAudio called (Simplified) with ${audioBlob.size} byte blob`, 'background: #9c27b0; color: white; padding: 2px 5px; border-radius: 3px;');
    
    // Prevent multiple simultaneous transcriptions
    if (this.isTranscribing) {
      console.warn('[LocalTranscriptionManager] Transcription already in progress, skipping...');
      throw new Error("Another transcription is already in progress");
    }
    
    this.isTranscribing = true;
    
    try {
      // Ensure initialized
      if (!this.initialized) {
        console.log('[LocalTranscriptionManager] Manager not initialized, initializing now');
        await this.initialize();
      }
      
      // Validate audio blob
      if (audioBlob.size === 0) {
        throw new Error('Audio blob is empty');
      }
      
      if (audioBlob.size < 500) {
        throw new Error('Audio file too small, likely blank or invalid recording');
      }
      
      // Create unique filename for this recording
      const uniqueTimestamp = Date.now();
      const uniqueFilename = `audio_${uniqueTimestamp}.webm`;
      const appDir = await appDataDir();
      const uniqueInputPath = `${appDir}${uniqueFilename}`;
      
      console.log('[LocalTranscriptionManager] Audio metadata:', {
        type: audioBlob.type,
        size: `${(audioBlob.size / 1024).toFixed(2)} KB`,
        path: uniqueInputPath
      });
      
      // Convert blob to buffer and save
      console.log(`[LocalTranscriptionManager] Converting ${(audioBlob.size / 1024).toFixed(2)} KB blob to buffer`);
      const buffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      
      console.log(`[LocalTranscriptionManager] Saving audio to: ${uniqueInputPath}`);
      await invoke('save_audio_buffer', { 
        buffer: Array.from(uint8Array), 
        path: uniqueInputPath 
      });
      
      // Verify file was saved
      const fileExists = await invoke('verify_file_exists', { path: uniqueInputPath }) as boolean;
      if (!fileExists) {
        throw new Error('Failed to save audio file - file not found after save');
      }
      console.log('[LocalTranscriptionManager] Audio file saved and verified');
      
      // Invoke transcription directly
      const payload = {
        audioPath: uniqueInputPath,
        autoPaste: autoPaste
      };
      
      console.log('[LocalTranscriptionManager] Invoking transcribe_audio_file with:', payload);
      const resultText = await invoke<string>('transcribe_audio_file', payload);
      
      console.log(`[LocalTranscriptionManager] Transcription completed successfully. Result length: ${resultText.length} chars`);
      if (resultText.length > 0) {
        console.log('Sample:', resultText.substring(0, 100) + (resultText.length > 100 ? '...' : ''));
      }
      
      return resultText;
      
    } catch (error) {
      console.error('[LocalTranscriptionManager] Transcription failed:', error);
      throw new Error(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`);
      
    } finally {
      console.log('[LocalTranscriptionManager] Resetting transcription state');
      this.isTranscribing = false;
    }
  }

  /**
   * Clean up temporary files
   */
  public async cleanupTempFiles(): Promise<void> {
    try {
      if (this.tempAudioPath) {
        // TEMPORARILY DISABLED: Do not delete temp_audio.wav to allow manual testing
        // await removeFile(this.tempAudioPath);
        console.log('[LocalTranscriptionManager] CLEANUP DISABLED: Keeping temp file for testing:', this.tempAudioPath);
      }
    } catch (error) {
      console.warn('[LocalTranscriptionManager] Error cleaning up temp files:', error);
    }
  }

  /**
   * Clean up all resources
   */
  public cleanup(): void {
    console.log('[LocalTranscriptionManager] Cleaning up resources...');
    
    // Clean up event listeners
    this.cleanupEventListeners();
    
    // TEMPORARILY MODIFIED: Still call cleanupTempFiles but it won't delete files
    this.cleanupTempFiles().catch(err => 
      console.warn('[LocalTranscriptionManager] Error in cleanup:', err));
    
    // Reset state
    this.isTranscribing = false;
    this.initialized = false;
    
    console.log('[LocalTranscriptionManager] Cleanup completed (temp files preserved for testing)');
  }
} 