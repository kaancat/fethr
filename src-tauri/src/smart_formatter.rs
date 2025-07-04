use regex::Regex;
use serde::{Deserialize, Serialize};
use once_cell::sync::Lazy;
use log::{info};

/// Main smart formatter that handles text formatting enhancements
pub struct SmartFormatter {
    enabled: bool,
    filler_removal: bool,
    remove_phrases: bool, // Remove multi-word fillers like "you know"
    remove_sentence_starters: bool, // Remove "So," "Well," at sentence start
    preserve_meaning: bool, // Be conservative to avoid changing meaning
}


/// Result of formatting with tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormattedText {
    pub text: String,
    pub formatting_applied: Vec<FormatChange>,
    pub paragraphs_added: usize,
    pub lists_detected: usize,
}

/// Individual formatting change for tracking/undo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatChange {
    pub change_type: String,
    pub position: usize,
    pub confidence: String,
    pub can_undo: bool,
}

// Filler word patterns for removal
static FILLER_WORD_PATTERN: Lazy<Regex> = Lazy::new(|| {
    // Match common filler words with word boundaries
    // (?i) makes it case-insensitive
    Regex::new(r"(?i)\b(um+|uh+|ah+|er+|erm+|hmm+)\b").unwrap()
});

// Simplified filler phrase patterns - separate patterns for clarity
static FILLER_YOU_KNOW: Lazy<Regex> = Lazy::new(|| {
    // Match "you know" only when followed by comma
    Regex::new(r"(?i)\byou\s+know\s*,").unwrap()
});

static FILLER_I_MEAN: Lazy<Regex> = Lazy::new(|| {
    // Match "I mean" at start or with comma
    Regex::new(r"(?i)(?:^|[.!?]\s+)I\s+mean\s*,|,\s*I\s+mean\s*,").unwrap()
});

static FILLER_SORT_KIND: Lazy<Regex> = Lazy::new(|| {
    // Match "sort of" and "kind of" with comma
    Regex::new(r"(?i)\b(?:sort|kind)\s+of\s*,").unwrap()
});

static FILLER_LIKE: Lazy<Regex> = Lazy::new(|| {
    // Match "like" as a filler (with comma or in specific contexts)
    Regex::new(r"(?i)(?:\blike\s*,|,\s*like\s*,|\bshould\s+like\s+(?:get|go|do|try|start))").unwrap()
});

// Additional patterns for common cases without commas
static FILLER_YOU_KNOW_NO_COMMA: Lazy<Regex> = Lazy::new(|| {
    // Match "you know" without comma only at end of sentence or before certain transitions
    Regex::new(r"(?i)\byou\s+know\s+(?:the|it|that|this|they|we)\b").unwrap()
});

// Protected phrases that should never be broken
static PROTECTED_PHRASES: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:you\s+know\s+what\s+I\s+mean|you\s+know\s+what|you\s+know\s+how|you\s+know\s+why|you\s+know\s+when|you\s+know\s+where|what\s+I\s+mean\s+(?:by|when|is)|I\s+mean\s+it|I\s+mean\s+that)").unwrap()
});

static SENTENCE_START_FILLER: Lazy<Regex> = Lazy::new(|| {
    // Match fillers at sentence start (after period or at beginning)
    Regex::new(r"(?i)(^|\. )(So|Well|Actually|Basically|Literally|Like|Just|Okay|Alright|Right),?\s+").unwrap()
});

impl SmartFormatter {
    pub fn new() -> Self {
        Self {
            enabled: true,
            filler_removal: true,
            remove_phrases: true,
            remove_sentence_starters: true,
            preserve_meaning: true,
        }
    }

    /// Create formatter with custom settings
    pub fn with_settings(filler_removal: bool, remove_phrases: bool, remove_starters: bool) -> Self {
        Self {
            enabled: true,
            filler_removal,
            remove_phrases,
            remove_sentence_starters: remove_starters,
            preserve_meaning: true,
        }
    }
    

