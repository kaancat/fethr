// src-tauri/src/transcription.rs (Corrected)

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio}; // <<< ADD Stdio import
use tauri::{command, AppHandle, Manager};
// Removed unused imports: Duration, Enigo, KeyboardControllable, NamedTempFile, Resampler, Read
use std::sync::atomic::{AtomicBool, Ordering};
use scopeguard;
use uuid::Uuid;

// REMOVED: use crate::{write_to_clipboard_internal, paste_text_to_cursor};

// Add a static flag to prevent multiple transcription processes
static TRANSCRIPTION_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

// Status structure to report transcription progress
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TranscriptionStatus {
    Idle, Ready, Processing, Failed(String), // Simplified for now
    // Other variants can be added back if needed
    Complete { text: String }, // Keep this one
}

// Transcription results (simplified, maybe not needed if state holds last text)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub model_used: String,
}

// Transcription state to store as app state
#[derive(Debug, Clone)]
pub struct TranscriptionState {
    pub status: TranscriptionStatus,
    pub result: Option<TranscriptionResult>, // Store last successful result maybe?
    pub whisper_directory: PathBuf,
    pub whisper_binary_path: PathBuf,
    pub whisper_model_directory: PathBuf,
    pub current_model: String, // Keep track of the model being used
}

impl Default for TranscriptionState {
    fn default() -> Self {
        Self {
            status: TranscriptionStatus::Idle,
            result: None,
            whisper_directory: PathBuf::new(),
            whisper_binary_path: PathBuf::new(),
            whisper_model_directory: PathBuf::new(),
            current_model: "tiny.en".to_string(), // Default to tiny.en
        }
    }
}

// Initialize the transcription state
pub fn init_transcription(app_handle: &AppHandle) -> Result<TranscriptionState, String> {
    let whisper_directory = PathBuf::from("C:\\Users\\kaan\\.fethr"); // Use specific path
    let whisper_model_directory = whisper_directory.join("models");
    let whisper_binary_path = whisper_directory.join("whisper.exe");

    println!("Using whisper binary at: {}", whisper_binary_path.display());
    println!("Using whisper models directory at: {}", whisper_model_directory.display());

    fs::create_dir_all(&whisper_model_directory)
        .map_err(|e| format!("Failed to create whisper models directory: {}", e))?;

    let mut state = TranscriptionState::default(); // Use default model ("tiny.en")
    state.whisper_directory = whisper_directory;
    state.whisper_binary_path = whisper_binary_path;
    state.whisper_model_directory = whisper_model_directory;
    println!("[RUST INIT] Initializing with model: {}", state.current_model);

    if !check_whisper_binary(&state) {
        let error_msg = format!("Whisper binary not found at {}", state.whisper_binary_path.display());
        // Consider emitting error state here if needed by frontend
        return Err(error_msg);
    }
    println!("Whisper binary found at: {}", state.whisper_binary_path.display());

    if !check_model_exists(&state.whisper_model_directory, &state.current_model) {
        let error_msg = format!("Model '{}' not found in {}", state.current_model, state.whisper_model_directory.display());
        // Consider emitting error state
        return Err(error_msg);
    }
     println!("Model found at: {}", state.whisper_model_directory.join(format!("ggml-{}.bin", state.current_model)).display());
     let _ = app_handle.emit_all("transcription_status_changed", TranscriptionStatus::Ready); // Use snake_case event name

    Ok(state)
}

// Check if Whisper binary is available
pub fn check_whisper_binary(state: &TranscriptionState) -> bool {
    Path::new(&state.whisper_binary_path).exists()
}

// Check if a specific model exists
pub fn check_model_exists(model_directory: &PathBuf, model_name: &str) -> bool {
    model_directory.join(format!("ggml-{}.bin", model_name)).exists()
}

