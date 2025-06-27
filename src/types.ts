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

export interface FuzzyCorrectionSettings {
  enabled: boolean;
  sensitivity: number;
  max_corrections_per_text: number;
  preserve_original_case: boolean;
  correction_log_enabled: boolean;
}

export interface AppSettings {
  model_name: string;
  language: string;
  auto_paste: boolean;
  pill_enabled: boolean;
  supabase_url: string;
  supabase_anon_key: string;
  stripe_secret_key: string;
  stripe_success_url: string;
  stripe_cancel_url: string;
  fuzzy_correction: FuzzyCorrectionSettings;
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