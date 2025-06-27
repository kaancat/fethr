// src-tauri/src/fuzzy_dictionary.rs
// 
// Fuzzy dictionary correction module for post-processing transcription output
// Implements conservative Levenshtein distance matching with confidence scoring

use std::collections::HashMap;
use std::time::Instant;
use std::sync::{Arc, Mutex};
use once_cell::sync::Lazy;

/// Configuration for fuzzy dictionary correction
#[derive(Debug, Clone)]
pub struct FuzzyConfig {
    pub sensitivity: f32,              // 0.6-0.9, lower = more conservative
    pub max_corrections_per_text: usize, // Limit corrections to prevent over-correction
    pub preserve_original_case: bool,  // Maintain original casing
    pub timeout_ms: u64,              // Timeout protection
}

impl Default for FuzzyConfig {
    fn default() -> Self {
        Self {
            sensitivity: 0.6,
            max_corrections_per_text: 10,
            preserve_original_case: true,
            timeout_ms: 200,
        }
    }
}

/// Result of a fuzzy match attempt
#[derive(Debug, Clone)]
pub struct FuzzyMatch {
    pub original: String,
    pub corrected: String,
    pub confidence: f32,
    pub edit_distance: f32, // Changed to f32 for weighted distances
}

/// Pre-indexed dictionary for faster lookups
#[derive(Debug, Clone)]
struct IndexedDictionary {
    /// Words grouped by length, then by first character
    by_length_and_char: HashMap<usize, HashMap<char, Vec<String>>>,
    /// Total word count for statistics
    total_words: usize,
}

impl IndexedDictionary {
    fn new(words: &[String]) -> Self {
        let mut by_length_and_char: HashMap<usize, HashMap<char, Vec<String>>> = HashMap::new();
        
        for word in words {
            let normalized_word = normalize_text(&word.to_lowercase());
            let length = normalized_word.len(); // Use normalized length for indexing
            // Use normalized first character for indexing
            let first_char = normalized_word.chars().next().unwrap_or('_');
            
            by_length_and_char
                .entry(length)
                .or_insert_with(HashMap::new)
                .entry(first_char)
                .or_insert_with(Vec::new)
                .push(word.clone());
        }
        
        Self {
            by_length_and_char,
            total_words: words.len(),
        }
    }
    
    /// Get candidate words for a given word based on length and character similarity
    fn get_candidates(&self, word: &str, max_length_diff: usize) -> Vec<String> {
        let word_len = word.len();
        // Word is already normalized, so use its first character directly
        let first_char = word.chars().next().unwrap_or('_');
        let mut candidates = Vec::new();
        
        // Search within length range
        for target_len in word_len.saturating_sub(max_length_diff)..=word_len + max_length_diff {
            if let Some(char_map) = self.by_length_and_char.get(&target_len) {
                // First, try exact first character match
                if let Some(words) = char_map.get(&first_char) {
                    candidates.extend(words.iter().cloned());
                }
                
                // Then, try similar first characters (for typos like 'j' -> 'i')
                for (&char_key, words) in char_map.iter() {
                    if char_key != first_char && are_similar_chars(first_char, char_key) {
                        candidates.extend(words.iter().cloned());
                    }
                }
            }
        }
        
        candidates
    }
}

/// Check if two characters are similar (keyboard proximity, phonetic similarity, visual similarity)
fn are_similar_chars(c1: char, c2: char) -> bool {
    match (c1, c2) {
        // Keyboard proximity
        ('i', 'j') | ('j', 'i') => true,
        ('u', 'v') | ('v', 'u') => true,
        ('n', 'm') | ('m', 'n') => true,
        ('q', 'w') | ('w', 'q') => true,
        ('e', 'r') | ('r', 'e') => true,
        ('t', 'y') | ('y', 't') => true,
        ('a', 's') | ('s', 'a') => true,
        ('d', 'f') | ('f', 'd') => true,
        ('g', 'h') | ('h', 'g') => true,
        ('z', 'x') | ('x', 'z') => true,
        ('c', 'v') | ('v', 'c') => true,
        ('b', 'n') | ('n', 'b') => true,
        
        // Phonetic similarities (critical for name matching)
        ('t', 'c') | ('c', 't') => true,  // Tethokaya ↔ Catalkaya
        ('w', 'v') | ('v', 'w') => true,  // Windstool ↔ Vindstød
        ('k', 'c') | ('c', 'k') => true,  // Katzel ↔ Catalkaya, Katsulkaya ↔ Catalkaya
        ('p', 'b') | ('b', 'p') => true,  // Common phonetic confusion
        ('d', 't') | ('t', 'd') => true,  // Common phonetic confusion
        ('g', 'k') | ('k', 'g') => true,  // Common phonetic confusion
        ('f', 'v') | ('v', 'f') => true,  // Common phonetic confusion
        ('s', 'z') | ('z', 's') => true,  // Common phonetic confusion
        
        // Additional consonant cluster confusions
        ('j', 'y') | ('y', 'j') => true,  // Raj ↔ Ray
        ('x', 'k') | ('k', 'x') => true,  // Alex ↔ Alek
        ('q', 'k') | ('k', 'q') => true,  // Qatar ↔ Katar
        // Note: Digraphs like 'ph'→'f', 'ts'→'t' are handled in aggressive normalization
        // Note: Digraphs like 'sh'/'ch' would need special handling
        
        // Vowel substitutions (very common in speech recognition)
        ('a', 'e') | ('e', 'a') => true,
        ('a', 'i') | ('i', 'a') => true,
        ('a', 'o') | ('o', 'a') => true,
        ('e', 'i') | ('i', 'e') => true,
        ('e', 'o') | ('o', 'e') => true,
        ('i', 'o') | ('o', 'i') => true,
        ('u', 'o') | ('o', 'u') => true,
        ('y', 'i') | ('i', 'y') => true,
        
        // Silent/weak consonants that often get confused with vowels
        ('h', 'a') | ('a', 'h') => true,  // h often silent, confused with vowels
        ('h', 'e') | ('e', 'h') => true,
        ('h', 'i') | ('i', 'h') => true,
        ('l', 'r') | ('r', 'l') => true,  // Liquid consonant confusion
        
        // Additional keyboard/visual similarities
        ('l', 'k') | ('k', 'l') => true,  // Visual similarity on some fonts
        // Note: Digraphs like 'rn'→'m', 'cl'→'d' would need special handling
        
        // Visual similarity
        ('o', '0') | ('0', 'o') => true,
        ('l', '1') | ('1', 'l') => true,
        ('s', '5') | ('5', 's') => true,
        ('i', '1') | ('1', 'i') => true,
        ('o', 'q') | ('q', 'o') => true,
        ('r', 'n') | ('n', 'r') => true,
        
        // Special character mappings (for international names)
        ('ø', 'o') | ('o', 'ø') => true,  // Vindstød
        ('å', 'a') | ('a', 'å') => true,
        ('æ', 'a') | ('a', 'æ') => true,
        ('ä', 'a') | ('a', 'ä') => true,
        ('ö', 'o') | ('o', 'ö') => true,
        ('ü', 'u') | ('u', 'ü') => true,
        
        _ => false,
    }
}

