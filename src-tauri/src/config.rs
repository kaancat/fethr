use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use directories::ProjectDirs;
use once_cell::sync::Lazy; // Use Lazy for thread-safe static initialization
use std::sync::Mutex;
use toml;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppSettings {
    #[serde(default = "default_model_name")]
    pub model_name: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_auto_paste")]
    pub auto_paste: bool,
    #[serde(default = "default_pill_enabled")]
    pub pill_enabled: bool,
    #[serde(default = "default_supabase_url")]
    pub supabase_url: String,
    #[serde(default = "default_supabase_anon_key")]
    pub supabase_anon_key: String,
    #[serde(default = "default_fuzzy_correction")]
    pub fuzzy_correction: FuzzyCorrectionSettings,
}

/// Settings for fuzzy dictionary correction
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FuzzyCorrectionSettings {
    #[serde(default = "default_fuzzy_enabled")]
    pub enabled: bool,
    #[serde(default = "default_fuzzy_sensitivity")]
    pub sensitivity: f32,
    #[serde(default = "default_fuzzy_max_corrections")]
    pub max_corrections_per_text: usize,
    #[serde(default = "default_fuzzy_preserve_case")]
    pub preserve_original_case: bool,
    #[serde(default = "default_fuzzy_correction_log")]
    pub correction_log_enabled: bool,
}

fn default_model_name() -> String {
    "ggml-tiny.en.bin".to_string()
}

fn default_language() -> String {
    "en".to_string()
}

fn default_auto_paste() -> bool {
    true
}

fn default_pill_enabled() -> bool {
    true
}

fn default_supabase_url() -> String {
    "https://dttwcuqlnfpsbkketppf.supabase.co".to_string()
}

fn default_supabase_anon_key() -> String {
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHdjdXFsbmZwc2Jra2V0cHBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY2Mzk5ODAsImV4cCI6MjA2MjIxNTk4MH0.PkcvR5uSlcXIpGP5E_jADVWDG0be5pTkqsbBxON8o8g".to_string()
}


fn default_fuzzy_correction() -> FuzzyCorrectionSettings {
    FuzzyCorrectionSettings::default()
}

fn default_fuzzy_enabled() -> bool {
    true // Enable by default for better user experience 
}

fn default_fuzzy_sensitivity() -> f32 {
    0.5 // Balanced sensitivity - aggressive enough for names but protects common words
}

fn default_fuzzy_max_corrections() -> usize {
    10 // Reasonable limit to prevent over-correction
}

fn default_fuzzy_preserve_case() -> bool {
    true // Preserve original casing
}

fn default_fuzzy_correction_log() -> bool {
    false // Logging disabled by default
}

impl Default for FuzzyCorrectionSettings {
    fn default() -> Self {
        Self {
            enabled: default_fuzzy_enabled(),
            sensitivity: default_fuzzy_sensitivity(),
            max_corrections_per_text: default_fuzzy_max_corrections(),
            preserve_original_case: default_fuzzy_preserve_case(),
            correction_log_enabled: default_fuzzy_correction_log(),
        }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            model_name: default_model_name(),
            language: default_language(),
            auto_paste: default_auto_paste(),
            pill_enabled: default_pill_enabled(),
            supabase_url: default_supabase_url(),
            supabase_anon_key: default_supabase_anon_key(),
            fuzzy_correction: default_fuzzy_correction(),
        }
    }
}

// Use Lazy<Mutex<AppSettings>> for thread-safe static config
pub static SETTINGS: Lazy<Mutex<AppSettings>> = Lazy::new(|| {
    Mutex::new(load_settings())
});

// Helper function to get project directories
fn get_project_dirs() -> Option<ProjectDirs> {
    // Use unique qualifiers for your app
    ProjectDirs::from("com", "fethr", "Fethr")
}

// Helper function to get the config file path
fn get_config_path() -> Option<PathBuf> {
    get_project_dirs().map(|proj_dirs| {
        let config_dir = proj_dirs.config_dir();
        config_dir.join("config.toml")
    })
}

// Function to load settings from TOML file or create default
fn load_settings() -> AppSettings {
    if let Some(config_path) = get_config_path() {
        println!("[Config] Trying to load settings from: {}", config_path.display());
        match fs::read_to_string(&config_path) {
            Ok(contents) => {
                match toml::from_str::<AppSettings>(&contents) {
                    Ok(settings) => {
                         println!("[Config] Settings loaded successfully: model='{}', lang='{}', paste={}, pill={}", 
                                  settings.model_name, settings.language, settings.auto_paste, settings.pill_enabled);
                         return settings;
                    },
                    Err(e) => {
                        eprintln!("[Config ERROR] Failed to parse config file '{}': {}", config_path.display(), e);
                        // Fall through to create default if parsing fails
                    }
                }
            },
            Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => {
                 println!("[Config] Config file not found. Creating default.");
                 // Fall through to create default
            },
            Err(e) => {
                 eprintln!("[Config ERROR] Failed to read config file '{}': {}", config_path.display(), e);
                 // Fall through to create default on other read errors
            }
        }
    } else {
         eprintln!("[Config ERROR] Could not determine project directories. Using default settings.");
    }

    // --- Create or use Default Settings ---
    let default_settings = AppSettings::default();
    if let Some(config_path) = get_config_path() {
        // Ensure the config directory exists
        if let Some(config_dir) = config_path.parent() {
            if !config_dir.exists() {
                 println!("[Config] Creating config directory: {}", config_dir.display());
                 if let Err(e) = fs::create_dir_all(config_dir) {
                     eprintln!("[Config ERROR] Failed to create config directory: {}", e);
                     // Proceed with default settings in memory anyway
                     return default_settings;
                 }
            }
        }

        // Try to save the default config file
        match toml::to_string_pretty(&default_settings) {
            Ok(toml_string) => {
                println!("[Config] Saving default settings to: {}", config_path.display());
                if let Err(e) = fs::write(&config_path, toml_string) {
                    eprintln!("[Config ERROR] Failed to write default config file: {}", e);
                } else {
                    println!("[Config] Default config file created successfully.");
                }
            },
            Err(e) => {
                 eprintln!("[Config ERROR] Failed to serialize default settings: {}", e);
            }
        }
    }

    default_settings // Return defaults if loading/saving failed
}

// Implementation for saving settings
impl AppSettings {
    pub fn config_path() -> Result<PathBuf, String> {
        get_config_path().ok_or_else(|| "Could not determine config path".to_string())
    }
    
    pub fn save(&self) -> Result<(), String> {
        let config_path = Self::config_path()?;
        println!("[CONFIG] Attempting to save settings to: {}", config_path.display());
        
        if let Some(dir) = config_path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
        }
        
        let config_content = toml::to_string_pretty(self).map_err(|e| format!("Failed to serialize: {}", e))?;
        fs::write(&config_path, config_content).map_err(|e| format!("Failed to write config: {}", e))?;
        
        println!("[CONFIG] Settings saved successfully.");
        Ok(())
    }
} 