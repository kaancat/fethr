// File: src-tauri/src/custom_prompts.rs
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

const CUSTOM_PROMPTS_FILENAME: &str = "custom_prompts.json";

#[derive(Serialize, Deserialize, Debug, Default)]
struct CustomPromptsStore(HashMap<String, String>); // action_id -> prompt_text

fn get_custom_prompts_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app_handle
        .path_resolver()
        .app_config_dir()
        .ok_or_else(|| "Failed to get app config directory".to_string())?;
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    Ok(config_dir.join(CUSTOM_PROMPTS_FILENAME))
}

fn read_prompts_from_file(app_handle: &AppHandle) -> Result<CustomPromptsStore, String> {
    let path = get_custom_prompts_path(app_handle)?;
    if !path.exists() {
        return Ok(CustomPromptsStore::default()); // Return empty if file doesn't exist
    }
    let data = fs::read_to_string(path).map_err(|e| format!("Failed to read custom prompts file: {}", e))?;
    if data.trim().is_empty() {
        return Ok(CustomPromptsStore::default()); // Return empty if file is empty
    }
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse custom prompts JSON: {}", e))
}

fn write_prompts_to_file(app_handle: &AppHandle, prompts: &CustomPromptsStore) -> Result<(), String> {
    let path = get_custom_prompts_path(app_handle)?;
    let data = serde_json::to_string_pretty(prompts).map_err(|e| format!("Failed to serialize custom prompts: {}", e))?;
    fs::write(path, data).map_err(|e| format!("Failed to write custom prompts file: {}", e))
}

#[tauri::command]
pub fn save_custom_prompt(app_handle: AppHandle, action_id: String, custom_prompt: String) -> Result<(), String> {
    println!("[RUST CMD] save_custom_prompt for action_id: {}, prompt: {:.50}...", action_id, custom_prompt);
    let mut prompts = read_prompts_from_file(&app_handle)?;
    prompts.0.insert(action_id, custom_prompt);
    write_prompts_to_file(&app_handle, &prompts)
}

#[tauri::command]
pub fn get_custom_prompt(app_handle: AppHandle, action_id: String) -> Result<Option<String>, String> {
    println!("[RUST CMD] get_custom_prompt for action_id: {}", action_id);
    let prompts = read_prompts_from_file(&app_handle)?;
    Ok(prompts.0.get(&action_id).cloned())
}

#[tauri::command]
pub fn delete_custom_prompt(app_handle: AppHandle, action_id: String) -> Result<(), String> {
    println!("[RUST CMD] delete_custom_prompt for action_id: {}", action_id);
    let mut prompts = read_prompts_from_file(&app_handle)?;
    if prompts.0.remove(&action_id).is_some() {
        write_prompts_to_file(&app_handle, &prompts)
    } else {
        Ok(()) // No action needed if prompt wasn't custom
    }
} 