/// Cache for indexed dictionaries to avoid re-indexing
static DICTIONARY_INDEX_CACHE: Lazy<Arc<Mutex<Option<(Vec<String>, IndexedDictionary)>>>> = 
    Lazy::new(|| Arc::new(Mutex::new(None)));

/// LRU Cache for recent fuzzy corrections
#[derive(Debug)]
struct LruCorrectionCache {
    /// Map from word to (correction, access_order)
    cache: HashMap<String, (Option<FuzzyMatch>, usize)>,
    /// Current access counter for LRU ordering
    access_counter: usize,
    /// Maximum cache size
    max_size: usize,
}

impl LruCorrectionCache {
    fn new(max_size: usize) -> Self {
        Self {
            cache: HashMap::new(),
            access_counter: 0,
            max_size,
        }
    }
    
    /// Get a cached correction result for a word
    fn get(&mut self, word: &str) -> Option<Option<FuzzyMatch>> {
        if let Some((correction, _)) = self.cache.get(word) {
            // Clone the correction before updating access order
            let correction_clone = correction.clone();
            
            // Update access order
            self.access_counter += 1;
            self.cache.insert(word.to_string(), (correction_clone.clone(), self.access_counter));
            
            Some(correction_clone)
        } else {
            None
        }
    }
    
    /// Cache a correction result for a word
    fn put(&mut self, word: String, correction: Option<FuzzyMatch>) {
        self.access_counter += 1;
        
        // If cache is full, remove least recently used item
        if self.cache.len() >= self.max_size && !self.cache.contains_key(&word) {
            self.evict_lru();
        }
        
        self.cache.insert(word, (correction, self.access_counter));
    }
    
    /// Remove the least recently used item from cache
    fn evict_lru(&mut self) {
        if let Some((lru_word, _)) = self.cache
            .iter()
            .min_by_key(|(_, (_, access_order))| *access_order)
            .map(|(word, (_, access_order))| (word.clone(), *access_order))
        {
            self.cache.remove(&lru_word);
            println!("[FuzzyDictionary] Evicted '{}' from LRU cache", lru_word);
        }
    }
    
    /// Clear the cache
    fn clear(&mut self) {
        self.cache.clear();
        self.access_counter = 0;
    }
    
    /// Get cache statistics
    fn stats(&self) -> (usize, usize) {
        (self.cache.len(), self.max_size)
    }
}

/// Global LRU cache for corrections
static CORRECTION_CACHE: Lazy<Arc<Mutex<LruCorrectionCache>>> = 
    Lazy::new(|| Arc::new(Mutex::new(LruCorrectionCache::new(100))));

/// Main entry point for fuzzy dictionary correction
pub fn correct_text_with_dictionary(text: &str, dictionary: &[String]) -> String {
    // Try to get configuration from global settings, fallback to defaults
    let config = get_fuzzy_config_from_settings().unwrap_or_default();
    correct_text_with_dictionary_config(text, dictionary, &config)
}

/// Debug function to test specific word matching (useful for troubleshooting)
pub fn debug_word_matching(word: &str, dictionary: &[String]) -> String {
    let config = FuzzyConfig {
        sensitivity: 0.1, // Very aggressive
        max_corrections_per_text: 1,
        preserve_original_case: true,
        timeout_ms: 1000,
    };
    
    println!("[DEBUG] Testing word '{}' against dictionary: {:?}", word, dictionary);
    
    if let Some(result) = find_best_match(word, dictionary, &config) {
        println!("[DEBUG] Match found: '{}' -> '{}' (confidence: {:.3}, distance: {:.2})", 
                 word, result.corrected, result.confidence, result.edit_distance);
        result.corrected
    } else {
        println!("[DEBUG] No match found for '{}'", word);
        
        // Debug the normalization steps
        let normalized = normalize_text(word);
        let aggressive = normalize_text_aggressive(&normalized);
        println!("[DEBUG] Normalization steps: '{}' -> '{}' -> '{}'", word, normalized, aggressive);
        
        // Check distances to each dictionary word
        for dict_word in dictionary {
            let dict_normalized = normalize_text(&dict_word.to_lowercase());
            let dict_aggressive = normalize_text_aggressive(&dict_normalized);
            
            let distance_normal = weighted_levenshtein_distance(&normalized, &dict_normalized);
            let distance_aggressive = weighted_levenshtein_distance(&aggressive, &dict_aggressive);
            
            println!("[DEBUG] Distance to '{}': normal={:.2}, aggressive={:.2}", 
                     dict_word, distance_normal, distance_aggressive);
        }
        
        word.to_string()
    }
}

/// Get FuzzyConfig from global settings
fn get_fuzzy_config_from_settings() -> Option<FuzzyConfig> {
    use crate::config;
    
    if let Ok(settings) = config::SETTINGS.lock() {
        Some(FuzzyConfig {
            sensitivity: settings.fuzzy_correction.sensitivity,
            max_corrections_per_text: settings.fuzzy_correction.max_corrections_per_text,
            preserve_original_case: settings.fuzzy_correction.preserve_original_case,
            timeout_ms: 200, // Keep default timeout
        })
    } else {
        None
    }
}

/// Correct text with custom configuration
pub fn correct_text_with_dictionary_config(
    text: &str, 
    dictionary: &[String], 
    config: &FuzzyConfig
) -> String {
    let start_time = Instant::now();
    
    // Early return for empty inputs
    if text.trim().is_empty() || dictionary.is_empty() {
        return text.to_string();
    }
    
    // Memory protection: skip correction for very long texts (>1000 words)
    let word_count = text.split_whitespace().count();
    if word_count > 1000 {
        println!("[FuzzyDictionary] Text too long ({} words), skipping correction for performance", word_count);
        return text.to_string();
    }
    
    // Split text into words while preserving punctuation and spacing
    let words = tokenize_with_positions(text);
    let mut result = text.to_string();
    let mut corrections_made = 0;
    
    // Process each word for potential correction
    for word_info in words {
        // Check timeout
        if start_time.elapsed().as_millis() > config.timeout_ms as u128 {
            println!("[FuzzyDictionary] Timeout reached, stopping corrections");
            break;
        }
        
        // Check correction limit
        if corrections_made >= config.max_corrections_per_text {
            break;
        }
        
        // Skip if word doesn't need correction
        if !should_attempt_correction(&word_info.word) {
            continue;
        }
        
        // Find best fuzzy match
        if let Some(fuzzy_match) = find_best_match(&word_info.word, dictionary, config) {
            // Apply correction to result string
            let corrected_word = if config.preserve_original_case {
                preserve_case(&word_info.word, &fuzzy_match.corrected)
            } else {
                fuzzy_match.corrected.clone()
            };
            
            // Replace in result string
            result = result.replacen(&word_info.word, &corrected_word, 1);
            corrections_made += 1;
            
            println!("[FuzzyDictionary] Corrected '{}' -> '{}' (confidence: {:.2})", 
                     word_info.word, corrected_word, fuzzy_match.confidence);
        }
    }
    
    result
}

/// Information about a word's position in text
#[derive(Debug, Clone)]
struct WordInfo {
    word: String,
    start: usize,
    end: usize,
}

