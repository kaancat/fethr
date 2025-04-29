/**
 * TranscriptionService handles interaction with the Rust transcription backend
 * 
 * What it does: Sends audio data to the Rust backend for transcription and handles results
 * Why it exists: To provide a clean interface between frontend and Rust transcription functionality
 */

import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { writeText } from '@tauri-apps/api/clipboard';

/**
 * Custom error class for transcription errors
 */
class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/**
 * Interface for status change event payload
 */
interface StatusChangeEvent {
  payload: TranscriptionStatus;
}

/**
 * Interface for transcription completion event payload
 */
interface CompletionEvent {
  payload: TranscriptionResult;
}

/**
 * Type for unlisten function returned by tauri listen
 */
type UnlistenFn = () => void;

/**
 * Enum representing the possible states of transcription
 */
export enum TranscriptionStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETE = 'COMPLETE',
  FAILED = 'FAILED'
}

/**
 * Interface for transcription results
 */
export interface TranscriptionResult {
  text: string;
  confidence?: number;
  duration?: number;
}

/**
 * TranscriptionService handles the communication with the backend for audio transcription
 * 
 * What it does: Manages transcription state and processes audio for transcription
 * Why it exists: To provide a clean API for frontend components to interact with 
 * the transcription features of the backend
 */
export class TranscriptionService {
  private static instance: TranscriptionService;
  
  private status: TranscriptionStatus = TranscriptionStatus.IDLE;
  private result: TranscriptionResult | null = null;
  private error: string | null = null;
  private statusListeners: ((status: TranscriptionStatus) => void)[] = [];
  private resultListeners: ((text: string) => void)[] = [];
  private errorListeners: ((error: string) => void)[] = [];
  private unlisteners: Array<() => void> = [];

  // Event listeners for cleanup
  private statusChangeUnlisten: UnlistenFn | null = null;
  private completionUnlisten: UnlistenFn | null = null;
  
  // Callback functions
  private onStatusChangeCallback: ((status: TranscriptionStatus) => void) | null = null;
  private onTranscriptionComplete: ((result: TranscriptionResult) => void) | null = null;
  
  // Last result
  private lastResult: TranscriptionResult | null = null;

  // Private constructor to enforce singleton pattern
  private constructor() {
    console.log('TranscriptionService: Initializing');
    this.setupEventListeners();
  }

  /**
   * Get the TranscriptionService instance (singleton pattern)
   */
  public static getInstance(): TranscriptionService {
    if (!TranscriptionService.instance) {
      TranscriptionService.instance = new TranscriptionService();
    }
    return TranscriptionService.instance;
  }

  /**
   * Set up event listeners for backend events
   */
  private async setupEventListeners(): Promise<void> {
    try {
      // Listen for transcription status updates
      const unlistenStatus = await listen('transcription-status', (event: any) => {
        const newStatus = event.payload as TranscriptionStatus;
        this.status = newStatus;
        this.notifyStatusListeners();
      });

      // Listen for transcription results
      const unlistenResult = await listen('transcription-result', (event: any) => {
        const result = event.payload as TranscriptionResult;
        this.result = result;
        this.notifyResultListeners();
      });

      // Listen for transcription errors
      const unlistenError = await listen('transcription-error', (event: any) => {
        const error = event.payload as string;
        this.error = error;
        this.notifyErrorListeners();
      });

      this.unlisteners.push(unlistenStatus, unlistenResult, unlistenError);
    } catch (error) {
      console.error('Failed to set up event listeners:', error);
    }
  }

  /**
   * Check if Whisper is installed on the system
   */
  public async isWhisperInstalled(): Promise<boolean> {
    try {
      return await invoke('is_whisper_installed');
    } catch (error) {
      console.error('Error checking if Whisper is installed:', error);
      return false;
    }
  }

  /**
   * Download Whisper model
   */
  public async downloadWhisper(): Promise<void> {
    try {
      this.setStatus(TranscriptionStatus.PROCESSING);
      await invoke('download_whisper');
    } catch (error) {
      this.handleError('Failed to download Whisper model', error);
    }
  }

  /**
   * Transcribe audio blob
   */
  public async transcribeAudio(audioBlob: Blob): Promise<void> {
    try {
      this.setStatus(TranscriptionStatus.PROCESSING);
      
      // Convert blob to ArrayBuffer
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Save the audio buffer to a temporary file
      const filePath = await invoke<string>('save_audio_buffer', {
        buffer: Array.from(uint8Array)
      });
      
      // Transcribe the audio file
      await invoke('transcribe_audio', {
        filePath
      });
    } catch (error) {
      this.handleError('Failed to transcribe audio', error);
    }
  }

