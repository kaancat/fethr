#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Core Tauri imports
use tauri::{AppHandle, Manager};

// Standard library imports
use std::path::PathBuf;
use std::fs::File; // Keep File import for types
use std::io::BufWriter;
use std::sync::{Arc, Mutex};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

// Crates
use arboard;
use enigo::{Enigo, Key, Settings, Direction, Keyboard}; // <<< Use Keyboard trait
use rdev::{Event, EventType, Key as RdevKey};
use lazy_static::lazy_static;

// Import our modules
mod transcription;
mod audio_manager_rs;

// Import necessary types from submodules
use crate::transcription::TranscriptionState; // Make sure TranscriptionState is pub in transcription.rs

// --- State Definitions ---

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppRecordingState { // Public enum
    Idle,
    Recording,           // Single state for active recording (hold or pre-lock)
    WaitingForSecondTap, // For double-tap detection
    LockedRecording,
    Transcribing,
}

lazy_static! {
    static ref RDEV_APP_STATE: Mutex<AppRecordingState> = Mutex::new(AppRecordingState::Idle);
    static ref HOTKEY_DOWN: Mutex<bool> = Mutex::new(false); // Physical key state
    static ref PRESS_START_TIME: Mutex<Option<Instant>> = Mutex::new(None);
    static ref FIRST_TAP_RELEASE_TIME: Mutex<Option<Instant>> = Mutex::new(None); // Time of the first tap's release
}
const DOUBLE_TAP_WINDOW_MS: u128 = 350; // Time window for second tap (adjust as needed)
const TAP_MAX_DURATION_MS: u128 = 300; // Max duration for a press to be considered a 'tap' for locking

#[derive(Default)]
pub struct AudioRecordingState {
    pub stop_signal_sender: Option<mpsc::Sender<()>>,
    pub recording_thread_handle: Option<thread::JoinHandle<()>>,
    pub temp_wav_path: Option<PathBuf>,
    pub is_actively_recording: bool,
    // Correct type: Option contains the Arc/Mutex/Option<WavWriter>
    pub writer: Option<Arc<Mutex<Option<hound::WavWriter<BufWriter<File>>>>>>,
}
pub type SharedRecordingState = Arc<Mutex<AudioRecordingState>>;


// --- Commands ---

#[tauri::command]
async fn paste_text_to_cursor(_text: String) -> Result<(), String> {
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
    #[cfg(target_os = "macos")]
    {
        let _ = enigo.key(Key::Meta, Direction::Press);
        let _ = enigo.key(Key::Unicode('v'), Direction::Click);
        let _ = enigo.key(Key::Meta, Direction::Release);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = enigo.key(Key::Control, Direction::Press);
        let _ = enigo.key(Key::Unicode('v'), Direction::Click);
        let _ = enigo.key(Key::Control, Direction::Release);
    }
    println!("[RUST PASTE] Paste simulation complete.");
    Ok(())
}

// Make internal helper pub so audio_manager can call it
pub fn write_to_clipboard_internal(text_to_copy: String) -> Result<(), String> {
    println!("[RUST CLIPBOARD INTERNAL] Attempting to write via arboard...");
    match arboard::Clipboard::new() {
        Ok(mut clipboard) => match clipboard.set_text(text_to_copy) {
            Ok(_) => { println!("[RUST CLIPBOARD INTERNAL] OK"); Ok(()) },
            Err(e) => Err(format!("arboard set_text failed: {}", e)),
        },
        Err(e) => Err(format!("arboard init failed: {}", e)),
    }
}
// Tauri command wrapper remains async
#[tauri::command]
async fn write_to_clipboard_command(text_to_copy: String) -> Result<(), String> {
    println!("[RUST CLIPBOARD COMMAND] Received request.");
    write_to_clipboard_internal(text_to_copy) // Call sync helper
}

