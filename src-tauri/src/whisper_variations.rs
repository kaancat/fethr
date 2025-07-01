// src-tauri/src/whisper_variations.rs
//
// Universal Whisper transcription error patterns that apply across all users
// Only includes technical terms and common service names that Whisper consistently mishears
// User-specific names and variations are handled by conservative corrections
//

use std::collections::HashMap;
use once_cell::sync::Lazy;

/// Static mapping of UNIVERSAL Whisper transcription errors
/// Only includes patterns that apply across all users and languages
/// User-specific variations should be handled by conservative corrections
static WHISPER_VARIATIONS: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut map = HashMap::new();
    
    // Common technical terms that Whisper consistently mishears
    // These benefit all users regardless of their specific vocabulary
    map.insert("javascrypt", "javascript");
    map.insert("typescrypt", "typescript");
    map.insert("reakt", "react");
    map.insert("paython", "python");
    map.insert("vishual", "visual");
    map.insert("sequel", "sql");
    
    // Common service names with consistent errors
    // Only include widely-used services
    map.insert("github", "GitHub");  // Casing correction
    map.insert("gethub", "github");
    map.insert("superbase", "supabase");  // Common error
    map.insert("firebase", "Firebase");  // Casing
    
    // Common Whisper transcription errors
    // Note: "dick" -> "click" is handled contextually in get_correct_form_with_context
    
    // Common tech acronyms
    map.insert("ai", "AI");
    map.insert("api", "API");
    map.insert("ui", "UI");
    map.insert("ux", "UX");
    
    // Note: User-specific names and variations should NOT be here
    // Those are handled by conservative corrections in dictionary_corrector.rs
    
    map
});

/// Check if a word is a known Whisper variation and return the correct form if found
pub fn get_correct_form(word: &str) -> Option<String> {
    let lowercase = word.to_lowercase();
    WHISPER_VARIATIONS.get(lowercase.as_str()).map(|&correct| {
        // Preserve the original casing pattern if possible
        apply_original_casing(correct, word)
    })
}

/// Context-aware correction for words that need surrounding context
pub fn get_correct_form_with_context(word: &str, prev_word: Option<&str>, next_word: Option<&str>) -> Option<String> {
    let lowercase = word.to_lowercase();
    
    // Handle "dick" -> "click" with context
    if lowercase == "dick" {
        // Only correct to "click" in tech/UI contexts
        let is_tech_context = 
            // Common patterns: "dick on", "dick the", "dick here", "dick this"
            matches!(next_word.map(|w| w.to_lowercase()).as_deref(), 
                Some("on") | Some("the") | Some("here") | Some("this") | Some("that") | 
                Some("button") | Some("link") | Some("icon")) ||
            // Common patterns: "please dick", "just dick", "then dick"
            matches!(prev_word.map(|w| w.to_lowercase()).as_deref(),
                Some("please") | Some("just") | Some("then") | Some("and") | 
                Some("to") | Some("double"));
        
        if is_tech_context {
            return Some(apply_original_casing("click", word));
        }
    }
    
    // Fall back to regular correction
    get_correct_form(word)
}

/// Apply the casing pattern from the original word to the corrected word
fn apply_original_casing(correct_word: &str, original_word: &str) -> String {
    let is_all_caps = original_word.chars().all(|c| !c.is_alphabetic() || c.is_uppercase());
    let is_title_case = original_word.chars().next().map_or(false, |c| c.is_uppercase()) &&
                       original_word.chars().skip(1).all(|c| !c.is_alphabetic() || c.is_lowercase());
    
    if is_all_caps {
        correct_word.to_uppercase()
    } else if is_title_case {
        let mut chars = correct_word.chars();
        match chars.next() {
            None => String::new(),
            Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
        }
    } else {
        correct_word.to_string()
    }
}

/// Check if this variation mapping system should be used
/// Only use if we have a dictionary loaded and the word isn't already correct
pub fn should_check_variations(word: &str, dictionary_contains: bool) -> bool {
    // Don't check variations for:
    // - Very short words (high false positive risk)
    // - Words that are already in the dictionary
    // - Common English words
    word.len() >= 4 && !dictionary_contains && !is_common_english_word(word)
}

/// Simple check for common English words we shouldn't try to correct
fn is_common_english_word(word: &str) -> bool {
    // This is a simplified check - in production we'd use the common_words module
    matches!(word.to_lowercase().as_str(), 
        "the" | "and" | "for" | "are" | "but" | "not" | "you" | "can" | "con" |
        "was" | "will" | "with" | "have" | "this" | "from" | "they" | "been"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_known_variations() {
        // Test technical terms
        assert_eq!(get_correct_form("javascrypt"), Some("javascript".to_string()));
        assert_eq!(get_correct_form("typescrypt"), Some("typescript".to_string()));
        assert_eq!(get_correct_form("paython"), Some("python".to_string()));
        
        // Test case preservation
        assert_eq!(get_correct_form("JAVASCRYPT"), Some("JAVASCRIPT".to_string()));
        assert_eq!(get_correct_form("TypeScrypt"), Some("Typescript".to_string()));
        
        // Test service names
        assert_eq!(get_correct_form("github"), Some("GitHub".to_string()));
        assert_eq!(get_correct_form("superbase"), Some("supabase".to_string()));
        
        // Test unknown variations return None
        assert_eq!(get_correct_form("random"), None);
        assert_eq!(get_correct_form("unknown"), None);
    }
    
    #[test]
    fn test_context_aware_corrections() {
        // Test "dick" -> "click" in appropriate contexts
        assert_eq!(get_correct_form_with_context("dick", Some("please"), Some("on")), Some("click".to_string()));
        assert_eq!(get_correct_form_with_context("dick", Some("just"), Some("the")), Some("click".to_string()));
        assert_eq!(get_correct_form_with_context("Dick", Some("double"), Some("here")), Some("Click".to_string()));
        assert_eq!(get_correct_form_with_context("dick", None, Some("button")), Some("click".to_string()));
        assert_eq!(get_correct_form_with_context("dick", Some("and"), None), Some("click".to_string()));
        
        // Test it doesn't correct in inappropriate contexts
        assert_eq!(get_correct_form_with_context("dick", Some("a"), None), None);
        assert_eq!(get_correct_form_with_context("dick", Some("is"), Some("!")), None);
        assert_eq!(get_correct_form_with_context("dick", Some("being"), Some("to")), None);
        
        // Test that without context, it doesn't correct
        assert_eq!(get_correct_form_with_context("dick", None, None), None);
    }
    
    #[test]
    fn test_should_check_variations() {
        // Should check these
        assert!(should_check_variations("javascrypt", false));
        assert!(should_check_variations("typescrypt", false));
        assert!(should_check_variations("paython", false));
        
        // Should NOT check these
        assert!(!should_check_variations("can", false)); // too short
        assert!(!should_check_variations("the", false)); // common word
        assert!(!should_check_variations("javascript", true)); // already in dictionary
    }
}