// src-tauri/src/word_usage_tracker.rs
//
// Tracks usage frequency of dictionary words to prioritize them in Whisper prompts
// Lightweight implementation using in-memory tracking with periodic persistence

use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use chrono::{DateTime, Utc, Duration};
use serde::{Serialize, Deserialize};

/// Maximum number of words to include in Whisper prompt
const MAX_PROMPT_WORDS: usize = 30;

/// Days to consider for "recent" usage
const RECENT_DAYS: i64 = 7;

/// Global word usage tracker
static WORD_USAGE: Lazy<Mutex<WordUsageTracker>> = Lazy::new(|| {
    Mutex::new(WordUsageTracker::new())
});

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WordUsage {
    pub word: String,
    pub use_count: u32,
    pub last_used: DateTime<Utc>,
}

pub struct WordUsageTracker {
    /// Map of word (lowercase) to usage data
    usage_map: HashMap<String, WordUsage>,
}

impl WordUsageTracker {
    fn new() -> Self {
        Self {
            usage_map: HashMap::new(),
        }
    }
    
    /// Record that a word was used in a transcription
    fn record_usage(&mut self, word: &str) {
        let key = word.to_lowercase();
        let now = Utc::now();
        
        match self.usage_map.get_mut(&key) {
            Some(usage) => {
                usage.use_count += 1;
                usage.last_used = now;
            }
            None => {
                self.usage_map.insert(key, WordUsage {
                    word: word.to_string(),
                    use_count: 1,
                    last_used: now,
                });
            }
        }
    }
    
    /// Get the most frequently used words from the recent period
    fn get_high_priority_words(&self, dictionary_words: &[String], limit: usize) -> Vec<String> {
        let recent_cutoff = Utc::now() - Duration::days(RECENT_DAYS);
        
        // Create a map of lowercase dictionary words to their original casing
        let _dict_map: HashMap<String, &String> = dictionary_words.iter()
            .map(|w| (w.to_lowercase(), w))
            .collect();
        
        // Score each dictionary word based on usage
        let mut scored_words: Vec<(String, f64)> = dictionary_words.iter()
            .filter_map(|word| {
                let key = word.to_lowercase();
                
                // Get usage data if it exists
                if let Some(usage) = self.usage_map.get(&key) {
                    // Calculate score based on frequency and recency
                    let recency_score = if usage.last_used > recent_cutoff {
                        1.0
                    } else {
                        // Decay score based on how old the last use is
                        let days_old = (Utc::now() - usage.last_used).num_days() as f64;
                        (1.0 / (1.0 + days_old / 30.0)).max(0.1)
                    };
                    
                    let frequency_score = (usage.use_count as f64).log2() + 1.0;
                    let total_score = frequency_score * recency_score;
                    
                    Some((word.clone(), total_score))
                } else {
                    // Include unused words with low score
                    Some((word.clone(), 0.1))
                }
            })
            .collect();
        
        // Sort by score (highest first)
        scored_words.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        
        // Return top words up to the limit
        scored_words.into_iter()
            .take(limit)
            .map(|(word, _)| word)
            .collect()
    }
}

/// Public API for word usage tracking
pub struct UsageTracker;

impl UsageTracker {
    /// Record usage of words found in a transcription
    pub fn record_transcription_words(transcription: &str, dictionary_words: &[String]) {
        let mut tracker = WORD_USAGE.lock().unwrap();
        
        // Create lowercase set of dictionary words for fast lookup
        let dict_set: std::collections::HashSet<String> = dictionary_words.iter()
            .map(|w| w.to_lowercase())
            .collect();
        
        // Check each word in the transcription
        for word in transcription.split_whitespace() {
            // Remove basic punctuation
            let clean_word = word.trim_matches(|c: char| !c.is_alphanumeric());
            let lowercase = clean_word.to_lowercase();
            
            // If this word is in our dictionary, record its usage
            if dict_set.contains(&lowercase) {
                // Find the original casing from dictionary
                if let Some(dict_word) = dictionary_words.iter()
                    .find(|w| w.to_lowercase() == lowercase) {
                    tracker.record_usage(dict_word);
                }
            }
        }
    }
    
    /// Get prioritized words for Whisper prompt
    pub fn get_prompt_words(all_dictionary_words: &[String]) -> (Vec<String>, usize) {
        let tracker = WORD_USAGE.lock().unwrap();
        
        // Always include high-frequency recent words
        let mut prompt_words = tracker.get_high_priority_words(all_dictionary_words, MAX_PROMPT_WORDS);
        
        // If we have space, add some unused words to give them a chance
        if prompt_words.len() < MAX_PROMPT_WORDS {
            let used_set: std::collections::HashSet<_> = prompt_words.iter()
                .map(|w| w.to_lowercase())
                .collect();
            
            // Add unused words
            for word in all_dictionary_words {
                if !used_set.contains(&word.to_lowercase()) {
                    prompt_words.push(word.clone());
                    if prompt_words.len() >= MAX_PROMPT_WORDS {
                        break;
                    }
                }
            }
        }
        
        let total_words = all_dictionary_words.len();
        (prompt_words, total_words)
    }
    
    /// Load usage data from persistent storage
    pub fn load_from_file(path: &std::path::Path) -> Result<(), String> {
        if !path.exists() {
            return Ok(()); // No file yet, start fresh
        }
        
        let data = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read usage file: {}", e))?;
        
        let usage_list: Vec<WordUsage> = serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse usage data: {}", e))?;
        
        let mut tracker = WORD_USAGE.lock().unwrap();
        tracker.usage_map.clear();
        
        for usage in usage_list {
            tracker.usage_map.insert(usage.word.to_lowercase(), usage);
        }
        
        Ok(())
    }
    
    /// Save usage data to persistent storage
    #[allow(dead_code)]
    pub fn save_to_file(path: &std::path::Path) -> Result<(), String> {
        let tracker = WORD_USAGE.lock().unwrap();
        
        let usage_list: Vec<&WordUsage> = tracker.usage_map.values().collect();
        
        let json = serde_json::to_string_pretty(&usage_list)
            .map_err(|e| format!("Failed to serialize usage data: {}", e))?;
        
        std::fs::write(path, json)
            .map_err(|e| format!("Failed to write usage file: {}", e))?;
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_usage_tracking() {
        let mut tracker = WordUsageTracker::new();
        
        // Record some usage
        tracker.record_usage("Cursor");
        tracker.record_usage("cursor"); // Should count as same word
        tracker.record_usage("Panjeet");
        
        assert_eq!(tracker.usage_map.get("cursor").unwrap().use_count, 2);
        assert_eq!(tracker.usage_map.get("panjeet").unwrap().use_count, 1);
    }
    
    #[test]
    fn test_priority_sorting() {
        let mut tracker = WordUsageTracker::new();
        
        // Simulate usage patterns
        for _ in 0..10 {
            tracker.record_usage("FrequentWord");
        }
        for _ in 0..3 {
            tracker.record_usage("OccasionalWord");
        }
        tracker.record_usage("RareWord");
        
        let dictionary = vec![
            "FrequentWord".to_string(),
            "OccasionalWord".to_string(),
            "RareWord".to_string(),
            "UnusedWord".to_string(),
        ];
        
        let priority = tracker.get_high_priority_words(&dictionary, 3);
        
        // Most used word should be first
        assert_eq!(priority[0], "FrequentWord");
        assert_eq!(priority[1], "OccasionalWord");
        assert_eq!(priority[2], "RareWord");
    }
}