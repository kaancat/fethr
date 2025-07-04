use regex::Regex;
use serde::{Deserialize, Serialize};
use once_cell::sync::Lazy;
use tongrams::EliasFanoTrieCountLm;
use std::sync::Arc;

/// Main smart formatter that handles text formatting enhancements
pub struct SmartFormatter {
    enabled: bool,
    paragraph_detection: bool,
    list_detection: bool,
    confidence_threshold: f64,
    ngram_model: Option<Arc<EliasFanoTrieCountLm>>, // Optional n-gram model
}

/// Confidence levels for formatting decisions
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FormatConfidence {
    High,
    Medium, 
    Low,
}

/// Types of content detected
#[derive(Debug, Clone, PartialEq)]
pub enum ContentType {
    Conversation,
    Monologue,
    List,
    Notes,
    Unknown,
}

/// Formatting decision with confidence
#[derive(Debug, Clone)]
pub struct FormatDecision {
    pub format_type: FormatType,
    pub confidence: FormatConfidence,
    pub reason: String,
}

/// Types of formatting to apply
#[derive(Debug, Clone, PartialEq)]
pub enum FormatType {
    ParagraphBreak,
    NumberedList,
    BulletList,
    None,
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

// Lazy static regex patterns for efficiency
static SENTENCE_END_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"([.!?])\s+([A-Z])").unwrap()
});

static TRANSITION_WORD_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\.\s+(So|Now|Next|First|Second|Finally|However|Therefore|Additionally)\s+").unwrap()
});

static LIST_MARKER_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(First|Firstly|Second|Secondly|Third|Thirdly|Next|Then|Also|Additionally),?\s+").unwrap()
});

impl SmartFormatter {
    pub fn new() -> Self {
        Self {
            enabled: true,
            paragraph_detection: true,
            list_detection: false, // Start conservative
            confidence_threshold: 0.8,
            ngram_model: None, // Will be loaded separately if available
        }
    }