    /// Main formatting entry point
    pub fn format(&self, text: &str) -> FormattedText {
        if !self.enabled || text.is_empty() {
            return FormattedText {
                text: text.to_string(),
                formatting_applied: vec![],
                paragraphs_added: 0,
                lists_detected: 0,
            };
        }

        let mut result = FormattedText {
            text: text.to_string(),
            formatting_applied: vec![],
            paragraphs_added: 0,
            lists_detected: 0,
        };

        // Apply filler removal if enabled
        if self.filler_removal {
            result = self.remove_filler_words(result);
        }

        result
    }

    /// Find regions within quotes to avoid formatting (unused but kept for future)
    fn find_quoted_regions(&self, text: &str) -> Vec<(usize, usize)> {
        let mut regions = Vec::new();
        let mut in_quote = false;
        let mut quote_start = 0;

        for (i, ch) in text.char_indices() {
            if ch == '"' {
                if in_quote {
                    regions.push((quote_start, i));
                    in_quote = false;
                } else {
                    quote_start = i;
                    in_quote = true;
                }
            }
        }

        regions
    }

    /// Check if position is within a quoted region
    fn is_in_quotes(&self, position: usize, quoted_regions: &[(usize, usize)]) -> bool {
        quoted_regions.iter().any(|(start, end)| position >= *start && position <= *end)
    }
    
    /// Find regions that contain protected phrases
    fn find_protected_regions(&self, text: &str) -> Vec<(usize, usize)> {
        let mut regions = Vec::new();
        
        for mat in PROTECTED_PHRASES.find_iter(text) {
            regions.push((mat.start(), mat.end()));
        }
        
        regions
    }

