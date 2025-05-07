use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use hound;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager}; // Correct Manager import

// Existing constants
const MAX_RECORDING_DURATION: Duration = Duration::from_secs(60 * 5); // Max 5 minutes recording
const SAMPLE_RATE: u32 = 48000; // Consider making this configurable or use device default
const TARGET_SAMPLE_RATE: u32 = 16000; // Target sample rate for Whisper

// --- AudioDevice Struct REMOVED ---

// --- get_audio_input_devices Command REMOVED ---

// --- Existing RecordingState and StateUpdater ---
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RecordingState {
    Idle,
    Recording,
    Stopped,
    Error(String),
}

// Structure to send updates to the frontend
#[derive(Clone, Serialize)]
struct StateUpdatePayload {
    state: RecordingState,
    file_path: Option<String>, // Send path on success or error
}

pub struct AudioRecorder {
    // ... existing fields ...
    app_handle: AppHandle, // Add AppHandle
    is_recording: Arc<Mutex<bool>>,
    stop_sender: Option<mpsc::Sender<()>>,
    output_file_path: Arc<Mutex<Option<PathBuf>>>,
    recording_state: Arc<Mutex<RecordingState>>,
}

impl AudioRecorder {
    pub fn new(app_handle: AppHandle) -> Self {
        AudioRecorder {
            app_handle,
            is_recording: Arc::new(Mutex::new(false)),
            stop_sender: None,
            output_file_path: Arc::new(Mutex::new(None)),
            recording_state: Arc::new(Mutex::new(RecordingState::Idle)),
        }
    }

    // ... (keep existing start_recording, stop_recording, get_state methods)
    // Make sure start_recording and stop_recording update the new recording_state field
    // and emit events via app_handle.