/// Tokenize text into words while preserving positions
fn tokenize_with_positions(text: &str) -> Vec<WordInfo> {
    let mut words = Vec::new();
    let mut current_word = String::new();
    let mut word_start = 0;
    
    for (i, ch) in text.char_indices() {
        if ch.is_alphabetic() {
            if current_word.is_empty() {
                word_start = i;
            }
            current_word.push(ch);
        } else {
            if !current_word.is_empty() {
                words.push(WordInfo {
                    word: current_word.clone(),
                    start: word_start,
                    end: i,
                });
                current_word.clear();
            }
        }
    }
    
    // Handle final word
    if !current_word.is_empty() {
        words.push(WordInfo {
            word: current_word,
            start: word_start,
            end: text.len(),
        });
    }
    
    words
}

/// Determine if a word should be considered for fuzzy correction
fn should_attempt_correction(word: &str) -> bool {
    // Skip very short words (too risky for fuzzy matching)
    if word.len() <= 3 {
        return false;
    }
    
    // Skip words that are clearly numbers
    if word.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    
    // Protect essential common English words that were causing false positives
    if is_protected_english_word(word) {
        return false;
    }
    
    // Allow correction for names/technical terms and less common words
    true
}

/// Check if word is a protected English word that should never be corrected
fn is_protected_english_word(word: &str) -> bool {
    // Minimal list of essential English words that were causing false positives
    const PROTECTED_WORDS: &[&str] = &[
        // Words that were incorrectly corrected in the regression
        "foremost", "current", "together", "girlfriend", "friend", "using", "great",
        "first", "last", "back", "name", "which", "with",
        
        // Essential function words that should never be corrected
        "the", "and", "that", "have", "for", "not", "you", "this", "but",
        "his", "from", "they", "she", "her", "been", "than", "its", "who",
        "will", "about", "would", "there", "their", "when", "what", "some",
        "time", "very", "into", "just", "like", "only", "know", "take",
        "good", "make", "over", "think", "also", "after", "work", "life",
        "more", "other", "could", "even", "most", "way", "may", "say",
        
        // Common verbs that should not be corrected
        "is", "are", "was", "were", "be", "being", "have", "has", "had",
        "do", "does", "did", "can", "could", "should", "would", "will",
        "get", "got", "give", "gave", "go", "went", "come", "came", "see", "saw"
    ];
    
    PROTECTED_WORDS.contains(&word.to_lowercase().as_str())
}

/// Get or create indexed dictionary with caching
fn get_indexed_dictionary(dictionary: &[String]) -> IndexedDictionary {
    let mut cache = DICTIONARY_INDEX_CACHE.lock().unwrap();
    
    // Check if cache is valid (same dictionary)
    if let Some((cached_dict, indexed_dict)) = cache.as_ref() {
        if cached_dict == dictionary {
            return indexed_dict.clone();
        }
    }
    
    // Create new indexed dictionary and cache it
    println!("[FuzzyDictionary] Creating new dictionary index with {} words", dictionary.len());
    let indexed_dict = IndexedDictionary::new(dictionary);
    *cache = Some((dictionary.to_vec(), indexed_dict.clone()));
    
    indexed_dict
}

/// Find the best fuzzy match for a word in the dictionary using indexed lookup and LRU caching
fn find_best_match(word: &str, dictionary: &[String], config: &FuzzyConfig) -> Option<FuzzyMatch> {
    let word_lower = word.to_lowercase();
    let word_normalized = normalize_text(&word_lower);
    
    // Check LRU cache first
    if let Ok(mut cache) = CORRECTION_CACHE.lock() {
        if let Some(cached_result) = cache.get(&word_lower) {
            println!("[FuzzyDictionary] Cache hit for '{}'", word);
            return cached_result;
        }
    }
    
    let mut best_match: Option<FuzzyMatch> = None;
    let mut best_confidence = 0.0;
    
    // Get conservative thresholds based on word length
    let (max_distance, min_confidence) = get_distance_thresholds(word.len());
    
    // For small dictionaries, use brute force to avoid missing matches due to indexing constraints
    let candidates: Vec<String> = if dictionary.len() <= 20 {
        println!("[FuzzyDictionary] Small dictionary ({} words) - using brute force approach", dictionary.len());
        dictionary.to_vec()
    } else {
        // Use indexed dictionary for faster candidate selection
        let indexed_dict = get_indexed_dictionary(dictionary);
        indexed_dict.get_candidates(&word_normalized, 3)
    };
    
    println!("[FuzzyDictionary] Cache miss - checking {} candidates for '{}' -> '{}' (word_len: {}, thresholds: max_dist={}, min_conf={:.2})", 
              candidates.len(), word, word_normalized, word.len(), max_distance, min_confidence);
    
    for dict_word in &candidates {
        // Calculate weighted edit distance using normalized comparison
        let dict_word_lower = dict_word.to_lowercase();
        let dict_word_normalized = normalize_text(&dict_word_lower);
        let distance = weighted_levenshtein_distance(&word_normalized, &dict_word_normalized);
        
        // Skip if distance exceeds threshold
        if distance > max_distance {
            continue;
        }
        
        // Calculate confidence score using normalized forms and weighted distance
        let confidence = calculate_confidence_weighted(&word_normalized, &dict_word_normalized, distance);
        let required_confidence = min_confidence.max(config.sensitivity);
        
        println!("[FuzzyDictionary] Candidate '{}' -> '{}' weighted_distance: {:.2}, confidence: {:.2}, required: {:.2}", 
                 dict_word, dict_word_normalized, distance, confidence, required_confidence);
        
        // Check if this is a better match
        if confidence >= required_confidence && confidence > best_confidence {
            best_match = Some(FuzzyMatch {
                original: word.to_string(),
                corrected: dict_word.clone(),
                confidence,
                edit_distance: distance,
            });
            best_confidence = confidence;
        }
    }
    
    // If no match found with standard fuzzy matching, try AGGRESSIVE matching combining phonetic + substring approaches
    if best_match.is_none() && word.len() >= 6 {
        println!("[FuzzyDictionary] No fuzzy match found, trying aggressive phonetic + substring matching for '{}'", word);
        
        let word_aggressive = normalize_text_aggressive(&word_normalized);
        
        for dict_word in &candidates {
            let dict_word_lower = dict_word.to_lowercase();
            let dict_word_normalized = normalize_text(&dict_word_lower);
            let dict_word_aggressive = normalize_text_aggressive(&dict_word_normalized);
            
            // Try both substring similarity and aggressive phonetic matching
            let substring_similarity = calculate_substring_similarity(&word_normalized, &dict_word_normalized);
            let phonetic_distance = weighted_levenshtein_distance(&word_aggressive, &dict_word_aggressive);
            
            // Calculate confidence using the best approach
            let mut confidence = 0.0;
            let mut match_type = "";
            
            // Check substring similarity first (good for partial name matches)
            if substring_similarity > 0.7 {
                confidence = substring_similarity * 0.85; // Penalty for substring matches
                match_type = "SUBSTRING";
            }
            
            // Check aggressive phonetic matching (good for distorted names)
            let aggressive_threshold = word.len() as f32 * 0.6; // Allow 60% of characters to be different
            if phonetic_distance <= aggressive_threshold {
                let phonetic_confidence = calculate_confidence_weighted(&word_aggressive, &dict_word_aggressive, phonetic_distance) * 0.8;
                if phonetic_confidence > confidence {
                    confidence = phonetic_confidence;
                    match_type = "PHONETIC";
                }
            }
            
            // Minimum confidence for aggressive matching - higher to prevent false positives
            if confidence > 0.35 && confidence > best_confidence {
                println!("[FuzzyDictionary] AGGRESSIVE {} MATCH '{}' -> '{}' confidence: {:.2}", 
                         match_type, word, dict_word, confidence);
                    
                best_match = Some(FuzzyMatch {
                    original: word.to_string(),
                    corrected: dict_word.clone(),
                    confidence,
                    edit_distance: phonetic_distance,
                });
                best_confidence = confidence;
            }
        }
    }
    
    // Cache the result (whether found or not)
    if let Ok(mut cache) = CORRECTION_CACHE.lock() {
        cache.put(word_lower, best_match.clone());
        let (cache_size, max_size) = cache.stats();
        if cache_size % 10 == 0 { // Log every 10th entry
            println!("[FuzzyDictionary] Cache stats: {}/{} entries", cache_size, max_size);
        }
    }
    
    best_match
}