// Helper function to convert to WAV with predictable output path & error checking
fn convert_to_wav_predictable(input_path: &str, output_path_str: &str) -> Result<(), String> {
    println!("[RUST FFMPEG] Converting {} to 16kHz WAV at {}", input_path, output_path_str); // No volume boost
    let ffmpeg_command = std::process::Command::new("ffmpeg")
        .arg("-y")
        .arg("-i").arg(input_path)
        .arg("-ar").arg("16000")
        .arg("-ac").arg("1")
        .arg("-c:a").arg("pcm_s16le")
        .arg(output_path_str)
        .output(); // Use .output() to get status, stdout, stderr

    match ffmpeg_command {
        Ok(output) => {
            if output.status.success() {
                // Verify output file size (must be > 44 bytes)
                match std::fs::metadata(output_path_str) {
                    Ok(m) if m.len() > 44 => { // Basic check for non-empty data
                         println!("[RUST FFMPEG] Output file {} verified ({} bytes).", output_path_str, m.len());
                         Ok(())
                    },
                    Ok(m) => {
                        let err_msg = format!("FFmpeg created empty/tiny output file ({} bytes)", m.len());
                        println!("[RUST FFMPEG ERROR] {}", err_msg);
                        Err(err_msg)
                    },
                    Err(e) => {
                         let err_msg = format!("Failed to verify FFmpeg output file metadata: {}", e);
                         println!("[RUST FFMPEG ERROR] {}", err_msg);
                         Err(err_msg)
                    }
                }
            } else {
                // Log FFmpeg errors clearly
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                let err_msg = format!("FFmpeg execution failed with status: {}. Stderr: '{}'. Stdout: '{}'", output.status, stderr.trim(), stdout.trim());
                println!("[RUST FFMPEG ERROR] {}", err_msg);
                Err(err_msg)
            }
        },
        Err(e) => {
             let err_msg = format!("Failed to execute FFmpeg command: {}", e);
             println!("[RUST FFMPEG ERROR] {}", err_msg);
             Err(err_msg)
        },
    }
}

// New command that accepts a specific audio file path - CALLED BY stop_backend_recording
#[tauri::command]
pub async fn transcribe_audio_file(
    app_handle: AppHandle,
    state: tauri::State<'_, TranscriptionState>,
    audio_path: String,
    auto_paste: bool // Keep flag if needed elsewhere, but not used in transcribe_local_audio_impl now
) -> Result<String, String> {
    println!("\n\n[RUST DEBUG] >>> ENTERED transcribe_audio_file command function <<<");
    println!("[RUST DEBUG] Input audio path: {}", audio_path);
    println!("[RUST DEBUG] Auto paste flag (passed): {}", auto_paste);

    // Check if transcription is already in progress
    if TRANSCRIPTION_IN_PROGRESS.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        println!("[RUST DEBUG] Another transcription is already in progress, skipping this request");
        // Don't emit error here, just return Err to the caller (stop_backend_recording)
        return Err("Another transcription is already in progress".to_string());
    }

    // --- Correct scopeguard usage HERE --- Ensure lock is released even on panic
    scopeguard::defer!({ // <<< REMOVE `let _guard = `
        TRANSCRIPTION_IN_PROGRESS.store(false, Ordering::SeqCst);
        println!("[RUST DEBUG] Transcription lock released via scopeguard");
    });
    // --- End scopeguard call ---

    // Call the implementation (pass auto_paste along, even if _impl ignores it now)
    // The guard will run automatically when this function returns or panics
    let result = transcribe_local_audio_impl(app_handle, state, audio_path, auto_paste).await; // Pass auto_paste
    println!("[RUST DEBUG] transcribe_local_audio_impl completed. Success? {}", result.is_ok());
    
    // Guard runs automatically after this point
    result
}

