#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{Manager, GlobalShortcutManager};
use std::path::Path;
use std::fs;

// Import our modules
mod transcription;
mod whisper;
mod audio_manager;

// Only import what we actually use directly in this file
use transcription::init_transcription;

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
            
            // Register state
            app.manage(state);
            
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
            delete_file
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