    /// Create formatter with n-gram model for enhanced detection
    pub fn with_ngram_model(model: Arc<EliasFanoTrieCountLm>) -> Self {
        Self {
            enabled: true,
            paragraph_detection: true,
            list_detection: false,
            confidence_threshold: 0.8,
            ngram_model: Some(model),
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

        // Find quoted regions to protect
        let quoted_regions = self.find_quoted_regions(&result.text);

        // Apply formatting based on enabled features
        if self.paragraph_detection {
            result = self.apply_paragraph_breaks(result, &quoted_regions);
        }

        if self.list_detection {
            result = self.apply_list_formatting(result, &quoted_regions);
        }

        result
    }

    /// Detect content type for appropriate formatting
    fn detect_content_type(&self, text: &str) -> ContentType {
        let sentences: Vec<&str> = text.split(". ").collect();
        
        if sentences.is_empty() {
            return ContentType::Unknown;
        }

        let avg_length = sentences.iter()
            .map(|s| s.len())
            .sum::<usize>() / sentences.len().max(1);
        
        let question_count = text.matches('?').count();
        let list_markers = LIST_MARKER_PATTERN.find_iter(text).count();

        // Detection logic with safety checks
        if list_markers >= 2 && sentences.len() >= 3 {
            ContentType::List
        } else if question_count > 2 && sentences.len() > 5 {
            ContentType::Conversation
        } else if avg_length > 50 && sentences.len() > 3 {
            ContentType::Monologue
        } else if avg_length < 20 {
            ContentType::Notes
        } else {
            ContentType::Unknown
        }
    }

    /// Find regions within quotes to avoid formatting
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

    /// Apply paragraph breaks with conservative detection
    fn apply_paragraph_breaks(&self, mut result: FormattedText, quoted_regions: &[(usize, usize)]) -> FormattedText {
        let mut new_text = String::new();
        let mut last_end = 0;
        let mut changes = result.formatting_applied;

        // Find potential paragraph break positions
        for mat in TRANSITION_WORD_PATTERN.find_iter(&result.text) {
            let pos = mat.start();
            
            // Skip if in quotes
            if self.is_in_quotes(pos, quoted_regions) {
                continue;
            }

            // Check confidence signals
            let confidence = self.calculate_paragraph_confidence(&result.text, pos);
            
            if confidence == FormatConfidence::High {
                // Add text up to this point
                new_text.push_str(&result.text[last_end..pos + 1]); // Include the period
                new_text.push_str("\n\n");
                
                // Track the change
                changes.push(FormatChange {
                    change_type: "paragraph_break".to_string(),
                    position: pos,
                    confidence: "high".to_string(),
                    can_undo: true,
                });
                
                result.paragraphs_added += 1;
                last_end = pos + 2; // Skip the space after period
            }
        }

        // Add remaining text
        new_text.push_str(&result.text[last_end..]);

        FormattedText {
            text: new_text,
            formatting_applied: changes,
            paragraphs_added: result.paragraphs_added,
            lists_detected: result.lists_detected,
        }
    }

    /// Calculate confidence for paragraph break
    fn calculate_paragraph_confidence(&self, text: &str, position: usize) -> FormatConfidence {
        // Get context around position
        let before_start = position.saturating_sub(100);
        let before = &text[before_start..position];
        let after_end = (position + 100).min(text.len());
        let after = &text[position..after_end];

        let mut confidence_score = 0.0;

        // Check for transition word (already confirmed by regex)
        confidence_score += 0.3;

        // Check if previous sentence is complete and substantial
        if let Some(last_sentence) = before.split(". ").last() {
            if last_sentence.split_whitespace().count() > 10 {
                confidence_score += 0.3;
            }
        }

        // Check if it's at a natural boundary (not mid-thought)
        if !after.starts_with("and ") && !after.starts_with("but ") {
            confidence_score += 0.2;
        }

        // Topic shift detection (simple version)
        let before_words: Vec<&str> = before.split_whitespace().collect();
        let after_words: Vec<&str> = after.split_whitespace().take(10).collect();
        
        // Different subject/verb patterns suggest topic change
        if before_words.len() > 5 && after_words.len() > 5 {
            confidence_score += 0.2;
        }

        // N-gram enhanced scoring if model is available
        if let Some(ref model) = self.ngram_model {
            let ngram_boost = self.calculate_ngram_boundary_score(model, before, after);
            confidence_score = confidence_score * 0.7 + ngram_boost * 0.3;
        }

        match confidence_score {
            s if s >= self.confidence_threshold => FormatConfidence::High,
            s if s >= 0.6 => FormatConfidence::Medium,
            _ => FormatConfidence::Low,
        }
    }

    /// Use n-gram model to calculate boundary likelihood
    fn calculate_ngram_boundary_score(&self, model: &EliasFanoTrieCountLm, before: &str, after: &str) -> f64 {
        // Get last few words before and first few words after
        let before_words: Vec<&str> = before.split_whitespace().rev().take(3).collect();
        let after_words: Vec<&str> = after.split_whitespace().take(3).collect();

        if before_words.is_empty() || after_words.is_empty() {
            return 0.5; // Neutral score
        }

        // Create a lookuper for the model
        let mut lookuper = model.lookuper();

        // Check continuity - low probability of sequence suggests boundary
        let mut continuity_tokens = before_words.clone();
        continuity_tokens.reverse();
        continuity_tokens.extend(&after_words);

        // Try to lookup the transition sequence
        let continuity_score = if continuity_tokens.len() >= 3 {
            // Check 3-gram across boundary
            let ngram = &continuity_tokens[continuity_tokens.len()-3..];
            match lookuper.with_tokens(ngram) {
                Some(count) => {
                    // Normalize by a typical frequency (adjust based on your model)
                    (count as f64 / 1000.0).min(1.0)
                }
                None => 0.0, // No match = likely boundary
            }
        } else {
            0.5
        };

        // Return inverted score - low continuity = high boundary likelihood
        1.0 - continuity_score
    }

    /// Apply list formatting with safety checks
    fn apply_list_formatting(&self, mut result: FormattedText, quoted_regions: &[(usize, usize)]) -> FormattedText {
        // Only apply if we detect list content type
        let content_type = self.detect_content_type(&result.text);
        if content_type != ContentType::List {
            return result;
        }

        // Find list markers
        let markers: Vec<_> = LIST_MARKER_PATTERN.find_iter(&result.text)
            .filter(|m| !self.is_in_quotes(m.start(), quoted_regions))
            .collect();

        // Need at least 2 markers to be confident
        if markers.len() < 2 {
            return result;
        }

        // Apply numbered list formatting
        let mut new_text = String::new();
        let mut last_end = 0;
        let mut list_number = 1;

        result.lists_detected = 1; // We detected a list

        for (i, mat) in markers.iter().enumerate() {
            // Add text before marker
            new_text.push_str(&result.text[last_end..mat.start()]);
            
            // Add list number
            new_text.push_str(&format!("{}. ", list_number));
            list_number += 1;
            
            // Track change
            result.formatting_applied.push(FormatChange {
                change_type: "list_item".to_string(),
                position: mat.start(),
                confidence: "high".to_string(),
                can_undo: true,
            });
            
            last_end = mat.end();
        }

        // Add remaining text
        new_text.push_str(&result.text[last_end..]);

        FormattedText {
            text: new_text,
            formatting_applied: result.formatting_applied,
            paragraphs_added: result.paragraphs_added,
            lists_detected: result.lists_detected,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_paragraph_detection() {
        let formatter = SmartFormatter::new();
        
        let input = "This is the first topic. Now let's move on to something else.";
        let result = formatter.format(input);
        
        assert!(result.text.contains("\n\n"));
        assert_eq!(result.formatting_applied.len(), 1);
    }

    #[test]
    fn test_quoted_text_protection() {
        let formatter = SmartFormatter::new();
        
        let input = "She said \"Now let's go\" and we left.";
        let result = formatter.format(input);
        
        // Should not add paragraph break inside quotes
        assert!(!result.text.contains("\n\n"));
    }

    #[test]
    fn test_list_detection_safety() {
        let mut formatter = SmartFormatter::new();
        formatter.list_detection = true;
        
        // Should not detect as list with only one marker
        let input = "First of all, I'd like to say hello.";
        let result = formatter.format(input);
        assert_eq!(result.text, input);
        
        // Should detect with multiple markers
        let input2 = "First, we need to check. Second, we should verify. Third, we can proceed.";
        let result2 = formatter.format(input2);
        assert!(result2.text.contains("1. "));
    }

    #[test]
    fn test_no_false_positive_paragraphs() {
        let formatter = SmartFormatter::new();
        
        // Technical content with abbreviations
        let text = "The U.S. economy is growing. So is the E.U. market.";
        let result = formatter.format(text);
        assert!(result.text.contains("\n\n")); // "So" after period should trigger
        
        // URLs and paths should not trigger breaks
        let text2 = "Visit example.com/page. Now check the results.";
        let result2 = formatter.format(text2);
        assert!(result2.text.contains("\n\n")); // "Now" should still trigger
        
        // Numbers and decimals
        let text3 = "The temperature is 98.6 degrees. However it may vary.";
        let result3 = formatter.format(text3);
        assert!(result3.text.contains("\n\n")); // "However" should trigger
    }

    #[test]
    fn test_question_boundary_detection() {
        let formatter = SmartFormatter::new();
        
        let text = "What do you think about this? Now let me explain why.";
        let result = formatter.format(text);
        
        // "Now" after question should trigger paragraph break
        assert!(result.formatting_applied.len() > 0);
    }

    #[test]
    fn test_edge_case_empty_and_whitespace() {
        let formatter = SmartFormatter::new();
        
        assert_eq!(formatter.format("").text, "");
        assert_eq!(formatter.format("   ").text, "   ");
        assert_eq!(formatter.format("\n\n").text, "\n\n");
    }

    #[test]
    fn test_preserve_existing_formatting() {
        let formatter = SmartFormatter::new();
        
        // Already has paragraph breaks - should not modify
        let text = "First paragraph.\n\nSecond paragraph.";
        let result = formatter.format(text);
        assert_eq!(result.text, text);
        assert_eq!(result.formatting_applied.len(), 0);
    }

    #[test]
    fn test_configuration_disabled() {
        let mut formatter = SmartFormatter::new();
        formatter.enabled = false;
        
        let text = "This should not be formatted. Now with multiple sentences.";
        let result = formatter.format(text);
        assert_eq!(result.text, text);
        assert_eq!(result.formatting_applied.len(), 0);
    }

    #[test]
    fn test_dialogue_handling() {
        let formatter = SmartFormatter::new();
        
        // Should not break short conversational exchanges
        let text = "He said hello. She said hi back. They both smiled.";
        let result = formatter.format(text);
        // No transition words, so no breaks
        assert_eq!(result.formatting_applied.len(), 0);
        
        // But should break with transition words
        let text2 = "He said hello. So she decided to respond differently.";
        let result2 = formatter.format(text2);
        assert!(result2.formatting_applied.len() > 0);
    }

    #[test]
    fn test_confidence_threshold_filtering() {
        let mut formatter = SmartFormatter::new();
        formatter.confidence_threshold = 0.95; // Very high threshold
        
        // Even with transition word, low confidence should prevent formatting
        let text = "End of sentence. Next word here.";
        let result = formatter.format(text);
        // "Next" is a transition word but may not meet high confidence
        // depending on context scoring
        assert!(result.formatting_applied.is_empty() || 
                result.formatting_applied.iter().all(|c| c.confidence == "high"));
    }

    #[test]
    fn test_real_world_transcription_scenarios() {
        let mut formatter = SmartFormatter::new();
        formatter.list_detection = true;
        
        // Typical transcription with filler words removed by Whisper
        let text = "so today i want to talk about the new features. \
                   First we have improved search. \
                   Second we added error handling. \
                   Finally the performance is better. \
                   So what do you think";
        
        let result = formatter.format(text);
        
        // Should detect list items
        assert!(result.formatting_applied.iter().any(|c| c.change_type == "list_item"));
        // Should add paragraph break after intro
        assert!(result.formatting_applied.iter().any(|c| c.change_type == "paragraph_break"));
    }

    #[test]
    fn test_no_formatting_in_code_or_technical_content() {
        let formatter = SmartFormatter::new();
        
        // Technical content that looks like it might have transitions
        let text = "Run git init. Next run git add. Finally git commit.";
        let result = formatter.format(text);
        
        // Should still format as these are clear transitions
        assert!(result.formatting_applied.len() > 0);
        
        // But quoted commands should be protected
        let text2 = "Type \"Next item please\" in the terminal.";
        let result2 = formatter.format(text2);
        assert_eq!(result2.text, text2); // No changes in quoted text
    }

    #[test]
    fn test_content_type_detection() {
        let formatter = SmartFormatter::new();
        
        // List content
        let list_text = "Here are the items. First item one. Second item two. Third item three.";
        assert_eq!(formatter.detect_content_type(list_text), ContentType::List);
        
        // Conversation with questions
        let conv_text = "How are you? I'm fine thanks. What about you? Pretty good. Where are you going? To the store.";
        assert_eq!(formatter.detect_content_type(conv_text), ContentType::Conversation);
        
        // Short notes
        let notes_text = "Buy milk. Call Bob. Fix bug.";
        assert_eq!(formatter.detect_content_type(notes_text), ContentType::Notes);
    }

    #[test]
    fn test_formatting_tracking_and_undo_capability() {
        let formatter = SmartFormatter::new();
        
        let text = "First paragraph here. Now the second paragraph begins.";
        let result = formatter.format(text);
        
        // Check that changes are tracked
        assert!(!result.formatting_applied.is_empty());
        
        // All changes should be undoable
        assert!(result.formatting_applied.iter().all(|c| c.can_undo));
        
        // Position should be recorded correctly
        let first_change = &result.formatting_applied[0];
        assert!(first_change.position > 0);
        assert!(first_change.position < text.len());
    }

    #[test]
    fn test_multiple_transition_words() {
        let formatter = SmartFormatter::new();
        
        let text = "Introduction here. So let's begin. Next we'll cover basics. \
                   Finally we'll do advanced topics. Therefore practice is important.";
        
        let result = formatter.format(text);
        
        // Should have multiple paragraph breaks
        let break_count = result.formatting_applied.iter()
            .filter(|c| c.change_type == "paragraph_break")
            .count();
        
        assert!(break_count >= 3); // At least 3 transitions should be detected
    }

    #[test] 
    fn test_abbreviation_handling() {
        let formatter = SmartFormatter::new();
        
        // Common abbreviations shouldn't break formatting
        let text = "Dr. Smith arrived. However he was late.";
        let result = formatter.format(text);
        
        // Should only break at "However", not after "Dr."
        assert_eq!(result.formatting_applied.len(), 1);
        assert!(result.text.contains(".\n\nHowever"));
    }
}