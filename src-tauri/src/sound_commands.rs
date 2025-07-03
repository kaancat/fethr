use tauri::AppHandle;
use crate::config::SETTINGS;

#[tauri::command]
pub fn get_sound_info(app_handle: AppHandle) -> Result<serde_json::Value, String> {
    use serde_json::json;
    
    let settings = SETTINGS.lock().unwrap();
    let sounds_config = settings.sounds.clone();
    drop(settings);
    
    // Get paths where sounds might be located
    let mut sound_paths = Vec::new();
    
    // Production path
    if let Some(prod_path) = app_handle.path_resolver().resolve_resource("sounds") {
        sound_paths.push(("production", prod_path.to_string_lossy().to_string()));
    }
    
    // Development path
    #[cfg(debug_assertions)]
    if let Ok(mut dev_path) = std::env::current_exe() {
        dev_path.pop();
        dev_path.pop();
        dev_path.pop();
        dev_path.push("resources");
        dev_path.push("sounds");
        sound_paths.push(("development", dev_path.to_string_lossy().to_string()));
    }
    
    // User config path
    if let Some(mut config_path) = app_handle.path_resolver().app_config_dir() {
        config_path.push("sounds");
        sound_paths.push(("user_config", config_path.to_string_lossy().to_string()));
    }
    
    Ok(json!({
        "enabled": sounds_config.enabled,
        "volume": sounds_config.volume,
        "start_sound": sounds_config.start_sound,
        "stop_sound": sounds_config.stop_sound,
        "paths": sound_paths,
    }))
}