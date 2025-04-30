use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::{command, AppHandle, Manager};
use enigo::{Enigo, KeyboardControllable};
use tempfile::NamedTempFile;
use rubato::Resampler;
use std::sync::atomic::{AtomicBool, Ordering};
use scopeguard;
use chrono;
use std::io::Read;
use uuid::Uuid;

// Add a static flag to prevent multiple transcription processes
static TRANSCRIPTION_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

// Status structure to report transcription progress
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TranscriptionStatus {
    Idle,
    Downloading,
    Ready,
    Processing,
    Complete { text: String },
    Failed(String),
    Transcribing,
    Progress { progress: f32 },
    Done,
    Error(String),
}

// Transcription results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub duration: f32, // in seconds
    pub model_used: String,
}

// Transcription state to store as app state
#[derive(Debug, Clone)]
pub struct TranscriptionState {
    pub status: TranscriptionStatus,
    pub result: Option<TranscriptionResult>,
    pub whisper_directory: PathBuf,
    pub whisper_binary_path: PathBuf,
    pub whisper_model_directory: PathBuf,
    pub current_model: String,
}

impl Default for TranscriptionState {
    fn default() -> Self {
        Self {
            status: TranscriptionStatus::Idle,
            result: None,
            whisper_directory: PathBuf::new(),
            whisper_binary_path: PathBuf::new(),
            whisper_model_directory: PathBuf::new(),
            current_model: "tiny.en".to_string(), // Use tiny.en which is already installed
        }
    }
}

// Initialize the transcription state
pub fn init_transcription(app_handle: &AppHandle) -> Result<TranscriptionState, String> {
    // Use the custom location where whisper.exe is manually placed
    let whisper_directory = PathBuf::from("C:\\Users\\kaan\\.fethr");
    let whisper_model_directory = whisper_directory.join("models");
    
    // Manually placed whisper binary path
    let whisper_binary_path = whisper_directory.join("whisper.exe");
    
    println!("Using whisper binary at: {}", whisper_binary_path.display());
    println!("Using whisper models directory at: {}", whisper_model_directory.display());
    
    // Create the models directory if it doesn't exist
    fs::create_dir_all(&whisper_model_directory)
        .map_err(|e| format!("Failed to create whisper models directory: {}", e))?;
    
    // --- FIX: Use the default state --- 
    let mut state = TranscriptionState::default(); // Get default (should be tiny.en)
    // Assign the paths determined above
    state.whisper_directory = whisper_directory;
    state.whisper_binary_path = whisper_binary_path;
    state.whisper_model_directory = whisper_model_directory;
    println!("[RUST INIT] Initializing with model: {}", state.current_model); // Log which model is actually used
    // --- END FIX ---
    
    // Check if Whisper binary exists
    if !check_whisper_binary(&state) {
        let error_msg = format!("Whisper binary not found at {}", state.whisper_binary_path.display());
        app_handle.emit_all("transcription-status-changed", TranscriptionStatus::Failed(error_msg.clone()))
            .expect("Failed to emit transcription status");
        println!("{}", error_msg);
        return Err(error_msg);
    } else {
        println!("Whisper binary found at: {}", state.whisper_binary_path.display());
    }
    
    // Check if model exists (now checks for state.current_model which should be "tiny.en")
    let model_exists = check_model_exists(&state.whisper_model_directory, &state.current_model);
    if !model_exists {
        let error_msg = format!("Model '{}' not found in {}", state.current_model, state.whisper_model_directory.display());
        app_handle.emit_all("transcription-status-changed", TranscriptionStatus::Failed(error_msg.clone()))
            .expect("Failed to emit transcription status");
        println!("{}", error_msg);
        return Err(error_msg);
    } else {
        println!("Model found at: {}", state.whisper_model_directory.join(format!("ggml-{}.bin", state.current_model)).display());
        app_handle.emit_all("transcription-status-changed", TranscriptionStatus::Ready)
            .expect("Failed to emit transcription status");
    }
    
    Ok(state) // Return the correctly initialized state
}

