// src-tauri/src/transcription.rs (Corrected)

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri::api::path::resource_dir;
use std::sync::atomic::{AtomicBool, Ordering};
use scopeguard;
use uuid::Uuid;
use crate::config; // Make sure this line is present
use crate::config::SETTINGS; // Import the global settings

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

// Add Default implementation for TranscriptionStatus
impl Default for TranscriptionStatus {
    fn default() -> Self {
        TranscriptionStatus::Idle
    }
}

// Transcription results (simplified, maybe not needed if state holds last text)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub model_used: String,
}

// Transcription state to store as app state - Simplified without paths
#[derive(Debug, Clone, Default)]
pub struct TranscriptionState {
    pub _status: TranscriptionStatus,
    pub _result: Option<TranscriptionResult>, // Store last successful result maybe?
}

// Check if Whisper binary is available
#[allow(dead_code)] // Not used directly but kept for potential future use
pub fn check_whisper_binary(whisper_binary_path: &PathBuf) -> bool {
    whisper_binary_path.exists()
}

// Check if a specific model exists
#[allow(dead_code)] // Not used directly but kept for potential future use
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
    auto_paste: bool // Keep flag as override parameter
) -> Result<String, String> {
    println!("\n\n[RUST DEBUG] >>> ENTERED transcribe_audio_file command function <<<");
    println!("[RUST DEBUG] Input audio path: {}", audio_path);
    println!("[RUST DEBUG] Auto paste flag (passed): {}", auto_paste);

    // Check if transcription is already in progress
    if TRANSCRIPTION_IN_PROGRESS.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        println!("[RUST DEBUG] Another transcription is already in progress, skipping this request");
        return Err("Another transcription is already in progress".to_string());
    }

    // Ensure lock is released even on panic
    scopeguard::defer!({
        TRANSCRIPTION_IN_PROGRESS.store(false, Ordering::SeqCst);
        println!("[RUST DEBUG] Transcription lock released via scopeguard");
    });

    // Get auto_paste setting from config if not provided
    let effective_auto_paste = {
        if !auto_paste {
            // If auto_paste is false in the command, use that
            false
        } else {
            // Otherwise, check the config setting
            let settings_guard = SETTINGS.lock().unwrap();
            settings_guard.auto_paste
        }
    };
    
    // Call the implementation with appropriate auto_paste
    let result = transcribe_local_audio_impl(audio_path, effective_auto_paste, app_handle).await;
    println!("[RUST DEBUG] transcribe_local_audio_impl completed. Success? {}", result.is_ok());
    
    result
}

