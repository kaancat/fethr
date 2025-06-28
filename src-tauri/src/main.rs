#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Core Tauri imports
use tauri::{AppHandle, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem, CustomMenuItem};

// Standard library imports
use std::path::PathBuf;
use std::fs::{self, File}; // Add fs module for directory operations
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
use log::{info, error}; // Use log crate for messages
use serde::{Serialize, Deserialize}; // <-- Add serde import

// Import our modules
mod transcription;
mod audio_manager_rs;
mod config; // Add config module
mod custom_prompts; // <-- ADDED THIS LINE
mod dictionary_manager; // <<< ADD THIS MODULE DECLARATION
mod ai_actions_manager; // <<< ADD THIS MODULE DECLARATION
mod supabase_manager; // <<< ADDED THIS LINE
mod fuzzy_dictionary; // <<< ADDED FUZZY DICTIONARY MODULE

// Export modules for cross-file references
pub use config::SETTINGS; // Export SETTINGS for use by other modules
pub use config::AppSettings; // Export AppSettings for use by other modules

// Import necessary types from submodules
use crate::transcription::TranscriptionState; // Make sure TranscriptionState is pub in transcription.rs

// --- ADD HistoryEntry Struct ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HistoryEntry {
    timestamp: String,
    text: String,
}
// --- END HistoryEntry Struct ---

// --- ADD AI Action Structs ---
/*
#[derive(Deserialize, Debug)] // For receiving from Vercel
struct AiActionResponse {
    result: Option<String>, // Make it optional to handle potential nulls/errors
    error: Option<String>,
}
*/

// --- ADD Vercel Proxy URL Constant ---
// const VERCEL_PROXY_URL: &str = "https://fethr-ai-proxy.vercel.app/api/ai-proxy";
// --- END Constant ---

// --- PASTE AudioDevice Struct ---
// #[derive(Serialize, Debug, Clone)]
// pub struct AudioDevice { 
//     name: String,
// }
// --- END AudioDevice Struct ---

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

// --- ADD History Path Helper ---
// Helper function to get the path to history.json
pub fn get_history_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app_handle.path_resolver().app_config_dir()
        .ok_or_else(|| "Failed to get app config directory".to_string())?;
    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    Ok(config_dir.join("history.json"))
}
// --- END History Path Helper ---