// Check if Whisper binary is available
pub fn check_whisper_binary(state: &TranscriptionState) -> bool {
    let exists = Path::new(&state.whisper_binary_path).exists();
    println!("Checking whisper binary at {}: {}", state.whisper_binary_path.display(), exists);
    exists
}

// Check if a specific model exists
pub fn check_model_exists(model_directory: &PathBuf, model_name: &str) -> bool {
    let model_path = model_directory.join(format!("ggml-{}.bin", model_name));
    let exists = model_path.exists();
    println!("Checking model existence at {}: {}", model_path.display(), exists);
    exists
}

// Command to transcribe audio locally using the Whisper binary
#[command]
pub async fn transcribe_local_audio(
    app_handle: AppHandle,
    state: tauri::State<'_, TranscriptionState>,
) -> Result<String, String> {
    println!("\n\n RUST: >>> Entered NO-ARG transcribe_local_audio command function <<<");

    // Determine audio path internally
    let app_data_dir = app_handle.path_resolver().app_data_dir()
        .ok_or("Could not get app data dir")?;
    let audio_path = app_data_dir.join("temp_audio.wav").to_string_lossy().to_string();
    println!("[RUST DEBUG] Using internally determined audio path: {}", audio_path);

    // Hardcode auto_paste for this test
    let auto_paste = true;
    println!("[RUST DEBUG] Using hardcoded auto_paste: {}", auto_paste);

    // Check if transcription is already in progress
    if TRANSCRIPTION_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        println!("[RUST] Another transcription is already in progress, skipping this request");
        app_handle.emit_all("transcription-error", "Another transcription is already in progress").unwrap();
        return Err("Another transcription is already in progress".to_string());
    }

    // Emit status change ONCE with a unique identifier (before starting transcription)
    let _request_id = format!("req-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
    app_handle.emit_all("transcription-status-changed", TranscriptionStatus::Processing)
        .expect("Failed to emit transcription status");

    // Make sure to set the flag back to false when done, using drop guard pattern
    let _guard = scopeguard::guard((), |_| {
        TRANSCRIPTION_IN_PROGRESS.store(false, Ordering::SeqCst);
        println!("[RUST] Transcription lock released");
    });
    
    // Execute the actual transcription with our internally determined values
    let result = transcribe_local_audio_impl(app_handle, state, audio_path, auto_paste).await;
    
    // Return the original result
    result
}

// Helper function to convert to WAV with predictable output path
fn convert_to_wav_predictable(input_path: &str, output_path_str: &str) -> Result<(), String> {
    println!("[RUST FFMPEG] Converting {} to 16kHz WAV at {} with volume=2.0 boost", input_path, output_path_str);
    let ffmpeg_result = std::process::Command::new("ffmpeg")
        .arg("-y") // Overwrite output
        .arg("-i").arg(input_path) // Input is the backend WAV
        .arg("-ar").arg("16000") // **** Resample to 16kHz ****
        .arg("-ac").arg("1") // Ensure mono
        .arg("-c:a").arg("pcm_s16le") // Ensure 16-bit PCM
        .arg("-filter:a")
        .arg("volume=2.0") // Try volume=2.0 (6dB gain)
        .arg(output_path_str)
        .output();

    match ffmpeg_result {
        Ok(output) => {
            if output.status.success() {
                // Verify output file was created and has content
                match std::fs::metadata(output_path_str) {
                    Ok(m) if m.len() > 0 => {
                         println!("[RUST FFMPEG] Output file {} verified ({} bytes).", output_path_str, m.len());
                         Ok(())
                    },
                    Ok(_) => Err("FFmpeg created empty output file".to_string()),
                    Err(e) => Err(format!("Failed to verify FFmpeg output file: {}", e))
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("FFmpeg execution failed: {}", stderr))
            }
        },
        Err(e) => Err(format!("Failed to execute FFmpeg command: {}", e)),
    }
}