// The main implementation function - now returns only the transcription text
pub async fn transcribe_local_audio_impl(
    wav_path_in: String,
    auto_paste: bool, // Renamed parameter to match command
    app_handle: AppHandle, // Keep app handle for emits
) -> Result<String, String> {
    println!("[RUST DEBUG] >>> ENTERED transcribe_local_audio_impl <<<");
    println!("[RUST DEBUG] Received initial WAV path: {}", wav_path_in);
    println!("[RUST DEBUG] Auto-paste enabled: {}", auto_paste);

    // --- Get settings from global config (model name, language only now) ---
    let (model_name_string, language_string) = {
        let settings_guard = config::SETTINGS.lock().unwrap();
        (settings_guard.model_name.clone(), settings_guard.language.clone())
    };
    println!("[RUST DEBUG transcription.rs] Using Model: '{}', Language: '{}'", model_name_string, language_string);

    // --- Resolve Paths (Debug vs Release) ---

    let whisper_binary_path: PathBuf;
    let model_path: PathBuf;
    let whisper_working_dir: PathBuf;

    if cfg!(debug_assertions) {
        // DEBUG MODE: Point to the source vendor directory using CARGO_MANIFEST_DIR
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")); // Path to src-tauri
        let vendor_dir = manifest_dir.join("vendor");

        println!("[RUST DEBUG transcription.rs] Detected DEBUG build. Using source vendor path: {}", vendor_dir.display());

        // --- Construct platform-specific binary name for DEBUG ---
        // This needs to match the actual file name required by the build script
        let binary_name = if cfg!(target_os = "windows") {
            // Assuming x86_64 MSVC build target, adjust if different
             "whisper-x86_64-pc-windows-msvc.exe"
        } else if cfg!(target_os = "macos") {
             // Assuming x86_64 or aarch64, adjust target triple as needed
             if cfg!(target_arch = "aarch64") {
                 "whisper-aarch64-apple-darwin"
             } else {
                 "whisper-x86_64-apple-darwin"
             }
        } else if cfg!(target_os = "linux") {
             // Assuming x86_64 GNU target, adjust target triple as needed
             "whisper-x86_64-unknown-linux-gnu"
        } else {
            // Fallback or error for unsupported OS during debug build
             panic!("Unsupported OS for debug build path construction");
        };

        whisper_binary_path = vendor_dir.join(binary_name);
        model_path = vendor_dir.join("models").join(&model_name_string);
        whisper_working_dir = vendor_dir.clone(); // Use vendor dir as CWD

        println!("[RUST DEBUG transcription.rs] DEBUG PATHS:");
        println!("  -> Binary: {}", whisper_binary_path.display());
        println!("  -> Model: {}", model_path.display());
        println!("  -> CWD: {}", whisper_working_dir.display());

    } else {
        // RELEASE MODE: Use Tauri's resource resolver
        // This part remains tricky and might need testing in a real release build.
        // We'll try resolving the external binary name relative to the resource dir.
        println!("[RUST DEBUG transcription.rs] Detected RELEASE build.");
        let resource_path = resource_dir(app_handle.package_info(), &app_handle.env())
            .ok_or_else(|| "Failed to resolve resource directory".to_string())?;
        println!("[RUST DEBUG transcription.rs] Resource Dir: {}", resource_path.display());

        // Construct the expected release binary name based on externalBin entry and target
        // Note: Tauri usually places externalBin next to the main executable,
        // NOT necessarily in the resource dir like resources.
        // Let's try getting the *executable's directory* instead.
        let exe_dir = std::env::current_exe()
             .ok().and_then(|p| p.parent().map(|p| p.to_path_buf()))
             .ok_or_else(|| "Could not determine executable directory in release build".to_string())?;

        println!("[RUST DEBUG transcription.rs] Executable Dir: {}", exe_dir.display());

        // Assume whisper binary is in the same directory as the main app executable in release
        let binary_name_release = if cfg!(target_os = "windows") {
            "whisper.exe" // In release, it should have the simple name next to app exe
        } else {
            "whisper" // No extension on Linux/macOS
        };

        whisper_binary_path = exe_dir.join(binary_name_release);
        // Models are still in the resource directory
        model_path = resource_path.join(format!("vendor/models/{}", model_name_string));
        whisper_working_dir = exe_dir.clone(); // Use exe dir as CWD? Or resource dir? Try exe dir.

        println!("[RUST DEBUG transcription.rs] RELEASE PATHS (Attempted):");
        println!("  -> Binary: {}", whisper_binary_path.display());
        println!("  -> Model: {}", model_path.display());
        println!("  -> CWD: {}", whisper_working_dir.display());
    }
    // --- End Path Resolution ---

    // --- Check if paths/files exist ---
    if !whisper_binary_path.exists() {
        let err_msg = format!("Bundled Whisper binary not found at: {}", whisper_binary_path.display());
        eprintln!("[RUST ERROR] {}", err_msg);
        let _ = app_handle.emit_all("fethr-transcription-error", &err_msg);
        return Err(err_msg);
    }
     if !model_path.exists() {
        let err_msg = format!("Bundled Whisper model not found at: {}", model_path.display());
        eprintln!("[RUST ERROR] {}", err_msg);
         let _ = app_handle.emit_all("fethr-transcription-error", &err_msg);
        return Err(err_msg);
    }
    // --- End Resource Path Resolution ---

    let input_wav_path = Path::new(&wav_path_in);
    let mut converted_wav_path_opt: Option<PathBuf> = None;

    // --- FFMPEG resampling logic ---
    let unique_id = Uuid::new_v4().to_string();
    let temp_dir = std::env::temp_dir();
    let converted_wav_path = temp_dir.join(format!("fethr_converted_{}.wav", unique_id));
    println!("[RUST DEBUG] Attempting FFmpeg resampling to: {}", converted_wav_path.display());

    match convert_to_wav_predictable(&wav_path_in, converted_wav_path.to_str().unwrap()) {
        Ok(_) => {
            println!("[RUST DEBUG] FFmpeg resampling successful.");
            converted_wav_path_opt = Some(converted_wav_path.clone());
        },
        Err(e) => {
            println!("[RUST DEBUG ERROR] FFmpeg resampling failed: {}. Proceeding with original.", e);
        }
    }

    // --- Determine which path to use ---
    let whisper_input_path_str = converted_wav_path_opt
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| {
            println!("[RUST WARNING] Using original (non-resampled) WAV for Whisper: {}", wav_path_in);
            wav_path_in.clone()
        });

    let whisper_input_path = Path::new(&whisper_input_path_str);

    if !whisper_input_path.exists() {
        let error_msg = format!("Whisper input file does not exist: {}", whisper_input_path.display());
        println!("[RUST ERROR] {}", error_msg);
        cleanup_files(input_wav_path, None::<&Path>);
        return Err(error_msg);
    }
    println!("[RUST DEBUG] Whisper will use input file: {}", whisper_input_path.display());

    // --- Prepare Whisper command ---
    println!("[RUST DEBUG] ========== STARTING WHISPER COMMAND (Bundled) ... ==========");
    println!("    Executable: {}", whisper_binary_path.display());
    println!("    Model: {}", model_path.display());
    println!("    Input WAV: {}", whisper_input_path.display());
    println!("    CWD: {}", whisper_working_dir.display());
    println!("    Language: {}", language_string);
    println!("    Flags: -nt"); // Assuming no timestamps needed
    println!("=========================================================================================");

    // --- Setup Whisper command ---
    let mut command = std::process::Command::new(&whisper_binary_path);
    command.current_dir(&whisper_working_dir) // Set CWD
           .arg("-m").arg(&model_path) // Pass model path
           .arg("-l").arg(&language_string) // Pass language
           .arg("-nt") // No timestamps flag
           .arg(&whisper_input_path); // Pass input audio AFTER flags

    // --- Run Whisper command and read output ---
    println!("[RUST DEBUG] Running Whisper with these args: {:?}", command.get_args().collect::<Vec<_>>());
    let output = match command.output() {
        Ok(output) => output,
        Err(e) => {
            let err_msg = format!("Failed to execute Whisper: {}", e);
            eprintln!("[RUST ERROR] {}", err_msg);
            cleanup_files(input_wav_path, converted_wav_path_opt.as_ref().map(|v| &**v));
            let _ = app_handle.emit_all("transcription_status_changed", TranscriptionStatus::Failed(err_msg.clone())); // Use snake_case
            return Err(err_msg);
        }
    };

    let exit_status = output.status;
    let stdout_bytes = output.stdout;
    let stderr_bytes = output.stderr;
    let stdout_text = String::from_utf8_lossy(&stdout_bytes).to_string();
    let stderr_text = String::from_utf8_lossy(&stderr_bytes).to_string();

    println!("[RUST DEBUG] Whisper exit status: {}", exit_status);
    println!("[RUST DEBUG] Whisper stdout: {}", stdout_text);
    println!("[RUST DEBUG] Whisper stderr: {}", stderr_text);

    // Clean up temporary files
    cleanup_files(input_wav_path, converted_wav_path_opt.as_ref().map(|v| &**v));

    // Process the result
    if exit_status.success() {
        // Process the output
        let trimmed_output = whisper_output_trim(&stdout_text);
        println!("[RUST DEBUG] Transcription successful. Result: {}", trimmed_output);
        let success_status = TranscriptionStatus::Complete { text: trimmed_output.clone() };
        let _ = app_handle.emit_all("transcription_status_changed", success_status); // Use snake_case event name

        // Note: Auto-paste is now handled in audio_manager_rs.rs
        if auto_paste {
            println!("[RUST DEBUG] Auto-paste is enabled but will be handled by the calling function.");
        } else {
            println!("[RUST DEBUG] Auto-paste is disabled.");
        }

        // Return the text
        Ok(trimmed_output)
    } else {
        // Non-zero exit code
        let error_msg = format!("Whisper command failed with status: {}. Stderr: {}. Stdout: {}", 
                              output.status, stderr_text.trim(), stdout_text.trim());
        println!("[RUST ERROR] {}", error_msg);
        Err(error_msg)
    }
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

// Helper to clean up the output from Whisper
fn whisper_output_trim(output: &str) -> String {
    // Trim leading/trailing whitespace, remove any [?] markers Whisper sometimes adds
    output.trim()
        .replace("[BLANK_AUDIO]", "")
        .replace("[SPEAKER]", "")
        .replace("[NOISE]", "")
        .trim()
        .to_string()
}