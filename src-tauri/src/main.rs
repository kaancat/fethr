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

// Import our modules
mod transcription;
mod whisper;
// mod audio_manager; // REMOVED: Old unused module
mod audio_manager_rs; // New module for backend recording
mod config_manager;
mod setup;
mod tray_manager;
mod hotkey_manager; // Assuming hotkey registration might still be needed

// Only import what we actually use directly in this file

// Define the state struct
#[derive(Default)]
pub struct AudioRecordingState {
    // To signal the recording thread to stop
    pub stop_signal_sender: Option<mpsc::Sender<()>>,
    // To wait for the recording thread to finish
    pub recording_thread_handle: Option<thread::JoinHandle<()>>,
    // Path where the WAV is being written (set by start, read by stop)
    pub temp_wav_path: Option<PathBuf>,
    // Simple flag managed synchronously by start/stop commands
    pub is_actively_recording: bool,
    // The WAV writer, wrapped in Arc<Mutex> for thread-safe access
    pub writer: Option<Arc<Mutex<hound::WavWriter<BufWriter<File>>>>>,
}

// Type alias for the managed state
pub type SharedRecordingState = Arc<Mutex<AudioRecordingState>>;

// Key state for tracking press/release
#[derive(Default)]
struct KeyState {
    // Only track the combined state of Ctrl+Shift+A
    all_pressed: bool,
}

// Command to paste text to cursor position
#[tauri::command]
async fn paste_text_to_cursor(text: String) -> Result<(), String> {
    // Reuse the transcription module's helper function
    transcription::paste_text_to_cursor(&text).await
}

// Command to emit an event to all windows
#[tauri::command]
fn emit_event(app_handle: tauri::AppHandle, event: String, payload: serde_json::Value) -> Result<(), String> {
    app_handle
        .emit_all(&event, payload)
        .map_err(|e| format!("Failed to emit event {}: {}", event, e))
}

// Define a struct to hold the application state
pub struct AppState {
    pub audio_manager: Arc<Mutex<AudioManager>>,
    // pub hotkey_manager: Arc<Mutex<hotkey_manager::HotkeyManager>>, // If used
    pub transcription_state: Arc<Mutex<TranscriptionState>>,
}

// New command for clipboard writing
#[tauri::command]
async fn write_to_clipboard_rust(text_to_copy: String) -> Result<(), String> {
    println!("[RUST CLIPBOARD] Attempting to write to clipboard via arboard...");
    match arboard::Clipboard::new() {
        Ok(mut clipboard) => {
            match clipboard.set_text(text_to_copy) {
                Ok(_) => {
                    println!("[RUST CLIPBOARD] Successfully wrote text to clipboard.");
                    Ok(())
                },
                Err(e) => {
                    let err_msg = format!("arboard failed to set text: {}", e);
                    println!("[RUST CLIPBOARD ERROR] {}", err_msg);
                    Err(err_msg)
                }
            }
        },
        Err(e) => {
            let err_msg = format!("Failed to initialize arboard clipboard: {}", e);
            println!("[RUST CLIPBOARD ERROR] {}", err_msg);
            Err(err_msg)
        }
    }
}