// --- Helper Functions ---
#[tauri::command] // Make it a Tauri command
fn get_default_prompt_for_action(action_id: String) -> Result<String, String> {
    println!("[RUST HELPER] get_default_prompt_for_action called for: {}", action_id);
    let common_output_constraint = "\n\nIMPORTANT: Your entire response must consist ONLY of the processed text. Do not include any introductory phrases, explanations, apologies, self-references, or surrounding quotation marks unless the quotation marks were explicitly part of the original spoken content being transformed.";

    match action_id.to_lowercase().as_str() {
        "written_form" => Ok(
            format!(
                r#"Directly reformat the following verbatim spoken transcription into polished, grammatically correct written text.
Focus ONLY on the following transformations:
1. Correct grammar and punctuation.
2. Remove verbal disfluencies (e.g., "um", "uh", "you know", "like", "so", "actually", "basically", "right?").
3. Rephrase awkward, run-on, or overly conversational sentences for clarity and conciseness suitable for written text.
4. Ensure sentence structure is complete and flows well.
Maintain the original speaker's core meaning, intent, and tone.
Do NOT interpret the content, add new information, summarize, or change the core message.
{}

Spoken Transcription:
"${{text}}"

Refined Written Text:"#,
                common_output_constraint
            )
        ),
        "summarize" => Ok(
            format!(
                r#"Provide a concise, neutral summary of the key information and main conclusions from the following text.
Aim for a few sentences or a short paragraph, depending on the original length.
The summary should be objective and easy to understand.
{}

Original Text:
"${{text}}"

Summary:"#,
                common_output_constraint
            )
        ),
        "email" => Ok(
            format!(
                r#"Transform the following text into a well-structured, professional email body suitable for standard business communication.
Ensure it is polite, clear, and maintains a natural yet professional tone.
Do not include a subject line, salutation (like "Dear..."), closing (like "Sincerely..."), or any other elements outside the main body content.
{}

Original Text for Email Body:
"${{text}}"

Email Body Content:"#,
                common_output_constraint
            )
        ),
        "promptify" => Ok(
            format!(
                r#"A user has provided the following spoken idea for a prompt they intend to give to an AI.
Your task is to meticulously refine this idea into a highly effective, clear, and concise prompt, suitable for a large language model.
Apply prompt engineering best practices:
- Be extremely specific about the desired output format if implied by the user's idea.
- Clearly and unambiguously define the task, question, or desired outcome.
- Suggest a specific role or persona for the target AI only if it clearly enhances the prompt's effectiveness for the user's stated goal.
- If the user mentions constraints, specific details, a particular style, or examples, ensure these are precisely and clearly incorporated in the refined prompt.
- Structure the refined prompt for optimal clarity and to guide the AI effectively.
{}

User's Spoken Idea for a Prompt:
"${{text}}"

Refined Prompt:"#,
                common_output_constraint
            )
        ),
        _ => {
            let err_msg = format!("[RUST HELPER ERROR] Unknown action_id for default prompt: {}", action_id);
            eprintln!("{}", err_msg);
            // Defaulting to a generic Written Form prompt template as a fallback
            Ok(format!(
                r#"Directly reformat the following verbatim spoken transcription into polished, grammatically correct written text.
Focus ONLY on the following transformations:
1. Correct grammar and punctuation.
2. Remove verbal disfluencies (e.g., "um", "uh", "you know", "like", "so", "actually", "basically", "right?").
3. Rephrase awkward, run-on, or overly conversational sentences for clarity and conciseness suitable for written text.
4. Ensure sentence structure is complete and flows well.
Maintain the original speaker's core meaning, intent, and tone.
Do NOT interpret the content, add new information, summarize, or change the core message.
{}

Spoken Transcription:
"${{text}}"

Refined Written Text:"#,
                common_output_constraint
            ))
        }
    }
}

// --- Commands ---