// The main implementation function - now returns only the transcription text
pub async fn transcribe_local_audio_impl(
    app_handle: AppHandle, // Marked unused now, consider removing later if truly not needed
    state: tauri::State<'_, TranscriptionState>,
    audio_path: String,
    _auto_paste: bool, // Mark unused now
) -> Result<String, String> {
    println!("[RUST DEBUG] >>> ENTERED transcribe_local_audio_impl <<<"); // Removed AutoPaste log
    println!("[RUST DEBUG] Received initial WAV path: {}", audio_path);

    let input_wav_path = Path::new(&audio_path);
    let mut converted_wav_path_opt: Option<PathBuf> = None; // <<< UNCOMMENT this line

    // --- RE-ENABLE FFMPEG BLOCK ---
    let unique_id = Uuid::new_v4().to_string();
    let temp_dir = std::env::temp_dir();
    let converted_wav_path = temp_dir.join(format!("fethr_converted_{}.wav", unique_id));
    println!("[RUST DEBUG] Attempting FFmpeg resampling to: {}", converted_wav_path.display());

    match convert_to_wav_predictable(&audio_path, converted_wav_path.to_str().unwrap()) {
        Ok(_) => {
            println!("[RUST DEBUG] FFmpeg resampling successful.");
            converted_wav_path_opt = Some(converted_wav_path.clone());
        },
        Err(e) => {
             println!("[RUST DEBUG ERROR] FFmpeg resampling failed: {}. Proceeding with original.", e);
             // Fall through to use original audio_path - whisper_input_path_str will handle this
        }
    }
    // --- END OF RE-ENABLED FFMPEG BLOCK ---

    // --- DETERMINE WHISPER INPUT PATH (Use converted if successful, else original) ---
    let whisper_input_path_str = converted_wav_path_opt
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| {
            println!("[RUST WARNING] Using original (non-resampled) WAV for Whisper: {}", audio_path);
            audio_path.clone()
        });
    // --- END OF DETERMINING PATH --- 

    let whisper_input_path = Path::new(&whisper_input_path_str);

    if !whisper_input_path.exists() {
        let error_msg = format!("Whisper input file does not exist: {}", whisper_input_path.display());
         println!("[RUST ERROR] {}", error_msg);
         // Cleanup only original if converted doesn't exist or failed
         cleanup_files(input_wav_path, None); // Pass None for converted
         return Err(error_msg);
    }
     println!("[RUST DEBUG] Whisper will use input file: {}", whisper_input_path.display());

    // --- Prepare Whisper ---
    let model_path_str = state.whisper_model_directory
        .join(format!("ggml-{}.bin", state.current_model)) // Uses state.current_model
        .to_str().ok_or("Invalid UTF-8 in model path")?.to_string();
    let whisper_dir = state.whisper_binary_path.parent()
        .ok_or("Could not get whisper binary directory")?;

    println!("[RUST DEBUG] ========== STARTING WHISPER COMMAND ... ==========");
    println!("    Executable: {}", state.whisper_binary_path.display());
    println!("    Model: {}", model_path_str);
    println!("    Input WAV: {}", whisper_input_path.display());
    println!("    CWD: {}", whisper_dir.display());
    println!("    Language: en");
    println!("    Flags: -nt (No Timestamps)"); // Correct flag
    println!("=========================================================================================");

    let _ = app_handle.emit_all("transcription_status_changed", TranscriptionStatus::Processing); // Use snake_case

    // --- Run Whisper ---
    let mut command_builder = std::process::Command::new(&state.whisper_binary_path);
    command_builder.current_dir(whisper_dir)
                   .arg("--model") // Use long form for clarity
                   .arg(&model_path_str)
                   .arg("--file")
                   .arg(&whisper_input_path_str)
                   .arg("--language")
                   .arg("en")
                   .arg("-nt"); // Correct flag for no timestamps
                   // REMOVED: .stdout(Stdio::piped())
                   // REMOVED: .stderr(Stdio::piped())

    println!("[RUST DEBUG] Executing Whisper command...");
    let start_time = std::time::Instant::now();
    let output_result = command_builder.output(); // Capture combined output
    let duration = start_time.elapsed();
    println!("[RUST DEBUG] Whisper command finished in {:.2?}s", duration.as_secs_f32());

    // --- Process Whisper Output ---
    let final_transcription_result = match output_result { // Rename variable to avoid conflict later
        Ok(output) => {
            let stderr_text = String::from_utf8_lossy(&output.stderr).to_string();
            if !stderr_text.is_empty() {
                 println!("[RUST DEBUG] Whisper STDERR (Info/Timings/Errors):\n{}", stderr_text);
            }
            // Check exit status FIRST
            if output.status.success() {
                let stdout_text = String::from_utf8_lossy(&output.stdout).to_string();
                 println!("[RUST DEBUG] Whisper STDOUT Length: {}", stdout_text.len());
                 if stdout_text.len() > 100 {println!("[RUST DEBUG] Whisper STDOUT Preview: '{}'...", stdout_text.chars().take(100).collect::<String>());} else {println!("[RUST DEBUG] Whisper STDOUT: '{}'", stdout_text);}

                let transcription_text = stdout_text.trim();

                if transcription_text.is_empty() {
                     // Check stderr for specific errors like "failed to read"
                     if stderr_text.contains("failed to read") || stderr_text.contains("error:") {
                         println!("[RUST WARNING] Whisper failed to read audio (check STDERR).");
                         Err(format!("Whisper failed to read audio: {}", stderr_text.lines().filter(|l| l.starts_with("error:")).collect::<Vec<_>>().join(" ")))
                     } else {
                         println!("[RUST WARNING] Whisper produced empty output.");
                         Err("Whisper produced no text output".to_string()) // Treat empty as error for now
                     }
                } else {
                    println!("[RUST] Transcription successful: '{}'", transcription_text.chars().take(50).collect::<String>());
                    // REMOVED copy/paste logic from here
                    Ok(transcription_text.to_string())
                }
            } else {
                 // Non-zero exit code
                let stdout_text_on_error = String::from_utf8_lossy(&output.stdout).to_string();
                let error_msg = format!( "Whisper command failed with status: {}. Stderr: {}. Stdout: {}", output.status, stderr_text.trim(), stdout_text_on_error.trim());
                println!("[RUST ERROR] {}", error_msg);
                Err(error_msg)
            }
        }
        Err(e) => {
            let error_msg = format!("Failed to execute Whisper command: {}", e);
            println!("[RUST ERROR] {}", error_msg);
            Err(error_msg)
        }
    };

    // --- Cleanup ---
    println!("[RUST DEBUG] Cleaning up temporary files..."); // <<< UNCOMMENT log
    cleanup_files(input_wav_path, converted_wav_path_opt.as_deref()); // <<< UNCOMMENT this call
    println!("[RUST DEBUG] Temporary files cleanup attempted."); // <<< UNCOMMENT log

    // Return the final result
    final_transcription_result
}

