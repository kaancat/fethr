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
   * What it does: Saves WAV audio to a temp file and invokes Whisper.cpp for transcription
   * Why it exists: To provide offline transcription capability
   */
  public async transcribeAudio(audioBlob: Blob, autoPaste: boolean = true): Promise<string> {
    console.log('\n===== STARTING TRANSCRIPTION PROCESS =====');
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.log(`%c[${timestamp}] [LocalTranscriptionManager] transcribeAudio called with ${audioBlob.size} byte blob`, 'background: #9c27b0; color: white; padding: 2px 5px; border-radius: 3px;');
    
    // Prevent multiple simultaneous transcriptions
    if (this.isTranscribing) {
      console.warn('[LocalTranscriptionManager] Transcription already in progress, skipping...');
      return "Error: Another transcription is already in progress";
    }
    
    this.isTranscribing = true;
    
    // Return a new Promise that will resolve/reject based on transcription events
    return new Promise<string>((resolve, reject) => {
      // Set up temporary event listeners specifically for this transcription request
      let unlistenResult: (() => void) | null = null;
      let unlistenError: (() => void) | null = null;
      
      const setupTemporaryListeners = async () => {
        console.log(`%c[${timestamp}] [LocalTranscriptionManager] Setting up temporary event listeners for this transcription`, 'color: #9c27b0;');
        
        try {
          // Listen for transcription result
          unlistenResult = await listen('transcription-result', (event) => {
            console.log(`%c[${timestamp}] [LocalTranscriptionManager] 🎉 TEMPORARY LISTENER: Received transcription-result event`, 'background: green; color: white; font-weight: bold;');
            
            let transcriptionText = '';
            if (typeof event.payload === 'object' && event.payload.text) {
              transcriptionText = event.payload.text;
            } else if (typeof event.payload === 'string') {
              transcriptionText = event.payload;
            }
            
            console.log(`[LocalTranscriptionManager] Transcription result received (${transcriptionText.length} chars)`, 
              transcriptionText.substring(0, 100) + (transcriptionText.length > 100 ? '...' : ''));
            
            cleanupListeners();
            this.isTranscribing = false;
            resolve(transcriptionText);
          });
          
          console.log(`[LocalTranscriptionManager] ---> Attaching TEMPORARY listener for 'transcription-error'...`);
          unlistenError = await listen('transcription-error', (event) => {
            console.log(`%c[${timestamp}] [LocalTranscriptionManager] ❌ TEMPORARY LISTENER: Received transcription-error event`, 'background: red; color: white; font-weight: bold;');
            const errorMessage = typeof event.payload === 'string' 
              ? event.payload 
              : (typeof event.payload === 'object' ? JSON.stringify(event.payload) : 'Unknown error');
            console.error(`[LocalTranscriptionManager] Transcription error received: ${errorMessage}`);
            cleanupListeners();
            this.isTranscribing = false;
            console.error(`[LocalTranscriptionManager] ---> REJECTING Promise due to transcription-error: ${errorMessage}`);
            reject(new Error(`Transcription error: ${errorMessage}`));
          });
          console.log(`[LocalTranscriptionManager] ---> Successfully ATTACHED TEMPORARY listener for 'transcription-error'.`);
          
          console.log('[LocalTranscriptionManager] Temporary event listeners set up successfully');
        } catch (error) {
          console.error('[LocalTranscriptionManager] Failed to set up temporary event listeners:', error);
          this.isTranscribing = false;
          reject(new Error(`Failed to set up event listeners: ${error}`));
        }
      };
      
      // Clean up temporary listeners
      const cleanupListeners = () => {
        console.log('[LocalTranscriptionManager] Cleaning up temporary event listeners');
        if (unlistenResult) {
          unlistenResult();
          unlistenResult = null;
        }
        if (unlistenError) {
          unlistenError();
          unlistenError = null;
        }
      };
      
      // Execute the transcription process
      const executeTranscription = async () => {
        try {
          if (!this.initialized) {
            console.log('[LocalTranscriptionManager] Manager not initialized, initializing now');
            await this.initialize();
          }
          
          console.log('[LocalTranscriptionManager] Transcribing audio...');
          console.log('[LocalTranscriptionManager] Audio blob metadata:', {
            type: audioBlob.type,
            size: `${(audioBlob.size / 1024).toFixed(2)} KB`,
            lastModified: new Date().toISOString()
          });
          
          // Validate audio blob
          if (audioBlob.size === 0) {
            const error = 'Audio blob is empty';
            console.error(`[LocalTranscriptionManager] ${error}`);
            this.isTranscribing = false;
            cleanupListeners();
            reject(new Error(error));
            return;
          }
          
          // Ensure the blob is a WAV file
          if (audioBlob.type !== 'audio/wav') {
            console.warn('[LocalTranscriptionManager] Audio is not in WAV format:', audioBlob.type);
            console.warn('[LocalTranscriptionManager] The audio should be converted to WAV before calling this method');
          }
          
          // Convert blob to buffer
          console.log('[LocalTranscriptionManager] Converting audio blob to buffer');
          const buffer = await audioBlob.arrayBuffer();
          const uint8Array = new Uint8Array(buffer);
          
          console.log(`[LocalTranscriptionManager] Saving WAV to: ${this.tempAudioPath}`);
          console.log(`[LocalTranscriptionManager] File size: ${(uint8Array.length / 1024).toFixed(2)} KB`);
          
          // Very small files are likely empty/invalid
          if (uint8Array.length < 500) {
            console.warn('[LocalTranscriptionManager] Audio file is very small, likely blank or invalid');
            cleanupListeners();
            this.isTranscribing = false;
            reject(new Error('Audio file too small, likely blank or invalid recording'));
            return;
          }
          
          // Save audio to temp file
          console.log(`%c[${timestamp}] [LocalTranscriptionManager] 📥 BEFORE invoking save_audio_buffer`, 'color: #2196F3; font-weight: bold;');
          try {
            await invoke('save_audio_buffer', { buffer: Array.from(uint8Array), path: this.tempAudioPath });
            console.log(`%c[${timestamp}] [LocalTranscriptionManager] ✅ AFTER invoking save_audio_buffer - SUCCESS`, 'color: #4CAF50; font-weight: bold;');
          } catch (saveError) {
            console.error(`%c[${timestamp}] [LocalTranscriptionManager] ❌ ERROR invoking save_audio_buffer:`, 'background: #F44336; color: white; padding: 2px 5px;', saveError);
            cleanupListeners();
            this.isTranscribing = false;
            reject(new Error(`Failed to save audio buffer: ${saveError}`));
            return;
          }
          
          // Verify file was saved successfully
          let fileExists = false;
          try {
            fileExists = await invoke('verify_file_exists', { path: this.tempAudioPath }) as boolean;
            console.log(`[LocalTranscriptionManager] File exists check: ${fileExists ? '✓' : '✗'}`);
          } catch (verifyError) {
            console.error('[LocalTranscriptionManager] Error verifying file exists:', verifyError);
          }
          
          if (!fileExists) {
            const error = 'Failed to save audio file - file not found after save';
            console.error(`[LocalTranscriptionManager] ${error}`);
            cleanupListeners();
            this.isTranscribing = false;
            reject(new Error(error));
            return;
          }
          
          // Start transcription with local Whisper
          console.log(`%c[${timestamp}] [LocalTranscriptionManager] 🔄 BEFORE invoking transcribe_audio_file`, 'color: #2196F3; font-weight: bold;');
          try {
            // Prepare payload with correct arguments
            const payload = {
              audioPath: this.tempAudioPath,
              autoPaste: autoPaste // Use the autoPaste parameter from transcribeAudio
            };
            console.log(`[LocalTranscriptionManager] Invoking 'transcribe_audio_file' with payload:`, payload);
            
            // Call the correct command with payload
            await invoke('transcribe_audio_file', payload);
            
            console.log(`%c[${timestamp}] [LocalTranscriptionManager] ✅ AFTER invoking transcribe_audio_file - SUCCESS`, 'color: #4CAF50; font-weight: bold;');
            console.log(`%c[${timestamp}] [LocalTranscriptionManager] 🕒 Now WAITING for transcription-result or transcription-error event...`, 'background: #FF9800; color: black; font-weight: bold; padding: 2px 5px;');
            
            // NOTE: We don't resolve the promise here, but wait for the event listeners
          } catch (transcribeError) {
            console.error(`%c[${timestamp}] [LocalTranscriptionManager] ❌ ERROR invoking transcribe_audio_file:`, 'background: #F44336; color: white; padding: 2px 5px;', transcribeError);
            cleanupListeners();
            this.isTranscribing = false;
            reject(new Error(`Failed to start transcription: ${transcribeError}`));
            return;
          }
          
          // Cleanup temp file will be handled after transcription completes (in the event handlers)
          
        } catch (generalError) {
          console.error(`%c[${timestamp}] [LocalTranscriptionManager] ❌ GENERAL ERROR in executeTranscription:`, 'background: #F44336; color: white; padding: 2px 5px;', generalError);
          cleanupListeners();
          this.isTranscribing = false;
          reject(new Error(`General transcription error: ${generalError}`));
        }
      };
      
      // Start the process: set up listeners then execute transcription
      (async () => {
        try {
          await setupTemporaryListeners();
          await executeTranscription();
        } catch (startupError) {
          console.error('[LocalTranscriptionManager] Error during transcription startup:', startupError);
          cleanupListeners();
          this.isTranscribing = false;
          reject(new Error(`Transcription startup error: ${startupError}`));
        }
      })();
      
      // Add a timeout to prevent hanging indefinitely
      setTimeout(() => {
        if (this.isTranscribing) {
          console.error(`%c[${timestamp}] [LocalTranscriptionManager] ⏰ TRANSCRIPTION TIMEOUT after 30 seconds`, 'background: #FF5722; color: white; font-weight: bold; padding: 2px 5px;');
          cleanupListeners();
          this.isTranscribing = false;
          reject(new Error('Transcription timed out after 30 seconds'));
        }
      }, 30000); // 30 second timeout
    });
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