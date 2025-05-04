#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Core Tauri imports
use tauri::{AppHandle, Manager, SystemTray, SystemTrayEvent};

// Standard library imports
use std::path::PathBuf;
use std::fs::File; // Keep File import for types
use std::io::BufWriter;
use std::sync::{Arc, Mutex};
use std::sync::mpsc;
use std::thread;
use std::thread::JoinHandle; // Import JoinHandle
use std::time::{Duration, Instant};
use std::sync::atomic::{AtomicBool}; // Keep Atomics for signalling thread
use std::error::Error;

// Crates
use arboard;
use crossbeam_channel::{unbounded, Sender, Receiver}; // Import channel types
use enigo::{Enigo, Key, Settings, Direction, Keyboard}; // <<< Use Keyboard trait
use rdev::{Event, EventType, Key as RdevKey};
use lazy_static::lazy_static;

// Import our modules
mod transcription;
mod audio_manager_rs;
mod config; // Add config module

// Export modules for cross-file references
pub use config::SETTINGS; // Export SETTINGS for use by other modules
pub use config::AppSettings; // Export AppSettings for use by other modules

// Import necessary types from submodules
use crate::transcription::TranscriptionState; // Make sure TranscriptionState is pub in transcription.rs

// --- State Definitions ---

// --- Frontend State Enum for serialization to match TypeScript ---
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)] // Must derive Serialize
#[serde(rename_all = "UPPERCASE")] // Ensure serialization matches frontend if needed
pub enum FrontendRecordingState {
    Idle,
    Recording,
    LockedRecording,
    Transcribing,
    Error,
    Pasting, // Add any other states defined in TypeScript
}

// Implement Default trait for FrontendRecordingState
impl Default for FrontendRecordingState {
    fn default() -> Self {
        FrontendRecordingState::Idle // Default state is Idle
    }
}

// --- Structured payload for UI state updates ---
#[derive(Clone, Debug, serde::Serialize, Default)]
struct StateUpdatePayload {
    state: FrontendRecordingState, // Use the frontend enum type
    duration_ms: u128,
    transcription_result: Option<String>,
    error_message: Option<String>,
}

// --- ADD Lifecycle Enum ---
#[derive(Debug, Clone)] // Removed PartialEq, Eq
pub enum RecordingLifecycle {
    Idle,
    Recording(Arc<AtomicBool>), // Store the session's active flag
    Stopping,                   // Intermediate state during cleanup
}

// Add manual implementation for equality checks, ignoring the Arc<AtomicBool> value
impl PartialEq for RecordingLifecycle {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (RecordingLifecycle::Idle, RecordingLifecycle::Idle) => true,
            (RecordingLifecycle::Stopping, RecordingLifecycle::Stopping) => true,
            (RecordingLifecycle::Recording(_), RecordingLifecycle::Recording(_)) => true,
            _ => false,
        }
    }
}

impl Eq for RecordingLifecycle {}
// --- END Enum ---

// --- ADD Lifecycle State ---
lazy_static! {
    pub static ref RECORDING_LIFECYCLE: Mutex<RecordingLifecycle> = Mutex::new(RecordingLifecycle::Idle);
}
// --- END State ---

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppRecordingState { // Use simpler enum
    Idle,
    Recording,
    LockedRecording,
    Transcribing,
}

// Enum for events sent over the channel
#[derive(Debug, Clone)]
enum HotkeyEvent {
    Press(Instant),
    Release(Instant),
}

// Shared application state
#[derive(Clone, Debug)]
struct AppState {
    recording_state: AppRecordingState,
    press_start_time: Option<Instant>,
    hotkey_down_physically: bool, // Track physical key state separately if needed
}

lazy_static! {
    // The state managed by the dedicated processing thread
    static ref HOTKEY_STATE: Mutex<AppState> = Mutex::new(AppState {
        recording_state: AppRecordingState::Idle,
        press_start_time: None,
        hotkey_down_physically: false,
    });

    // The channel for communication
    static ref EVENT_CHANNEL: (Sender<HotkeyEvent>, Receiver<HotkeyEvent>) = unbounded();
    static ref EVENT_SENDER: Sender<HotkeyEvent> = EVENT_CHANNEL.0.clone();
    static ref EVENT_RECEIVER: Receiver<HotkeyEvent> = EVENT_CHANNEL.1.clone();
}

const TAP_MAX_DURATION_MS: u128 = 300;

