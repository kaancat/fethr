use std::path::Path;
use std::fs;
use std::process::Command;
use tauri::{command, AppHandle, Manager};
use serde_json::{self, Value};
use std::io::Write;

// Fixed paths for Whisper executable and model
const WHISPER_EXECUTABLE_PATH: &str = r"C:\Users\kaan\.fethr\whisper.exe";
const WHISPER_MODEL_PATH: &str = r"C:\Users\kaan\.fethr\models\ggml-tiny.en.bin";

// Check if Whisper is installed (executable exists)
#[command]
pub fn is_whisper_installed() -> bool {
    println!("Checking whisper binary at {}: {}", WHISPER_EXECUTABLE_PATH, Path::new(WHISPER_EXECUTABLE_PATH).exists());
    println!("Checking model existence at {}: {}", WHISPER_MODEL_PATH, Path::new(WHISPER_MODEL_PATH).exists());
    Path::new(WHISPER_EXECUTABLE_PATH).exists() && Path::new(WHISPER_MODEL_PATH).exists()
}

/**
 * Save an audio buffer to a file
 * 
 * What it does: Saves audio data to a WAV file for transcription
 * Why it exists: To create a file from audio buffer for Whisper processing
 */
#[command]
pub fn whisper_save_audio_buffer(audio_data: Vec<u8>, file_path: String) -> Result<String, String> {
    println!("Saving audio buffer to: {}", file_path);
    
    // Create the parent directories if they don't exist
    if let Some(parent) = Path::new(&file_path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directories: {}", e))?;
        }
    }
    
    // Write the audio data to the file
    let mut file = fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create audio file: {}", e))?;
    
    file.write_all(&audio_data)
        .map_err(|e| format!("Failed to write audio data: {}", e))?;
    
    // Verify the file exists and has the correct size
    match fs::metadata(&file_path) {
        Ok(metadata) => {
            let size = metadata.len();
            println!("Successfully saved audio buffer ({} bytes) to {}", size, file_path);
            
            if size != audio_data.len() as u64 {
                return Err(format!("Audio file size mismatch: expected {}, got {}", audio_data.len(), size));
            }
            
            Ok(file_path)
        },
        Err(e) => Err(format!("Failed to verify audio file: {}", e))
    }
}

