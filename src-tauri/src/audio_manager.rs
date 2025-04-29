use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tempfile::NamedTempFile;
use std::sync::OnceLock;

/**
 * Audio manager module for handling recording
 * 
 * What it does: Manages audio recording using system's default microphone
 * Why it exists: To capture audio for transcription
 */

// Create a static recording state with OnceLock initialization
static RECORDING_STATE: OnceLock<Arc<Mutex<RecordingState>>> = OnceLock::new();

struct RecordingState {
    recording: bool,
    temp_file: Option<NamedTempFile>,
    process_handle: Option<std::process::Child>,
    start_time: Option<Instant>,
}

impl RecordingState {
    fn new() -> Self {
        Self {
            recording: false,
            temp_file: None,
            process_handle: None,
            start_time: None,
        }
    }
}

/**
 * Get recording state
 * 
 * What it does: Gets the current recording state
 * Why it exists: To maintain recording state across function calls
 */
fn get_recording_state() -> Arc<Mutex<RecordingState>> {
    RECORDING_STATE.get_or_init(|| Arc::new(Mutex::new(RecordingState::new()))).clone()
}

/**
 * Start recording audio
 * 
 * What it does: Begins audio recording using FFmpeg
 * Why it exists: To capture audio from the user's microphone
 */
#[tauri::command]
pub fn start_recording(app_handle: AppHandle) -> Result<(), String> {
    let state = get_recording_state();
    let mut state_guard = state.lock().map_err(|e| format!("Failed to lock recording state: {:?}", e))?;
    
    // Check if already recording
    if state_guard.recording {
        return Err("Already recording".to_string());
    }
    
    // Create temporary file for audio
    let temp_file = match NamedTempFile::new() {
        Ok(file) => file,
        Err(e) => return Err(format!("Failed to create temporary file: {:?}", e)),
    };
    
    let temp_path = temp_file.path().to_str().ok_or("Invalid temp path")?;
    println!("Recording to temporary file: {}", temp_path);
    
    // Start FFmpeg process for recording
    let process = match Command::new("ffmpeg")
        .arg("-f").arg("dshow") // DirectShow for Windows
        .arg("-i").arg("audio=Microphone Array (Realtek(R) Audio)") // Default microphone
        .arg("-c:a").arg("libopus") // Opus codec for WebM
        .arg("-f").arg("webm") // WebM container
        .arg("-y") // Overwrite output file
        .arg(temp_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn() {
            Ok(process) => process,
            Err(e) => return Err(format!("Failed to start recording: {:?}", e)),
        };
    
    // Update state
    state_guard.recording = true;
    state_guard.temp_file = Some(temp_file);
    state_guard.process_handle = Some(process);
    state_guard.start_time = Some(Instant::now());
    
    // Emit recording start event
    app_handle.emit_all("recording-status-changed", "started")
        .map_err(|e| format!("Failed to emit recording status: {:?}", e))?;
    
    Ok(())
}

/**
 * Stop recording audio
 * 
 * What it does: Stops the audio recording and returns the recorded data
 * Why it exists: To finalize the recording for transcription
 */
#[tauri::command]
pub async fn stop_recording(app_handle: AppHandle) -> Result<Vec<u8>, String> {
    let state = get_recording_state();
    let mut state_guard = state.lock().map_err(|e| format!("Failed to lock recording state: {:?}", e))?;
    
    // Check if recording
    if !state_guard.recording {
        return Err("Not recording".to_string());
    }
    
    // Emit status event
    app_handle.emit_all("recording-status-changed", "stopping")
        .map_err(|e| format!("Failed to emit recording status: {:?}", e))?;
    
    // Get minimum recording duration (for testing)
    let min_duration = if let Some(start_time) = state_guard.start_time {
        let elapsed = start_time.elapsed();
        if elapsed < Duration::from_millis(100) {
            println!("Recording too short, sleeping to ensure minimum duration");
            let sleep_time = Duration::from_millis(100) - elapsed;
            thread::sleep(sleep_time);
        }
        true
    } else {
        false
    };
    
    // Stop FFmpeg process
    if let Some(mut process) = state_guard.process_handle.take() {
        // Try to gracefully terminate the process
        match process.kill() {
            Ok(_) => println!("Recording process terminated"),
            Err(e) => println!("Failed to kill recording process: {:?}", e),
        }
        
        // Wait for process to exit
        match process.wait() {
            Ok(status) => println!("Recording process exited with status: {}", status),
            Err(e) => println!("Failed to wait for recording process: {:?}", e),
        }
    }
    
    // Get recorded audio data
    let audio_data = if let Some(temp_file) = state_guard.temp_file.take() {
        // Try to read the file
        let path = temp_file.path().to_owned();
        drop(temp_file); // Close the file
        
        match std::fs::read(&path) {
            Ok(data) => {
                // Remove the temporary file after reading
                if let Err(e) = std::fs::remove_file(&path) {
                    println!("Failed to remove temporary file: {:?}", e);
                }
                data
            },
            Err(e) => {
                app_handle.emit_all("recording-status-changed", "error")
                    .unwrap_or_default();
                return Err(format!("Failed to read recorded audio: {:?}", e));
            }
        }
    } else {
        app_handle.emit_all("recording-status-changed", "error")
            .unwrap_or_default();
        return Err("No temporary file found".to_string());
    };
    
    // Reset state
    state_guard.recording = false;
    state_guard.start_time = None;
    
    // Emit completion event
    app_handle.emit_all("recording-status-changed", "stopped")
        .map_err(|e| format!("Failed to emit recording status: {:?}", e))?;
    
    if audio_data.is_empty() && min_duration {
        println!("Warning: Empty audio data recorded despite minimum duration enforced");
    }
    
    Ok(audio_data)
} 