/// Get distance thresholds based on word length - balanced for normal fuzzy matching
fn get_distance_thresholds(word_length: usize) -> (f32, f32) {
    match word_length {
        1..=3 => (0.0, 1.0),     // Exact match only for short words
        4..=5 => (2.0, 0.6),     // Conservative for short words to avoid false positives
        6..=8 => (3.0, 0.5),     // More conservative for medium words  
        9..=10 => (4.0, 0.4),    // Allow more edits for long names but higher confidence needed
        11..=15 => (5.0, 0.4),   // Allow more edits for very long words
        _ => (6.0, 0.3),         // Allow many edits for extremely long words
    }
}

/// Normalize text with consonant cluster reduction for better phonetic matching
fn normalize_text_aggressive(text: &str) -> String {
    let mut result = normalize_text(text);
    
    // Consonant cluster reduction for name matching
    result = result.replace("ts", "t");    // Katsulkaya -> Katulkaya
    result = result.replace("ck", "k");    // thick -> thik
    result = result.replace("ph", "f");    // phone -> fone
    result = result.replace("gh", "g");    // laugh -> lag (when pronounced)
    result = result.replace("kh", "k");    // Khan -> Kan
    result = result.replace("th", "t");    // think -> tink (for some accents)
    result = result.replace("sh", "s");    // should -> sould (for some accents)
    result = result.replace("ch", "c");    // choose -> coose (for some accents)
    
    // Vowel cluster simplification
    result = result.replace("oo", "o");    // book -> bok
    result = result.replace("ee", "e");    // seen -> sen
    result = result.replace("aa", "a");    // Kaan -> Kan
    result = result.replace("ii", "i");    // skiing -> sking
    result = result.replace("uu", "u");    // vacuum -> vacum
    
    // Silent letter removal (common in names)
    result = result.replace("ul", "al");   // Katsulkaya -> Katsalkaya (ul -> al common in speech)
    result = result.replace("el", "al");   // different -> differant
    result = result.replace("il", "al");   // pencil -> pencal
    
    result
}

/// Normalize text by handling special characters and removing accents
fn normalize_text(text: &str) -> String {
    let mut result = String::new();
    
    for ch in text.chars() {
        let normalized = match ch {
            // Nordic characters
            'ø' | 'Ø' => "o",
            'å' | 'Å' => "a", 
            'æ' | 'Æ' => "ae",
            
            // German umlauts (highest priority)
            'ä' | 'Ä' => "ae",
            'ö' | 'Ö' => "oe", 
            'ü' | 'Ü' => "ue",
            'ß' => "ss",
            
            // French accents (without conflicting German umlauts)
            'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => "e",
            'à' | 'á' | 'â' | 'ã' | 'À' | 'Á' | 'Â' | 'Ã' => "a", // Removed 'ä' and 'Ä'
            'ì' | 'í' | 'î' | 'ï' | 'Ì' | 'Í' | 'Î' | 'Ï' => "i",
            'ò' | 'ó' | 'ô' | 'õ' | 'Ò' | 'Ó' | 'Ô' | 'Õ' => "o", // Removed 'ö' and 'Ö'
            'ù' | 'ú' | 'û' | 'Ù' | 'Ú' | 'Û' => "u", // Removed 'ü' and 'Ü'
            'ç' | 'Ç' => "c",
            'ñ' | 'Ñ' => "n",
            
            // Spanish
            'ý' | 'ÿ' | 'Ý' | 'Ÿ' => "y",
            
            // Eastern European
            'š' | 'Š' => "s",
            'ž' | 'Ž' => "z",
            'č' | 'Č' => "c",
            'ř' | 'Ř' => "r",
            'ď' | 'Ď' => "d",
            'ť' | 'Ť' => "t",
            'ň' | 'Ň' => "n",
            'ľ' | 'Ľ' => "l",
            
            // Other common accented characters (avoiding duplicates)
            'ă' | 'Ă' => "a",
            'ș' | 'Ș' => "s",
            'ț' | 'Ț' => "t",
            
            // Default: keep as single char string
            _ => {
                result.push(ch);
                continue;
            }
        };
        
        result.push_str(normalized);
    }
    
    result
}

/// Calculate weighted Levenshtein distance with phonetic costs
fn weighted_levenshtein_distance(s1: &str, s2: &str) -> f32 {
    let s1_chars: Vec<char> = s1.chars().collect();
    let s2_chars: Vec<char> = s2.chars().collect();
    let s1_len = s1_chars.len();
    let s2_len = s2_chars.len();
    
    // Create matrix for weighted distances
    let mut matrix = vec![vec![0.0; s2_len + 1]; s1_len + 1];
    
    // Initialize first row and column
    for i in 0..=s1_len {
        matrix[i][0] = i as f32;
    }
    for j in 0..=s2_len {
        matrix[0][j] = j as f32;
    }
    
    // Fill matrix with weighted costs
    for i in 1..=s1_len {
        for j in 1..=s2_len {
            let char1 = s1_chars[i - 1];
            let char2 = s2_chars[j - 1];
            
            let substitution_cost = if char1 == char2 {
                0.0
            } else if are_similar_chars(char1, char2) {
                0.5 // Phonetically similar substitutions cost half
            } else {
                1.0 // Regular substitutions cost full
            };
            
            matrix[i][j] = f32::min(
                f32::min(
                    matrix[i - 1][j] + 1.0,           // deletion
                    matrix[i][j - 1] + 1.0            // insertion
                ),
                matrix[i - 1][j - 1] + substitution_cost // substitution
            );
        }
    }
    
    matrix[s1_len][s2_len]
}