#[tauri::command]
async fn paste_text_to_cursor() -> Result<(), String> {
    println!("[RUST PASTE] Received request to simulate paste shortcut.");
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

    // --- Define the System Tray with Context Menu ---
    // Create context menu items for easy access to key features
    let open_settings = CustomMenuItem::new("open_settings".to_string(), "Open Settings");
    let view_history = CustomMenuItem::new("view_history".to_string(), "View History");
    let edit_dictionary = CustomMenuItem::new("edit_dictionary".to_string(), "Edit Dictionary");
    let separator1 = SystemTrayMenuItem::Separator;
    let edit_last = CustomMenuItem::new("edit_last".to_string(), "Edit Last Transcription");
    let toggle_pill = CustomMenuItem::new("toggle_pill".to_string(), "Toggle Recording Pill");
    let separator2 = SystemTrayMenuItem::Separator;
    let ai_actions = CustomMenuItem::new("ai_actions".to_string(), "AI Actions");
    let account = CustomMenuItem::new("account".to_string(), "Account & Usage");
    let separator3 = SystemTrayMenuItem::Separator;
    let quit = CustomMenuItem::new("quit".to_string(), "Quit Fethr");
    
    let tray_menu = SystemTrayMenu::new()
        .add_item(open_settings)
        .add_item(view_history)
        .add_item(edit_dictionary)
        .add_native_item(separator1)
        .add_item(edit_last)
        .add_item(toggle_pill)
        .add_native_item(separator2)
        .add_item(ai_actions)
        .add_item(account)
        .add_native_item(separator3)
        .add_item(quit);
    
    let system_tray = SystemTray::new().with_menu(tray_menu);

    let context = tauri::generate_context!(); // Regenerate context

    // Create the app builder
    tauri::Builder::default()
        // Initialize transcription state properly using init_transcription
        .setup(move |app| -> Result<(), Box<dyn Error>> {
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

            // --- Initialize Dictionary Manager ---
            println!("[RUST SETUP] Initializing DictionaryManager...");
            dictionary_manager::init_dictionary_manager(&app.handle());
            println!("[RUST SETUP] DictionaryManager initialized.");
            // --- End Dictionary Manager Init ---

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

            // --- Log Pill Window Position ---
            match pill_window.outer_position() {
                Ok(pos) => {
                    println!("[RUST SETUP] Pill window initial outer position reported by Tauri: x={}, y={}", pos.x, pos.y);
                }
                Err(e) => {
                    println!("[RUST SETUP ERROR] Failed to get pill window initial position: {}", e);
                }
            }
            // --- End Log ---
            
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

            // --- NEW: Initial Pill Visibility based on Config ---
            let initial_pill_enabled = {
                let settings_guard = crate::config::SETTINGS.lock().unwrap();
                settings_guard.pill_enabled
            };
            log::info!("[RUST SETUP] Initial pill_enabled state from config: {}", initial_pill_enabled);

            if !initial_pill_enabled {
                if let Some(pill_window) = app.get_window("pill") {
                    log::info!("[RUST SETUP] Pill is configured to be disabled on startup. Hiding pill window.");
                    if let Err(e) = pill_window.hide() {
                        log::error!("[RUST SETUP] Failed to hide pill window on startup: {}", e);
                    }
                } else {
                    log::error!("[RUST SETUP] Could not find pill window to hide on startup.");
                }
            }
            // --- END NEW ---

            // Setup complete
            log::info!("[RUST SETUP] Application setup complete.");

            Ok(())
        })
        // Add window event handler to intercept close requests for main window
        .on_window_event(|event| {
            match event.event() {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let window = event.window();
                    if window.label() == "main" {
                        // This is the 'main' (likely settings) window
                        println!("[WINDOW EVENT] Close requested for 'main' window. Preventing close and hiding.");
                        api.prevent_close(); // Prevent the window from actually closing
                        if let Err(e) = window.hide() { // Hide the window instead
                            eprintln!("[WINDOW EVENT ERROR] Failed to hide main window: {}", e);
                        }
                    } else {
                        // This is for any OTHER window (e.g., "pill" or future windows)
                        // Allow them to close normally by NOT calling api.prevent_close()
                        println!("[WINDOW EVENT] Close requested for window: '{}'. Allowing close.", window.label());
                        // No api.prevent_close() here, so the window will close by default.
                    }
                }
                // Minimized event does not exist directly in Tauri v1 WindowEvent enum for on_window_event.
                // Default behavior for minimization is handled by the catch-all arm below.
                _ => {
                     // println!("[WINDOW EVENT] Ignoring event: {:?}", event.event()); // Optional: Log ignored events
                } // Default catch-all still ignores other events
            }
        })
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { position: _, size: _, .. } => {
                info!("[Tray Event] Left click detected.");
                if let Some(main_window) = app.get_window("main") {
                    info!("[Tray Event] Attempting to unminimize, show and focus main window.");
                    // Attempt to unminimize first
                    if let Err(e) = main_window.unminimize() {
                        error!("[Tray Event WARN] Failed to unminimize window (may already be unminimized): {}", e);
                    }
                    // Attempt to show
                    if let Err(e) = main_window.show() {
                        error!("[Tray Event ERROR] Failed to show window: {}", e);
                    }
                    // Attempt to focus
                    if let Err(e) = main_window.set_focus() {
                        error!("[Tray Event ERROR] Failed to focus window: {}", e);
                    }
                } else {
                    error!("[Tray Event WARNING] Could not get main window handle on tray click.");
                }
            }
            SystemTrayEvent::RightClick { position: _, size: _, .. } => {
                println!("[Tray Event] Right click detected - context menu should appear automatically.");
            }
            SystemTrayEvent::DoubleClick { position: _, size: _, .. } => {
                println!("[Tray Event] Double click detected (No action defined).");
            }
            SystemTrayEvent::MenuItemClick { id, .. } => {
                println!("[Tray Event] Menu item clicked: {}", id);
                let app_handle = app.app_handle();
                
                // Handle menu item clicks using tokio::spawn for async operations
                match id.as_str() {
                    "open_settings" => {
                        tokio::spawn(async move {
                            if let Err(e) = navigate_to_settings_section(app_handle, "general".to_string()).await {
                                eprintln!("[Tray Menu Error] Failed to open settings: {}", e);
                            }
                        });
                    }
                    "view_history" => {
                        tokio::spawn(async move {
                            if let Err(e) = navigate_to_settings_section(app_handle, "history".to_string()).await {
                                eprintln!("[Tray Menu Error] Failed to open history: {}", e);
                            }
                        });
                    }
                    "edit_dictionary" => {
                        tokio::spawn(async move {
                            if let Err(e) = navigate_to_settings_section(app_handle, "dictionary".to_string()).await {
                                eprintln!("[Tray Menu Error] Failed to open dictionary: {}", e);
                            }
                        });
                    }
                    "edit_last" => {
                        tokio::spawn(async move {
                            if let Err(e) = edit_latest_transcription(app_handle).await {
                                eprintln!("[Tray Menu Error] Failed to edit latest transcription: {}", e);
                            }
                        });
                    }
                    "toggle_pill" => {
                        tokio::spawn(async move {
                            if let Err(e) = toggle_recording_pill_visibility(app_handle).await {
                                eprintln!("[Tray Menu Error] Failed to toggle pill visibility: {}", e);
                            }
                        });
                    }
                    "ai_actions" => {
                        tokio::spawn(async move {
                            if let Err(e) = navigate_to_settings_section(app_handle, "ai_actions".to_string()).await {
                                eprintln!("[Tray Menu Error] Failed to open AI actions: {}", e);
                            }
                        });
                    }
                    "account" => {
                        tokio::spawn(async move {
                            if let Err(e) = navigate_to_settings_section(app_handle, "account".to_string()).await {
                                eprintln!("[Tray Menu Error] Failed to open account: {}", e);
                            }
                        });
                    }
                    "quit" => {
                        println!("[Tray Event] Quit requested via context menu");
                        app.exit(0);
                    }
                    _ => {
                        println!("[Tray Event] Unknown menu item: {}", id);
                    }
                }
            }
            _ => {} // Handle other tray events if necessary
        })
        .invoke_handler(tauri::generate_handler![
            // REMOVE extra brackets and the command
            // Core Commands:
            audio_manager_rs::start_backend_recording,
            audio_manager_rs::stop_backend_recording,
            transcription::transcribe_audio_file,
            transcription::get_history, // History command
            update_history_entry,
            show_settings_window_and_focus,
            navigate_to_settings_section,
            edit_latest_transcription,
            toggle_recording_pill_visibility,
            ai_actions_manager::perform_ai_action, // <<< ADD NEW ONE
            get_default_prompt_for_action,
            custom_prompts::save_custom_prompt,
            custom_prompts::get_custom_prompt,
            custom_prompts::delete_custom_prompt,
            // Utility Commands:
            write_to_clipboard_command,
            paste_text_to_cursor,
            signal_reset_complete,
            delete_file,
            // UI-triggered hotkey events:
            trigger_press_event,
            trigger_release_event,
            // Settings Commands:
            get_settings,
            save_settings,
            get_available_models,
            // --- ADD THE NEW DICTIONARY COMMANDS ---
            dictionary_manager::get_dictionary,
            dictionary_manager::add_dictionary_word,
            dictionary_manager::delete_dictionary_word,
            dictionary_manager::save_dictionary_to_file,
            dictionary_manager::load_dictionary_from_file,
            // --- ADD NEW COMMAND ---
            set_pill_visibility,
            // New command
            debug_window_info,
            // New command
            set_ignore_cursor_events,
            // New command
            resize_pill_window
        ])
        .run(context)
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

