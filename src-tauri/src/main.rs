#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Core Tauri imports
use tauri::{AppHandle, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem, CustomMenuItem, Position, LogicalPosition};

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
use std::collections::HashMap;

// Crates
use arboard;
use crossbeam_channel::{unbounded, Receiver, Sender};
use enigo::{Enigo, Key, Settings, Direction, Keyboard}; // <<< Use Keyboard trait
use rdev::{listen, Event, EventType, Key as RdevKey};
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
mod dictionary_corrector; // <<< REPLACED: Simple dictionary correction module
mod common_words; // <<< ADDED: Common words whitelist protection
mod word_usage_tracker; // <<< ADDED: Track dictionary word usage
mod whisper_variations; // <<< ADDED: Handle common Whisper transcription variations
mod user_statistics; // User statistics tracking for Supabase
mod audio_devices; // Audio device management

// Export modules for cross-file references
pub use config::SETTINGS; // Export SETTINGS for use by other modules
pub use config::AppSettings; // Export AppSettings for use by other modules
pub use config::PillPosition; // Export PillPosition enum
pub use config::{AudioDeviceInfo, AudioSettings, HotkeySettings}; // Export audio and hotkey types

// Import necessary types from submodules
use crate::transcription::TranscriptionState; // Make sure TranscriptionState is pub in transcription.rs

// --- ADD HistoryEntry Struct ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HistoryEntry {
    timestamp: String,
    text: String,
}
// --- END HistoryEntry Struct ---

// --- ADD Dashboard Stats Struct ---
#[derive(Serialize, Debug)]
pub struct DashboardStats {
    total_words: usize,
    total_transcriptions: usize,
    weekly_streak: usize,
    today_words: usize,
    average_words_per_session: usize,
    dictionary_size: usize,
    most_active_hour: usize,
    recent_transcriptions: Vec<HistoryEntry>,
}
// --- END Dashboard Stats Struct ---

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