#[tauri::command]
fn reset_rdev_state() {
    println!("[RUST CMD] reset_rdev_state called (via frontend signal).");
    let mut state_guard = RDEV_APP_STATE.lock().unwrap();
    *state_guard = AppRecordingState::Idle;
    let mut hotkey_down_guard = HOTKEY_DOWN.lock().unwrap();
    *hotkey_down_guard = false;
    // Reset press times
    *PRESS_START_TIME.lock().unwrap() = None;
    *FIRST_TAP_RELEASE_TIME.lock().unwrap() = None; // Also clear the first tap release time
    println!("[RUST CMD] Rdev state forced to IDLE, hotkey down flag cleared, all press times cleared.");
}

#[tauri::command]
fn signal_reset_complete() {
    println!("[RUST CMD] signal_reset_complete received from frontend.");
    reset_rdev_state(); // Ensure it calls the updated reset function
}

// --- Main Setup ---
fn main() {
    println!("Fethr startup - v{}", env!("CARGO_PKG_VERSION"));

    tauri::Builder::default()
        // Initialize transcription state properly using init_transcription
        .setup(|app| {
            // Initialize TranscriptionState with proper paths
            match transcription::init_transcription(&app.handle()) {
                Ok(transcription_state) => {
                    println!("[RUST SETUP] Successfully initialized TranscriptionState: {:?}", transcription_state);
                    app.manage(transcription_state);
                },
                Err(e) => {
                    println!("[RUST SETUP ERROR] Failed to initialize TranscriptionState: {}", e);
                    // Fall back to default if initialization fails
                    app.manage(TranscriptionState::default());
                }
            }

            // Manage audio recording state
            app.manage(Arc::new(Mutex::new(AudioRecordingState::default())));

            // --- Initialize Rdev Listener Thread ---
            let app_handle_for_rdev = app.handle();
            thread::spawn(move || {
                println!("[RDEV Thread] Listener started (Tracking RightAlt Hold/Release/DoubleTap).");
                if let Err(error) = rdev::listen(move |event| callback(event, &app_handle_for_rdev)) {
                    println!("[RDEV Thread ERROR] Could not listen: {:?}", error);
                }
            });
            // --- End Rdev Listener Thread ---

            // --- Remove Old Global Shortcut Registration ---
            println!("[RUST Setup] Skipping registration of fallback Ctrl+Shift+A hotkey.");
            // let app_handle_shortcut = app.handle();
            // let mut shortcut_manager = app.global_shortcut_manager();
            // shortcut_manager.register("Ctrl+Shift+A", move || { /* ... */ }).ok();
            // --- End Remove ---

            // Show window
            if let Some(window) = app.get_window("main") {
                 println!("Showing main window");
                 window.show().unwrap();
                 window.set_focus().unwrap();
            } else { println!("Main window not found!"); }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Core Commands:
            audio_manager_rs::start_backend_recording,
            audio_manager_rs::stop_backend_recording,
            transcription::transcribe_audio_file,
            // Utility Commands:
            write_to_clipboard_command,
            paste_text_to_cursor, // Defined in this file now
            reset_rdev_state,
            signal_reset_complete,
            delete_file
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Fethr application");
} // <<< ENSURE THIS CLOSING BRACE FOR main() IS PRESENT


// --- Rdev Callback Logic ---
fn callback(event: Event, app_handle: &AppHandle) {
    let event_time = Instant::now();

    // Filter to only process RightAlt key events
    let is_relevant_key_event = match event.event_type {
        EventType::KeyPress(key) if key == RdevKey::AltGr => true,
        EventType::KeyRelease(key) if key == RdevKey::AltGr => true,
        _ => false,
    };

    if is_relevant_key_event {
        println!("\n[RDEV Event {:?}] Time: {:?}", event.event_type, event_time);

        // Variables for state tracking
        let state_before_timeout_check: AppRecordingState;
        let mut timeout_occurred = false;
        let mut final_action = None;

        // --- 1. Check for timeout first (with minimal lock duration) ---
        {
            let state_guard = RDEV_APP_STATE.lock().unwrap();
            state_before_timeout_check = *state_guard;
            println!("[RDEV Pre-Timeout State]: {:?}", state_before_timeout_check);
        }
        
        // Handle WaitingForSecondTap timeout (out of lock scope)
        if state_before_timeout_check == AppRecordingState::WaitingForSecondTap {
            let first_tap_time_opt = {
                let guard = FIRST_TAP_RELEASE_TIME.lock().unwrap();
                *guard // Clone the Option<Instant>
            };
            
            if let Some(first_tap_release_time) = first_tap_time_opt {
                let elapsed_ms = first_tap_release_time.elapsed().as_millis();
                if elapsed_ms > DOUBLE_TAP_WINDOW_MS {
                    println!("[RDEV Timeout] WaitingForSecondTap timed out after {} ms", elapsed_ms);
                    
                    // Reset state atomically
                    {
                        let mut state_guard = RDEV_APP_STATE.lock().unwrap();
                        *state_guard = AppRecordingState::Idle;
                        println!("[RDEV State Change] WaitingForSecondTap -> Idle (Timeout)");
                    }
                    {
                        let mut first_tap_guard = FIRST_TAP_RELEASE_TIME.lock().unwrap();
                        *first_tap_guard = None;
                    }
                    
                    timeout_occurred = true;
                    
                    // Signal UI to update
                    emit_state_update(app_handle, "IDLE");
                    emit_stop_transcribe(app_handle);
                }
            }
        }

        // If timeout occurred, we continue processing the current event with the new state
        let state_for_event_processing = if timeout_occurred {
            AppRecordingState::Idle
        } else {
            state_before_timeout_check
        };
        
        // --- 2. Process the current event based on the current state ---
        match event.event_type {
            EventType::KeyPress(_) => { // RightAlt key pressed
                let mut hotkey_pressed = false;
                
                // Update hotkey state (minimal lock duration)
                {
                    let mut hotkey_guard = HOTKEY_DOWN.lock().unwrap();
                    if !*hotkey_guard {
                        *hotkey_guard = true;
                        hotkey_pressed = true;
                        
                        // Record press time (minimal lock duration)
                        let press_time = Instant::now();
                        *PRESS_START_TIME.lock().unwrap() = Some(press_time);
                        println!("[RDEV HOTKEY] >>> RightAlt PRESS at {:?} <<<", press_time);
                    } else {
                        println!("[RDEV HOTKEY] >>> RightAlt PRESS (duplicate/ignored) <<<");
                    }
                }
                
                if hotkey_pressed {
                    // Process key press based on current state
                    let next_state = match state_for_event_processing {
                        AppRecordingState::Idle => {
                            println!("[RDEV State Transition] Idle -> Recording (Press)");
                            final_action = Some(("RECORDING", true)); // (ui_state, start_recording)
                            AppRecordingState::Recording
                        },
                        AppRecordingState::WaitingForSecondTap => {
                            println!("[RDEV State Transition] WaitingForSecondTap -> LockedRecording (Second Tap)");
                            // Clear first tap time
                            *FIRST_TAP_RELEASE_TIME.lock().unwrap() = None;
                            final_action = Some(("LOCKED_RECORDING", false)); // UI update only, recording already started
                            AppRecordingState::LockedRecording
                        },
                        AppRecordingState::LockedRecording => {
                            println!("[RDEV State Transition] LockedRecording -> Transcribing (Stop Press)");
                            final_action = Some(("TRANSCRIBING", false)); // UI update + stop recording
                            AppRecordingState::Transcribing
                        },
                        _ => {
                            println!("[RDEV Press Logic] Ignoring press in state: {:?}", state_for_event_processing);
                            state_for_event_processing // No change
                        }
                    };
                    
                    // Update state atomically (minimal lock duration)
                    {
                        let mut state_guard = RDEV_APP_STATE.lock().unwrap();
                        *state_guard = next_state;
                    }
                }
            },
            
            EventType::KeyRelease(_) => { // RightAlt key released
                let mut hotkey_released = false;
                let press_start_time_opt;
                
                // Update hotkey state (minimal lock duration)
                {
                    let mut hotkey_guard = HOTKEY_DOWN.lock().unwrap();
                    if *hotkey_guard {
                        *hotkey_guard = false;
                        hotkey_released = true;
                        println!("[RDEV HOTKEY] <<< RightAlt RELEASE at {:?} <<<", Instant::now());
                    } else {
                        println!("[RDEV HOTKEY] <<< RightAlt RELEASE (duplicate/ignored) <<<");
                    }
                }
                
                // Get press start time (minimal lock duration)
                {
                    let mut press_time_guard = PRESS_START_TIME.lock().unwrap();
                    press_start_time_opt = press_time_guard.take();
                }
                
                if hotkey_released {
                    // Process key release based on current state and press duration
                    if let Some(press_start) = press_start_time_opt {
                        let press_duration_ms = event_time.duration_since(press_start).as_millis();
                        println!("[RDEV Release Logic] Press Duration: {} ms", press_duration_ms);
                        
                        let next_state = match state_for_event_processing {
                            AppRecordingState::Recording => {
                                if press_duration_ms <= TAP_MAX_DURATION_MS {
                                    // Quick release (tap) - potential double-tap sequence
                                    println!("[RDEV State Transition] Recording -> WaitingForSecondTap (Tap)");
                                    // Record release time for double-tap detection
                                    *FIRST_TAP_RELEASE_TIME.lock().unwrap() = Some(event_time);
                                    AppRecordingState::WaitingForSecondTap
                                } else {
                                    // Long press (hold-to-record completed)
                                    println!("[RDEV State Transition] Recording -> Transcribing (Hold Release)");
                                    final_action = Some(("TRANSCRIBING", false)); // UI update + stop recording
                                    AppRecordingState::Transcribing
                                }
                            },
                            _ => {
                                println!("[RDEV Release Logic] Release ignored in state: {:?}", state_for_event_processing);
                                state_for_event_processing // No change
                            }
                        };
                        
                        // Update state atomically (minimal lock duration)
                        {
                            let mut state_guard = RDEV_APP_STATE.lock().unwrap();
                            *state_guard = next_state;
                        }
                        
                    } else {
                        println!("[RDEV WARN] Release event but PRESS_START_TIME was None (State: {:?})", state_for_event_processing);
                    }
                }
            },
            _ => {} // Unreachable
        }
        
        // --- 3. Execute final actions outside of any locks ---
        if let Some((ui_state, start_recording)) = final_action {
            println!("[RDEV Action] Emitting UI state: {}", ui_state);
            emit_state_update(app_handle, ui_state);
            
            if start_recording {
                println!("[RDEV Action] Emitting start recording signal");
                emit_start_recording(app_handle);
            }
            
            if ui_state == "TRANSCRIBING" {
                println!("[RDEV Action] Emitting stop and transcribe signal");
                emit_stop_transcribe(app_handle);
            }
        }
        
        // Log final state for debugging
        println!("[RDEV Post-Event State]: {:?}", *RDEV_APP_STATE.lock().unwrap());
    }
}

// --- Helper functions to emit events ---
fn emit_state_update(app_handle: &AppHandle, state_str: &str) {
    println!("[RUST Emit Helper] Emitting fethr-update-ui-state: {}", state_str);
    let _ = app_handle.emit_all("fethr-update-ui-state", serde_json::json!({ "state": state_str }));
}
fn emit_start_recording(app_handle: &AppHandle) {
    println!("[RUST Emit Helper] Emitting fethr-start-recording");
    let _ = app_handle.emit_all("fethr-start-recording", ());
}
fn emit_stop_transcribe(app_handle: &AppHandle) {
    println!("[RUST Emit Helper] Emitting fethr-stop-and-transcribe");
    let auto_paste_enabled = true; // TODO: Read from config state
    let _ = app_handle.emit_all("fethr-stop-and-transcribe", auto_paste_enabled);
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() { return Ok(()); }
    std::fs::remove_file(path).map_err(|e| format!("Failed to delete file: {:?}", e))
}