// New command that accepts a specific audio file path
#[tauri::command]
pub async fn transcribe_audio_file(
    app_handle: AppHandle,
    state: tauri::State<'_, TranscriptionState>,
    audio_path: String,
    auto_paste: bool
) -> Result<String, String> {
    println!("\n\n[RUST DEBUG] >>> ENTERED transcribe_audio_file command function <<<");
    println!("[RUST DEBUG] Input audio path: {}", audio_path);
    println!("[RUST DEBUG] Auto paste enabled: {}", auto_paste);

    // Check if transcription is already in progress
    if TRANSCRIPTION_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        println!("[RUST DEBUG] Another transcription is already in progress, skipping this request");
        app_handle.emit_all("transcription-error", "Another transcription is already in progress").unwrap();
        return Err("Another transcription is already in progress".to_string());
    }

    // Make sure to set the flag back to false when done
    let _guard = scopeguard::guard((), |_| {
        TRANSCRIPTION_IN_PROGRESS.store(false, Ordering::SeqCst);
        println!("[RUST DEBUG] Transcription lock released");
    });

    // Call the implementation with the provided audio path
    let result = transcribe_local_audio_impl(app_handle, state, audio_path, auto_paste).await;
    println!("[RUST DEBUG] transcribe_local_audio_impl completed. Success? {}", result.is_ok());
    result
}