// Simple function to transcribe audio using Whisper
#[command]
pub async fn whisper_transcribe_audio(app_handle: AppHandle, audio_path: String) -> Result<Value, String> {
    println!("\n========== TRANSCRIPTION PROCESS STARTED ==========");
    println!("[RUST] Received audio_path: {}", audio_path);
    
    // Convert to absolute path to avoid issues with relative paths
    let absolute_path = std::fs::canonicalize(&audio_path)
        .map_err(|e| format!("Failed to get absolute path: {}", e))?;
    println!("[RUST] Absolute audio path: {}", absolute_path.display());
    
    // Validate executable and model exist
    if !Path::new(WHISPER_EXECUTABLE_PATH).exists() {
        let error_msg = format!("Whisper executable not found at: {}", WHISPER_EXECUTABLE_PATH);
        app_handle.emit_all("transcription-error", &error_msg).unwrap();
        return Err(error_msg);
    }
    println!("[RUST] Whisper binary path: {}", WHISPER_EXECUTABLE_PATH);
    println!("Checking whisper binary at {}: {}", WHISPER_EXECUTABLE_PATH, Path::new(WHISPER_EXECUTABLE_PATH).exists());
    println!("[RUST] Whisper binary exists: {}", if Path::new(WHISPER_EXECUTABLE_PATH).exists() { "✓" } else { "❌" });

    if !Path::new(WHISPER_MODEL_PATH).exists() {
        let error_msg = format!("Whisper model not found at: {}", WHISPER_MODEL_PATH);
        app_handle.emit_all("transcription-error", &error_msg).unwrap();
        return Err(error_msg);
    }
    println!("[RUST] Model path: {}", WHISPER_MODEL_PATH);
    println!("Checking model existence at {}: {}", WHISPER_MODEL_PATH, Path::new(WHISPER_MODEL_PATH).exists());
    println!("[RUST] Model exists: {}", if Path::new(WHISPER_MODEL_PATH).exists() { "✓" } else { "❌" });

    // Validate audio file exists and has content
    if !Path::new(&audio_path).exists() {
        let error_msg = format!("Audio file not found at: {}", audio_path);
        app_handle.emit_all("transcription-error", &error_msg).unwrap();
        return Err(error_msg);
    }
    println!("[RUST] Audio file exists: {}", if Path::new(&audio_path).exists() { "✓" } else { "❌" });
    
    // Check file size to ensure it has content
    let file_size = match fs::metadata(&audio_path) {
        Ok(metadata) => metadata.len(),
        Err(e) => {
            let error_msg = format!("Failed to get audio file metadata: {}", e);
            app_handle.emit_all("transcription-error", &error_msg).unwrap();
            return Err(error_msg);
        }
    };
    println!("[RUST] Audio file size: {} bytes", file_size);
    
    if file_size == 0 {
        let error_msg = format!("Audio file is empty: {}", audio_path);
        app_handle.emit_all("transcription-error", &error_msg).unwrap();
        return Err(error_msg);
    }
    println!("[RUST] Audio file has content: ✓");
    
    // Emit event that transcription has started
    app_handle.emit_all("transcription-status", serde_json::json!({
        "status": "Processing"
    })).unwrap();
    println!("[RUST] Emitted 'Processing' status: ✓");
    
    // Run the Whisper executable with appropriate parameters
    println!("[RUST] Executing whisper.exe...");
    let start_time = std::time::Instant::now();
    
    // Explicitly build and log the full command for debugging
    let full_command = format!(
        "{} --model {} --file {} --language en --output-stdout",
        WHISPER_EXECUTABLE_PATH, WHISPER_MODEL_PATH, audio_path
    );
    println!("[RUST] Full command: {}", full_command);
    
    // Run whisper with --output-stdout to get transcription directly
    let output = Command::new(WHISPER_EXECUTABLE_PATH)
        .args(&[
            "--model", WHISPER_MODEL_PATH,
            "--file", &audio_path,
            "--language", "en",
            "--output-stdout"  // This is critical - get output directly instead of writing to a file
        ])
        .output()
        .map_err(|e| format!("Failed to execute whisper.exe: {}", e))?;
    
    let elapsed = start_time.elapsed();
    println!("[RUST] Whisper execution took {:.2} seconds", elapsed.as_secs_f64());
    
    // Log execution status
    println!("[RUST] Exit status: {}", output.status);
    
    // Get the text from stdout
    let stdout_text = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr_text = String::from_utf8_lossy(&output.stderr).to_string();
    
    println!("[RUST] === STDOUT START ===");
    println!("[RUST STDOUT] {}", stdout_text);
    println!("[RUST] === STDOUT END ===");
    
    println!("[RUST] === STDERR START ===");
    println!("[RUST STDERR] {}", stderr_text);
    println!("[RUST] === STDERR END ===");
    
    // Check if command execution succeeded
    if !output.status.success() {
        let error_msg = format!("Transcription failed: {}", stderr_text);
        app_handle.emit_all("transcription-error", &error_msg).unwrap();
        return Err(error_msg);
    }
    
    // Extract the transcription text from stdout
    let transcription_text = if stdout_text.trim().is_empty() {
        println!("[RUST] Warning: Whisper stdout is empty, checking for other output");
        
        // Create a fallback message if no transcription was found
        "Sorry, I couldn't transcribe that audio. Please try speaking more clearly or in a quieter environment.".to_string()
    } else {
        // Clean up the text and use it
        stdout_text.trim().to_string()
    };
    
    println!("[RUST] Transcription text: {}", 
             if transcription_text.len() > 100 { &transcription_text[0..100] } else { &transcription_text });
    
    // Try to paste the text to the cursor position
    println!("[RUST] Attempting to paste text to cursor position");
    if let Err(paste_err) = crate::transcription::paste_text_to_cursor(&transcription_text).await {
        println!("[RUST] Failed to paste text to cursor: {}", paste_err);
        
        // As a fallback, emit the copy-to-clipboard event which will show the fallback UI
        app_handle.emit_all("copy-to-clipboard", serde_json::json!({
            "text": transcription_text.clone()
        })).unwrap();
        println!("[RUST] Emitted copy-to-clipboard event as fallback");
    } else {
        println!("[RUST] Successfully pasted text to cursor");
    }
    
    // Emit transcription result event
    app_handle.emit_all("transcription-result", serde_json::json!({
        "text": transcription_text.clone()
    })).unwrap();
    
    // Return transcription result
    Ok(serde_json::json!({
        "text": transcription_text
    }))
}

// Initialize whisper module
pub fn init(_app_handle: &AppHandle) -> Result<(), String> {
    // Check if Whisper executable exists
    if !Path::new(WHISPER_EXECUTABLE_PATH).exists() {
        return Err(format!("Whisper executable not found at: {}", WHISPER_EXECUTABLE_PATH));
    }
    
    // Check if Whisper model exists
    if !Path::new(WHISPER_MODEL_PATH).exists() {
        return Err(format!("Whisper model not found at: {}", WHISPER_MODEL_PATH));
    }
    
    println!("Using whisper binary at: {}", WHISPER_EXECUTABLE_PATH);
    println!("Using whisper models directory at: {}", Path::new(WHISPER_MODEL_PATH).parent().unwrap_or(Path::new("")).display());
    
    Ok(())
} 