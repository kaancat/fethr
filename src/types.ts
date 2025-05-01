export enum RecordingState {
  IDLE = 0,
  RECORDING = 1,           // Represents initial recording OR hold recording
  // WAITING_FOR_SECOND_TAP - No distinct UI state
  LOCKED_RECORDING = 3,   // Keep distinct locked state
  TRANSCRIBING = 2,       // Keep distinct transcribing state
  // Adjust numeric values if needed for consistency
}

// You can add other shared interfaces or types here later if needed
// Example:
// export interface ConfigOptions {
//   useWhisperAPI: boolean;
//   autoCopyToClipboard: boolean;
//   autoPasteTranscription: boolean;
// } 