// --- Improved rdev 2.0 Implementation ---
// Key detection event for the improved hotkey system
#[derive(Debug, Clone)]
pub struct HotkeyEvent {
    pub key: String,
    pub event_type: HotkeyEventType,
    pub timestamp: Instant,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HotkeyEventType {
    KeyPress,
    KeyRelease,
}

lazy_static! {
    // Auth state tracking (keep this)
    static ref AUTH_STATE: Mutex<AuthState> = Mutex::new(AuthState {
        is_authenticated: false,
        user_id: None,
    });
    
    // Recording state for the hotkey actions
    static ref RECORDING_STATE: Mutex<AppRecordingState> = Mutex::new(AppRecordingState::Idle);
    
    // Improved state tracking for rdev 2.0
    static ref HOTKEY_STATE: Mutex<HotkeyState> = Mutex::new(HotkeyState::new());
    
    // Channel for hotkey events
    static ref HOTKEY_CHANNEL: (Sender<HotkeyEvent>, Receiver<HotkeyEvent>) = unbounded();
    
    // Currently held modifiers (for complex key detection)
    static ref HELD_MODIFIERS: Mutex<HashMap<String, Instant>> = Mutex::new(HashMap::new());
    
    // AltGr special handling state
    static ref ALTGR_STATE: Mutex<AltGrState> = Mutex::new(AltGrState::new());
    
    // Comprehensive key name mapping
    static ref KEY_NAME_MAP: HashMap<RdevKey, String> = create_key_name_map();
}

#[derive(Debug, Clone)]
struct AuthState {
    is_authenticated: bool,
    user_id: Option<String>,
}

// --- Improved State Management for rdev 2.0 ---
#[derive(Debug, Clone)]
struct HotkeyState {
    last_event_time: Instant,
    hotkey_pressed_at: Option<Instant>,
    is_hotkey_held: bool,
    recording_mode: RecordingMode,
}

impl HotkeyState {
    fn new() -> Self {
        Self {
            last_event_time: Instant::now(),
            hotkey_pressed_at: None,
            is_hotkey_held: false,
            recording_mode: RecordingMode::Toggle,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum RecordingMode {
    Toggle,
    PushToTalk,
}

// Special state for AltGr handling
#[derive(Debug, Clone)]
struct AltGrState {
    control_pressed_at: Option<Instant>,
    expecting_altgr: bool,
}

impl AltGrState {
    fn new() -> Self {
        Self {
            control_pressed_at: None,
            expecting_altgr: false,
        }
    }
}

const TAP_MAX_DURATION_MS: u128 = 300;
const HOTKEY_DEBOUNCE_MS: u128 = 50; // Minimum time between hotkey events
const RAPID_FIRE_THRESHOLD_MS: u128 = 100; // If events come faster than this, it's likely typing
const PUSH_TO_TALK_TIMEOUT_MS: u128 = 150; // Time to wait for key release in push-to-talk mode
const ALTGR_SEQUENCE_TIMEOUT_MS: u128 = 20; // Max time between Control and AltGr events

// --- Comprehensive Key Mapping for rdev 2.0 ---
fn create_key_name_map() -> HashMap<RdevKey, String> {
    let mut map = HashMap::new();
    
    // Alphabet keys
    map.insert(RdevKey::KeyA, "A".to_string());
    map.insert(RdevKey::KeyB, "B".to_string());
    map.insert(RdevKey::KeyC, "C".to_string());
    map.insert(RdevKey::KeyD, "D".to_string());
    map.insert(RdevKey::KeyE, "E".to_string());
    map.insert(RdevKey::KeyF, "F".to_string());
    map.insert(RdevKey::KeyG, "G".to_string());
    map.insert(RdevKey::KeyH, "H".to_string());
    map.insert(RdevKey::KeyI, "I".to_string());
    map.insert(RdevKey::KeyJ, "J".to_string());
    map.insert(RdevKey::KeyK, "K".to_string());
    map.insert(RdevKey::KeyL, "L".to_string());
    map.insert(RdevKey::KeyM, "M".to_string());
    map.insert(RdevKey::KeyN, "N".to_string());
    map.insert(RdevKey::KeyO, "O".to_string());
    map.insert(RdevKey::KeyP, "P".to_string());
    map.insert(RdevKey::KeyQ, "Q".to_string());
    map.insert(RdevKey::KeyR, "R".to_string());
    map.insert(RdevKey::KeyS, "S".to_string());
    map.insert(RdevKey::KeyT, "T".to_string());
    map.insert(RdevKey::KeyU, "U".to_string());
    map.insert(RdevKey::KeyV, "V".to_string());
    map.insert(RdevKey::KeyW, "W".to_string());
    map.insert(RdevKey::KeyX, "X".to_string());
    map.insert(RdevKey::KeyY, "Y".to_string());
    map.insert(RdevKey::KeyZ, "Z".to_string());
    
    // Number keys
    map.insert(RdevKey::Num0, "0".to_string());
    map.insert(RdevKey::Num1, "1".to_string());
    map.insert(RdevKey::Num2, "2".to_string());
    map.insert(RdevKey::Num3, "3".to_string());
    map.insert(RdevKey::Num4, "4".to_string());
    map.insert(RdevKey::Num5, "5".to_string());
    map.insert(RdevKey::Num6, "6".to_string());
    map.insert(RdevKey::Num7, "7".to_string());
    map.insert(RdevKey::Num8, "8".to_string());
    map.insert(RdevKey::Num9, "9".to_string());
    
    // Function keys
    map.insert(RdevKey::F1, "F1".to_string());
    map.insert(RdevKey::F2, "F2".to_string());
    map.insert(RdevKey::F3, "F3".to_string());
    map.insert(RdevKey::F4, "F4".to_string());
    map.insert(RdevKey::F5, "F5".to_string());
    map.insert(RdevKey::F6, "F6".to_string());
    map.insert(RdevKey::F7, "F7".to_string());
    map.insert(RdevKey::F8, "F8".to_string());
    map.insert(RdevKey::F9, "F9".to_string());
    map.insert(RdevKey::F10, "F10".to_string());
    map.insert(RdevKey::F11, "F11".to_string());
    map.insert(RdevKey::F12, "F12".to_string());
    
    // Modifier keys
    map.insert(RdevKey::ControlLeft, "Ctrl".to_string());
    map.insert(RdevKey::ControlRight, "ControlRight".to_string());
    map.insert(RdevKey::AltGr, "AltGr".to_string());
    map.insert(RdevKey::Alt, "Alt".to_string());
    map.insert(RdevKey::ShiftLeft, "Shift".to_string());
    map.insert(RdevKey::ShiftRight, "ShiftRight".to_string());
    map.insert(RdevKey::MetaLeft, "Cmd".to_string());
    map.insert(RdevKey::MetaRight, "Cmd".to_string());
    
    // Arrow keys
    map.insert(RdevKey::UpArrow, "Up".to_string());
    map.insert(RdevKey::DownArrow, "Down".to_string());
    map.insert(RdevKey::LeftArrow, "Left".to_string());
    map.insert(RdevKey::RightArrow, "Right".to_string());
    
    // Special keys
    map.insert(RdevKey::Space, "Space".to_string());
    map.insert(RdevKey::Return, "Enter".to_string());
    map.insert(RdevKey::Tab, "Tab".to_string());
    map.insert(RdevKey::Escape, "Escape".to_string());
    map.insert(RdevKey::Backspace, "Backspace".to_string());
    map.insert(RdevKey::Delete, "Delete".to_string());
    
    map
}

// --- Improved Key Detection Logic ---
fn rdev_key_to_string(key: &RdevKey) -> Option<String> {
    KEY_NAME_MAP.get(key).cloned()
}

fn update_modifier_state(key: &str, is_pressed: bool) {
    let mut modifiers = HELD_MODIFIERS.lock().unwrap();
    if is_pressed {
        modifiers.insert(key.to_string(), Instant::now());
    } else {
        modifiers.remove(key);
    }
}

fn is_modifier_key(key: &str) -> bool {
    matches!(key, "Ctrl" | "ControlRight" | "Alt" | "AltGr" | "Shift" | "ShiftRight" | "Cmd")
}

fn is_hotkey_match(key: &str, settings: &HotkeySettings, held_modifiers: &HashMap<String, Instant>) -> bool {
    // Check if the main key matches
    if key != settings.key {
        return false;
    }
    
    // For standalone modifier keys, ensure no other modifiers are held
    if is_modifier_key(key) && settings.modifiers.is_empty() {
        // Special case: AltGr might have ControlLeft held due to Windows behavior
        if key == "AltGr" {
            // On Windows, AltGr sends Ctrl+AltGr, so we need to allow Ctrl to be held
            for (held_key, _) in held_modifiers {
                if held_key != "Ctrl" && held_key != "ControlLeft" && held_key != key {
                    return false;
                }
            }
            return true;
        }
        
        // For other standalone modifiers, only the key itself should be in held_modifiers
        // (this happens during release events)
        for (held_key, _) in held_modifiers {
            if held_key != key {
                return false;
            }
        }
        return true;
    }
    
    // For key combinations, check all required modifiers are held
    if !settings.modifiers.is_empty() {
        for required_mod in &settings.modifiers {
            let is_held = held_modifiers.keys().any(|k| k == required_mod);
            if !is_held {
                return false;
            }
        }
    }
    
    true
}

// Removed obsolete Tauri GlobalShortcut mapping function

// --- rdev Event Callback ---
fn rdev_callback(event: Event) {
    match event.event_type {
        EventType::KeyPress(key) => {
            if let Some(key_name) = rdev_key_to_string(&key) {
                // Handle AltGr special case on Windows
                if key == RdevKey::AltGr {
                    let mut altgr_state = ALTGR_STATE.lock().unwrap();
                    // Check if we recently saw a Control press
                    if let Some(ctrl_time) = altgr_state.control_pressed_at {
                        if ctrl_time.elapsed().as_millis() < ALTGR_SEQUENCE_TIMEOUT_MS {
                            // This is part of the AltGr sequence, remove the false Control
                            let mut modifiers = HELD_MODIFIERS.lock().unwrap();
                            modifiers.remove("Ctrl");
                            modifiers.remove("ControlLeft");
                        }
                    }
                    altgr_state.control_pressed_at = None;
                    altgr_state.expecting_altgr = false;
                } else if key == RdevKey::ControlLeft {
                    // Mark that we might be starting an AltGr sequence
                    let mut altgr_state = ALTGR_STATE.lock().unwrap();
                    altgr_state.control_pressed_at = Some(Instant::now());
                    altgr_state.expecting_altgr = true;
                }
                
                // Send key press event BEFORE updating modifier state
                // This is critical for standalone modifier keys to work
                let event = HotkeyEvent {
                    key: key_name.clone(),
                    event_type: HotkeyEventType::KeyPress,
                    timestamp: Instant::now(),
                };
                let _ = HOTKEY_CHANNEL.0.send(event);
                
                // Update modifier state AFTER sending the event
                if is_modifier_key(&key_name) {
                    update_modifier_state(&key_name, true);
                }
            }
        }
        EventType::KeyRelease(key) => {
            if let Some(key_name) = rdev_key_to_string(&key) {
                // Send key release event BEFORE updating modifier state
                // This ensures proper detection for standalone modifiers
                let event = HotkeyEvent {
                    key: key_name.clone(),
                    event_type: HotkeyEventType::KeyRelease,
                    timestamp: Instant::now(),
                };
                let _ = HOTKEY_CHANNEL.0.send(event);
                
                // Update modifier state AFTER sending the event
                if is_modifier_key(&key_name) {
                    update_modifier_state(&key_name, false);
                }
            }
        }
        _ => {} // Ignore other event types
    }
}

// Removed obsolete get_supported_keys function

// --- rdev 2.0 Hotkey System ---

/// Starts the rdev listener thread
fn start_hotkey_listener() -> Result<JoinHandle<()>, String> {
    println!("[RDEV 2.0] Starting hotkey listener thread");
    
    let handle = thread::spawn(|| {
        match listen(rdev_callback) {
            Ok(()) => println!("[RDEV 2.0] Listener thread ended normally"),
            Err(e) => eprintln!("[RDEV 2.0 ERROR] Listener thread error: {:?}", e),
        }
    });
    
    Ok(handle)
}

/// Process hotkey events from the rdev listener
fn process_hotkey_events(app_handle: AppHandle) {
    println!("[RDEV 2.0] Starting hotkey event processor");
    
    loop {
        match HOTKEY_CHANNEL.1.recv() {
            Ok(event) => {
                process_hotkey_event(event, &app_handle);
            }
            Err(e) => {
                eprintln!("[RDEV 2.0 ERROR] Channel receive error: {:?}", e);
                break;
            }
        }
    }
}

/// Process individual hotkey event
fn process_hotkey_event(event: HotkeyEvent, app_handle: &AppHandle) {
    // Special handling for UI-triggered events
    if event.key == "UI_CLICK" {
        handle_ui_click_event(event, app_handle);
        return;
    }
    
    // Get hotkey settings
    let hotkey_settings = {
        match SETTINGS.lock() {
            Ok(settings) => settings.hotkey.clone(),
            Err(_) => {
                eprintln!("[RDEV 2.0 ERROR] Failed to access settings");
                return;
            }
        }
    };
    
    if !hotkey_settings.enabled {
        return;
    }
    
    // Special handling: ignore ControlLeft events when AltGr is the hotkey
    // (Windows sends ControlLeft+AltGr for AltGr key)
    if event.key == "Ctrl" && hotkey_settings.key == "AltGr" {
        // Check if we're expecting an AltGr
        let altgr_state = ALTGR_STATE.lock().unwrap();
        if altgr_state.expecting_altgr {
            println!("[RDEV 2.0] Ignoring ControlLeft - expecting AltGr");
            return;
        }
    }
    
    // Apply intelligent debouncing
    {
        let mut state = HOTKEY_STATE.lock().unwrap();
        let elapsed = state.last_event_time.elapsed().as_millis();
        
        // For press events when we're already holding, ignore (key repeat)
        if event.event_type == HotkeyEventType::KeyPress && state.is_hotkey_held {
            // Allow through if it's been a while (might be a legitimate re-press)
            if elapsed < 500 {
                return;
            }
        }
        
        // For very rapid events of the same type, ignore
        if elapsed < HOTKEY_DEBOUNCE_MS {
            return;
        }
        
        state.last_event_time = event.timestamp;
    }
    
    // Get current modifiers for matching
    let held_modifiers = HELD_MODIFIERS.lock().unwrap().clone();
    
    // Check if this key event matches our hotkey
    let is_match = is_hotkey_match(&event.key, &hotkey_settings, &held_modifiers);
    
    if !is_match {
        // Debug log for non-matching events
        if is_modifier_key(&event.key) || event.key == hotkey_settings.key {
            println!("[RDEV 2.0] Key {} did not match hotkey. Settings key: {}, Held modifiers: {:?}", 
                event.key, hotkey_settings.key, held_modifiers.keys().collect::<Vec<_>>());
        }
        return;
    }
    
    match event.event_type {
        HotkeyEventType::KeyPress => {
            handle_hotkey_press(app_handle, &hotkey_settings);
        }
        HotkeyEventType::KeyRelease => {
            handle_hotkey_release(app_handle, &hotkey_settings);
        }
    }
}

/// Handle UI-triggered click events (mouse click on pill)
fn handle_ui_click_event(event: HotkeyEvent, app_handle: &AppHandle) {
    // Check authentication first
    let is_authenticated = {
        let auth = AUTH_STATE.lock().unwrap();
        auth.is_authenticated
    };
    
    if !is_authenticated {
        println!("[RDEV 2.0] UI Click - Authentication required");
        app_handle.emit_all("fethr-auth-required", ()).unwrap_or_else(|e| {
            println!("[RDEV 2.0] Failed to emit auth-required: {}", e);
        });
        return;
    }
    
    // Get current recording state
    let current_recording_state = {
        RECORDING_STATE.lock().unwrap().clone()
    };
    
    match event.event_type {
        HotkeyEventType::KeyPress => {
            // Mouse down - always toggle mode for UI clicks
            println!("[RDEV 2.0] UI Click - Mouse down");
        }
        HotkeyEventType::KeyRelease => {
            // Mouse up - toggle recording state
            println!("[RDEV 2.0] UI Click - Mouse up, toggling recording");
            match current_recording_state {
                AppRecordingState::Idle => start_recording(app_handle),
                AppRecordingState::Recording => stop_recording(app_handle),
                _ => {
                    println!("[RDEV 2.0] Ignoring UI click in state: {:?}", current_recording_state);
                }
            }
        }
    }
}

/// Handle hotkey press event
fn handle_hotkey_press(app_handle: &AppHandle, settings: &HotkeySettings) {
    println!("[RDEV 2.0] Hotkey pressed: {} (mode: {})", 
        settings.key, 
        if settings.hold_to_record { "push-to-talk" } else { "toggle" }
    );
    
    // Check authentication first
    let is_authenticated = {
        let auth = AUTH_STATE.lock().unwrap();
        auth.is_authenticated
    };
    
    if !is_authenticated {
        println!("[RDEV 2.0] Authentication required");
        app_handle.emit_all("fethr-auth-required", ()).unwrap_or_else(|e| {
            println!("[RDEV 2.0] Failed to emit auth-required: {}", e);
        });
        return;
    }
    
    let mut state = HOTKEY_STATE.lock().unwrap();
    
    // Prevent key repeat spam - ignore if we already have a press registered
    if state.is_hotkey_held && state.hotkey_pressed_at.is_some() {
        println!("[RDEV 2.0] Ignoring key repeat - already pressed");
        return;
    }
    
    state.hotkey_pressed_at = Some(Instant::now());
    state.is_hotkey_held = true;
    state.recording_mode = if settings.hold_to_record {
        RecordingMode::PushToTalk
    } else {
        RecordingMode::Toggle
    };
    
    // Get current recording state
    let current_recording_state = {
        RECORDING_STATE.lock().unwrap().clone()
    };
    
    println!("[RDEV 2.0] Current recording state: {:?}", current_recording_state);
    
    // For push-to-talk mode, start recording immediately
    if settings.hold_to_record {
        if current_recording_state == AppRecordingState::Idle {
            println!("[RDEV 2.0] Starting push-to-talk recording");
            drop(state); // Release lock before starting recording
            start_recording(app_handle);
        } else {
            println!("[RDEV 2.0] Not starting push-to-talk - already in state: {:?}", current_recording_state);
        }
    } else {
        // Toggle mode - will be handled on release
        println!("[RDEV 2.0] Toggle mode - waiting for release");
    }
}

/// Handle hotkey release event  
fn handle_hotkey_release(app_handle: &AppHandle, settings: &HotkeySettings) {
    println!("[RDEV 2.0] Hotkey released: {} (mode: {})", 
        settings.key,
        if settings.hold_to_record { "push-to-talk" } else { "toggle" }
    );
    
    let mut state = HOTKEY_STATE.lock().unwrap();
    state.is_hotkey_held = false;
    
    // Check if we actually saw a press event (to avoid spurious releases)
    if state.hotkey_pressed_at.is_none() {
        println!("[RDEV 2.0] Ignoring release - no corresponding press event");
        return;
    }
    
    let press_duration = state.hotkey_pressed_at
        .map(|t| t.elapsed().as_millis())
        .unwrap_or(0);
    
    println!("[RDEV 2.0] Press duration: {}ms", press_duration);
    
    // Get current recording state
    let current_recording_state = {
        RECORDING_STATE.lock().unwrap().clone()
    };
    
    println!("[RDEV 2.0] Current recording state: {:?}", current_recording_state);
    
    // CRITICAL: Use the current settings mode, not the stored one
    let is_push_to_talk = settings.hold_to_record;
    
    if is_push_to_talk {
        // Push-to-talk: Always stop on release if recording
        if current_recording_state == AppRecordingState::Recording {
            println!("[RDEV 2.0] Stopping push-to-talk recording");
            // Clear the press timestamp before dropping lock
            state.hotkey_pressed_at = None;
            drop(state); // Release lock before stopping recording
            stop_recording(app_handle);
        } else {
            println!("[RDEV 2.0] Not stopping push-to-talk - not in Recording state: {:?}", current_recording_state);
            state.hotkey_pressed_at = None;
        }
    } else {
        // Toggle mode: Only process if it was a tap (not a hold)
        if press_duration < TAP_MAX_DURATION_MS {
            println!("[RDEV 2.0] Toggle tap detected ({}ms < {}ms)", press_duration, TAP_MAX_DURATION_MS);
            // Clear the press timestamp before dropping lock
            state.hotkey_pressed_at = None;
            drop(state); // Release lock before toggling
            match current_recording_state {
                AppRecordingState::Idle => {
                    println!("[RDEV 2.0] Toggle: Starting recording");
                    start_recording(app_handle);
                }
                AppRecordingState::Recording => {
                    println!("[RDEV 2.0] Toggle: Stopping recording");
                    stop_recording(app_handle);
                }
                _ => {
                    println!("[RDEV 2.0] Ignoring toggle in state: {:?}", current_recording_state);
                }
            }
        } else {
            println!("[RDEV 2.0] Toggle hold detected ({}ms >= {}ms) - ignoring", press_duration, TAP_MAX_DURATION_MS);
            state.hotkey_pressed_at = None;
        }
    }
}

/// Start recording helper
fn start_recording(app_handle: &AppHandle) {
    // Check if we're already recording (safeguard)
    {
        let state = RECORDING_STATE.lock().unwrap();
        if *state != AppRecordingState::Idle {
            println!("[RDEV 2.0] Warning: Attempted to start recording while in state: {:?}", *state);
            return;
        }
    }
    
    // Update state
    {
        let mut state = RECORDING_STATE.lock().unwrap();
        *state = AppRecordingState::Recording;
    }
    
    println!("[RDEV 2.0] Starting recording");
    
    // Emit UI update and start recording
    let payload = StateUpdatePayload { 
        state: FrontendRecordingState::Recording, 
        ..Default::default() 
    };
    emit_state_update(app_handle, payload);
    emit_start_recording(app_handle);
}

/// Stop recording helper
fn stop_recording(app_handle: &AppHandle) {
    // Check if we're actually recording (safeguard)
    {
        let state = RECORDING_STATE.lock().unwrap();
        if *state != AppRecordingState::Recording {
            println!("[RDEV 2.0] Warning: Attempted to stop recording while in state: {:?}", *state);
            return;
        }
    }
    
    // Update state
    {
        let mut state = RECORDING_STATE.lock().unwrap();
        *state = AppRecordingState::Transcribing;
    }
    
    println!("[RDEV 2.0] Stopping recording");
    
    // Emit UI update and stop recording
    let payload = StateUpdatePayload { 
        state: FrontendRecordingState::Transcribing, 
        ..Default::default() 
    };
    emit_state_update(app_handle, payload);
    emit_stop_transcribe(app_handle);
}

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

// PostEventAction enum removed - Tauri GlobalShortcut handles actions directly

// Old process_hotkey_event function removed - replaced by Tauri GlobalShortcut system
// Function body removed - Tauri GlobalShortcut system replaces all this complexity

#[tauri::command]
fn signal_reset_complete(app_handle: AppHandle) {
    println!("[RUST CMD] signal_reset_complete received. Performing state reset...");

    let lifecycle = RECORDING_LIFECYCLE.lock().unwrap();
    if *lifecycle == RecordingLifecycle::Idle {
        println!("[RUST CMD] RecordingLifecycle is Idle, proceeding with state reset.");
        drop(lifecycle); // Drop lock before acquiring next

        // Reset recording state
        { 
            let mut state = RECORDING_STATE.lock().unwrap();
            *state = AppRecordingState::Idle;
            println!("[RUST CMD] Recording state forced to IDLE.");
        }
        
        // Reset hotkey state
        {
            let mut hotkey_state = HOTKEY_STATE.lock().unwrap();
            hotkey_state.hotkey_pressed_at = None;
            hotkey_state.is_hotkey_held = false;
            println!("[RUST CMD] Hotkey state cleared.");
        }

        // Emit Final IDLE State Update
        println!("[RUST CMD] Emitting final IDLE state update to frontend.");
        let final_payload = StateUpdatePayload {
            state: FrontendRecordingState::Idle,
            duration_ms: 0,
            transcription_result: None,
            error_message: None,
        };
        emit_state_update(&app_handle, final_payload);

    } else {
        println!("[RUST CMD WARNING] signal_reset_complete called, but RecordingLifecycle was {:?}. Not resetting state.", *lifecycle);
    }
}

#[tauri::command]
fn update_auth_state(is_authenticated: bool, user_id: Option<String>) -> Result<(), String> {
    let mut auth = AUTH_STATE.lock().unwrap();
    let changed = auth.is_authenticated != is_authenticated || auth.user_id != user_id;
    
    auth.is_authenticated = is_authenticated;
    auth.user_id = user_id.clone();
    
    if changed {
        println!("[RUST] Auth state updated: authenticated={}, user_id={:?}", is_authenticated, user_id);
    }
    Ok(())
}

#[tauri::command]
fn force_reset_to_idle(app_handle: AppHandle) -> Result<(), String> {
    println!("[RUST CMD] force_reset_to_idle - FORCING all states to IDLE");
    
    // Force recording lifecycle to Idle
    {
        let mut lifecycle = RECORDING_LIFECYCLE.lock().unwrap();
        println!("[RUST CMD] Current lifecycle: {:?}, forcing to Idle", *lifecycle);
        *lifecycle = RecordingLifecycle::Idle;
    }
    
    // Force recording state to Idle
    {
        let mut state = RECORDING_STATE.lock().unwrap();
        *state = AppRecordingState::Idle;
        println!("[RUST CMD] Recording state FORCED to IDLE");
    }
    
    // Reset hotkey state
    {
        let mut hotkey_state = HOTKEY_STATE.lock().unwrap();
        hotkey_state.hotkey_pressed_at = None;
        hotkey_state.is_hotkey_held = false;
        println!("[RUST CMD] Hotkey state cleared");
    }
    
    // Clear held modifiers
    {
        let mut modifiers = HELD_MODIFIERS.lock().unwrap();
        modifiers.clear();
        println!("[RUST CMD] Held modifiers cleared");
    }
    
    // Emit IDLE state to frontend
    let final_payload = StateUpdatePayload {
        state: FrontendRecordingState::Idle,
        duration_ms: 0,
        transcription_result: None,
        error_message: None,
    };
    emit_state_update(&app_handle, final_payload);
    
    println!("[RUST CMD] All states forced to IDLE and frontend notified");
    Ok(())
}

// --- Tauri Commands for Hotkey Settings ---
#[tauri::command]
async fn update_hotkey_settings(_app_handle: AppHandle, hotkey_settings: HotkeySettings) -> Result<(), String> {
    println!("[RUST CMD] Updating hotkey settings: key={}, modifiers={:?}, hold_to_record={}, enabled={}", 
        hotkey_settings.key, hotkey_settings.modifiers, hotkey_settings.hold_to_record, hotkey_settings.enabled);
    
    // Update the settings
    {
        let mut settings = SETTINGS.lock().map_err(|e| format!("Failed to lock settings: {}", e))?;
        settings.hotkey = hotkey_settings.clone();
        settings.save().map_err(|e| format!("Failed to save settings: {}", e))?;
    }
    
    // Reset hotkey state when settings change
    {
        let mut hotkey_state = HOTKEY_STATE.lock().unwrap();
        hotkey_state.hotkey_pressed_at = None;
        hotkey_state.is_hotkey_held = false;
        hotkey_state.recording_mode = if hotkey_settings.hold_to_record {
            RecordingMode::PushToTalk
        } else {
            RecordingMode::Toggle
        };
    }
    
    // Force stop any ongoing recording when hotkey settings change
    {
        let recording_state = RECORDING_STATE.lock().unwrap().clone();
        if recording_state == AppRecordingState::Recording {
            println!("[RUST CMD] Forcing stop of ongoing recording due to hotkey settings change");
            drop(recording_state);
            // Force the state to transcribing to trigger cleanup
            {
                let mut state = RECORDING_STATE.lock().unwrap();
                *state = AppRecordingState::Transcribing;
            }
            let payload = StateUpdatePayload { 
                state: FrontendRecordingState::Transcribing, 
                ..Default::default() 
            };
            emit_state_update(&app_handle, payload);
            emit_stop_transcribe(&app_handle);
        }
    }
    
    println!("[RUST CMD] Hotkey settings updated successfully");
    Ok(())
}

// --- Main Setup ---
fn main() {
    // Initialize logging
    env_logger::init();
    println!("Fethr startup - v{}", env!("CARGO_PKG_VERSION"));

    // --- Define the System Tray with Context Menu ---
    // Create context menu items for easy access to key features
    let open_settings = CustomMenuItem::new("open_settings".to_string(), "Open Settings");
    let view_history = CustomMenuItem::new("view_history".to_string(), "View History");
    let edit_dictionary = CustomMenuItem::new("edit_dictionary".to_string(), "Edit Dictionary");
    let separator1 = SystemTrayMenuItem::Separator;
    let edit_last = CustomMenuItem::new("edit_last".to_string(), "Edit Last Transcription");
    
    // Get current pill visibility state
    let pill_enabled = {
        let settings_guard = crate::config::SETTINGS.lock().unwrap();
        settings_guard.pill_enabled
    };
    let toggle_pill_text = if pill_enabled { "✓ Show Recording Pill" } else { "Show Recording Pill" };
    let toggle_pill = CustomMenuItem::new("toggle_pill".to_string(), toggle_pill_text);
    
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
            
            // --- Initialize Word Usage Tracker ---
            println!("[RUST SETUP] Initializing Word Usage Tracker...");
            let usage_path = app.path_resolver()
                .app_config_dir()
                .map(|dir| dir.join("word_usage.json"))
                .ok_or("Failed to get config dir for usage tracker")?;
            
            if let Err(e) = word_usage_tracker::UsageTracker::load_from_file(&usage_path) {
                println!("[RUST SETUP] Warning: Could not load word usage data: {}", e);
            }
            println!("[RUST SETUP] Word Usage Tracker initialized.");
            // --- End Word Usage Tracker Init ---

            // --- Debug Window Handles (Final Correction) ---
            // Checking window handles
            match app.get_window("main") {
                Some(window) => {
                    // Handle title() Result and url() Url
                    let _url_string = window.url().to_string(); // Convert tauri::Url to String
                    let _title_string = window.title() // This returns Result<String, Error>
                        .unwrap_or_else(|e| format!("Error getting title: {}", e)); // Provide fallback on error
                    // Main window found
                },
                None => eprintln!("[RUST SETUP ERROR] Could not find main window handle"),
            }
            match app.get_window("pill") {
                Some(window) => {
                    // Handle title() Result and url() Url
                    let _url_string = window.url().to_string(); // Convert tauri::Url to String
                    let _title_string = window.title() // This returns Result<String, Error>
                        .unwrap_or_else(|e| format!("Error getting title: {}", e)); // Provide fallback on error
                    // Pill window found
                },
                None => eprintln!("[RUST SETUP ERROR] Could not find pill window handle"),
            }
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

            // --- Initialize rdev 2.0 Hotkey System ---
            println!("[RDEV 2.0] Initializing hotkey system...");
            
            // Start the rdev listener thread
            match start_hotkey_listener() {
                Ok(_handle) => {
                    println!("[RDEV 2.0] Hotkey listener thread started successfully");
                    // Store the handle if needed for cleanup later
                }
                Err(e) => {
                    eprintln!("[RDEV 2.0 ERROR] Failed to start hotkey listener: {}", e);
                }
            }
            
            // Start the hotkey event processor
            let app_handle_for_processor = app.handle();
            thread::spawn(move || {
                process_hotkey_events(app_handle_for_processor);
            });
            
            println!("[RDEV 2.0] Hotkey system initialized");
            // --- End rdev 2.0 Initialization ---

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
                
                // Handle menu item clicks using tauri::async_runtime for async operations
                match id.as_str() {
                    "open_settings" => {
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = navigate_to_settings_section(app_handle, "general".to_string()).await {
                                eprintln!("[Tray Menu Error] Failed to open settings: {}", e);
                            }
                        });
                    }
                    "view_history" => {
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = navigate_to_page(app_handle, "/history".to_string()).await {
                                eprintln!("[Tray Menu Error] Failed to open history: {}", e);
                            }
                        });
                    }
                    "edit_dictionary" => {
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = navigate_to_page(app_handle, "/dictionary".to_string()).await {
                                eprintln!("[Tray Menu Error] Failed to open dictionary: {}", e);
                            }
                        });
                    }
                    "edit_last" => {
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = edit_latest_transcription(app_handle).await {
                                eprintln!("[Tray Menu Error] Failed to edit latest transcription: {}", e);
                            }
                        });
                    }
                    "toggle_pill" => {
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = toggle_recording_pill_visibility(app_handle).await {
                                eprintln!("[Tray Menu Error] Failed to toggle pill visibility: {}", e);
                            }
                        });
                    }
                    "ai_actions" => {
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = navigate_to_settings_section(app_handle, "ai_actions".to_string()).await {
                                eprintln!("[Tray Menu Error] Failed to open AI actions: {}", e);
                            }
                        });
                    }
                    "account" => {
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = navigate_to_page(app_handle, "/".to_string()).await {
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
            get_dashboard_stats,
            show_settings_window_and_focus,
            navigate_to_page,
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
            force_reset_to_idle,
            update_auth_state,
            delete_file,
            // UI-triggered hotkey events:
            trigger_press_event,
            trigger_release_event,
            // Settings Commands:
            get_settings,
            save_settings,
            get_available_models,
            // Hotkey Commands:
            update_hotkey_settings,
            // --- ADD THE NEW DICTIONARY COMMANDS ---
            dictionary_manager::get_dictionary,
            dictionary_manager::add_dictionary_word,
            dictionary_manager::delete_dictionary_word,
            dictionary_manager::check_common_words,
            dictionary_manager::get_dictionary_stats,
            dictionary_manager::export_dictionary,
            dictionary_manager::import_dictionary,
            dictionary_manager::save_dictionary_to_file,
            dictionary_manager::load_dictionary_from_file,
            // --- ADD NEW COMMAND ---
            set_pill_visibility,
            temporarily_show_pill_if_hidden,
            set_pill_position,
            set_pill_draggable,
            // Audio device commands
            get_audio_devices,
            set_audio_device,
            test_microphone_levels,
            get_current_audio_settings,
            update_audio_settings,
            // New command
            debug_window_info,
            // New command
            set_ignore_cursor_events,
            // New command
            resize_pill_window,
            // User statistics
            user_statistics::get_user_statistics
        ])
        .run(context)
        .expect("Error while running Fethr application");
}