// --- Settings Commands ---

#[tauri::command]
async fn get_settings(_app_handle: AppHandle) -> Result<AppSettings, String> {
    info!("[Settings] Getting current application settings");
    
    // Access settings through the mutex
    let settings_guard = SETTINGS.lock()
        .map_err(|_| "Failed to lock settings mutex".to_string())?;
    
    // Clone the settings to return to the frontend
    let cloned_settings = settings_guard.clone();
    info!("[Settings] Retrieved settings: model_name={}, language={}, auto_paste={}", 
          cloned_settings.model_name, cloned_settings.language, cloned_settings.auto_paste);
    
    Ok(cloned_settings)
}

#[tauri::command]
async fn save_settings(settings: AppSettings, _app_handle: AppHandle) -> Result<(), String> {
    info!("[Settings] Saving new settings: model_name={}, language={}, auto_paste={}", 
          settings.model_name, settings.language, settings.auto_paste);
    
    // Access settings through the mutex
    let mut settings_guard = SETTINGS.lock()
        .map_err(|_| "Failed to lock settings mutex".to_string())?;
    
    // Update the settings in memory
    *settings_guard = settings.clone();
    
    // Persist settings to file
    settings_guard.save()
        .map_err(|e| format!("Failed to save settings to file: {}", e))?;
    
    info!("[Settings] Settings saved successfully");
    Ok(())
}