#[derive(Default)]
pub struct AudioRecordingState {
    pub stop_signal_sender: Option<mpsc::Sender<()>>,
    pub recording_thread_handle: Option<JoinHandle<()>>,
    pub temp_wav_path: Option<PathBuf>,
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

// Re-introduce PostEventAction enum
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PostEventAction {
    None,
    StartRecordingAndEmitUi,
    StopAndTranscribeAndEmitUi,
    UpdateUiOnly, // For entering LockedRecording
}

// Simplified process_hotkey_event function
fn process_hotkey_event(event: HotkeyEvent, app_handle: &AppHandle) {
    let mut action_to_take = PostEventAction::None;
    {
        let mut state = HOTKEY_STATE.lock().unwrap();
        let current_state = state.recording_state;
        println!("[State Processor (Simplified V2)] Received event: {:?}. Current state: {:?}", event, current_state);

        match event {
            HotkeyEvent::Press(press_time) => {
                if !state.hotkey_down_physically {
                    state.hotkey_down_physically = true;
                    state.press_start_time = Some(press_time);
                    match current_state {
                        AppRecordingState::Idle => {
                            println!("[State Processor (Simplified V2)] State Transition: Idle -> Recording");
                            state.recording_state = AppRecordingState::Recording;
                            action_to_take = PostEventAction::StartRecordingAndEmitUi;
                        }
                        AppRecordingState::LockedRecording => {
                            println!("[State Processor (Simplified V2)] State Transition: LockedRecording -> Transcribing (Tap)");
                            state.recording_state = AppRecordingState::Transcribing;
                            action_to_take = PostEventAction::StopAndTranscribeAndEmitUi;
                        }
                        _ => println!("[State Processor (Simplified V2)] Ignoring Press in state: {:?}", current_state),
                    }
                } else { println!("[State Processor (Simplified V2)] Ignoring Repeat Press event."); }
            }
            HotkeyEvent::Release(release_time) => {
                 if state.hotkey_down_physically {
                    state.hotkey_down_physically = false;
                    let press_start = state.press_start_time.take();
                    if let Some(start) = press_start {
                        let duration_ms = release_time.duration_since(start).as_millis();
                        println!("[State Processor (Simplified V2)] Release duration: {} ms", duration_ms);
                        match current_state {
                            AppRecordingState::Recording => {
                                if duration_ms <= TAP_MAX_DURATION_MS {
                                    println!("[State Processor (Simplified V2)] State Transition: Recording -> LockedRecording (Tap)");
                                    state.recording_state = AppRecordingState::LockedRecording;
                                    action_to_take = PostEventAction::UpdateUiOnly; // Action to emit LockedRecording state
                                } else {
                                    println!("[State Processor (Simplified V2)] State Transition: Recording -> Transcribing (Hold)");
                                    state.recording_state = AppRecordingState::Transcribing;
                                    action_to_take = PostEventAction::StopAndTranscribeAndEmitUi;
                                }
                            }
                            _ => println!("[State Processor (Simplified V2)] Ignoring Release in state: {:?}", current_state),
                        }
                    } else { println!("[State Processor (Simplified V2) WARN] Release without matching press_start_time! (State: {:?})", current_state); }
                 } else { println!("[State Processor (Simplified V2) WARN] Ignoring spurious Release event."); }
            }
        }
        println!("[State Processor (Simplified V2)] New State determined: {:?}. Action: {:?}", state.recording_state, action_to_take);
    } // State lock released

    // Perform Action outside lock
    println!("[State Processor (Simplified V2)] Performing Action: {:?}", action_to_take);
    match action_to_take {
         PostEventAction::StartRecordingAndEmitUi => {
             let payload = StateUpdatePayload { state: FrontendRecordingState::Recording, ..Default::default() };
             emit_state_update(app_handle, payload);
             emit_start_recording(app_handle);
         }
         PostEventAction::StopAndTranscribeAndEmitUi => {
             let payload = StateUpdatePayload { state: FrontendRecordingState::Transcribing, ..Default::default() };
             emit_state_update(app_handle, payload);
             emit_stop_transcribe(app_handle);
         }
         PostEventAction::UpdateUiOnly => { // LockedRecording
             let payload = StateUpdatePayload { state: FrontendRecordingState::LockedRecording, ..Default::default() };
             emit_state_update(app_handle, payload);
         }
         PostEventAction::None => { println!("[State Processor (Simplified V2)] No action needed."); }
     }
    println!("[State Processor (Simplified V2)] Finished processing event.");
}

#[tauri::command]
fn signal_reset_complete(app_handle: AppHandle) { // Add AppHandle back
    println!("[RUST CMD] signal_reset_complete received. Performing state reset...");

    // --- Moved Reset Logic Here ---
    let lifecycle = RECORDING_LIFECYCLE.lock().unwrap();
    if *lifecycle == RecordingLifecycle::Idle {
        println!("[RUST CMD] RecordingLifecycle is Idle, proceeding with hotkey state reset.");
        drop(lifecycle); // Drop lock before acquiring next

        // Reset hotkey state
        { // Scope for HOTKEY_STATE lock
            let mut state = HOTKEY_STATE.lock().unwrap();
            state.recording_state = AppRecordingState::Idle;
            state.press_start_time = None;
            state.hotkey_down_physically = false;
            println!("[RUST CMD] Hotkey state forced to IDLE, flags/times cleared.");
        } // HOTKEY_STATE lock released

        // --- Emit Final IDLE State Update ---
        println!("[RUST CMD] Emitting final IDLE state update to frontend.");
        let final_payload = StateUpdatePayload {
            state: FrontendRecordingState::Idle,
            duration_ms: 0,
            transcription_result: None, // Let frontend manage showing last result
            error_message: None,
        };
        // Use the app_handle passed into this command
        emit_state_update(&app_handle, final_payload);
        // --- End Emit ---

    } else {
        // This case might indicate a race condition, log it
        println!("[RUST CMD WARNING] signal_reset_complete called, but RecordingLifecycle was {:?}. Not resetting hotkey state or emitting Idle.", *lifecycle);
        // We might want to force emit Idle anyway? Or investigate why this happens.
        // For now, just log. If lifecycle isn't Idle, the hotkey state shouldn't be reset.
    }
    // --- End Moved Reset Logic ---
}

// --- Main Setup ---
fn main() {
    println!("Fethr startup - v{}", env!("CARGO_PKG_VERSION"));

    // --- Define the System Tray ---
    // We define it here, but the icon is set in tauri.conf.json
    // We can add menu items here later if needed.
    let system_tray = SystemTray::new(); // Basic tray with no menu for now

    tauri::Builder::default()
        // Initialize transcription state properly using init_transcription
        .setup(|app| -> Result<(), Box<dyn Error>> {
            // --- Ensure Config is Loaded ---
            println!("[RUST SETUP] Initializing configuration...");
            drop(config::SETTINGS.lock().unwrap()); // Access Lazy static to trigger loading
            println!("[RUST SETUP] Configuration initialized.");
            // --- End Config Init ---

            // Initialize TranscriptionState (now much simpler)
            println!("[RUST SETUP] Initializing TranscriptionState...");
            let transcription_state = TranscriptionState::default();
            app.manage(transcription_state);
            println!("[RUST SETUP] TranscriptionState initialized.");

            // Manage audio recording state
            app.manage(Arc::new(Mutex::new(AudioRecordingState::default())));

            // --- Debug Window Handles (Final Correction) ---
            println!("[RUST SETUP DEBUG] Checking window handles for URL/Title...");
            match app.get_window("main") {
                Some(window) => {
                    // Handle title() Result and url() Url
                    let url_string = window.url().to_string(); // Convert tauri::Url to String
                    let title_string = window.title() // This returns Result<String, Error>
                        .unwrap_or_else(|e| format!("Error getting title: {}", e)); // Provide fallback on error
                    println!("[RUST SETUP DEBUG] Found window handle 'main'. Title: \"{}\", URL: \"{}\"", title_string, url_string);
                },
                None => println!("[RUST SETUP DEBUG ERROR] Could NOT find window handle 'main' during debug check."),
            }
            match app.get_window("pill") {
                Some(window) => {
                    // Handle title() Result and url() Url
                    let url_string = window.url().to_string(); // Convert tauri::Url to String
                    let title_string = window.title() // This returns Result<String, Error>
                        .unwrap_or_else(|e| format!("Error getting title: {}", e)); // Provide fallback on error
                    println!("[RUST SETUP DEBUG] Found window handle 'pill'. Title: \"{}\", URL: \"{}\"", title_string, url_string);
                },
                None => println!("[RUST SETUP DEBUG ERROR] Could NOT find window handle 'pill' during debug check."),
            }
            println!("[RUST SETUP DEBUG] Proceeding with safe handle retrieval...");
            // --- End Debug Window Handles (Final Correction) ---

            // --- Get Window Handles Safely ---
            let main_window = match app.get_window("main") {
                 Some(win) => {
                     println!("[RUST SETUP] Got main window handle successfully.");
                     
                    // --- Explicitly Navigate to Dev Server URL ---
                    let dev_server_url = "http://localhost:5176"; // Base URL for main window
                    println!("[RUST SETUP] Attempting to navigate main window to: {}", dev_server_url);
                    match win.eval(&format!("window.location.replace('{}')", dev_server_url)) {
                        Ok(_) => println!("[RUST SETUP] Main window navigation command sent successfully."),
                        Err(e) => println!("[RUST SETUP ERROR] Failed to send main window navigation command: {}", e),
                    }
                    // --- End Explicit Navigation ---
                    
                    // --- Explicitly Hide Main Window ---
                    println!("[RUST SETUP] Explicitly hiding main window after navigation attempt.");
                    if let Err(e) = win.hide() {
                        println!("[RUST SETUP WARNING] Failed to explicitly hide main window: {}", e);
                    }
                    // --- End Explicit Hide ---
                     
                     win
                 },
                 None => {
                     println!("[RUST SETUP FATAL] Could not get main window handle! Exiting setup.");
                     // Use Box<dyn Error> for the return type
                     return Err(Box::from("Failed to get main window handle"));
                 }
             };
            let pill_window = match app.get_window("pill") {
                Some(win) => {
                    println!("[RUST SETUP] Got pill window handle successfully.");
                    
                    // --- Explicitly Navigate Pill Window ---
                    let pill_url = "http://localhost:5176/pill"; // Full URL for pill window
                    println!("[RUST SETUP] Attempting to navigate pill window to: {}", pill_url);
                    match win.eval(&format!("window.location.replace('{}')", pill_url)) {
                        Ok(_) => println!("[RUST SETUP] Pill window navigation command sent successfully."),
                        Err(e) => println!("[RUST SETUP ERROR] Failed to send pill window navigation command: {}", e),
                    }
                    // --- End Explicit Navigation ---
                    
                    win
                },
                None => {
                    println!("[RUST SETUP FATAL] Could not get pill window handle! Exiting setup.");
                    return Err(Box::from("Failed to get pill window handle"));
                }
            };
            // --- End Safe Window Handle Logic ---

            // --- Verify Initial Visibility (Optional but good for debugging) ---
            match main_window.is_visible() {
                Ok(visible) => {
                    if visible {
                        println!("[RUST SETUP WARN] Main window was unexpectedly visible on start! Hiding.");
                        let _ = main_window.hide(); // Attempt to hide if wrongly visible
                    } else {
                         println!("[RUST SETUP] Main window correctly hidden on start.");
                    }
                },
                Err(e) => println!("[RUST SETUP ERROR] Failed to check main window visibility: {}", e),
            }
            match pill_window.is_visible() {
                Ok(visible) => {
                    if !visible {
                        println!("[RUST SETUP WARN] Pill window was unexpectedly hidden on start! Showing.");
                        let _ = pill_window.show(); // Attempt to show if wrongly hidden
                    } else {
                         println!("[RUST SETUP] Pill window correctly visible on start.");
                    }
                },
                Err(e) => println!("[RUST SETUP ERROR] Failed to check pill window visibility: {}", e),
            }
            // --- End Window Handle Logic ---

            // --- Start State Processing Thread ---
            let app_handle_for_state = app.handle(); // Clone handle for the new thread
            thread::spawn(move || {
                println!("[State Thread] Started (Simplified - No Timeout).");
                loop {
                    println!("[State Thread] Waiting for next hotkey event...");
                    match EVENT_RECEIVER.recv() { // Use blocking recv()
                        Ok(hotkey_event) => {
                            println!("[State Thread] Received event via channel: {:?}", hotkey_event);
                            process_hotkey_event(hotkey_event, &app_handle_for_state);
                        }
                        Err(e) => {
                            println!("[State Thread ERROR] Channel disconnected! Exiting thread. Error: {}", e);
                            break; // Exit loop
                        }
                    }
                } // End loop
            }); // End state thread spawn
            // --- End State Processing Thread ---

            // --- Initialize Rdev Listener Thread ---
            let app_handle_for_rdev = app.handle();
            thread::spawn(move || {
                println!("[RDEV Thread] Listener started (Tracking RightAlt Hold/Release/DoubleTap).");
                if let Err(error) = rdev::listen(move |event| callback(event, &app_handle_for_rdev)) {
                    println!("[RDEV Thread ERROR] Could not listen: {:?}", error);
                }
            });
            // --- End Rdev Listener Thread ---

            Ok(())
        })
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { position: _, size: _, .. } => {
                println!("[Tray Event] Left click detected.");
                if let Some(main_window) = app.get_window("main") {
                    // Window handle exists, proceed with toggle logic
                    if let Ok(is_visible) = main_window.is_visible() {
                        if is_visible {
                            println!("[Tray Event] Hiding settings window.");
                            // Optionally, you could unminimize first if you want hide to work after minimize
                            // main_window.unminimize().unwrap_or_else(|e| eprintln!("Failed to unminimize: {}", e));
                            main_window.hide().unwrap_or_else(|e| eprintln!("[Tray Event ERROR] Failed to hide window: {}", e));
                        } else {
                            println!("[Tray Event] Showing settings window.");
                            main_window.show().unwrap_or_else(|e| eprintln!("[Tray Event ERROR] Failed to show window: {}", e));
                            main_window.set_focus().unwrap_or_else(|e| eprintln!("[Tray Event ERROR] Failed to focus window: {}", e));
                        }
                    } else {
                         eprintln!("[Tray Event ERROR] Failed to check main window visibility.");
                    }
                } else {
                    // Window handle DOES NOT exist
                    eprintln!("[Tray Event WARNING] Could not get main window handle on tray click. Window might be closed or in an unexpected state.");
                }
            }
            SystemTrayEvent::RightClick { position: _, size: _, .. } => {
                println!("[Tray Event] Right click detected (No action defined).");
                // TODO: Implement context menu if needed later
            }
            SystemTrayEvent::DoubleClick { position: _, size: _, .. } => {
                println!("[Tray Event] Double click detected (No action defined).");
            }
            // --- Handle Menu Items Later ---
            // SystemTrayEvent::MenuItemClick { id, .. } => {
            //   match id.as_str() {
            //     "quit" => { std::process::exit(0); }
            //     "show_settings" => { ... show main window ... }
            //     _ => {}
            //   }
            // }
            _ => {} // Handle other tray events if necessary
        })
        .invoke_handler(tauri::generate_handler![
            // Core Commands:
            audio_manager_rs::start_backend_recording,
            audio_manager_rs::stop_backend_recording,
            transcription::transcribe_audio_file,
            // Utility Commands:
            write_to_clipboard_command,
            paste_text_to_cursor, // Defined in this file now
            signal_reset_complete,
            delete_file
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Fethr application");
}


// --- Rdev Callback Logic ---

// Replace the entire existing callback function
fn callback(event: Event, _app_handle: &AppHandle) { // app_handle not needed here anymore
    let event_time = Instant::now();

    match event.event_type {
        EventType::KeyPress(key) if key == RdevKey::AltGr => {
            println!("[RDEV Callback] Detected AltGr Press. Sending to channel.");
            if let Err(e) = EVENT_SENDER.send(HotkeyEvent::Press(event_time)) {
                println!("[RDEV Callback ERROR] Failed to send Press event: {}", e);
            }
        }
        EventType::KeyRelease(key) if key == RdevKey::AltGr => {
             println!("[RDEV Callback] Detected AltGr Release. Sending to channel.");
             if let Err(e) = EVENT_SENDER.send(HotkeyEvent::Release(event_time)) {
                 println!("[RDEV Callback ERROR] Failed to send Release event: {}", e);
             }
        }
        _ => {} // Ignore other events
    }
}


// --- Helper functions to emit events ---
fn emit_state_update(app_handle: &AppHandle, payload: StateUpdatePayload) {
    // Use {:?} debug formatting for the struct log
    println!("[RUST Emit Helper] Emitting fethr-update-ui-state payload: {:?}", payload);
    let _ = app_handle.emit_all("fethr-update-ui-state", payload); // Emit the struct
}
fn emit_start_recording(app_handle: &AppHandle) {
    println!("[RUST Emit Helper] Emitting fethr-start-recording");
    let _ = app_handle.emit_all("fethr-start-recording", ());
}
fn emit_stop_transcribe(app_handle: &AppHandle) {
    println!("[RUST Emit Helper] Emitting fethr-stop-and-transcribe");
    // Get auto_paste setting from loaded config
    let auto_paste_enabled = {
        let settings_guard = SETTINGS.lock().unwrap();
        settings_guard.auto_paste
    };
    println!("[RUST Emit Helper] Auto-paste enabled: {}", auto_paste_enabled);
    let _ = app_handle.emit_all("fethr-stop-and-transcribe", auto_paste_enabled);
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).exists() { return Ok(()); }
    std::fs::remove_file(path).map_err(|e| format!("Failed to delete file: {:?}", e))
}