    /// Remove filler words from text with context awareness
    fn remove_filler_words(&self, mut result: FormattedText) -> FormattedText {
        println!("[SMART FORMATTER] Starting filler removal on text ({} chars)", result.text.len());
        println!("[SMART FORMATTER] Input text: '{}'", result.text);
        info!("[SMART FORMATTER] Starting filler removal on text ({} chars)", result.text.len());
        info!("[SMART FORMATTER] Input text: '{}'", result.text);
        
        let mut text = result.text.clone();
        let mut removals = 0;
        
        // Remove basic filler words (um, uh, ah, etc.)
        if self.filler_removal {
            let matches_count = FILLER_WORD_PATTERN.find_iter(&text).count();
            if matches_count > 0 {
                info!("[SMART FORMATTER] Removing {} basic fillers", matches_count);
                text = FILLER_WORD_PATTERN.replace_all(&text, "").to_string();
                removals += matches_count;
            }
        }
        
        // Remove filler phrases with proper protection checking
        if self.remove_phrases {
            // Build a list of all removals to process
            let mut all_removals = Vec::new();
            
            // Check protected regions BEFORE collecting removals
            let protected_regions = self.find_protected_regions(&text);
            println!("[SMART FORMATTER] Found {} protected regions", protected_regions.len());
            info!("[SMART FORMATTER] Found {} protected regions", protected_regions.len());
            for (start, end) in &protected_regions {
                println!("[SMART FORMATTER] Protected region: '{}'", &text[*start..*end]);
                info!("[SMART FORMATTER] Protected region: '{}'", &text[*start..*end]);
            }
            
            // Collect "you know," matches
            for mat in FILLER_YOU_KNOW.find_iter(&text) {
                let start = mat.start();
                let end = mat.end();
                let matched_text = mat.as_str();
                
                // Check if any part of this match overlaps with protected regions
                let is_protected = protected_regions.iter().any(|(p_start, p_end)| 
                    // Check if match overlaps with protected region
                    !(end <= *p_start || start >= *p_end)
                );
                
                if !is_protected {
                    println!("[SMART FORMATTER] Will remove 'you know,' at position {} ('{}')", start, matched_text);
                    info!("[SMART FORMATTER] Will remove 'you know,' at position {} ('{}')", start, matched_text);
                    all_removals.push((start, end, "you know"));
                } else {
                    println!("[SMART FORMATTER] Keeping protected 'you know' at position {}", start);
                    info!("[SMART FORMATTER] Keeping protected 'you know' at position {}", start);
                }
            }
            
            // Collect "I mean," matches with sentence boundary detection
            for mat in FILLER_I_MEAN.find_iter(&text) {
                let start = mat.start();
                let end = mat.end();
                let is_protected = protected_regions.iter().any(|(p_start, p_end)| 
                    !(end <= *p_start || start >= *p_end)
                );
                
                if !is_protected {
                    // Check if the next character after removal would be uppercase
                    let needs_period = if end < text.len() {
                        // Skip any spaces after the match
                        let remaining = &text[end..];
                        let next_non_space = remaining.trim_start();
                        !next_non_space.is_empty() && next_non_space.chars().next().unwrap().is_uppercase()
                    } else {
                        false
                    };
                    
                    println!("[SMART FORMATTER] Will remove 'I mean,' at position {}, needs_period: {}", start, needs_period);
                    info!("[SMART FORMATTER] Will remove 'I mean,' at position {}, needs_period: {}", start, needs_period);
                    all_removals.push((start, end, if needs_period { "I mean+period" } else { "I mean" }));
                }
            }
            
            // Collect other filler matches
            for mat in FILLER_SORT_KIND.find_iter(&text) {
                all_removals.push((mat.start(), mat.end(), "sort/kind of"));
            }
            
            for mat in FILLER_LIKE.find_iter(&text) {
                let matched = mat.as_str();
                if matched.contains("should") && matched.contains("like") {
                    // For "should like get" patterns, mark for special handling
                    all_removals.push((mat.start(), mat.end(), "like-context"));
                } else {
                    all_removals.push((mat.start(), mat.end(), "like"));
                }
            }
            
            // Remove "you know" without comma in specific contexts
            for mat in FILLER_YOU_KNOW_NO_COMMA.find_iter(&text) {
                let start = mat.start();
                let end = mat.end();
                
                // Check if protected
                let is_protected = protected_regions.iter().any(|(p_start, p_end)| 
                    !(end <= *p_start || start >= *p_end)
                );
                
                if !is_protected {
                    all_removals.push((start, end, "you-know-context"));
                }
            }
            
            // Sort removals by position (reverse order for safe removal)
            all_removals.sort_by(|a, b| b.0.cmp(&a.0));
            
            // Apply all removals with punctuation fixes
            for (start, end, filler_type) in all_removals {
                println!("[SMART FORMATTER] Removing '{}' at {}-{}", filler_type, start, end);
                info!("[SMART FORMATTER] Removing '{}' at {}-{}", filler_type, start, end);
                
                // Special handling for different filler types
                match filler_type {
                    t if t.ends_with("+period") => {
                        text.replace_range(start..end, ". ");
                    },
                    "like-context" => {
                        // For "should like get", remove just " like"
                        let original = &result.text[start..end];
                        let replacement = original.replace(" like", "");
                        text.replace_range(start..end, &replacement);
                    },
                    "you-know-context" => {
                        // For "you know the", remove "you know "
                        let original = &result.text[start..end];
                        let replacement = original.replace("you know ", "").replace("You know ", "");
                        text.replace_range(start..end, &replacement);
                    },
                    _ => {
                        text.replace_range(start..end, "");
                    }
                }
                removals += 1;
            }
        }
        
        // Remove sentence starters (So, Well, etc.)
        if self.remove_sentence_starters {
            let matches_count = SENTENCE_START_FILLER.find_iter(&text).count();
            if matches_count > 0 {
                info!("[SMART FORMATTER] Removing {} sentence starters", matches_count);
                text = SENTENCE_START_FILLER.replace_all(&text, "$1").to_string();
                removals += matches_count;
            }
        }
        
        // Clean up multiple spaces and fix punctuation
        text = self.clean_after_removal(text);
        
        // Track changes
        if removals > 0 {
            result.formatting_applied.push(FormatChange {
                change_type: "filler_removal".to_string(),
                position: 0,
                confidence: format!("{} removed", removals),
                can_undo: false,
            });
            info!("[SMART FORMATTER] Removed {} filler words/phrases total", removals);
        }
        
        println!("[SMART FORMATTER] Final text: '{}'" , text);
        info!("[SMART FORMATTER] Final text: '{}'" , text);
        
        FormattedText {
            text,
            formatting_applied: result.formatting_applied,
            paragraphs_added: 0,
            lists_detected: 0,
        }
    }