// The main implementation function - now returns the transcription text
pub async fn transcribe_local_audio_impl(
    app_handle: AppHandle,
    state: tauri::State<'_, TranscriptionState>,
    audio_path: String, // This is the path from backend recording (e.g., 48kHz)
    _auto_paste: bool, // Mark unused if needed (or remove if config not needed)
) -> Result<String, String> {
    println!("[RUST DEBUG] >>> ENTERED transcribe_local_audio_impl <<<");
    println!("[RUST DEBUG] Received initial potentially high-sample-rate WAV path: {}", audio_path);

    let input_wav_path = Path::new(&audio_path);
    let mut converted_wav_path_opt: Option<PathBuf> = None; // Store converted path if created

    // --- Re-enable FFmpeg Resampling --- 
    let unique_id = Uuid::new_v4().to_string();
    let temp_dir = std::env::temp_dir();
    let converted_wav_path = temp_dir.join(format!("fethr_converted_{}.wav", unique_id));
    println!("[RUST DEBUG] Attempting FFmpeg resampling to 16kHz WAV at: {}", converted_wav_path.display());

    match convert_to_wav_predictable(&audio_path, converted_wav_path.to_str().unwrap()) {
        Ok(_) => {
            println!("[RUST DEBUG] FFmpeg resampling successful.");
            converted_wav_path_opt = Some(converted_wav_path.clone()); // Store path on success
        },
        Err(e) => {
            println!("[RUST DEBUG ERROR] FFmpeg resampling failed: {}. Proceeding with original file, Whisper might fail.", e);
            // Don't return early, let Whisper try the original file, but log the error
            // Cleanup will handle only the input path later if conversion fails
        }
    }
    // --- End FFmpeg Step ---

    // Determine which path to use for Whisper
    let whisper_input_path_str = converted_wav_path_opt
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| {
            println!("[RUST WARNING] Using original (non-resampled) WAV file for Whisper.");
            audio_path.clone() // Use original path if conversion failed
        });
    let whisper_input_path = Path::new(&whisper_input_path_str);

    // --- Prepare Whisper --- 
    // ... (Check binary, get model path using state.current_model, etc.) ...
    let model_path_str = state.whisper_model_directory
        .join(format!("ggml-{}.bin", state.current_model))
        .to_str()
        .ok_or_else(|| "Invalid UTF-8 in model path".to_string())?
        .to_string();
    let whisper_dir = state.whisper_binary_path.parent()
        .ok_or_else(|| "Could not get whisper binary directory".to_string())?;

    println!("[RUST DEBUG] ========== STARTING WHISPER COMMAND (stdout, explicit CWD, more sensitive params) ==========");
    println!("    Executable: {}", state.whisper_binary_path.display());
    println!("    Model: {}", model_path_str);
    println!("    Input WAV: {}", whisper_input_path.display()); // Use determined input path
    println!("    CWD: {}", whisper_dir.display());
    println!("    Language: en");
    println!("    Using: --output-stdout --verbose --no-speech-thold 0.1"); 
    println!("==========================================================================================");

    // --- Run Whisper --- 
    let mut command_builder = std::process::Command::new(&state.whisper_binary_path);
    command_builder.current_dir(whisper_dir)
                   .arg("--model")
                   .arg(&model_path_str)
                   .arg("--file")
                   .arg(&whisper_input_path_str) // USE DETERMINED INPUT PATH STRING
                   .arg("--language")
                   .arg("en")
                   .arg("--output-stdout")
                   .arg("--verbose")
                   .arg("--no-speech-thold")
                   .arg("0.1"); // Very low threshold (default is usually ~0.6)

    let output_result = command_builder.output();

    // --- Process Result --- 
    let transcription_result = match output_result {
        Ok(out) => {
            let duration = std::time::Instant::now().duration_since(std::time::Instant::now()).as_secs_f32();
            println!("[RUST DEBUG] Whisper completed in {:.2}s with status: {}", duration, out.status);

            // Always log stderr output for diagnostics
            let stderr_text = String::from_utf8_lossy(&out.stderr).to_string();
            if !stderr_text.is_empty() {
                println!("[RUST DEBUG] Whisper STDERR:\n{}", stderr_text);
            }

            if out.status.success() {
                let stdout_text = String::from_utf8_lossy(&out.stdout).to_string();
                println!("[RUST DEBUG] Whisper STDOUT Length: {}", stdout_text.len());
                // Log first few chars of stdout if long
                if stdout_text.len() > 100 {
                    println!("[RUST DEBUG] Whisper STDOUT Preview: '{}'...", stdout_text.chars().take(100).collect::<String>());
                } else {
                    println!("[RUST DEBUG] Whisper STDOUT: '{}'", stdout_text);
                }

                let transcription_text = stdout_text.trim();

                // Check for empty or generic success message
                if transcription_text.is_empty() || transcription_text == "Whisper transcription completed successfully." {
                    println!("[RUST WARNING] Whisper produced no real text output via stdout.");
                    Err("Whisper produced no text output".to_string()) 
                } else {
                    println!("[RUST] Transcription OK via stdout: '{}'...", transcription_text.chars().take(50).collect::<String>());
                    Ok(transcription_text.to_string())
                }
            } else {
                // Handle Whisper execution error (non-zero exit code)
                let error_msg = format!("Whisper execution failed with status {}: {}", out.status, stderr_text);
                println!("[RUST ERROR] {}", error_msg);
                Err(error_msg)
            }
        },
        Err(e) => {
            // Handle failure to execute the command itself
            let error_msg = format!("Failed to execute whisper command: {}", e);
            println!("[RUST ERROR] {}", error_msg);
            Err(error_msg)
        }
    };

    // --- Cleanup --- 
    println!("[RUST DEBUG] Cleaning up temporary files...");
    // Pass original path and Option<&Path> for converted path
    cleanup_files(input_wav_path, converted_wav_path_opt.as_deref());
    println!("[RUST DEBUG] Temporary files cleanup attempted.");

    transcription_result
}