/// Calculate Levenshtein distance between two strings (legacy function for tests)
fn levenshtein_distance(s1: &str, s2: &str) -> usize {
    let s1_chars: Vec<char> = s1.chars().collect();
    let s2_chars: Vec<char> = s2.chars().collect();
    let s1_len = s1_chars.len();
    let s2_len = s2_chars.len();
    
    // Create matrix
    let mut matrix = vec![vec![0; s2_len + 1]; s1_len + 1];
    
    // Initialize first row and column
    for i in 0..=s1_len {
        matrix[i][0] = i;
    }
    for j in 0..=s2_len {
        matrix[0][j] = j;
    }
    
    // Fill matrix
    for i in 1..=s1_len {
        for j in 1..=s2_len {
            let cost = if s1_chars[i - 1] == s2_chars[j - 1] { 0 } else { 1 };
            matrix[i][j] = std::cmp::min(
                std::cmp::min(
                    matrix[i - 1][j] + 1,     // deletion
                    matrix[i][j - 1] + 1      // insertion
                ),
                matrix[i - 1][j - 1] + cost   // substitution
            );
        }
    }
    
    matrix[s1_len][s2_len]
}

/// Calculate confidence score for a potential match (legacy version for tests)
fn calculate_confidence(original: &str, candidate: &str, edit_distance: usize) -> f32 {
    calculate_confidence_weighted(original, candidate, edit_distance as f32)
}

/// Calculate confidence score for a potential match using weighted distances
fn calculate_confidence_weighted(original: &str, candidate: &str, edit_distance: f32) -> f32 {
    let max_len = original.len().max(candidate.len()) as f32;
    let base_score = 1.0 - (edit_distance / max_len);
    
    // Length penalty: prefer similar lengths
    let length_diff = (original.len() as i32 - candidate.len() as i32).abs() as f32;
    let length_penalty = 1.0 - (length_diff / max_len * 0.2);
    
    // Position bonus: reward matches at word boundaries (simplified for now)
    let position_bonus = 1.0;
    
    // Frequency boost: could be added later based on dictionary word frequency
    let frequency_boost = 1.0;
    
    // Phonetic bonus: give extra confidence for weighted matches (lower distance = more phonetic similarity)
    let expected_full_distance = max_len; // If all chars were different
    let phonetic_bonus = if edit_distance < expected_full_distance * 0.7 {
        1.1 // 10% bonus for phonetically similar matches
    } else {
        1.0
    };
    
    (base_score * length_penalty * position_bonus * frequency_boost * phonetic_bonus).min(1.0)
}

/// Calculate substring similarity using longest common subsequence
fn calculate_substring_similarity(s1: &str, s2: &str) -> f32 {
    let chars1: Vec<char> = s1.chars().collect();
    let chars2: Vec<char> = s2.chars().collect();
    
    // Calculate longest common subsequence length
    let lcs_length = longest_common_subsequence(&chars1, &chars2);
    
    // Calculate similarity as ratio of LCS to average length
    let avg_length = (chars1.len() + chars2.len()) as f32 / 2.0;
    if avg_length == 0.0 {
        return 1.0; // Both empty strings are similar
    }
    
    let lcs_similarity = lcs_length as f32 / avg_length;
    
    // Also check for significant substring overlap
    let substring_similarity = calculate_ngram_overlap(s1, s2, 3); // 3-gram overlap
    
    // Combine both metrics (weighted average)
    let combined = (lcs_similarity * 0.6) + (substring_similarity * 0.4);
    
    combined.min(1.0)
}

/// Calculate longest common subsequence length
fn longest_common_subsequence(chars1: &[char], chars2: &[char]) -> usize {
    let len1 = chars1.len();
    let len2 = chars2.len();
    
    if len1 == 0 || len2 == 0 {
        return 0;
    }
    
    let mut dp = vec![vec![0; len2 + 1]; len1 + 1];
    
    for i in 1..=len1 {
        for j in 1..=len2 {
            if chars1[i - 1] == chars2[j - 1] || are_similar_chars(chars1[i - 1], chars2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
            }
        }
    }
    
    dp[len1][len2]
}

/// Calculate N-gram overlap between two strings  
fn calculate_ngram_overlap(s1: &str, s2: &str, n: usize) -> f32 {
    if s1.len() < n || s2.len() < n {
        // For short strings, use character overlap
        let chars1: std::collections::HashSet<char> = s1.chars().collect();
        let chars2: std::collections::HashSet<char> = s2.chars().collect();
        let intersection = chars1.intersection(&chars2).count();
        let union = chars1.union(&chars2).count();
        return if union == 0 { 0.0 } else { intersection as f32 / union as f32 };
    }
    
    let ngrams1: std::collections::HashSet<String> = s1
        .chars()
        .collect::<Vec<_>>()
        .windows(n)
        .map(|w| w.iter().collect())
        .collect();
    
    let ngrams2: std::collections::HashSet<String> = s2
        .chars()
        .collect::<Vec<_>>()
        .windows(n)
        .map(|w| w.iter().collect())
        .collect();
    
    let intersection = ngrams1.intersection(&ngrams2).count();
    let union = ngrams1.union(&ngrams2).count();
    
    if union == 0 { 0.0 } else { intersection as f32 / union as f32 }
}