#[tauri::command]
async fn get_available_models(_app_handle: AppHandle) -> Result<Vec<String>, String> {
    info!("[Settings] Getting available Whisper models");
    
    // For debug builds, check vendor/models directory in the project
    let model_path = if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let vendor_dir = manifest_dir.join("vendor").join("models");
        info!("[Settings] Debug mode - looking for models in: {:?}", vendor_dir);
        vendor_dir
    } else {
        // For release builds, use Tauri's resource resolver
        let resource_path = _app_handle.path_resolver()
            .resolve_resource("vendor/models")
            .ok_or_else(|| "Could not resolve resource path vendor/models".to_string())?;
        info!("[Settings] Release mode - looking for models in: {:?}", resource_path);
        resource_path
    };
    
    // Read the directory contents
    let entries = fs::read_dir(&model_path)
        .map_err(|e| format!("Failed to read models directory {:?}: {}", model_path, e))?;
    
    // Collect model filenames
    let mut model_files = Vec::new();
    for entry_result in entries {
        let entry = entry_result.map_err(|e| format!("Error reading directory entry: {}", e))?;
        let path = entry.path();
        if path.is_file() {
            if let Some(filename_os) = path.file_name() {
                if let Some(filename_str) = filename_os.to_str() {
                    if filename_str.ends_with(".bin") {
                        model_files.push(filename_str.to_string());
                    }
                }
            }
        }
    }
    
    info!("[Settings] Found models: {:?}", model_files);
    Ok(model_files)
}

#[tauri::command]
fn trigger_press_event() {
    println!("[RUST CMD] trigger_press_event received from UI.");
    let event = HotkeyEvent::Press(Instant::now());
    if let Err(e) = EVENT_SENDER.send(event) {
        error!("[RUST CMD ERROR] Failed to send Press event via channel: {}", e);
    }
}

#[tauri::command]
fn trigger_release_event() {
    println!("[RUST CMD] trigger_release_event received from UI.");
    let event = HotkeyEvent::Release(Instant::now());
    if let Err(e) = EVENT_SENDER.send(event) {
        error!("[RUST CMD ERROR] Failed to send Release event via channel: {}", e);
    }
}