// This function initializes the application
// What it does: Sets up the main window, system tray, and event handlers
// Why it exists: To provide the entry point for the Tauri application
fn main() {
    println!("Fethr startup - v{}", env!("CARGO_PKG_VERSION"));
    
    // Create app with all the tauri features and commands
    tauri::Builder::default()
        .setup(|app| {
            // Initialize transcription state
            let state = transcription::init_transcription(&app.handle())?;
            
            // Register transcription state
            app.manage(state);
            
            // Initialize and register recording state
            // Explicitly set the default state values
            let recording_state_inner = AudioRecordingState {
                stop_signal_sender: None,
                recording_thread_handle: None,
                temp_wav_path: None,
                is_actively_recording: false, // Be explicit
                writer: None,
            };
            let recording_state: SharedRecordingState = Arc::new(Mutex::new(recording_state_inner));
            app.manage(recording_state);
            
            // Explicitly show the main window
            if let Some(window) = app.get_window("main") {
                println!("Showing main window");
                window.show().unwrap();
                window.set_focus().unwrap();
            } else {
                println!("Main window not found!");
            }
            
            // Register global shortcut for Ctrl+Shift+A
            let app_handle = app.handle();
            let mut shortcut_manager = app_handle.global_shortcut_manager();
            
            // Try registering Ctrl+Shift+A hotkey first
            println!("Attempting to register Ctrl+Shift+A hotkey...");
            let hotkey_result = shortcut_manager.register("Ctrl+Shift+A", move || {
                println!("Hotkey Ctrl+Shift+A pressed, emitting hotkey-pressed event");
                let _ = app_handle.emit_all("hotkey-pressed", ());
            });
            
            // Handle hotkey registration failure with fallbacks
            if let Err(e) = hotkey_result {
                println!("Failed to register Ctrl+Shift+A hotkey: {}", e);
                
                // Try alternative hotkeys
                let alternative_hotkeys = ["Alt+Shift+A", "Ctrl+Alt+A", "Ctrl+Shift+R"];
                
                for hotkey in alternative_hotkeys.iter() {
                    println!("Trying alternative hotkey: {}", hotkey);
                    // Clone the hotkey string and app_handle for each iteration
                    let hotkey_owned = hotkey.to_string();
                    let app_handle_clone = app.handle();
                    
                    match shortcut_manager.register(hotkey, move || {
                        println!("Hotkey {} pressed, emitting hotkey-pressed event", hotkey_owned);
                        let _ = app_handle_clone.emit_all("hotkey-pressed", ());
                    }) {
                        Ok(_) => {
                            println!("Successfully registered alternative hotkey: {}", hotkey);
                            
                            // Emit event to notify frontend which hotkey was registered
                            let _ = app.handle().emit_all("hotkey-registered", serde_json::json!({
                                "hotkey": hotkey
                            }));
                            
                            break;
                        },
                        Err(e) => println!("Failed to register alternative hotkey {}: {}", hotkey, e)
                    }
                }
                
                // Emit event to frontend if no hotkeys could be registered
                if !alternative_hotkeys.iter().any(|&k| shortcut_manager.is_registered(k).unwrap_or(false)) {
                    println!("⚠️ WARNING: No hotkeys could be registered. Manual recording will be required.");
                    let _ = app.handle().emit_all("hotkey-registration-failed", ());
                }
            } else {
                println!("Successfully registered Ctrl+Shift+A hotkey");
                // Emit event to notify frontend which hotkey was registered
                let _ = app.handle().emit_all("hotkey-registered", serde_json::json!({
                    "hotkey": "Ctrl+Shift+A"
                }));
            }
            
            // Manage the combined AppState
            app.manage(AppState {
                audio_manager: Arc::new(Mutex::new(AudioManager::new(app_handle.clone()))),
                transcription_state: Arc::new(Mutex::new(state)),
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            transcription::transcribe_audio_file,
            transcription::get_transcription_status,
            transcription::get_transcription_result,
            transcription::save_audio_buffer,
            transcription::verify_file_exists,
            whisper::is_whisper_installed,
            whisper::whisper_transcribe_audio,
            whisper::whisper_save_audio_buffer,
            paste_text_to_cursor,
            emit_event,
            delete_file,
            // New backend recording commands
            audio_manager_rs::start_backend_recording,
            audio_manager_rs::stop_backend_recording,
            // Config Commands
            config_manager::load_config,
            config_manager::save_config,
            config_manager::get_default_config,
            // NEW Clipboard Command
            write_to_clipboard_rust
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Fethr application");
}

/**
 * Delete a file
 * 
 * What it does: Deletes a file at the specified path
 * Why it exists: To clean up temporary files
 */
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Ok(());
    }
    
    match fs::remove_file(path) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to delete file: {:?}", e))
    }
} 