/**
 * Application models and type definitions
 * 
 * What it does: Defines common interfaces and types for the application
 * Why it exists: To provide type safety and common structures
 */

/**
 * Transcription options for configuring the transcription process
 */
export interface TranscriptionOptions {
  /**
   * Path to the audio file for transcription
   */
  audioPath: string;
  
  /**
   * Whether to ignore blank audio detection
   * When true, Whisper will return empty text for silence instead of [BLANK_AUDIO]
   */
  ignoreBlankAudio?: boolean;
}

/**
 * Status of a transcription operation
 */
export type TranscriptionStatus = 
  | { type: 'progress', progress: number }
  | { type: 'complete', text: string }
  | { type: 'failed', error: string };

/**
 * Recording status
 */
export type RecordingStatus = 'started' | 'stopping' | 'stopped' | 'error';

/**
 * Configuration for the LocalTranscriptionManager
 */
export interface TranscriberConfig {
  /**
   * Whether to ignore blank audio detection
   * When true, blank audio will return empty string rather than triggering a "blank audio" event
   */
  ignoreBlankAudio?: boolean;
  
  /**
   * Minimum audio size in bytes to consider for transcription
   * Audio files smaller than this threshold will be skipped
   */
  minDurationThreshold?: number;
} 