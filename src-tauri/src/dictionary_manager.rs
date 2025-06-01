use tauri::AppHandle;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use once_cell::sync::Lazy;

// Define the path to the dictionary file.
// It's placed in the app's config directory.
fn get_dictionary_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app_handle.path_resolver().app_config_dir()
        .ok_or_else(|| "Failed to get app config directory".to_string())?;
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    Ok(config_dir.join("custom_dictionary.json"))
}

// In-memory cache for the dictionary to avoid frequent file reads.
static DICTIONARY_CACHE: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));

// Load dictionary from file into cache. This should be called on startup or when cache is invalid.
fn load_dictionary_from_file_internal(app_handle: &AppHandle) -> Result<(), String> {
    let path = get_dictionary_path(app_handle)?;
    let mut cache = DICTIONARY_CACHE.lock().unwrap();
    if path.exists() {
        let data = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read dictionary file: {}", e))?;
        if data.trim().is_empty() {
            *cache = Vec::new(); // Handle empty file case
        } else {
            *cache = serde_json::from_str(&data)
                .map_err(|e| format!("Failed to parse dictionary JSON: {}", e))?;
        }
    } else {
        *cache = Vec::new(); // No file, so dictionary is empty
    }
    // Ensure words are lowercase and sorted for consistency
    cache.iter_mut().for_each(|word| *word = word.to_lowercase());
    cache.sort_unstable();
    cache.dedup();
    println!("[DictionaryManager] Loaded {} words into cache.", cache.len());
    Ok(())
}

// Save the current cache content to the dictionary file.
fn save_dictionary_to_file_internal(app_handle: &AppHandle) -> Result<(), String> {
    let path = get_dictionary_path(app_handle)?;
    let cache = DICTIONARY_CACHE.lock().unwrap();
    let data = serde_json::to_string_pretty(&*cache)
        .map_err(|e| format!("Failed to serialize dictionary: {}", e))?;
    fs::write(path, data)
        .map_err(|e| format!("Failed to write dictionary file: {}", e))?;
    println!("[DictionaryManager] Saved {} words from cache to file.", cache.len());
    Ok(())
}

// Command to explicitly save a list of words, overwriting the dictionary.
#[tauri::command]
pub fn save_dictionary_to_file(app_handle: AppHandle, words: Vec<String>) -> Result<(), String> {
    println!("[DictionaryManager CMD] save_dictionary_to_file called with {} words.", words.len());
    let mut cache = DICTIONARY_CACHE.lock().unwrap();
    *cache = words;
    // Ensure new words are also processed (lowercase, sorted, deduped)
    cache.iter_mut().for_each(|word| *word = word.to_lowercase());
    cache.sort_unstable();
    cache.dedup();
    drop(cache); // Release lock before calling internal save which also locks
    save_dictionary_to_file_internal(&app_handle)
}

// Command to explicitly load the dictionary from file and return its content.
#[tauri::command]
pub fn load_dictionary_from_file(app_handle: AppHandle) -> Result<Vec<String>, String> {
    println!("[DictionaryManager CMD] load_dictionary_from_file called.");
    load_dictionary_from_file_internal(&app_handle)?;
    // After loading into cache, return a clone of the cache
    Ok(DICTIONARY_CACHE.lock().unwrap().clone())
}

// Call this once in main.rs setup if you want to pre-load the dictionary.
// Or, ensure each command calls it if the cache might be stale.
// For simplicity, we'll have get_dictionary load it if the cache is empty as a fallback.
// However, a dedicated init during app setup is usually better.
pub fn init_dictionary_manager(app_handle: &AppHandle) {
    if let Err(e) = load_dictionary_from_file_internal(app_handle) {
        eprintln!("[DictionaryManager ERROR] Failed to initialize dictionary: {}", e);
    }
}

#[tauri::command]
pub fn get_dictionary(app_handle: AppHandle) -> Result<Vec<String>, String> {
    println!("[DictionaryManager] get_dictionary called.");
    // Ensure cache is loaded if it's somehow empty (e.g., first call before explicit init)
    if DICTIONARY_CACHE.lock().unwrap().is_empty() {
        load_dictionary_from_file_internal(&app_handle)?;
    }
    let cache = DICTIONARY_CACHE.lock().unwrap();
    Ok(cache.clone())
}

#[tauri::command]
pub fn add_dictionary_word(app_handle: AppHandle, word: String) -> Result<Vec<String>, String> {
    let trimmed_word = word.trim().to_lowercase();
    if trimmed_word.is_empty() {
        return Err("Word cannot be empty".to_string());
    }
    println!("[DictionaryManager] add_dictionary_word called with: '{}'", trimmed_word);

    let mut cache = DICTIONARY_CACHE.lock().unwrap();
    if !cache.contains(&trimmed_word) {
        cache.push(trimmed_word);
        cache.sort_unstable(); // Keep it sorted
        // No need to dedup if we check contains, but sort_unstable is cheap.
        drop(cache); // Release lock before saving
        save_dictionary_to_file_internal(&app_handle)?;
    } else {
        println!("[DictionaryManager] Word '{}' already exists.", trimmed_word);
    }
    // Return the updated (or current) list
    Ok(DICTIONARY_CACHE.lock().unwrap().clone())
}

#[tauri::command]
pub fn delete_dictionary_word(app_handle: AppHandle, word_to_delete: String) -> Result<Vec<String>, String> {
    let lower_word_to_delete = word_to_delete.trim().to_lowercase();
    if lower_word_to_delete.is_empty() {
        return Err("Word to delete cannot be empty".to_string());
    }
    println!("[DictionaryManager] delete_dictionary_word called for: '{}'", lower_word_to_delete);

    let mut cache = DICTIONARY_CACHE.lock().unwrap();
    let initial_len = cache.len();
    cache.retain(|w| w != &lower_word_to_delete);
    
    if cache.len() < initial_len { // If something was actually deleted
        // No need to re-sort as retain preserves order.
        drop(cache); // Release lock before saving
        save_dictionary_to_file_internal(&app_handle)?;
        println!("[DictionaryManager] Word '{}' deleted.", lower_word_to_delete);
    } else {
        println!("[DictionaryManager] Word '{}' not found for deletion.", lower_word_to_delete);
    }
    // Return the updated (or current) list
    Ok(DICTIONARY_CACHE.lock().unwrap().clone())
} 