// --- ADD Update History Command ---
#[tauri::command]
async fn update_history_entry(app_handle: AppHandle, timestamp: String, new_text: String) -> Result<(), String> {
    println!("Backend: Received update request for timestamp: {}", timestamp); // Add logging

    let history_path = get_history_path(&app_handle)?;

    // Read the existing history
    let history_json = fs::read_to_string(&history_path)
        // If file doesn't exist or error reading, return error or empty history?
        // For update, we expect it to exist. Let's error out.
        .map_err(|e| format!("Failed to read history file: {}", e))?;

    // Deserialize into a Vec<HistoryEntry>
    let mut history: Vec<HistoryEntry> = serde_json::from_str(&history_json)
        .map_err(|e| format!("Failed to parse history JSON: {}", e))?;

    // Find the entry and update it
    let mut found = false;
    for entry in history.iter_mut() {
        if entry.timestamp == timestamp {
            println!("Backend: Found entry, updating text."); // Add logging
            entry.text = new_text.clone(); // Update the text
            found = true;
            break;
        }
    }

    if !found {
         eprintln!("Backend: History entry with timestamp {} not found.", timestamp); // Use eprintln for errors
         return Err(format!("History entry with timestamp {} not found", timestamp));
    }

    // Serialize the updated history back to JSON
    let updated_history_json = serde_json::to_string_pretty(&history) // Use pretty for readability
        .map_err(|e| format!("Failed to serialize updated history: {}", e))?;

    // Write the updated JSON back to the file
    fs::write(&history_path, updated_history_json)
        .map_err(|e| format!("Failed to write updated history file: {}", e))?;

    println!("Backend: History file updated successfully."); // Add logging

    // Emit event to notify frontend of the update
    if let Err(e) = app_handle.emit_all("fethr-history-updated", ()) {
         eprintln!("Backend: Failed to emit fethr-history-updated event: {}", e); // Log event emission errors
    } else {
         println!("Backend: Emitted fethr-history-updated event."); // Log event emission success
    }

    Ok(()) // Return success
}
// --- END Update History Command ---

// --- Navigation Commands for System Tray Context Menu ---
#[tauri::command]
async fn navigate_to_settings_section(app_handle: tauri::AppHandle, section: String) -> Result<(), String> {
    // First show and focus the settings window
    show_settings_window_and_focus(app_handle.clone()).await?;
    
    // Then emit an event to navigate to the specific section
    if let Some(main_window) = app_handle.get_window("main") {
        if let Err(e) = main_window.emit("navigate-to-section", &section) {
            return Err(format!("Failed to emit navigation event: {}", e));
        }
        println!("[RUST CMD] Navigated to settings section: {}", section);
    }
    Ok(())
}

#[tauri::command]
async fn edit_latest_transcription(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Show settings window and navigate to history section
    show_settings_window_and_focus(app_handle.clone()).await?;
    
    // Emit event to edit latest transcription (this event already exists in the frontend)
    if let Some(main_window) = app_handle.get_window("main") {
        if let Err(e) = main_window.emit("fethr-edit-latest-history", "") {
            return Err(format!("Failed to emit edit-latest event: {}", e));
        }
        println!("[RUST CMD] Triggered edit latest transcription");
    }
    Ok(())
}

#[tauri::command]
async fn toggle_recording_pill_visibility(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(pill_window) = app_handle.get_window("pill") {
        match pill_window.is_visible() {
            Ok(is_visible) => {
                if is_visible {
                    if let Err(e) = pill_window.hide() {
                        return Err(format!("Failed to hide pill window: {}", e));
                    }
                    println!("[RUST CMD] Recording pill hidden");
                } else {
                    if let Err(e) = pill_window.show() {
                        return Err(format!("Failed to show pill window: {}", e));
                    }
                    println!("[RUST CMD] Recording pill shown");
                }
                Ok(())
            }
            Err(e) => Err(format!("Failed to check pill window visibility: {}", e))
        }
    } else {
        Err("Pill window not found".to_string())
    }
}