// --- UI-Triggered Events (Mouse Click Support) ---
// UI-triggered event functions moved below to avoid duplicates

// --- rdev 2.0 Implementation Complete ---
// Improved hotkey system with bulletproof AltGr handling and comprehensive key support


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

// --- Hotkey Commands ---
// Removed obsolete get_supported_hotkeys and test_hotkey commands
// rdev 2.0 supports all keys directly

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
fn trigger_press_event(_app_handle: AppHandle) {
    println!("[RUST CMD] UI-triggered press event (mouse click)");
    
    // Simulate a hotkey press event
    let event = HotkeyEvent {
        key: "UI_CLICK".to_string(),
        event_type: HotkeyEventType::KeyPress,
        timestamp: Instant::now(),
    };
    
    let _ = HOTKEY_CHANNEL.0.send(event);
}

#[tauri::command]
fn trigger_release_event(_app_handle: AppHandle) {
    println!("[RUST CMD] UI-triggered release event (mouse release)");
    
    // Simulate a hotkey release event
    let event = HotkeyEvent {
        key: "UI_CLICK".to_string(),
        event_type: HotkeyEventType::KeyRelease,
        timestamp: Instant::now(),
    };
    
    let _ = HOTKEY_CHANNEL.0.send(event);
}

// Duplicate update_hotkey_settings removed - using the one defined earlier

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

