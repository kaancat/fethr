/**
 * Type declaration for audiobuffer-to-wav package
 */
declare module 'audiobuffer-to-wav' {
  /**
   * Converts an AudioBuffer to a WAV file as an ArrayBuffer
   * @param audioBuffer - The AudioBuffer to convert
   * @returns ArrayBuffer containing WAV file data
   */
  export default function audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer;
} 