// --- ADD Command to Show/Focus Settings Window ---
#[tauri::command]
async fn show_settings_window_and_focus(app_handle: tauri::AppHandle) -> Result<(), String> {
    let window_label = "main"; // Assuming "main" is your settings window
    match app_handle.get_window(window_label) {
        Some(window) => {
            println!("[RUST CMD] Found settings window ('{}'). Attempting show/focus...", window_label);
            if let Err(e) = window.show() {
                let err_msg = format!("Failed to show window '{}': {}", window_label, e);
                eprintln!("[RUST CMD ERROR] {}", err_msg);
                return Err(err_msg);
            }
            if let Err(e) = window.unminimize() {
                println!("[RUST CMD WARN] Failed to unminimize window '{}': {}", window_label, e);
            }
            if let Err(e) = window.set_focus() {
                let err_msg = format!("Failed to set focus on window '{}': {}", window_label, e);
                eprintln!("[RUST CMD ERROR] {}", err_msg);
                return Err(err_msg);
            }
            println!("[RUST CMD] Successfully showed and focused window '{}'.", window_label);
            Ok(())
        }
        None => {
            let err_msg = format!("Could not find settings window with label '{}'.", window_label);
            eprintln!("[RUST CMD ERROR] {}", err_msg);
            Err(err_msg)
        }
    }
}
// --- END Command ---

#[tauri::command]
async fn set_pill_visibility(app_handle: AppHandle, visible: bool) -> Result<(), String> {
    if let Some(pill_window) = app_handle.get_window("pill") {
        if visible {
            log::info!("[CMD set_pill_visibility] Attempting to show pill window.");
            match pill_window.show() {
                Ok(_) => {
                    log::info!("[CMD set_pill_visibility] Pill window shown successfully.");
                    // Optional: Attempt to focus after showing.
                    if let Err(e_focus) = pill_window.set_focus() {
                        log::warn!("[CMD set_pill_visibility] Failed to focus pill window after show (non-fatal): {}", e_focus);
                    }
                    Ok(())
                }
                Err(e) => {
                    log::error!("[CMD set_pill_visibility] Failed to show pill window: {}", e);
                    Err(format!("Failed to show pill: {}", e))
                }
            }
        } else {
            log::info!("[CMD set_pill_visibility] Attempting to hide pill window.");
            pill_window.hide().map_err(|e| {
                log::error!("[CMD set_pill_visibility] Failed to hide pill window: {}", e);
                format!("Failed to hide pill: {}", e)
            })
        }
    } else {
        log::error!("[CMD set_pill_visibility] Pill window with label 'pill' not found.");
        Err("Pill window not found.".to_string())
    }
}