  /**
   * Register a listener for status changes
   */
  public onStatusChange(callback: (status: TranscriptionStatus) => void): () => void {
    this.statusListeners.push(callback);
    return () => {
      this.statusListeners = this.statusListeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Register a listener for results
   */
  public onResultAvailable(callback: (text: string) => void): () => void {
    this.resultListeners.push(callback);
    return () => {
      this.resultListeners = this.resultListeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Register a listener for errors
   */
  public onError(callback: (error: string) => void): () => void {
    this.errorListeners.push(callback);
    return () => {
      this.errorListeners = this.errorListeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Set the transcription status
   */
  private setStatus(status: TranscriptionStatus): void {
    this.status = status;
    this.notifyStatusListeners();
  }

  /**
   * Notify all status listeners of the current status
   */
  private notifyStatusListeners(): void {
    this.statusListeners.forEach(listener => listener(this.status));
  }

  /**
   * Notify all result listeners of the available result
   */
  private notifyResultListeners(): void {
    if (this.result && this.result.text) {
      this.resultListeners.forEach(listener => listener(this.result!.text));
    }
  }

  /**
   * Notify all error listeners of the error
   */
  private notifyErrorListeners(): void {
    if (this.error) {
      this.errorListeners.forEach(listener => listener(this.error!));
    }
  }

  /**
   * Handle errors during transcription
   */
  private handleError(message: string, error: unknown): void {
    const errorMessage = error instanceof Error ? `${message}: ${error.message}` : message;
    this.error = errorMessage;
    this.setStatus(TranscriptionStatus.FAILED);
    this.notifyErrorListeners();
  }

  /**
   * Clean up event listeners
   */
  public destroy(): void {
    this.unlisteners.forEach(unlistenFn => unlistenFn());
    this.statusListeners = [];
    this.resultListeners = [];
    this.errorListeners = [];
  }

  /**
   * Initialize the service and set up event listeners
   * 
   * What it does: Sets up listeners for transcription status changes and completion events
   * Why it exists: To establish communication with the Rust backend
   */
  public async initialize(): Promise<void> {
    try {
      console.log('TranscriptionService: Setting up event listeners');

      // Listen for status changes
      this.statusChangeUnlisten = await listen('transcription-status-changed', (event: StatusChangeEvent) => {
        const status = event.payload;
        console.log(`TranscriptionService: Status changed to ${status}`);
        
        if (this.onStatusChangeCallback) {
          this.onStatusChangeCallback(status);
        }
      });

      // Listen for transcription completion
      this.completionUnlisten = await listen('transcription-completed', (event: CompletionEvent) => {
        const result = event.payload;
        console.log(`TranscriptionService: Transcription completed: "${result.text.substring(0, 30)}..."`);
        this.lastResult = result;
        
        if (this.onTranscriptionComplete) {
          this.onTranscriptionComplete(result);
        }
      });

      // Get current status from backend
      await this.getCurrentStatus();
      
      console.log('TranscriptionService: Initialization complete');
    } catch (error) {
      console.error('TranscriptionService: Failed to initialize:', error);
      throw new TranscriptionError(`Failed to initialize TranscriptionService: ${error}`);
    }
  }

  /**
   * Set callback for status changes
   */
  public setStatusChangeCallback(callback: (status: TranscriptionStatus) => void): void {
    this.onStatusChangeCallback = callback;
  }

  /**
   * Set callback for transcription completion
   */
  public setTranscriptionCompleteCallback(callback: (result: TranscriptionResult) => void): void {
    this.onTranscriptionComplete = callback;
  }

  /**
   * Get the current transcription status from the backend
   */
  private async getCurrentStatus(): Promise<TranscriptionStatus> {
    try {
      const status = await invoke<TranscriptionStatus>('get_transcription_status');
      console.log(`TranscriptionService: Current status is ${status}`);
      return status;
    } catch (error) {
      console.error('TranscriptionService: Failed to get status:', error);
      return TranscriptionStatus.IDLE;
    }
  }

  /**
   * Get the last transcription result
   */
  public async getLastTranscription(): Promise<TranscriptionResult | null> {
    try {
      const result = await invoke<TranscriptionResult | null>('get_last_transcription');
      console.log('TranscriptionService: Retrieved last transcription');
      this.lastResult = result;
      return result;
    } catch (error) {
      console.error('TranscriptionService: Failed to get last transcription:', error);
      return null;
    }
  }

  /**
   * Paste the last transcription at the cursor
   * 
   * What it does: Instructs the backend to paste the last transcription at the current cursor position
   * Why it exists: To provide an easy way to paste transcription results without clipboard management
   */
  public async pasteLastTranscription(): Promise<boolean> {
    try {
      const result = await invoke<boolean>('paste_last_transcription');
      console.log(`TranscriptionService: Paste last transcription command ${result ? 'succeeded' : 'failed'}`);
      return result;
    } catch (error) {
      console.error('TranscriptionService: Failed to paste last transcription:', error);
      return false;
    }
  }

  /**
   * Copy transcription to clipboard
   * 
   * What it does: Copies the last transcription result to the system clipboard
   * Why it exists: To provide easy access to transcription results
   */
  public async copyToClipboard(text?: string): Promise<boolean> {
    try {
      // Use provided text or fall back to last result
      const textToCopy = text || (this.lastResult ? this.lastResult.text : null);
      
      if (!textToCopy) {
        console.warn('TranscriptionService: No text to copy to clipboard');
        return false;
      }
      
      await writeText(textToCopy);
      console.log('TranscriptionService: Copied text to clipboard');
      return true;
    } catch (error) {
      console.error('TranscriptionService: Failed to copy to clipboard:', error);
      return false;
    }
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    if (this.statusChangeUnlisten) {
      this.statusChangeUnlisten();
      this.statusChangeUnlisten = null;
    }
    
    if (this.completionUnlisten) {
      this.completionUnlisten();
      this.completionUnlisten = null;
    }
    
    console.log('TranscriptionService: Cleaned up resources');
  }
} 