// Cleanup helper - Restore body
fn cleanup_files(original_temp_wav: &Path, converted_temp_wav: Option<&Path>) {
     // Remove the "skipped" log
     println!("[RUST CLEANUP] Cleaning up files... Original: {:?}, Converted: {:?}",
         original_temp_wav.display(),
         converted_temp_wav.map(|p| p.display().to_string()).unwrap_or_else(|| "None".to_string()));

    if let Some(converted_path) = converted_temp_wav {
        if converted_path.exists() {
            if let Err(e) = fs::remove_file(converted_path) {
                println!("[RUST CLEANUP WARNING] Failed to delete converted temp file {:?}: {}", converted_path.display(), e);
            } else { println!("[RUST CLEANUP] Removed converted: {}", converted_path.display()); }
        } else { 
             println!("[RUST CLEANUP] Converted file does not exist, skipping removal: {}", converted_path.display());
        }
    }

    if original_temp_wav.exists() {
        if let Err(e) = fs::remove_file(original_temp_wav) {
            println!("[RUST CLEANUP WARNING] Failed to delete original backend temp file {:?}: {}", original_temp_wav.display(), e);
        } else { println!("[RUST CLEANUP] Removed original backend temp: {}", original_temp_wav.display()); }
    } else { 
        println!("[RUST CLEANUP] Original backend temp file does not exist, skipping removal: {}", original_temp_wav.display());
    }
}

// --- Commands below are potentially unused / part of old logic ---
// --- Consider removing them later if transcribe_audio_file is the only entry point ---

#[command]
pub fn get_transcription_status(state: tauri::State<'_, TranscriptionState>) -> TranscriptionStatus {
    state.status.clone()
}

#[command]
pub fn get_transcription_result(state: tauri::State<'_, TranscriptionState>) -> Option<TranscriptionResult> {
    state.result.clone()
}

#[command]
pub fn save_audio_buffer(buffer: Vec<u8>, path: String) -> Result<(), String> {
    println!("Saving audio buffer to: {}", path);
    fs::write(&path, buffer).map_err(|e| format!("Failed to save audio buffer: {}", e))
}

#[command]
pub fn verify_file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptionOptions {
    pub audio_path: String,
    #[serde(default = "default_ignore_blank_audio")]
    pub ignore_blank_audio: bool,
}

fn default_ignore_blank_audio() -> bool { true }

#[command]
pub async fn transcribe_audio(app_handle: AppHandle, options: TranscriptionOptions) -> Result<String, String> {
    // This function seems unused and still calls convert_to_wav which doesn't exist
    let audio_path = options.audio_path.clone();
    println!("🎙️ Transcribing audio (DEPRECATED PATH): {}", audio_path);
    app_handle.emit_all("transcription_status_changed", TranscriptionStatus::Processing).ok();
    // ... rest of logic ...
    // --- This needs convert_to_wav_predictable OR should be deleted ---
    // match convert_to_wav_predictable(&audio_path, /* need output path */) { ... }
    Err("transcribe_audio function is deprecated/broken".to_string())
}

fn load_audio_data(_wav_path: &Path) -> Result<Vec<f32>, String> {
    // This seems unused
    Err("load_audio_data function is unused".to_string())
}

// REMOVED fn convert_to_wav(...)