// --- Dashboard Stats Command ---
#[tauri::command]
async fn get_dashboard_stats(app_handle: AppHandle) -> Result<DashboardStats, String> {
    use chrono::{DateTime, Utc, Duration, Datelike, Timelike};
    use std::collections::HashSet;
    
    println!("[RUST CMD] get_dashboard_stats called");
    
    // Get history
    let history_path = get_history_path(&app_handle)?;
    let history_json = fs::read_to_string(&history_path).unwrap_or_else(|_| "[]".to_string());
    let history: Vec<HistoryEntry> = serde_json::from_str(&history_json)
        .map_err(|e| format!("Failed to parse history: {}", e))?;
    
    // Get dictionary size
    let dictionary = dictionary_manager::get_dictionary(app_handle)?;
    let dictionary_size = dictionary.len();
    
    // Calculate statistics
    let now = Utc::now();
    let today_start = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
    let week_start = now - Duration::days(7);
    
    let mut total_words = 0;
    let mut today_words = 0;
    let mut hour_counts = vec![0; 24];
    let mut week_days = HashSet::new();
    
    for entry in &history {
        // Parse timestamp
        let timestamp = DateTime::parse_from_rfc3339(&entry.timestamp)
            .map(|dt| dt.with_timezone(&Utc))
            .or_else(|_| entry.timestamp.parse::<DateTime<Utc>>())
            .unwrap_or(now);
        
        // Count words
        let word_count = entry.text.split_whitespace().count();
        total_words += word_count;
        
        // Today's words
        if timestamp >= today_start {
            today_words += word_count;
        }
        
        // Weekly streak - track unique days
        if timestamp >= week_start {
            let date_str = format!("{}-{}-{}", 
                timestamp.year(), 
                timestamp.month(), 
                timestamp.day()
            );
            week_days.insert(date_str);
        }
        
        // Hour distribution
        hour_counts[timestamp.hour() as usize] += 1;
    }
    
    // Find most active hour
    let most_active_hour = hour_counts
        .iter()
        .enumerate()
        .max_by_key(|(_, count)| *count)
        .map(|(hour, _)| hour)
        .unwrap_or(0);
    
    // Average words per session
    let average_words_per_session = if history.is_empty() {
        0
    } else {
        total_words / history.len()
    };
    
    // Get recent transcriptions (last 5)
    let recent_transcriptions = history
        .iter()
        .rev()
        .take(5)
        .cloned()
        .collect();
    
    Ok(DashboardStats {
        total_words,
        total_transcriptions: history.len(),
        weekly_streak: week_days.len(),
        today_words,
        average_words_per_session,
        dictionary_size,
        most_active_hour,
        recent_transcriptions,
    })
}
// --- END Dashboard Stats Command ---