/// Preserve the original casing pattern when applying corrections
fn preserve_case(original: &str, corrected: &str) -> String {
    let orig_chars: Vec<char> = original.chars().collect();
    let corr_chars: Vec<char> = corrected.chars().collect();
    let mut result = String::new();
    
    for (i, &corr_char) in corr_chars.iter().enumerate() {
        if i < orig_chars.len() {
            if orig_chars[i].is_uppercase() {
                result.push(corr_char.to_uppercase().next().unwrap_or(corr_char));
            } else {
                result.push(corr_char.to_lowercase().next().unwrap_or(corr_char));
            }
        } else {
            result.push(corr_char);
        }
    }
    
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_levenshtein_distance() {
        assert_eq!(levenshtein_distance("hello", "hello"), 0);
        assert_eq!(levenshtein_distance("hello", "helo"), 1);
        assert_eq!(levenshtein_distance("hello", "world"), 4);
        assert_eq!(levenshtein_distance("", "hello"), 5);
        assert_eq!(levenshtein_distance("hello", ""), 5);
    }
    
    #[test]
    fn test_should_attempt_correction() {
        assert!(!should_attempt_correction("hi"));    // Too short
        assert!(!should_attempt_correction("123"));   // Contains digits
        assert!(!should_attempt_correction("the"));   // Common word
        assert!(should_attempt_correction("javascript")); // Good candidate
    }
    
    #[test]
    fn test_preserve_case() {
        assert_eq!(preserve_case("Hello", "world"), "World");
        assert_eq!(preserve_case("HELLO", "world"), "WORLD");
        assert_eq!(preserve_case("hello", "WORLD"), "world");
    }
    
    #[test]
    fn test_basic_correction() {
        let dictionary = vec!["javascript".to_string(), "python".to_string()];
        let result = correct_text_with_dictionary("javascipt is great", &dictionary);
        assert!(result.contains("javascript"));
    }
    
    #[test]
    fn test_distance_thresholds() {
        // Test balanced distance thresholds with weighted distances
        assert_eq!(get_distance_thresholds(3), (0.0, 1.0));    // Exact match only for short words
        assert_eq!(get_distance_thresholds(4), (2.0, 0.7));    // 2.0 weighted edits for 4-5 chars
        assert_eq!(get_distance_thresholds(6), (3.0, 0.6));    // 3.0 weighted edits for 6-8 chars
        assert_eq!(get_distance_thresholds(9), (4.0, 0.5));    // 4.0 weighted edits for 9-10 chars (long names)
        assert_eq!(get_distance_thresholds(12), (5.0, 0.4));   // 5.0 weighted edits for 11-15 chars
        assert_eq!(get_distance_thresholds(20), (6.0, 0.3));   // 6.0 weighted edits for very long words
    }
    
    #[test]
    fn test_confidence_scoring() {
        // Test confidence calculation
        let confidence = calculate_confidence("hello", "helo", 1);
        assert!(confidence > 0.5 && confidence < 1.0);
        
        // Perfect match should have higher confidence
        let perfect = calculate_confidence("hello", "hello", 0);
        assert!(perfect > confidence);
    }
    
    #[test]
    fn test_improved_distance_thresholds() {
        // Test that longer words now allow more edits with weighted distance
        let dictionary = vec!["Catalkaya".to_string()]; // 9 characters
        let config = FuzzyConfig { sensitivity: 0.3, ..Default::default() }; // Low sensitivity for aggressive matching
        
        // This should now work with the improved thresholds (5.0 weighted edits allowed for 9-char words)
        let result = find_best_match("Kethalkaya", &dictionary, &config);
        
        if let Some(match_result) = result {
            assert_eq!(match_result.corrected, "Catalkaya");
            
            // Calculate actual weighted distance to verify it's within new threshold
            let actual_distance = weighted_levenshtein_distance(
                &normalize_text("kethalkaya"), 
                &normalize_text("catalkaya")
            );
            assert!(actual_distance <= 5.0, "Weighted distance {:.2} should be <= 5.0", actual_distance);
            println!("Weighted distance for Kethalkaya -> Catalkaya: {:.2}", actual_distance);
        } else {
            panic!("Should find match for Kethalkaya -> Catalkaya with weighted distance");
        }
        
        // Test another challenging case
        let dictionary2 = vec!["Schleuning".to_string()]; // 10 characters
        let result2 = find_best_match("Shloining", &dictionary2, &config);
        
        if let Some(match_result) = result2 {
            assert_eq!(match_result.corrected, "Schleuning");
        }
    }
    
    #[test]
    fn test_edge_cases() {
        let dictionary = vec!["javascript".to_string(), "the".to_string(), "123test".to_string()];
        
        // Short words should not be corrected
        let result1 = correct_text_with_dictionary("th", &dictionary);
        assert_eq!(result1, "th");
        
        // Common words should be protected
        let result2 = correct_text_with_dictionary("te is good", &dictionary);
        assert!(result2.contains("te")); // "te" should not be corrected to "the"
        
        // Numbers should be preserved
        let result3 = correct_text_with_dictionary("123 test", &dictionary);
        assert!(result3.contains("123"));
    }
    
    #[test]
    fn test_case_preservation() {
        let dictionary = vec!["javascript".to_string()];
        let config = FuzzyConfig {
            preserve_original_case: true,
            ..Default::default()
        };
        
        let result = correct_text_with_dictionary_config("JavaScript is cool", &dictionary, &config);
        // Should preserve the original "JavaScript" casing
        assert!(result.contains("JavaScript") || result.contains("Javascript"));
    }
    
    #[test]
    fn test_correction_limits() {
        let dictionary = vec!["test".to_string()];
        let config = FuzzyConfig {
            max_corrections_per_text: 1,
            sensitivity: 0.6,
            ..Default::default()
        };
        
        // Should only correct up to max_corrections_per_text
        let result = correct_text_with_dictionary_config("tst tst tst", &dictionary, &config);
        let corrections = result.matches("test").count();
        assert!(corrections <= 1);
    }
    
    #[test]
    fn test_memory_protection() {
        let dictionary = vec!["test".to_string()];
        
        // Create a very long text (>1000 words)
        let long_text = "word ".repeat(1001);
        let result = correct_text_with_dictionary(&long_text, &dictionary);
        
        // Should return original text unchanged
        assert_eq!(result, long_text);
    }
    
    #[test]
    fn test_timeout_behavior() {
        let dictionary = vec!["test".to_string()];
        let config = FuzzyConfig {
            timeout_ms: 1, // Very short timeout
            ..Default::default()
        };
        
        // Should handle timeout gracefully
        let result = correct_text_with_dictionary_config("tst word", &dictionary, &config);
        // Should return some result (either corrected or original)
        assert!(!result.is_empty());
    }
    
    #[test]
    fn test_indexed_dictionary() {
        let words = vec!["hello".to_string(), "world".to_string(), "help".to_string()];
        let indexed = IndexedDictionary::new(&words);
        
        // Test candidate selection
        let candidates = indexed.get_candidates("helo", 2);
        assert!(candidates.len() > 0);
        
        // Should find "hello" as a candidate for "helo"
        assert!(candidates.iter().any(|s| s == "hello"));
    }
    
    #[test]
    fn test_similar_characters() {
        // Test keyboard proximity detection
        assert!(are_similar_chars('i', 'j'));
        assert!(are_similar_chars('u', 'v'));
        assert!(are_similar_chars('n', 'm'));
        
        // Test visual similarity
        assert!(are_similar_chars('o', '0'));
        assert!(are_similar_chars('l', '1'));
        
        // Test non-similar characters
        assert!(!are_similar_chars('a', 'z'));
    }
    
    #[test]
    fn test_text_normalization() {
        // Test Nordic characters
        assert_eq!(normalize_text("Vindstød"), "vindstod");
        assert_eq!(normalize_text("København"), "kobenhavn");
        assert_eq!(normalize_text("Åse"), "ase");
        
        // Test German umlauts
        assert_eq!(normalize_text("Müller"), "mueller");
        assert_eq!(normalize_text("Größe"), "groesse");
        assert_eq!(normalize_text("Weiß"), "weiss");
        
        // Test French accents
        assert_eq!(normalize_text("Café"), "cafe");
        assert_eq!(normalize_text("Élève"), "eleve");
        assert_eq!(normalize_text("Naïve"), "naive");
        
        // Test mixed case preservation
        assert_eq!(normalize_text("VINDSTØD"), "vindstod");
        
        // Test no normalization needed
        assert_eq!(normalize_text("hello"), "hello");
        assert_eq!(normalize_text("world"), "world");
    }
    
    #[test] 
    fn test_normalized_matching() {
        let dictionary = vec!["vindstod".to_string()]; // Normalized form in dictionary
        let config = FuzzyConfig::default();
        
        // Should match "Vindstød" to "vindstod" through normalization
        let result = find_best_match("Vindstød", &dictionary, &config);
        assert!(result.is_some());
        
        if let Some(match_result) = result {
            assert_eq!(match_result.corrected, "vindstod");
            assert!(match_result.confidence > 0.8); // Should be high confidence
        }
    }
    
    #[test]
    fn test_brute_force_fallback() {
        // Test with a small dictionary that would trigger brute force mode
        let small_dictionary = vec![
            "Kaan".to_string(),
            "Catalkaya".to_string(), 
            "Schleuning".to_string(),
            "Vindstød".to_string(),
            "Cursor".to_string()
        ];
        let config = FuzzyConfig { sensitivity: 0.6, ..Default::default() };
        
        // These matches should work with brute force even if indexing would miss them
        let test_cases = vec![
            ("Tethokaya", "Catalkaya"),  // T -> C phonetic similarity
            ("Windstool", "Vindstød"),   // W -> V + normalization
            ("Katzel", "Catalkaya"),     // K -> C + partial match
        ];
        
        for (input, expected) in test_cases {
            let result = find_best_match(input, &small_dictionary, &config);
            assert!(result.is_some(), "Failed to find match for '{}'", input);
            
            if let Some(match_result) = result {
                assert_eq!(match_result.corrected, expected, 
                          "Expected '{}' -> '{}', got '{}'", input, expected, match_result.corrected);
            }
        }
    }
    
    #[test]
    fn test_brute_force_vs_indexed() {
        let dictionary = vec![
            "test".to_string(),
            "javascript".to_string(),
            "python".to_string(),
            "rust".to_string()
        ];
        let config = FuzzyConfig::default();
        
        // Same input should give same result regardless of dictionary size
        let input = "javascipt"; // typo in "javascript"
        
        // Test with small dictionary (brute force)
        let small_result = find_best_match(input, &dictionary, &config);
        
        // Test with large dictionary (indexed) - pad to 25 words
        let mut large_dictionary = dictionary.clone();
        for i in 0..21 {
            large_dictionary.push(format!("dummy{}", i));
        }
        let large_result = find_best_match(input, &large_dictionary, &config);
        
        // Both should find the same match
        assert_eq!(small_result.is_some(), large_result.is_some());
        if small_result.is_some() && large_result.is_some() {
            assert_eq!(small_result.unwrap().corrected, large_result.unwrap().corrected);
        }
    }
    
    #[test]
    fn test_weighted_levenshtein() {
        // Test the weighted Levenshtein distance for phonetic similarities
        
        // Test exact match
        assert_eq!(weighted_levenshtein_distance("hello", "hello"), 0.0);
        
        // Test single phonetic substitution (should cost 0.5)
        let distance_ke = weighted_levenshtein_distance("k", "c"); // k -> c is phonetic
        assert_eq!(distance_ke, 0.5);
        
        // Test the challenging case: Kethalkaya -> Catalkaya
        let distance_name = weighted_levenshtein_distance(
            &normalize_text("kethalkaya"), 
            &normalize_text("catalkaya")
        );
        println!("Weighted distance kethalkaya -> catalkaya: {:.2}", distance_name);
        
        // With phonetic costs, this should be much lower than 9.0
        assert!(distance_name < 6.0, "Weighted distance should be < 6.0, got {:.2}", distance_name);
        
        // Detailed breakdown for the challenging case
        let k_to_c = if are_similar_chars('k', 'c') { 0.5 } else { 1.0 };
        let e_to_a = if are_similar_chars('e', 'a') { 0.5 } else { 1.0 };
        println!("k->c cost: {}, e->a cost: {}", k_to_c, e_to_a);
        
        assert_eq!(k_to_c, 0.5, "k->c should be phonetically similar");
        assert_eq!(e_to_a, 0.5, "e->a should be phonetically similar");
    }
    
    #[test]
    fn test_substring_similarity() {
        // Test exact match
        assert_eq!(calculate_substring_similarity("hello", "hello"), 1.0);
        
        // Test partial similarity
        let similarity = calculate_substring_similarity("kethalkaya", "catalkaya");
        println!("Substring similarity kethalkaya -> catalkaya: {:.3}", similarity);
        assert!(similarity > 0.6, "Should have high substring similarity: {:.3}", similarity);
        
        // Test with very different strings
        let similarity_diff = calculate_substring_similarity("hello", "world");
        assert!(similarity_diff < 0.5, "Different strings should have low similarity");
        
        // Test LCS function directly
        let chars1: Vec<char> = "kethalkaya".chars().collect();
        let chars2: Vec<char> = "catalkaya".chars().collect();
        let lcs = longest_common_subsequence(&chars1, &chars2);
        println!("LCS length for kethalkaya -> catalkaya: {}", lcs);
        assert!(lcs >= 6, "Should have significant common subsequence");
    }
    
    #[test]
    fn test_challenging_name_matching() {
        // Test the ultimate challenge: Kethalkaya -> Catalkaya
        let dictionary = vec!["Catalkaya".to_string()];
        let config = FuzzyConfig { 
            sensitivity: 0.3, 
            max_corrections_per_text: 10,
            preserve_original_case: true,
            timeout_ms: 500,
        };
        
        // This should now work with either weighted distance OR substring matching
        let result = find_best_match("Kethalkaya", &dictionary, &config);
        
        match result {
            Some(match_result) => {
                assert_eq!(match_result.corrected, "Catalkaya");
                println!("Successfully matched Kethalkaya -> Catalkaya with confidence: {:.3}", match_result.confidence);
                assert!(match_result.confidence > 0.3, "Should have reasonable confidence");
            },
            None => {
                panic!("Should find match for Kethalkaya -> Catalkaya with bulletproof algorithm");
            }
        }
        
        // Test some other challenging cases
        let test_cases = vec![
            ("Tethokaya", "Catalkaya"),
            ("Windstool", "Vindstød"), 
            ("Shloining", "Schleuning"),
            ("Superbase", "Supabase"),
        ];
        
        for (input, expected) in test_cases {
            let dict = vec![expected.to_string()];
            let result = find_best_match(input, &dict, &config);
            assert!(result.is_some(), "Should match '{}' -> '{}'", input, expected);
            if let Some(m) = result {
                assert_eq!(m.corrected, expected);
            }
        }
    }
    
    #[test]
    fn test_aggressive_normalization() {
        // Test the aggressive normalization function
        
        // Test consonant cluster reduction
        assert_eq!(normalize_text_aggressive("katsulkaya"), "katalkaya"); // ts->t, ul->al
        assert_eq!(normalize_text_aggressive("thick"), "thik"); // ck->k
        assert_eq!(normalize_text_aggressive("phone"), "fone"); // ph->f
        assert_eq!(normalize_text_aggressive("khan"), "kan"); // kh->k
        
        // Test vowel cluster simplification
        assert_eq!(normalize_text_aggressive("kaan"), "kan"); // aa->a
        assert_eq!(normalize_text_aggressive("book"), "bok"); // oo->o
        assert_eq!(normalize_text_aggressive("seen"), "sen"); // ee->e
        
        // Test the challenging case
        let input_aggressive = normalize_text_aggressive("katsulkaya");
        let target_aggressive = normalize_text_aggressive("catalkaya");
        println!("Aggressive normalization: '{}' -> '{}', '{}' -> '{}'", 
                 "katsulkaya", input_aggressive, "catalkaya", target_aggressive);
        
        // After aggressive normalization, they should be much closer
        let distance = weighted_levenshtein_distance(&input_aggressive, &target_aggressive);
        println!("Weighted distance after aggressive normalization: {:.2}", distance);
        assert!(distance < 4.0, "Should be much closer after aggressive normalization: {:.2}", distance);
    }
    
    #[test]
    fn test_katsulkaya_catalkaya_comprehensive() {
        // This is the specific case the user is struggling with
        let dictionary = vec!["Catalkaya".to_string()];
        let config = FuzzyConfig { 
            sensitivity: 0.1, // Very low sensitivity for aggressive matching
            max_corrections_per_text: 10,
            preserve_original_case: true,
            timeout_ms: 1000,
        };
        
        // Test the exact transcription variant the user mentioned
        let result = find_best_match("Katsulkaya", &dictionary, &config);
        
        match result {
            Some(match_result) => {
                assert_eq!(match_result.corrected, "Catalkaya");
                println!("✅ Successfully matched Katsulkaya -> Catalkaya with confidence: {:.3}", match_result.confidence);
                println!("   Edit distance: {:.2}", match_result.edit_distance);
                
                // Should have some reasonable confidence even if low
                assert!(match_result.confidence > 0.15, "Should have minimum confidence for name matching: {:.3}", match_result.confidence);
            },
            None => {
                // Let's debug why it's not matching
                println!("❌ No match found for Katsulkaya -> Catalkaya");
                
                // Check each step of the normalization
                let input_normalized = normalize_text("katsulkaya");
                let target_normalized = normalize_text("catalkaya");
                println!("Standard normalization: '{}' -> '{}', '{}' -> '{}'", 
                         "katsulkaya", input_normalized, "catalkaya", target_normalized);
                
                let input_aggressive = normalize_text_aggressive(&input_normalized);
                let target_aggressive = normalize_text_aggressive(&target_normalized);
                println!("Aggressive normalization: '{}' -> '{}', '{}' -> '{}'", 
                         input_normalized, input_aggressive, target_normalized, target_aggressive);
                
                let distance = weighted_levenshtein_distance(&input_aggressive, &target_aggressive);
                println!("Final weighted distance: {:.2}", distance);
                
                let confidence = calculate_confidence_weighted(&input_aggressive, &target_aggressive, distance);
                println!("Calculated confidence: {:.3}", confidence);
                
                panic!("Should find match for Katsulkaya -> Catalkaya with aggressive algorithm");
            }
        }
        
        // Test other variants that might come from transcription
        let transcription_variants = vec![
            "Katsalkaya",   // Direct ts->t, ul->al transformation
            "Catsulkaya",   // Just k->c at start
            "Katslkaya",    // Missing vowel in middle
            "Katsukaya",    // Missing 'l'
            "Katzulkaya",   // ts->tz variant
        ];
        
        for variant in transcription_variants {
            let result = find_best_match(variant, &dictionary, &config);
            println!("Testing variant '{}' -> {:?}", variant, 
                     result.as_ref().map(|r| (r.corrected.as_str(), r.confidence)));
        }
    }
    
    #[test]
    fn test_latest_transcription_variants() {
        // Test the specific variants mentioned in the latest user transcription
        let test_cases = vec![
            ("Katsulkaya", "Catalkaya"), // The main challenging case
            ("Vinstel", "Vindstød"),     // New variant mentioned by user
            ("Panjeet", "Panjeet"),      // Should match exactly
            ("Schleuning", "Schleuning"), // Should match exactly
            ("Supabase", "Supabase"),    // Should match exactly
        ];
        
        for (input, expected) in test_cases {
            let dictionary = vec![expected.to_string()];
            let config = FuzzyConfig { 
                sensitivity: 0.1, // Very aggressive
                max_corrections_per_text: 10,
                preserve_original_case: true,
                timeout_ms: 1000,
            };
            
            let result = find_best_match(input, &dictionary, &config);
            
            match result {
                Some(match_result) => {
                    assert_eq!(match_result.corrected, expected);
                    println!("✅ '{}' -> '{}' (confidence: {:.3})", 
                             input, match_result.corrected, match_result.confidence);
                },
                None => {
                    println!("❌ No match for '{}' -> '{}'", input, expected);
                    
                    // Debug this specific case
                    debug_word_matching(input, &dictionary);
                    
                    panic!("Should match '{}' -> '{}'", input, expected);
                }
            }
        }
    }
    
    #[test]
    fn test_english_word_detection() {
        // Test words that should be detected as English
        let english_words = vec![
            "foremost", "current", "together", "friend", "girlfriend",
            "using", "great", "again", "first", "making", "company",
            "something", "running", "better", "quickly", "wonderful"
        ];
        
        for word in english_words {
            assert!(is_likely_english_word(word), "'{}' should be detected as English", word);
        }
        
        // Test words that should NOT be detected as English (names/technical terms)
        let non_english_words = vec![
            "Katsulkaya", "Catalkaya", "Vindstød", "Kursor", "Kethalkaya",
            "Schleuning", "Vinstel", "Supabase", "Panjeet"
        ];
        
        for word in non_english_words {
            assert!(!is_likely_english_word(word), "'{}' should NOT be detected as English", word);
        }
    }
    
    #[test]
    fn test_balanced_correction_behavior() {
        // Test that the system now behaves more conservatively
        let dictionary = vec![
            "Cursor".to_string(),
            "Catalkaya".to_string(),
            "Vindstød".to_string(),
        ];
        let config = FuzzyConfig { 
            sensitivity: 0.6, // Default balanced sensitivity
            ..Default::default()
        };
        
        // These should still be corrected (clear technical terms)
        let should_correct = vec![
            ("Kursor", "Cursor"),    // Clear typo
        ];
        
        for (input, expected) in should_correct {
            let result = find_best_match(input, &dictionary, &config);
            assert!(result.is_some(), "Should correct '{}' -> '{}'", input, expected);
            if let Some(m) = result {
                assert_eq!(m.corrected, expected);
            }
        }
        
        // These should NOT be corrected (common English words)
        let should_not_correct = vec![
            "foremost", "current", "together", "friend", "girlfriend", "using"
        ];
        
        for input in should_not_correct {
            let result = find_best_match(input, &dictionary, &config);
            assert!(result.is_none(), "Should NOT correct English word '{}'", input);
        }
    }
    
    #[test]
    fn test_false_positive_prevention() {
        // Ensure aggressive matching doesn't create too many false positives
        let dictionary = vec![
            "Catalkaya".to_string(),
            "JavaScript".to_string(),
            "Python".to_string(),
        ];
        let config = FuzzyConfig { 
            sensitivity: 0.1,
            ..Default::default()
        };
        
        // These should NOT match to Catalkaya
        let false_positives = vec![
            "hello",      // Completely different
            "world",      // Completely different  
            "test",       // Too short and different
            "javascript", // Should match JavaScript, not Catalkaya
        ];
        
        for input in false_positives {
            let result = find_best_match(input, &dictionary, &config);
            if let Some(match_result) = result {
                if input == "javascript" {
                    assert_eq!(match_result.corrected, "JavaScript", "Should match correct word");
                } else {
                    assert_ne!(match_result.corrected, "Catalkaya", 
                              "Should not incorrectly match '{}' to Catalkaya", input);
                }
            }
        }
    }
}