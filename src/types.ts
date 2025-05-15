export enum RecordingState {
  IDLE = 0,
  RECORDING = 1,         // For RecordingHold
  LOCKED_RECORDING = 3, // For LockedRecording
  TRANSCRIBING = 2,     // Keep distinct transcribing state
  ERROR = 4,           // Add error state
  PASTING = 5,         // Add pasting state
  SUCCESS = 6,
  IDLE_EDIT_READY = 7, // Keep this if still used by SettingsPage
  SUCCESS_EDIT_PENDING = 8 // <-- Add new state for immediate edit
  // Intermediate backend states don't need direct UI representation
  // CANCELLING might map to IDLE visually
}

export interface AppSettings {
  model_name: string;
  language: string;
  auto_paste: boolean;
  pill_enabled: boolean;
}

// History entry for transcription results
export interface HistoryEntry {
  timestamp: string; // ISO string format from chrono::DateTime<Utc>
  text: string;     // The transcribed text
}

// You can add other shared interfaces or types here later if needed
// Example:
// export interface ConfigOptions {
//   useWhisperAPI: boolean;
//   autoCopyToClipboard: boolean;
//   autoPasteTranscription: boolean;
// } 