// --- Navigation Commands for System Tray Context Menu ---
// Global lock to prevent concurrent navigation operations
static NAVIGATION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tauri::command]
async fn navigate_to_page(app_handle: tauri::AppHandle, route: String) -> Result<(), String> {
    // Acquire lock to prevent concurrent navigation
    {
        let _guard = match NAVIGATION_LOCK.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                println!("[RUST CMD] Navigation already in progress, ignoring request for route: {}", route);
                return Ok(());
            }
        };
        println!("[RUST CMD] Starting navigation to route: {}", route);
    } // Guard is dropped here before any async operations
    
    // First show and focus the main window
    show_settings_window_and_focus(app_handle.clone()).await?;
    
    // Wait for window to be ready
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
    
    // Then navigate to the specific route
    if let Some(main_window) = app_handle.get_window("main") {
        if let Err(e) = main_window.emit("navigate-to-route", &route) {
            return Err(format!("Failed to emit navigation event: {}", e));
        }
        println!("[RUST CMD] Successfully navigated to route: {}", route);
    }
    Ok(())
}

#[tauri::command]
async fn navigate_to_settings_section(app_handle: tauri::AppHandle, section: String) -> Result<(), String> {
    // Acquire lock to prevent concurrent navigation
    {
        let _guard = match NAVIGATION_LOCK.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                println!("[RUST CMD] Navigation already in progress, ignoring request for settings section: {}", section);
                return Ok(());
            }
        };
        println!("[RUST CMD] Starting navigation to settings section: {}", section);
    } // Guard is dropped here before any async operations
    
    // First show and focus the settings window
    show_settings_window_and_focus(app_handle.clone()).await?;
    
    // Navigate to settings page first
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    
    if let Some(main_window) = app_handle.get_window("main") {
        if let Err(e) = main_window.emit("navigate-to-route", "/settings") {
            return Err(format!("Failed to emit settings navigation event: {}", e));
        }
    }
    
    // Wait for settings page to load
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
    
    // Then emit an event to navigate to the specific section
    if let Some(main_window) = app_handle.get_window("main") {
        if let Err(e) = main_window.emit("navigate-to-section", &section) {
            return Err(format!("Failed to emit section navigation event: {}", e));
        }
        println!("[RUST CMD] Successfully navigated to settings section: {}", section);
    }
    Ok(())
}