// Helper function to clean up temporary WAV file only
fn cleanup_files(original_temp_wav: &Path, converted_temp_wav: Option<&Path>) {
    println!("[RUST CLEANUP] Cleaning up files... Original: {:?}, Converted: {:?}", 
        original_temp_wav.display(), 
        converted_temp_wav.map(|p| p.display().to_string()).unwrap_or_else(|| "None".to_string()));
    
    if let Some(converted_path) = converted_temp_wav {
        if converted_path.exists() {
            // UNCOMMENT cleanup logic for converted file
            match std::fs::remove_file(converted_path) {
                Ok(_) => println!("[RUST CLEANUP] Removed converted: {}", converted_path.display()),
                Err(e) => println!("[RUST CLEANUP WARNING] Failed to remove converted file {}: {}", converted_path.display(), e),
            }
        } else {
            println!("[RUST CLEANUP] Converted file not found, skipping removal: {}", converted_path.display());
        }
    }
    
    // Always try to remove the original temp wav from backend recording
    if original_temp_wav.exists() {
        // UNCOMMENT cleanup logic for original file
        match std::fs::remove_file(original_temp_wav) {
            Ok(_) => println!("[RUST CLEANUP] Removed original backend temp: {}", original_temp_wav.display()),
            Err(e) => println!("[RUST CLEANUP WARNING] Failed to remove original backend temp file {}: {}", original_temp_wav.display(), e),
        }
    } else {
        println!("[RUST CLEANUP] Original backend temp file not found, skipping removal: {}", original_temp_wav.display());
    }
}

// Helper function to paste text using Enigo
pub async fn paste_text_to_cursor(text: &str) -> Result<(), String> {
    // Small delay to ensure the user has returned to the target application
    tokio::time::sleep(Duration::from_millis(500)).await;
    
    let mut enigo = Enigo::new();
    
    // We'll try to use clipboard for pasting
    match clipboard_copy_paste(text) {
        Ok(_) => {
            // Perform paste shortcut
            if cfg!(target_os = "macos") {
                enigo.key_down(enigo::Key::Meta);
                enigo.key_click(enigo::Key::Layout('v'));
                enigo.key_up(enigo::Key::Meta);
            } else {
    enigo.key_down(enigo::Key::Control);
    enigo.key_click(enigo::Key::Layout('v'));
    enigo.key_up(enigo::Key::Control);
            }
            Ok(())
        }
        Err(e) => Err(format!("Failed to paste text: {}", e))
    }
}

// Helper function to copy text to clipboard
fn clipboard_copy_paste(text: &str) -> Result<(), String> {
    // Copy to clipboard using arboard
    #[cfg(not(target_os = "linux"))]
    {
        let mut clipboard = arboard::Clipboard::new()
            .map_err(|e| format!("Failed to initialize clipboard: {}", e))?;
        
        clipboard.set_text(text.to_string())
            .map_err(|e| format!("Failed to set clipboard text: {}", e))?;
    }
    
    // For Linux, we'll use xclip if available
    #[cfg(target_os = "linux")]
    {
        let mut child = Command::new("xclip")
            .arg("-selection")
            .arg("clipboard")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn xclip: {}", e))?;
        
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(text.as_bytes())
                .map_err(|e| format!("Failed to write to xclip: {}", e))?;
        }
        
        child.wait()
            .map_err(|e| format!("xclip failed: {}", e))?;
    }
    
    Ok(())
}

// Get current transcription status
#[command]
pub fn get_transcription_status(state: tauri::State<'_, TranscriptionState>) -> TranscriptionStatus {
    state.status.clone()
}

// Get last transcription result
#[command]
pub fn get_transcription_result(state: tauri::State<'_, TranscriptionState>) -> Option<TranscriptionResult> {
    state.result.clone()
}

// Save audio buffer to a temporary file
#[command]
pub fn save_audio_buffer(buffer: Vec<u8>, path: String) -> Result<(), String> {
    println!("Saving audio buffer to: {}", path);
    fs::write(&path, buffer)
        .map_err(|e| format!("Failed to save audio buffer: {}", e))
}

