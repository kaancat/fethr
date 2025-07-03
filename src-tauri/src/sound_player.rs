use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::Arc;
use rodio::{OutputStream, OutputStreamHandle, Decoder, Sink};
use tauri::AppHandle;
use crate::config::SETTINGS;

pub struct SoundPlayer {
    _stream: Arc<OutputStream>,
    stream_handle: OutputStreamHandle,
}

unsafe impl Send for SoundPlayer {}
unsafe impl Sync for SoundPlayer {}

impl SoundPlayer {
    pub fn new() -> Result<Self, String> {
        let (stream, stream_handle) = OutputStream::try_default()
            .map_err(|e| format!("Failed to initialize audio output: {}", e))?;
        
        Ok(SoundPlayer {
            _stream: Arc::new(stream),
            stream_handle,
        })
    }
    
    pub fn play_start_sound(&self, app_handle: &AppHandle) {
        let (enabled, sound_name, volume) = {
            let settings = SETTINGS.lock().unwrap();
            (
                settings.sounds.enabled,
                settings.sounds.start_sound.clone(),
                settings.sounds.volume,
            )
        }; // Lock released here
        
        if !enabled {
            return;
        }
        
        if let Some(name) = sound_name {
            self.play_sound(app_handle, &name, volume);
        }
    }
    
    pub fn play_stop_sound(&self, app_handle: &AppHandle) {
        let (enabled, sound_name, volume) = {
            let settings = SETTINGS.lock().unwrap();
            (
                settings.sounds.enabled,
                settings.sounds.stop_sound.clone(),
                settings.sounds.volume,
            )
        }; // Lock released here
        
        if !enabled {
            return;
        }
        
        if let Some(name) = sound_name {
            self.play_sound(app_handle, &name, volume);
        }
    }
    
    fn play_sound(&self, app_handle: &AppHandle, sound_name: &str, volume: f32) {
        // Try multiple paths to find the sound file
        let possible_paths = vec![
            // 1. Production: bundled resources
            app_handle
                .path_resolver()
                .resolve_resource(format!("sounds/{}", sound_name)),
            
            // 2. Development: in the resources directory relative to the project
            #[cfg(debug_assertions)]
            std::env::current_exe().ok().map(|mut dev_path| {
                dev_path.pop(); // Remove executable name
                dev_path.pop(); // Remove 'debug' or 'release'
                dev_path.pop(); // Remove 'target'
                dev_path.push("resources");
                dev_path.push("sounds");
                dev_path.push(sound_name);
                dev_path
            }),
            #[cfg(not(debug_assertions))]
            None,
            
            // 3. User's config directory (for custom sounds)
            app_handle
                .path_resolver()
                .app_config_dir()
                .map(|mut p| {
                    p.push("sounds");
                    p.push(sound_name);
                    p
                }),
        ];
        
        let resource_path = possible_paths
            .into_iter()
            .flatten()
            .find(|p| p.exists())
            .unwrap_or_else(|| {
                eprintln!("[SoundPlayer] Warning: Sound file '{}' not found in any expected location", sound_name);
                PathBuf::from(sound_name)
            });
        
        println!("[SoundPlayer] Attempting to play sound: {}", resource_path.display());
        
        // Try to play the sound
        if let Ok(file) = File::open(&resource_path) {
            let reader = BufReader::new(file);
            
            if let Ok(source) = Decoder::new(reader) {
                if let Ok(sink) = Sink::try_new(&self.stream_handle) {
                    sink.set_volume(volume);
                    sink.append(source);
                    
                    // Detach the sink so it plays in the background
                    sink.detach();
                    
                    println!("[SoundPlayer] Playing sound: {} at volume: {}", sound_name, volume);
                } else {
                    eprintln!("[SoundPlayer] Failed to create audio sink");
                }
            } else {
                eprintln!("[SoundPlayer] Failed to decode audio file: {}", resource_path.display());
            }
        } else {
            eprintln!("[SoundPlayer] Sound file not found: {}", resource_path.display());
        }
    }
}

// Global sound player instance
lazy_static::lazy_static! {
    pub static ref SOUND_PLAYER: std::sync::Mutex<Option<SoundPlayer>> = std::sync::Mutex::new(None);
}

pub fn initialize_sound_player() -> Result<(), String> {
    match SoundPlayer::new() {
        Ok(player) => {
            *SOUND_PLAYER.lock().unwrap() = Some(player);
            println!("[SoundPlayer] Sound player initialized successfully");
            Ok(())
        }
        Err(e) => {
            eprintln!("[SoundPlayer] Failed to initialize: {}", e);
            Err(e)
        }
    }
}