#[tauri::command]
async fn edit_latest_transcription(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Acquire lock to prevent concurrent navigation
    {
        let _guard = match NAVIGATION_LOCK.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                println!("[RUST CMD] Navigation already in progress, ignoring edit transcription request");
                return Ok(());
            }
        };
        println!("[RUST CMD] Starting edit latest transcription");
    } // Guard is dropped here before any async operations
    
    // First navigate to history page
    navigate_to_page(app_handle.clone(), "/history".to_string()).await?;
    
    // Wait a bit for the page to load and set up event listeners
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    // Then emit event to edit latest transcription (this event already exists in the frontend)
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
                // Update the setting to match the new state
                let new_visibility = !is_visible;
                {
                    let mut settings_guard = crate::config::SETTINGS.lock().unwrap();
                    settings_guard.pill_enabled = new_visibility;
                    // Save settings to persist the change
                    let _ = settings_guard.save();
                }
                
                // Now actually show/hide the window
                if new_visibility {
                    if let Err(e) = pill_window.show() {
                        return Err(format!("Failed to show pill window: {}", e));
                    }
                    println!("[RUST CMD] Recording pill shown and setting updated");
                } else {
                    if let Err(e) = pill_window.hide() {
                        return Err(format!("Failed to hide pill window: {}", e));
                    }
                    println!("[RUST CMD] Recording pill hidden and setting updated");
                }
                
                // Update tray menu to reflect new state
                update_tray_menu(&app_handle);
                
                Ok(())
            }
            Err(e) => Err(format!("Failed to check pill window visibility: {}", e))
        }
    } else {
        Err("Pill window not found".to_string())
    }
}