#[command]
pub fn verify_file_exists(path: String) -> bool {
    let path_obj = Path::new(&path);
    let exists = path_obj.exists();
    println!("[RUST] Verifying file exists at {}: {}", path, exists);
    exists
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptionOptions {
    pub audio_path: String,
    #[serde(default = "default_ignore_blank_audio")]
    pub ignore_blank_audio: bool,
}

// Default function for ignore_blank_audio - default to true
fn default_ignore_blank_audio() -> bool {
    true
}

// Transcribe audio file
#[tauri::command]
pub async fn transcribe_audio(app_handle: AppHandle, options: TranscriptionOptions) -> Result<String, String> {
    let audio_path = options.audio_path.clone();
    println!("🎙️ Transcribing audio: {}", audio_path);
    
    // Emit transcription status
    app_handle.emit_all("transcription-status-changed", TranscriptionStatus::Progress { progress: 0.0 })
        .map_err(|e| format!("Failed to emit transcription status: {:?}", e))?;
    
    // Check file size
    let file_metadata = match fs::metadata(&audio_path) {
        Ok(metadata) => metadata,
        Err(e) => {
            let err_msg = format!("Failed to get metadata for audio file: {:?}", e);
            app_handle.emit_all("transcription-status-changed", TranscriptionStatus::Failed(err_msg.clone()))
                .map_err(|e| format!("Failed to emit transcription status: {:?}", e))?;
            return Err(err_msg);
        }
    };
    
    // Skip processing for empty files
    if file_metadata.len() == 0 {
        let err_msg = "Audio file is empty".to_string();
        app_handle.emit_all("transcription-status-changed", TranscriptionStatus::Failed(err_msg.clone()))
            .map_err(|e| format!("Failed to emit transcription status: {:?}", e))?;
        return Err(err_msg);
    }
    
    println!("Converting audio to WAV format");
    // Convert WebM to WAV
    match convert_to_wav(&audio_path) {
        Ok(wav_path) => {
            // Call the whisper module's transcribe_audio function
            let wav_path_str = wav_path.to_string_lossy().to_string();
            let result = crate::whisper::whisper_transcribe_audio(app_handle.clone(), wav_path_str).await;
            
            // Clean up temp WAV file
            if let Err(e) = fs::remove_file(&wav_path) {
                println!("Warning: Failed to delete temp WAV file: {:?}", e);
            }
            
            match result {
                Ok(json_result) => {
                    // Extract the text from the JSON result
                    if let Some(text) = json_result.get("text").and_then(|t| t.as_str()) {
                        let text_string = text.to_string();
                        
                        // Emit complete status
                        app_handle.emit_all("transcription-status-changed", TranscriptionStatus::Complete { text: text_string.clone() })
                            .map_err(|e| format!("Failed to emit transcription status: {:?}", e))?;
                        
                        // Return the transcribed text
                        Ok(text_string)
                    } else {
                        let err_msg = "Transcription result did not contain text".to_string();
                        app_handle.emit_all("transcription-status-changed", TranscriptionStatus::Failed(err_msg.clone()))
                            .map_err(|e| format!("Failed to emit transcription status: {:?}", e))?;
                        Err(err_msg)
                    }
                }
                Err(e) => {
                    app_handle.emit_all("transcription-status-changed", TranscriptionStatus::Failed(e.clone()))
                        .map_err(|e| format!("Failed to emit transcription status: {:?}", e))?;
                    Err(e)
                }
            }
        }
        Err(e) => {
            let err_msg = format!("Failed to convert audio to WAV: {:?}", e);
            app_handle.emit_all("transcription-status-changed", TranscriptionStatus::Failed(err_msg.clone()))
                .map_err(|e| format!("Failed to emit transcription status: {:?}", e))?;
            Err(err_msg)
        }
    }
}

/**
 * Load WAV audio data for Whisper
 * 
 * What it does: Loads and prepares audio data for processing with Whisper
 * Why it exists: To convert WAV audio files to the format required by Whisper
 */
fn load_audio_data(wav_path: &Path) -> Result<Vec<f32>, String> {
    // Load the audio file
    println!("Loading audio data from: {}", wav_path.display());
    let audio_data = match std::fs::read(wav_path) {
        Ok(data) => data,
        Err(e) => return Err(format!("Failed to read audio file: {:?}", e))
    };
    
    // Parse WAV header
    let mut wav = match audrey::read::Reader::new(std::io::Cursor::new(audio_data)) {
        Ok(wav) => wav,
        Err(e) => return Err(format!("Failed to parse WAV: {:?}", e))
    };
    
    // Get WAV specifications
    let spec = wav.description();
    let sample_rate = spec.sample_rate() as usize;
    let channels = spec.channel_count() as usize;
    
    println!("Audio specs: {} channels, {} Hz", channels, sample_rate);
    
    // Convert to mono f32 samples (using an average of all channels)
    let samples: Vec<f32> = wav
        .samples()
        .map(|s| s.unwrap())
        .collect();
    
    // Resample to 16kHz if necessary
    if sample_rate != 16000 {
        println!("Resampling from {} Hz to 16000 Hz", sample_rate);
        let mut resampler: rubato::FftFixedIn<f32> = rubato::FftFixedIn::new(
            sample_rate,
            16000,
            4096,
            2,
            channels,
        ).map_err(|e| format!("Failed to create resampler: {:?}", e))?;
        
        // Process samples in chunks
        let mut input_buffer = vec![Vec::new(); channels];
        let chunk_size = 4096;
        let mut output_vec = Vec::new();
        
        for chunk in samples.chunks(chunk_size * channels) {
            // Prepare input buffers
            for c in 0..channels {
                input_buffer[c].clear();
                input_buffer[c].extend(chunk.iter().skip(c).step_by(channels));
            }
            
            // Resample chunk
            let resampled_chunk = resampler.process(&input_buffer, None)
                .map_err(|e| format!("Failed to resample: {:?}", e))?;
            
            // Flatten to single channel (average of all channels)
            let resampled_mono: Vec<f32> = (0..resampled_chunk[0].len())
                .map(|i| {
                    let mut sum = 0.0;
                    for c in 0..channels {
                        sum += resampled_chunk[c][i];
                    }
                    sum / channels as f32
                })
                .collect();
            
            output_vec.extend_from_slice(&resampled_mono);
        }
        
        Ok(output_vec)
    } else if channels > 1 {
        // Just convert to mono by averaging channels (no resampling needed)
        println!("Converting to mono");
        let mono_samples: Vec<f32> = (0..samples.len() / channels)
            .map(|i| {
                let mut sum = 0.0;
                for c in 0..channels {
                    sum += samples[i * channels + c];
                }
                sum / channels as f32
            })
            .collect();
        Ok(mono_samples)
    } else {
        // Already mono and 16kHz, return as is
        Ok(samples)
    }
}

/**
 * Convert audio file to WAV
 * 
 * What it does: Converts the input audio file to WAV format using FFmpeg
 * Why it exists: To prepare audio for transcription with Whisper
 */
fn convert_to_wav(input_path: &str) -> Result<PathBuf, String> {
    // Create a temporary file to store the WAV output
    let output_file = NamedTempFile::new()
        .map_err(|e| format!("Failed to create temporary file: {:?}", e))?;
    let output_path = output_file.path().to_path_buf();
    
    // Close the file so FFmpeg can write to it
    let output_path_str = output_path.to_str().ok_or("Invalid output path")?;
    
    println!("Converting {} to WAV format at {}", input_path, output_path_str);
    
    // Set up FFmpeg command with optimized settings for speech
    let ffmpeg_result = Command::new("ffmpeg")
        .arg("-y") // Overwrite output file if exists
        .arg("-i").arg(input_path) // Input file
        .arg("-ar").arg("16000") // Set sample rate to 16kHz
        .arg("-ac").arg("1") // Convert to mono
        .arg("-c:a").arg("pcm_s16le") // 16-bit PCM
        .arg("-af").arg("highpass=f=80,lowpass=f=7500") // Filter frequencies for better speech recognition
        .arg(output_path_str) // Output file
        .output();
    
    match ffmpeg_result {
        Ok(output) => {
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("FFmpeg failed: {}", stderr))
            } else {
                Ok(output_path)
            }
        },
        Err(e) => Err(format!("Failed to execute FFmpeg: {:?}", e))
    }
} 