#[tauri::command]
async fn debug_window_info(app_handle: AppHandle, window_label: String) -> Result<serde_json::Value, String> {
    println!("=== 🔍 TAURI WINDOW DEBUG INFO ===");
    println!("Debugging window with label: '{}'", window_label);
    
    if let Some(window) = app_handle.get_window(&window_label) {
        let mut debug_info = serde_json::Map::new();
        
        // Window position
        match window.outer_position() {
            Ok(pos) => {
                println!("🎯 Window outer position: x={}, y={}", pos.x, pos.y);
                debug_info.insert("outer_position".to_string(), serde_json::json!({
                    "x": pos.x,
                    "y": pos.y
                }));
            }
            Err(e) => {
                println!("❌ Failed to get window outer position: {}", e);
                debug_info.insert("outer_position_error".to_string(), serde_json::Value::String(e.to_string()));
            }
        }
        
        // Window size
        match window.outer_size() {
            Ok(size) => {
                println!("📏 Window outer size: width={}, height={}", size.width, size.height);
                debug_info.insert("outer_size".to_string(), serde_json::json!({
                    "width": size.width,
                    "height": size.height
                }));
            }
            Err(e) => {
                println!("❌ Failed to get window outer size: {}", e);
                debug_info.insert("outer_size_error".to_string(), serde_json::Value::String(e.to_string()));
            }
        }
        
        // Inner size
        match window.inner_size() {
            Ok(size) => {
                println!("📐 Window inner size: width={}, height={}", size.width, size.height);
                debug_info.insert("inner_size".to_string(), serde_json::json!({
                    "width": size.width,
                    "height": size.height
                }));
            }
            Err(e) => {
                println!("❌ Failed to get window inner size: {}", e);
                debug_info.insert("inner_size_error".to_string(), serde_json::Value::String(e.to_string()));
            }
        }
        
        // Window visibility
        match window.is_visible() {
            Ok(visible) => {
                println!("👁️ Window visible: {}", visible);
                debug_info.insert("visible".to_string(), serde_json::Value::Bool(visible));
            }
            Err(e) => {
                println!("❌ Failed to check window visibility: {}", e);
                debug_info.insert("visibility_error".to_string(), serde_json::Value::String(e.to_string()));
            }
        }
        
        // Window scale factor
        match window.scale_factor() {
            Ok(scale) => {
                println!("🔍 Window scale factor: {}", scale);
                debug_info.insert("scale_factor".to_string(), serde_json::Value::Number(
                    serde_json::Number::from_f64(scale).unwrap_or(serde_json::Number::from(1))
                ));
            }
            Err(e) => {
                println!("❌ Failed to get window scale factor: {}", e);
                debug_info.insert("scale_factor_error".to_string(), serde_json::Value::String(e.to_string()));
            }
        }
        
        // Check if window is resizable, minimizable, etc.
        debug_info.insert("label".to_string(), serde_json::Value::String(window_label));
        
        println!("=== END TAURI WINDOW DEBUG ===");
        Ok(serde_json::Value::Object(debug_info))
    } else {
        let error_msg = format!("Window with label '{}' not found", window_label);
        println!("❌ {}", error_msg);
        Err(error_msg)
    }
}

#[tauri::command]
async fn set_ignore_cursor_events(app_handle: AppHandle, ignore: bool) -> Result<(), String> {
    println!("🔧 Setting ignore cursor events: {}", ignore);
    
    if let Some(window) = app_handle.get_window("pill") {
        window.set_ignore_cursor_events(ignore)
            .map_err(|e| {
                println!("❌ Failed to set ignore cursor events: {}", e);
                format!("Failed to set ignore cursor events: {}", e)
            })?;
        println!("✅ Successfully set ignore cursor events: {}", ignore);
        Ok(())
    } else {
        let error_msg = "Window 'pill' not found".to_string();
        println!("❌ {}", error_msg);
        Err(error_msg)
    }
}

#[tauri::command]
async fn resize_pill_window(app_handle: AppHandle, width: u32, height: u32) -> Result<(), String> {
    // println!("🔧 Resizing pill window to: {}×{}", width, height);
    
    if let Some(window) = app_handle.get_window("pill") {
        let logical_size = tauri::LogicalSize::new(width, height);
        
        // Perform the resize
        window.set_size(logical_size)
            .map_err(|e| {
                println!("❌ Failed to resize pill window: {}", e);
                format!("Failed to resize window: {}", e)
            })?;
        
        // Wait for resize to complete (OS-level operation)
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        
        // Verify the resize completed by checking actual size
        let mut retries = 0;
        while retries < 5 {
            match window.inner_size() {
                Ok(current_size) => {
                    if current_size.width == width && current_size.height == height {
                        // println!("✅ Resize confirmed: {}×{}", current_size.width, current_size.height);
                        break;
                    }
                }
                Err(_) => {}
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
            retries += 1;
        }
        
        // println!("✅ Window resize operation completed: {}×{}", width, height);
        Ok(())
    } else {
        let error_msg = "Window 'pill' not found".to_string();
        println!("❌ {}", error_msg);
        Err(error_msg)
    }
}