// Helper function to update tray menu with current state
fn update_tray_menu(app_handle: &tauri::AppHandle) {
    // Get current pill visibility state
    let pill_enabled = {
        let settings_guard = crate::config::SETTINGS.lock().unwrap();
        settings_guard.pill_enabled
    };
    
    // Create new menu with updated checkmark
    let open_settings = CustomMenuItem::new("open_settings".to_string(), "Open Settings");
    let view_history = CustomMenuItem::new("view_history".to_string(), "View History");
    let edit_dictionary = CustomMenuItem::new("edit_dictionary".to_string(), "Edit Dictionary");
    let separator1 = SystemTrayMenuItem::Separator;
    let edit_last = CustomMenuItem::new("edit_last".to_string(), "Edit Last Transcription");
    
    let toggle_pill_text = if pill_enabled { "✓ Show Recording Pill" } else { "Show Recording Pill" };
    let toggle_pill = CustomMenuItem::new("toggle_pill".to_string(), toggle_pill_text);
    
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
    
    // Update the system tray menu
    if let Err(e) = app_handle.tray_handle().set_menu(tray_menu) {
        println!("[RUST] Failed to update tray menu: {}", e);
    }
}

// --- ADD Command to Show/Focus Settings Window ---
#[tauri::command]
async fn show_settings_window_and_focus(app_handle: tauri::AppHandle) -> Result<(), String> {
    let window_label = "main";
    match app_handle.get_window(window_label) {
        Some(window) => {
            println!("[RUST CMD] Found settings window ('{}'). Attempting show/focus...", window_label);
            
            // Show window
            if let Err(e) = window.show() {
                let err_msg = format!("Failed to show window '{}': {}", window_label, e);
                eprintln!("[RUST CMD ERROR] {}", err_msg);
                return Err(err_msg);
            }
            
            // Small delay to ensure window is visible
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            
            // Unminimize window
            if let Err(e) = window.unminimize() {
                println!("[RUST CMD WARN] Failed to unminimize window '{}': {}", window_label, e);
            }
            
            // Another small delay before focusing
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            
            // Set focus
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
    // Update the setting first
    {
        let mut settings_guard = crate::config::SETTINGS.lock().unwrap();
        settings_guard.pill_enabled = visible;
        // Save settings to persist the change
        let _ = settings_guard.save();
    }
    
    if let Some(pill_window) = app_handle.get_window("pill") {
        if visible {
            log::info!("[CMD set_pill_visibility] Attempting to show pill window.");
            match pill_window.show() {
                Ok(_) => {
                    log::info!("[CMD set_pill_visibility] Pill window shown successfully.");
                    
                    // Apply saved position
                    let position = {
                        let settings_guard = crate::config::SETTINGS.lock().unwrap();
                        settings_guard.pill_position
                    };
                    
                    // Use the set_pill_position logic to apply position
                    if let Err(e) = set_pill_position(app_handle.clone(), position).await {
                        log::warn!("[CMD set_pill_visibility] Failed to apply saved position: {}", e);
                    }
                    
                    // Optional: Attempt to focus after showing.
                    if let Err(e_focus) = pill_window.set_focus() {
                        log::warn!("[CMD set_pill_visibility] Failed to focus pill window after show (non-fatal): {}", e_focus);
                    }
                }
                Err(e) => {
                    log::error!("[CMD set_pill_visibility] Failed to show pill window: {}", e);
                    return Err(format!("Failed to show pill: {}", e));
                }
            }
        } else {
            log::info!("[CMD set_pill_visibility] Attempting to hide pill window.");
            pill_window.hide().map_err(|e| {
                log::error!("[CMD set_pill_visibility] Failed to hide pill window: {}", e);
                format!("Failed to hide pill: {}", e)
            })?;
        }
    } else {
        log::error!("[CMD set_pill_visibility] Pill window with label 'pill' not found.");
        return Err("Pill window not found.".to_string());
    }
    
    // Update tray menu to reflect new state
    update_tray_menu(&app_handle);
    
    Ok(())
}

#[tauri::command]
async fn temporarily_show_pill_if_hidden(app_handle: AppHandle, duration: u64) -> Result<(), String> {
    println!("[RUST] temporarily_show_pill_if_hidden called with duration: {}ms", duration);
    
    // Always try to show the pill for important messages, regardless of setting
    if let Some(pill_window) = app_handle.get_window("pill") {
        // Check current visibility
        let is_visible = pill_window.is_visible().unwrap_or(false);
        println!("[RUST] Pill window current visibility: {}", is_visible);
        
        if !is_visible {
            // Show the pill window
            println!("[RUST] Attempting to show hidden pill window");
            pill_window.show().map_err(|e| {
                println!("[RUST ERROR] Failed to show pill window: {}", e);
                format!("Failed to show pill window: {}", e)
            })?;
            
            // Force window to front
            let _ = pill_window.set_focus();
            let _ = pill_window.set_always_on_top(true);
            
            // Don't reposition - let it use the default position from tauri.conf.json
            
            println!("[RUST] Pill window shown successfully, will hide after {} ms", duration);
            
            // Schedule hiding it again after the duration
            let app_handle_clone = app_handle.clone();
            tokio::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_millis(duration)).await;
                
                // Check if pill should be hidden based on settings AND if it wasn't manually shown
                let should_hide = {
                    let settings_guard = crate::config::SETTINGS.lock().unwrap();
                    !settings_guard.pill_enabled
                };
                
                if should_hide {
                    if let Some(pill_window) = app_handle_clone.get_window("pill") {
                        // Double-check that it's still supposed to be hidden
                        // (user might have changed settings while we were waiting)
                        let still_should_hide = {
                            let settings_guard = crate::config::SETTINGS.lock().unwrap();
                            !settings_guard.pill_enabled
                        };
                        
                        if still_should_hide {
                            let _ = pill_window.set_always_on_top(false);
                            let _ = pill_window.hide();
                            println!("[RUST] Re-hiding pill window after temporary display");
                        }
                    }
                }
            });
        } else {
            println!("[RUST] Pill window is already visible");
        }
    } else {
        println!("[RUST ERROR] Pill window not found!");
        return Err("Pill window not found".to_string());
    }
    
    Ok(())
}

