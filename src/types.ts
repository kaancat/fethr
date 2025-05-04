export enum RecordingState {
  IDLE = 0,
  RECORDING = 1,         // For RecordingHold
  LOCKED_RECORDING = 3, // For LockedRecording
  TRANSCRIBING = 2,     // Keep distinct transcribing state
  ERROR = 4,           // Add error state
  PASTING = 5,         // Add pasting state
  // Intermediate backend states don't need direct UI representation
  // CANCELLING might map to IDLE visually
}

export interface AppSettings {
  model_name: string;
  language: string;
  auto_paste: boolean;
}

// You can add other shared interfaces or types here later if needed
// Example:
// export interface ConfigOptions {
//   useWhisperAPI: boolean;
//   autoCopyToClipboard: boolean;
//   autoPasteTranscription: boolean;
// } 