    /// Clean up text after removing fillers
    fn clean_after_removal(&self, mut text: String) -> String {
        // Fix multiple commas
        while text.contains(",,") {
            text = text.replace(",,", ",");
        }
        
        // Fix comma after period
        text = text.replace(".,", ".");
        text = text.replace("!,", "!");
        text = text.replace("?,", "?");
        
        // Fix multiple spaces
        while text.contains("  ") {
            text = text.replace("  ", " ");
        }
        
        // Fix space before punctuation
        text = text.replace(" ,", ",");
        text = text.replace(" .", ".");
        text = text.replace(" !", "!");
        text = text.replace(" ?", "?");
        text = text.replace(" ;", ";");
        text = text.replace(" :", ":");
        
        // Fix missing space after punctuation
        let punctuation = [',', '.', '!', '?', ';', ':'];
        let mut chars: Vec<char> = text.chars().collect();
        let mut i = 0;
        while i < chars.len() - 1 {
            if punctuation.contains(&chars[i]) && chars[i + 1].is_alphabetic() {
                chars.insert(i + 1, ' ');
                i += 1;
            }
            i += 1;
        }
        text = chars.into_iter().collect();
        
        // Capitalize first letter after period if needed
        let mut chars: Vec<char> = text.chars().collect();
        let mut capitalize_next = true;
        
        for i in 0..chars.len() {
            if capitalize_next && chars[i].is_alphabetic() {
                chars[i] = chars[i].to_uppercase().next().unwrap_or(chars[i]);
                capitalize_next = false;
            } else if chars[i] == '.' && i + 1 < chars.len() && chars[i + 1] == ' ' {
                capitalize_next = true;
            }
        }
        
        chars.into_iter().collect::<String>().trim().to_string()
    }


}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_filler_removal() {
        let formatter = SmartFormatter::new();
        
        let input = "Um, this is the first topic. Uh, let's move on to something else.";
        let result = formatter.format(input);
        
        assert!(!result.text.contains("Um"));
        assert!(!result.text.contains("Uh"));
        assert_eq!(result.text, "This is the first topic. Let's move on to something else.");
    }

    #[test]
    fn test_sentence_starter_removal() {
        let formatter = SmartFormatter::new();
        
        let input = "So, she said \"Let's go\" and we left. Well, it was time to leave anyway.";
        let result = formatter.format(input);
        
        // Should remove sentence starters
        assert!(!result.text.starts_with("So,"));
        assert_eq!(result.text, "She said \"Let's go\" and we left. It was time to leave anyway.");
    }

    #[test]
    fn test_filler_phrase_removal() {
        let formatter = SmartFormatter::new();
        
        // Test "you know" and "I mean" removal
        let input = "The project is, you know, really important. I mean, we need to finish it soon.";
        let result = formatter.format(input);
        assert!(!result.text.contains("you know"));
        assert!(!result.text.contains("I mean"));
        assert_eq!(result.text, "The project is really important. We need to finish it soon.");
    }

    #[test]
    fn test_mixed_filler_removal() {
        let formatter = SmartFormatter::new();
        
        // Multiple fillers in one sentence
        let text = "Well, um, I think we should, uh, reconsider.";
        let result = formatter.format(text);
        assert_eq!(result.text, "I think we should reconsider.");
        
        // Sentence starters at different positions
        let text2 = "Actually, this is important. So, pay attention.";
        let result2 = formatter.format(text2);
        assert_eq!(result2.text, "This is important. Pay attention.");
        
        // Already clean example
        let text3 = "Let me explain the problem.";
        let result3 = formatter.format(text3);
        assert_eq!(result3.text, "Let me explain the problem.");
    }

    #[test]
    fn test_case_insensitive_removal() {
        let formatter = SmartFormatter::new();
        
        let text = "UM, what do you think? well, let me explain. You Know, it's important.";
        let result = formatter.format(text);
        
        // Should remove fillers regardless of case
        assert!(!result.text.contains("UM"));
        assert!(!result.text.contains("well"));
        assert!(!result.text.contains("You Know"));
    }

    #[test]
    fn test_edge_case_empty_and_whitespace() {
        let formatter = SmartFormatter::new();
        
        assert_eq!(formatter.format("").text, "");
        assert_eq!(formatter.format("   ").text, "   ");
        assert_eq!(formatter.format("\n\n").text, "\n\n");
    }

    #[test]
    fn test_preserve_spacing() {
        let formatter = SmartFormatter::new();
        
        // Should clean up spaces after removal
        let text = "The  um,  feature is  uh  ready.";
        let result = formatter.format(text);
        assert_eq!(result.text, "The feature is ready.");
        assert!(!result.text.contains("  ")); // No double spaces
    }

    #[test]
    fn test_configuration_disabled() {
        let mut formatter = SmartFormatter::new();
        formatter.enabled = false;
        
        let text = "Um, this should not be formatted. Well, with multiple sentences.";
        let result = formatter.format(text);
        assert_eq!(result.text, text);
        assert_eq!(result.formatting_applied.len(), 0);
    }

    #[test]
    fn test_preserve_meaning_words() {
        let formatter = SmartFormatter::new();
        
        // Should not remove "like" when it's a verb
        let text = "I like this feature. It feels like magic.";
        let result = formatter.format(text);
        assert!(result.text.contains("I like this feature"));
        assert!(result.text.contains("It feels like magic"));
        
        // But should remove "like" as a filler at sentence start
        let text2 = "Like, I was saying earlier.";
        let result2 = formatter.format(text2);
        assert_eq!(result2.text, "I was saying earlier.");
    }
    
    #[test]
    fn test_protected_phrases() {
        let formatter = SmartFormatter::new();
        
        // Test case from user feedback - should preserve "you know what I mean"
        let text = "You know what I mean when I say it's intuitive.";
        let result = formatter.format(text);
        assert_eq!(result.text, "You know what I mean when I say it's intuitive.");
        
        // Should still remove standalone fillers
        let text2 = "The thing is, you know, really complex.";
        let result2 = formatter.format(text2);
        assert_eq!(result2.text, "The thing is really complex.");
        
        // Protected: "you know what"
        let text3 = "Do you know what time it is?";
        let result3 = formatter.format(text3);
        assert_eq!(result3.text, "Do you know what time it is?");
        
        // Protected: "what I mean"
        let text4 = "This is what I mean by intuitive design.";
        let result4 = formatter.format(text4);
        assert_eq!(result4.text, "This is what I mean by intuitive design.");
        
        // Should remove "I mean" at start
        let text5 = "I mean, we should probably start now.";
        let result5 = formatter.format(text5);
        assert_eq!(result5.text, "We should probably start now.");
    }

    #[test]
    fn test_punctuation_cleanup() {
        let formatter = SmartFormatter::new();
        
        // Test punctuation spacing after filler removal
        let text = "The feature is um , really important .";
        let result = formatter.format(text);
        assert_eq!(result.text, "The feature is, really important.");
        
        // Multiple punctuation issues
        let text2 = "Well , this is important ; you know , very important .";
        let result2 = formatter.format(text2);
        assert_eq!(result2.text, "This is important; very important.");
    }

    #[test]
    fn test_real_world_transcription_scenarios() {
        let formatter = SmartFormatter::new();
        
        // Typical transcription with various fillers
        let text = "So, today I want to talk about, um, the new features. \
                   Well, first we have improved search. \
                   Uh, second we added error handling. \
                   Actually, the performance is better. \
                   So, what do you think?";
        
        let result = formatter.format(text);
        
        // Should remove all fillers
        assert!(!result.text.contains("So,") || !result.text.starts_with("So,"));
        assert!(!result.text.contains("um"));
        assert!(!result.text.contains("Well,"));
        assert!(!result.text.contains("Uh,"));
        assert!(!result.text.contains("Actually,"));
    }

    #[test]
    fn test_edge_case_filler_variations() {
        let formatter = SmartFormatter::new();
        
        // Test various filler variations
        let text = "Ummm, let me think. Uhhh, maybe we should proceed. Errr, I'm not sure.";
        let result = formatter.format(text);
        
        // Should remove all variations
        assert!(!result.text.contains("Ummm"));
        assert!(!result.text.contains("Uhhh"));
        assert!(!result.text.contains("Errr"));
        
        // Test repeated fillers with context-aware removal
        let text2 = "It's, you know, really important.";
        let result2 = formatter.format(text2);
        assert_eq!(result2.text, "It's, really important."); // Note: comma preserved
    }
    
    #[test]
    fn test_complex_edge_cases() {
        let formatter = SmartFormatter::new();
        
        // Multiple protected phrases in one sentence
        let text = "You know what I mean, and I mean it when I say this is important.";
        let result = formatter.format(text);
        assert_eq!(result.text, "You know what I mean, and I mean it when I say this is important.");
        
        // Filler at start but protected phrase later
        let text2 = "Well, you know what the problem is.";
        let result2 = formatter.format(text2);
        assert_eq!(result2.text, "You know what the problem is.");
        
        // Edge case: "sort of" and "kind of" with context
        let text3 = "It's sort of, complicated, kind of, like a puzzle.";
        let result3 = formatter.format(text3);
        assert_eq!(result3.text, "It's complicated, like a puzzle.");
    }


    #[test]
    fn test_formatting_tracking_and_undo_capability() {
        let formatter = SmartFormatter::new();
        
        let text = "Um, first paragraph here. Well, the second paragraph begins.";
        let result = formatter.format(text);
        
        // Check that changes are tracked
        assert!(!result.formatting_applied.is_empty());
        
        // Filler removal changes should not be undoable
        assert!(result.formatting_applied.iter().all(|c| !c.can_undo));
        
        // Should have correct change type
        let first_change = &result.formatting_applied[0];
        assert_eq!(first_change.change_type, "filler_removal");
    }

    #[test]
    fn test_filler_word_removal() {
        let formatter = SmartFormatter::new();
        
        let text = "Um, I think we should, uh, move forward with the project.";
        let result = formatter.format(text);
        
        // Should remove fillers
        assert!(!result.text.contains("Um"));
        assert!(!result.text.contains("uh"));
        assert_eq!(result.text, "I think we should move forward with the project.");
        
        // Should track changes
        assert!(!result.formatting_applied.is_empty());
        assert_eq!(result.formatting_applied[0].change_type, "filler_removal");
    }

    #[test] 
    fn test_filler_phrase_removal() {
        let formatter = SmartFormatter::new();
        
        let text = "The feature is, you know, really important.";
        let result = formatter.format(text);
        
        // Should remove "you know"
        assert!(!result.text.contains("you know"));
        assert_eq!(result.text, "The feature is really important.");
    }

    #[test]
    fn test_capitalization_after_removal() {
        let formatter = SmartFormatter::new();
        
        // Test capitalization is maintained
        let text = "well, the project started in January. so, we need to finish by March.";
        let result = formatter.format(text);
        
        // Should capitalize after removing sentence starters
        assert_eq!(result.text, "The project started in January. We need to finish by March.");
    }

    #[test]
    fn test_selective_filler_settings() {
        // Test with only basic fillers enabled
        let formatter = SmartFormatter::with_settings(true, false, false);
        
        let text = "Um, I think this is good. Well, you know, it works.";
        let result = formatter.format(text);
        
        // Should only remove "Um", not "Well" or "you know"
        assert!(!result.text.contains("Um"));
        assert!(result.text.contains("Well"));
        assert!(result.text.contains("you know"));
    }

    #[test]
    fn test_performance_with_large_text() {
        use std::time::Instant;
        
        let formatter = SmartFormatter::new();
        
        // Generate large text with fillers
        let mut large_text = String::new();
        for i in 0..100 {
            large_text.push_str(&format!("Um, this is sentence number {}. ", i));
            if i % 10 == 0 {
                large_text.push_str("Well, let's move to the next topic. ");
            }
        }
        
        let start = Instant::now();
        let result = formatter.format(&large_text);
        let duration = start.elapsed();
        
        // Should complete in reasonable time (< 100ms for ~100 sentences)
        assert!(duration.as_millis() < 100);
        
        // Should have removed fillers
        assert!(!result.text.contains("Um"));
        assert!(result.formatting_applied.len() > 0);
    }
}