#[tauri::command]
async fn set_pill_position(app_handle: AppHandle, position: PillPosition) -> Result<(), String> {
    // Check if position actually changed
    let position_changed = {
        let settings_guard = crate::config::SETTINGS.lock().unwrap();
        settings_guard.pill_position != position
    };
    
    // Update the setting
    {
        let mut settings_guard = crate::config::SETTINGS.lock().unwrap();
        settings_guard.pill_position = position;
        let _ = settings_guard.save();
    }
    
    if let Some(pill_window) = app_handle.get_window("pill") {
        // Get current monitor to calculate position
        if let Ok(monitor) = pill_window.current_monitor() {
            if let Some(monitor) = monitor {
                let screen_size = monitor.size();
                let scale_factor = monitor.scale_factor();
                
                // Window dimensions (adjust these as needed)
                let window_width = 280.0;
                let window_height = 75.0;
                let margin = 30.0;
                
                // Calculate position based on enum
                let (x, y) = match position {
                    PillPosition::TopLeft => (margin, margin),
                    PillPosition::TopCenter => ((screen_size.width as f64 / scale_factor - window_width) / 2.0, margin),
                    PillPosition::TopRight => (screen_size.width as f64 / scale_factor - window_width - margin, margin),
                    PillPosition::BottomLeft => (margin, screen_size.height as f64 / scale_factor - window_height - margin - 20.0),
                    PillPosition::BottomCenter => ((screen_size.width as f64 / scale_factor - window_width) / 2.0, screen_size.height as f64 / scale_factor - window_height - margin - 20.0),
                    PillPosition::BottomRight => (screen_size.width as f64 / scale_factor - window_width - margin, screen_size.height as f64 / scale_factor - window_height - margin - 20.0),
                };
                
                // Apply position
                if let Err(e) = pill_window.set_position(Position::Logical(LogicalPosition { x, y })) {
                    return Err(format!("Failed to set pill position: {}", e));
                }
                
                if position_changed {
                    println!("[RUST] Pill position set to {:?} at ({}, {})", position, x, y);
                }
            } else {
                return Err("Could not get monitor information".to_string());
            }
        } else {
            return Err("Could not get current monitor".to_string());
        }
    } else {
        return Err("Pill window not found".to_string());
    }
    
    Ok(())
}

#[tauri::command]
async fn set_pill_draggable(app_handle: AppHandle, draggable: bool) -> Result<(), String> {
    // Update the setting
    {
        let mut settings_guard = crate::config::SETTINGS.lock().unwrap();
        settings_guard.pill_draggable = draggable;
        let _ = settings_guard.save();
    }
    
    // Emit event to frontend to update drag region
    app_handle.emit_all("pill-draggable-changed", draggable)
        .map_err(|e| format!("Failed to emit draggable event: {}", e))?;
    
    println!("[RUST] Pill draggable set to: {}", draggable);
    Ok(())
}

// Audio Device Management Commands

#[tauri::command]
async fn get_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    use crate::audio_devices::AUDIO_DEVICE_MANAGER;
    
    println!("[RUST] Getting available audio devices");
    AUDIO_DEVICE_MANAGER.refresh_devices()
}

#[tauri::command]
async fn set_audio_device(device_id: String) -> Result<(), String> {
    println!("[RUST] Setting audio device to: {}", device_id);
    
    // Verify the device exists
    use crate::audio_devices::AUDIO_DEVICE_MANAGER;
    if AUDIO_DEVICE_MANAGER.get_device_by_id(&device_id).is_none() {
        return Err(format!("Device with ID '{}' not found", device_id));
    }
    
    // Update settings
    {
        let mut settings_guard = crate::config::SETTINGS.lock().unwrap();
        settings_guard.audio.selected_input_device = Some(device_id.clone());
        let _ = settings_guard.save();
    }
    
    println!("[RUST] Audio device set successfully");
    Ok(())
}

#[tauri::command]
async fn test_microphone_levels(device_id: String, duration_ms: Option<u64>) -> Result<f32, String> {
    use crate::audio_devices::AUDIO_DEVICE_MANAGER;
    
    let test_duration = duration_ms.unwrap_or(3000); // Default 3 seconds
    println!("[RUST] Testing microphone levels for device: {} ({}ms)", device_id, test_duration);
    
    AUDIO_DEVICE_MANAGER.test_device_levels(&device_id, test_duration)
}

#[tauri::command]
async fn get_current_audio_settings() -> Result<AudioSettings, String> {
    let settings = {
        let settings_guard = crate::config::SETTINGS.lock().unwrap();
        settings_guard.audio.clone()
    };
    
    println!("[RUST] Returning current audio settings");
    Ok(settings)
}

#[tauri::command]
async fn update_audio_settings(audio_settings: AudioSettings) -> Result<(), String> {
    println!("[RUST] Updating audio settings");
    
    // Validate device if specified
    if let Some(ref device_id) = audio_settings.selected_input_device {
        use crate::audio_devices::AUDIO_DEVICE_MANAGER;
        if AUDIO_DEVICE_MANAGER.get_device_by_id(device_id).is_none() {
            return Err(format!("Device with ID '{}' not found", device_id));
        }
    }
    
    // Update settings
    {
        let mut settings_guard = crate::config::SETTINGS.lock().unwrap();
        settings_guard.audio = audio_settings;
        let _ = settings_guard.save();
    }
    
    println!("[RUST] Audio settings updated successfully");
    Ok(())
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