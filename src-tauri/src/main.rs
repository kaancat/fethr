#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{Manager, GlobalShortcutManager};
use std::path::{Path, PathBuf};
use std::fs::{self, File};
use std::io::BufWriter;
use std::sync::{Arc, Mutex};
use std::sync::mpsc;
use std::thread;
use arboard;
use std::time::Duration;
use enigo::{Enigo, Key, Settings, Direction, Keyboard};

// Import our modules
mod transcription;
mod whisper;
mod audio_manager_rs;

// Import necessary types from submodules if they are public and needed here
// Example: use crate::transcription::SomePublicType;

// Define the state struct
#[derive(Default)]
pub struct AudioRecordingState {
    pub stop_signal_sender: Option<mpsc::Sender<()>>,
    pub recording_thread_handle: Option<thread::JoinHandle<()>>,
    pub temp_wav_path: Option<PathBuf>,
    pub is_actively_recording: bool,
    pub writer: Option<Arc<Mutex<hound::WavWriter<BufWriter<File>>>>>,
}

// Type alias for the managed state
pub type SharedRecordingState = Arc<Mutex<AudioRecordingState>>;

// Key state for tracking press/release (Currently unused but keep for now)
#[derive(Default)]
struct KeyState {
    all_pressed: bool,
}

// Command to paste text to cursor position
#[tauri::command]
async fn paste_text_to_cursor(text: String) -> Result<(), String> { // `text` arg currently unused
    println!("[RUST PASTE] Received request to paste text.");
    tokio::time::sleep(Duration::from_millis(200)).await;

    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(e) => e,
        Err(err) => {
            println!("[RUST PASTE ERROR] Failed to create Enigo instance: {:?}", err);
            return Err("Failed to initialize Enigo".to_string());
        }
    };

    println!("[RUST PASTE] Simulating paste shortcut...");

    // Platform-specific paste simulation
    #[cfg(target_os = "macos")]
    {
        // Call the 'key' method with specific directions for v0.2.0
        enigo.key(Key::Meta, Direction::Press);
        enigo.key(Key::Unicode('v'), Direction::Click);
        enigo.key(Key::Meta, Direction::Release);
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Call the 'key' method with specific directions for v0.2.0
        enigo.key(Key::Control, Direction::Press);
        enigo.key(Key::Unicode('v'), Direction::Click);
        enigo.key(Key::Control, Direction::Release);
    }

    println!("[RUST PASTE] Paste simulation complete.");
    Ok(())
}

// Command to emit an event to all windows
#[tauri::command]
fn emit_event(app_handle: tauri::AppHandle, event: String, payload: serde_json::Value) -> Result<(), String> {
    app_handle.emit_all(&event, payload).map_err(|e| format!("Failed to emit event {}: {}", event, e))
}

// --- Refactored Clipboard Logic ---
pub async fn write_to_clipboard_internal(text_to_copy: String) -> Result<(), String> {
    println!("[RUST CLIPBOARD INTERNAL] Attempting to write to clipboard via arboard...");
    match arboard::Clipboard::new() {
        Ok(mut clipboard) => match clipboard.set_text(text_to_copy) {
            Ok(_) => { println!("[RUST CLIPBOARD INTERNAL] Successfully wrote text to clipboard."); Ok(()) },
            Err(e) => { let err_msg = format!("arboard failed to set text: {}", e); println!("[RUST CLIPBOARD ERROR] {}", err_msg); Err(err_msg) }
        },
        Err(e) => { let err_msg = format!("Failed to initialize arboard clipboard: {}", e); println!("[RUST CLIPBOARD ERROR] {}", err_msg); Err(err_msg) }
    }
}
#[tauri::command]
async fn write_to_clipboard_command(text_to_copy: String) -> Result<(), String> {
    println!("[RUST CLIPBOARD COMMAND] Received request.");
    write_to_clipboard_internal(text_to_copy).await
}
// --- End Refactored Clipboard Logic ---

fn main() {
    println!("Fethr startup - v{}", env!("CARGO_PKG_VERSION"));

    tauri::Builder::default()
        .setup(|app| {
            // Initialize transcription state (using the public function from the module)
            let transcription_state = transcription::init_transcription(&app.handle())?;
            app.manage(transcription_state); // Manage the state returned by the function

            let recording_state_inner = AudioRecordingState::default();
            let recording_state: SharedRecordingState = Arc::new(Mutex::new(recording_state_inner));
            app.manage(recording_state);

            // --- Initialize Hotkey ---
            let app_handle_clone = app.handle();
            let mut shortcut_manager = app.global_shortcut_manager();
             println!("Attempting to register Ctrl+Shift+A hotkey...");
             shortcut_manager.register("Ctrl+Shift+A", move || {
                 println!("Hotkey Ctrl+Shift+A pressed, emitting hotkey-pressed event");
                 let _ = app_handle_clone.emit_all("hotkey-pressed", ());
             }).unwrap_or_else(|e| {
                  println!("Failed to register primary hotkey: {}. Trying alternatives...", e);
                  // TODO: Alternative registration logic
             });
            // --- End Hotkey Init ---

             // Show window
            if let Some(window) = app.get_window("main") {
                println!("Showing main window");
                window.show().unwrap();
                window.set_focus().unwrap();
            } else { println!("Main window not found!"); }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            transcription::transcribe_audio_file,
            transcription::get_transcription_status,
            transcription::get_transcription_result,
            transcription::save_audio_buffer,
            transcription::verify_file_exists,
            whisper::is_whisper_installed,
            whisper::whisper_transcribe_audio, // Keep if potentially used? Otherwise remove
            whisper::whisper_save_audio_buffer, // Keep if potentially used? Otherwise remove
            emit_event,
            delete_file, // Keep this command
            audio_manager_rs::start_backend_recording,
            audio_manager_rs::stop_backend_recording,
            write_to_clipboard_command, // Correct registration
            paste_text_to_cursor // Correct registration
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Fethr application");
}


#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() { return Ok(()); }
    fs::remove_file(path).map_err(|e| format!("Failed to delete file: {:?}", e))
}