    // Example update for start_recording (adjust as needed):
    pub fn start_recording(&mut self, output_dir: &Path) -> Result<(), String> {
        let mut recording_flag = self.is_recording.lock().unwrap();
        if *recording_flag {
            return Err("Already recording".to_string());
        }

        *recording_flag = true;
        *self.recording_state.lock().unwrap() = RecordingState::Recording;
        self.emit_state_update(); // Emit initial state

        let output_file = output_dir.join(format!("fethr_recording_{}.wav", chrono::Utc::now().format("%Y%m%d_%H%M%S_%f")));
        *self.output_file_path.lock().unwrap() = Some(output_file.clone());

        let (tx, rx) = mpsc::channel();
        self.stop_sender = Some(tx);

        let is_recording_clone = self.is_recording.clone();
        let recording_state_clone = self.recording_state.clone();
        let output_file_path_clone = self.output_file_path.clone();
        let app_handle_clone = self.app_handle.clone();

        thread::spawn(move || {
            let host = cpal::default_host();
            let device = host.default_input_device().expect("No input device available");
            let config = device.default_input_config().expect("Failed to get default input config").config();

            let spec = hound::WavSpec {
                channels: config.channels as u16,
                sample_rate: SAMPLE_RATE, // Use fixed rate for now
                bits_per_sample: 16, // Standard for WAV PCM
                sample_format: hound::SampleFormat::Int,
            };

            let writer = hound::WavWriter::create(output_file.clone(), spec).unwrap();
            let writer = Arc::new(Mutex::new(Some(writer)));

            let writer_clone = writer.clone();
            let err_fn = move |err| {
                eprintln!("An error occurred on the input audio stream: {}", err);
                let mut state = recording_state_clone.lock().unwrap();
                *state = RecordingState::Error(err.to_string());
                // Need a way to signal state update here, maybe using app_handle?
                app_handle_clone.emit_all("audio-state-update", StateUpdatePayload {
                    state: state.clone(),
                    file_path: None, // No file path on error during stream
                }).unwrap_or_else(|e| eprintln!("Failed to emit error state: {}", e));
            };

            let stream = device.build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if let Some(writer) = writer_clone.lock().unwrap().as_mut() {
                        for &sample in data {
                            let amplitude = (sample * i16::MAX as f32) as i16;
                            if writer.write_sample(amplitude).is_err() {
                                eprintln!("Error writing sample");
                                break; // Stop writing on error
                            }
                        }
                    }
                },
                err_fn,
                None // Timeout
            ).map_err(|e| format!("Failed to build input stream: {}", e))?;

            stream.play().map_err(|e| format!("Failed to play stream: {}", e))?;

            // Wait for stop signal or timeout
            let _ = rx.recv_timeout(MAX_RECORDING_DURATION); // Wait for signal or timeout

            // Cleanup
            drop(stream); // Stop the stream
            let final_path = output_file_path_clone.lock().unwrap().clone(); // Get path before writer lock
            let mut state = recording_state_clone.lock().unwrap();

            let mut writer_guard = writer.lock().unwrap();
            if let Some(writer) = writer_guard.take() { // Take ownership
                if let Err(e) = writer.finalize() {
                    eprintln!("Failed to finalize WAV writer: {}", e);
                     *state = RecordingState::Error(format!("Failed to finalize WAV: {}", e));
                     app_handle_clone.emit_all("audio-state-update", StateUpdatePayload {
                         state: state.clone(),
                         file_path: final_path.map(|p| p.to_string_lossy().into_owned()),
                     }).unwrap_or_else(|e| eprintln!("Failed to emit error state: {}", e));
                } else if *state == RecordingState::Recording { // Only transition if not already error
                    *state = RecordingState::Stopped;
                     app_handle_clone.emit_all("audio-state-update", StateUpdatePayload {
                        state: state.clone(),
                        file_path: final_path.map(|p| p.to_string_lossy().into_owned()),
                    }).unwrap_or_else(|e| eprintln!("Failed to emit stopped state: {}", e));
                }
            } else {
                 eprintln!("Writer was already finalized or taken?");
                 // State might already be Error
                 if *state == RecordingState::Recording { // Fallback if state wasn't updated
                    *state = RecordingState::Error("Writer unavailable during finalize".to_string());
                     app_handle_clone.emit_all("audio-state-update", StateUpdatePayload {
                         state: state.clone(),
                         file_path: final_path.map(|p| p.to_string_lossy().into_owned()),
                     }).unwrap_or_else(|e| eprintln!("Failed to emit error state: {}", e));
                 }
            }

            // Always ensure the flag is false after the thread finishes
            *is_recording_clone.lock().unwrap() = false;
             println!("Recording thread finished.");
        });

        Ok(())
    }

    // Example update for stop_recording (adjust as needed):
    pub fn stop_recording(&mut self) -> Result<PathBuf, String> {
        let mut recording_flag = self.is_recording.lock().unwrap();
        if !*recording_flag {
            return Err("Not recording".to_string());
        }

        if let Some(sender) = self.stop_sender.take() {
            sender.send(()).map_err(|e| format!("Failed to send stop signal: {}", e))?;
        }

        // Note: The state transition to Stopped/Error now happens *within* the recording thread
        // upon finalization or error. This function just signals the stop.
        // We might need to wait briefly or check the state to ensure it stopped before returning.

        // Let's wait a short duration for the thread to potentially update the state
        // This is a simplification; a more robust solution might use channels/conditions.
        thread::sleep(Duration::from_millis(100));

        let final_state = self.recording_state.lock().unwrap().clone();
        let final_path = self.output_file_path.lock().unwrap().clone();

        // Reset the main struct's state immediately after signaling stop
        *recording_flag = false; // Redundant? Thread sets it too.
        *self.recording_state.lock().unwrap() = RecordingState::Idle; // Reset main state
        // No need to emit here, thread emits Stopped/Error

        match final_state {
            RecordingState::Stopped => final_path.ok_or_else(|| "File path missing after successful stop".to_string()),
            RecordingState::Error(e) => Err(format!("Recording stopped with error: {}", e)),
            _ => Err("Recording stopped in unexpected state".to_string()),
        }
    }

    // Function to emit state updates (add this)
    fn emit_state_update(&self) {
        let state = self.recording_state.lock().unwrap().clone();
        let path = self.output_file_path.lock().unwrap().clone();
        self.app_handle.emit_all("audio-state-update", StateUpdatePayload {
            state,
            file_path: path.map(|p| p.to_string_lossy().into_owned()),
        }).unwrap_or_else(|e| eprintln!("Failed to emit state update: {}", e));
    }

    pub fn get_state(&self) -> RecordingState {
        self.recording_state.lock().unwrap().clone()
    }
} 