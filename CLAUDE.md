# Fethr - Voice Transcription App

## Important Development Guidelines
- **ALWAYS commit changes after completing a set of tasks** - Use git to create commits when you finish implementing features or fixing bugs
- Create meaningful commit messages that describe what was changed and why
- Don't wait until everything is perfect - commit working increments

## Project Overview
Fethr is a lightweight cross-platform voice transcription app built with Tauri (Rust backend) and React (TypeScript frontend). The app provides real-time voice transcription using local Whisper.cpp models with a clean, minimal UI featuring a floating pill interface.

## Current Architecture

### Backend (Rust/Tauri)
- **Audio Processing**: `audio_manager.rs` - Handles recording, format conversion, and audio pipeline
- **Transcription**: `transcription.rs` - Whisper.cpp integration with model management
- **Dictionary**: `dictionary_manager.rs` - Custom word dictionary for improved transcription accuracy
- **AI Actions**: `ai_actions_manager.rs` - Post-processing with OpenAI/Anthropic via Vercel proxy
- **Configuration**: `config.rs` - TOML-based settings management

### Frontend (React/TypeScript)
- **Main UI**: Floating pill interface with hover/recording states
- **Editor**: `EditorPage.tsx` - Text editing with AI enhancement options
- **Settings**: Comprehensive settings tabs including dictionary management
- **History**: Transcription history with search and editing capabilities

### Key Features
- Local Whisper.cpp transcription (multiple model sizes)
- Custom dictionary support for technical terms
- AI post-processing (summarize, email formatting, prompt optimization)
- Cross-platform (Windows, macOS, Linux)
- Minimal resource usage (~30-50MB RAM)

## Development Commands
```bash
# Development mode
npm run tauri dev

# Build for production
npm run tauri build

# Frontend only
npm run dev

# Linting
npm run lint
npm run typecheck
```

## Current Issues with Dictionary Correction

### Problem Statement
The current dictionary correction implementation is producing severe false positives, making the app unusable when dictionary mode is enabled. Common words like "can" and "con" are being incorrectly corrected to random names from the dictionary (e.g., "can" → "Kaan"). This breaks user trust and makes transcriptions worse rather than better.

### Root Causes
1. **Overly aggressive fuzzy matching**: Current Levenshtein implementation lacks proper safeguards
2. **No common word protection**: Frequent English words are being "corrected" unnecessarily
3. **Poor confidence scoring**: Algorithm can't distinguish between valid corrections and false positives
4. **Performance issues**: Current implementation is slow and resource-intensive

---

## Planned Solution: SymSpell + Harper Integration

### Overview
Replace the current broken dictionary correction system with a dual-layer approach:
1. **SymSpell**: Fast, accurate spelling correction with proven algorithms
2. **Harper**: Grammar checking and context-aware corrections

This combination will provide both spelling and grammar correction while maintaining privacy and performance.

### Why SymSpell + Harper?

**SymSpell Advantages:**
- **1000x faster** than traditional Levenshtein distance approaches
- **Proven algorithm** with extensive real-world usage
- **Configurable edit distance** for better control over corrections
- **Compound word support** for technical terms
- **Low memory footprint** with pre-calculated deletions

**Harper Advantages:**
- **Grammar-aware corrections** beyond simple spelling
- **Millisecond performance** for real-time usage
- **Privacy-first**: All processing happens locally
- **Lightweight**: Uses 1/50th the memory of LanguageTool
- **Context understanding**: Can detect grammatical errors spelling checkers miss

### Implementation Plan

#### Phase 1: SymSpell Integration (6-8 hours)

##### 1.1 Add Dependencies
```toml
# In Cargo.toml
[dependencies]
symspell = "0.4"  # Fast spelling correction
```

##### 1.2 Create SymSpell Module
```rust
// src-tauri/src/symspell_correction.rs
pub struct SymSpellCorrector {
    symspell: SymSpell<UnicodeStringStrategy>,
    user_dictionary: Vec<String>,
    common_words_protection: bool,
}

impl SymSpellCorrector {
    pub fn new(dictionary_words: Vec<String>) -> Self {
        // Initialize with user dictionary
        // Add frequency data for better corrections
        // Configure edit distance (max 2 for conservative corrections)
    }
    
    pub fn correct_text(&self, text: &str) -> CorrectionResult {
        // Use lookup() for single words
        // Use lookup_compound() for full sentences
        // Return both corrected text and confidence scores
    }
}
```

##### 1.3 Frequency Dictionary Integration
- Download and integrate English frequency dictionary
- Merge with user's custom dictionary
- Assign appropriate frequencies to custom terms

##### 1.4 Common Word Protection
- Implement whitelist of 10,000 most common English words
- Never correct words on this list unless explicitly in user dictionary
- Prevents "can" → "Kaan" type errors

#### Phase 2: Harper Integration (4-6 hours)

##### 2.1 Add Harper Dependency
```toml
# In Cargo.toml
[dependencies]
harper-core = "0.10"  # Grammar checking engine
```

##### 2.2 Create Grammar Module
```rust
// src-tauri/src/grammar_correction.rs
pub struct GrammarChecker {
    harper: Harper,
    enabled_rules: Vec<RuleType>,
}

impl GrammarChecker {
    pub fn new() -> Self {
        // Initialize Harper with appropriate rules
        // Configure for technical writing style
    }
    
    pub fn check_grammar(&self, text: &str) -> Vec<GrammarSuggestion> {
        // Run Harper linting
        // Filter suggestions by confidence
        // Return actionable corrections
    }
}
```

##### 2.3 Grammar Rules Configuration
- Enable rules appropriate for transcription
- Disable overly strict style rules
- Focus on clear grammatical errors

#### Phase 3: Unified Correction Pipeline (4-5 hours)

##### 3.1 Create Pipeline Module
```rust
// src-tauri/src/correction_pipeline.rs
pub struct CorrectionPipeline {
    symspell: SymSpellCorrector,
    harper: Option<GrammarChecker>,
    config: CorrectionConfig,
}

impl CorrectionPipeline {
    pub fn process(&self, text: &str) -> CorrectionResult {
        // Step 1: SymSpell spelling correction
        let spelling_corrected = self.symspell.correct_text(text);
        
        // Step 2: Harper grammar correction (if enabled)
        let final_text = if let Some(harper) = &self.harper {
            self.apply_grammar_corrections(spelling_corrected.text)
        } else {
            spelling_corrected.text
        };
        
        // Step 3: Return with metadata about corrections
        CorrectionResult {
            original: text.to_string(),
            corrected: final_text,
            spelling_changes: spelling_corrected.changes,
            grammar_changes: grammar_changes,
            confidence: overall_confidence,
        }
    }
}
```

##### 3.2 Integration with Transcription
```rust
// Update transcription.rs
fn whisper_output_trim(output: &str, app_handle: &AppHandle) -> String {
    let cleaned = /* existing cleanup */;
    
    // Use new correction pipeline
    if let Ok(pipeline) = get_correction_pipeline(app_handle) {
        let result = pipeline.process(&cleaned);
        
        // Log corrections for debugging
        if result.has_corrections() {
            log_corrections(&result);
        }
        
        result.corrected
    } else {
        cleaned
    }
}
```

##### 3.3 Performance Optimization
- Implement timeout (50ms max for entire pipeline)
- Cache correction results for repeated phrases
- Use parallel processing where possible
- Skip correction for very long texts (>1000 words)

#### Phase 4: Configuration & UI (3-4 hours)

##### 4.1 Configuration Structure
```rust
pub struct CorrectionConfig {
    // SymSpell settings
    pub spelling_enabled: bool,
    pub max_edit_distance: i64,  // 1-3, default 2
    pub include_unknown: bool,    // Correct unknown words
    pub min_word_length: usize,   // Skip short words
    
    // Harper settings
    pub grammar_enabled: bool,
    pub grammar_rules: Vec<String>,
    pub grammar_sensitivity: f32,
    
    // Pipeline settings
    pub timeout_ms: u64,          // Max processing time
    pub debug_mode: bool,         // Log all corrections
}
```

##### 4.2 UI Updates
- Replace fuzzy correction toggle with SymSpell/Harper controls
- Add correction transparency (show what was corrected)
- Implement correction history for debugging
- Add performance metrics display

#### Phase 5: Migration & Testing (3-4 hours)

##### 5.1 Migration Strategy
1. Keep existing dictionary management system
2. Remove `fuzzy_dictionary.rs` and `dictionary_corrector.rs`
3. Update all references to use new pipeline
4. Migrate user settings to new configuration

##### 5.2 Comprehensive Testing
```rust
#[cfg(test)]
mod tests {
    // Test no false positives on common words
    #[test]
    fn test_common_word_protection() {
        let corrector = create_test_corrector();
        assert_eq!(corrector.correct("can"), "can");  // Not "Kaan"
        assert_eq!(corrector.correct("the"), "the");
    }
    
    // Test valid corrections work
    #[test]
    fn test_technical_corrections() {
        let corrector = create_test_corrector();
        assert_eq!(corrector.correct("javscript"), "javascript");
        assert_eq!(corrector.correct("pyton"), "python");
    }
    
    // Test performance constraints
    #[test]
    fn test_performance_timeout() {
        let corrector = create_test_corrector();
        let start = Instant::now();
        corrector.correct(LARGE_TEXT);
        assert!(start.elapsed() < Duration::from_millis(50));
    }
}
```

##### 5.3 Real-world Validation
- Test with actual transcription outputs
- Verify no regression in correction quality
- Ensure performance meets targets
- Validate with user's problematic examples

### Expected Improvements

1. **Elimination of False Positives**
   - Common words protected by default
   - Configurable correction thresholds
   - Better confidence scoring

2. **Performance Gains**
   - 1000x faster than current implementation
   - Sub-50ms total processing time
   - Lower memory usage

3. **Better Corrections**
   - Compound word support for technical terms
   - Grammar checking for more natural output
   - Context-aware corrections

4. **User Control**
   - Granular configuration options
   - Correction transparency
   - Debug mode for troubleshooting

### Risk Mitigation

1. **Gradual Rollout**
   - Keep feature behind experimental flag initially
   - Allow users to switch between old/new systems
   - Collect feedback before full migration

2. **Fallback Mechanism**
   - If SymSpell/Harper fail, return original text
   - Never make transcription worse than input
   - Log all errors for debugging

3. **Performance Guarantees**
   - Hard timeout on correction pipeline
   - Skip correction for edge cases
   - Monitor resource usage

### Implementation Timeline

- **Week 1**: SymSpell integration and testing
- **Week 2**: Harper integration and unified pipeline
- **Week 3**: UI updates and configuration
- **Week 4**: Testing, optimization, and migration

Total estimated time: 20-27 hours

### Next Steps

1. **Immediate Actions**
   - Add symspell dependency to Cargo.toml
   - Create basic SymSpell corrector module
   - Test with problematic examples ("can", "con", etc.)

2. **Validation**
   - Ensure SymSpell solves false positive issues
   - Benchmark performance improvements
   - Test with user's dictionary

3. **Gradual Integration**
   - Start with SymSpell only
   - Add Harper once spelling correction is stable
   - Roll out to users with clear migration path

---

## Technical Notes

### SymSpell Configuration
- Use `UnicodeStringStrategy` for international support
- Set max_edit_distance to 2 (conservative)
- Use verbosity mode `Closest` for best match only
- Enable compound word splitting for technical terms

### Harper Configuration
- Disable style rules (focus on grammar only)
- Use technical writing preset if available
- Configure for American English by default
- Allow user to toggle specific rule categories

### Performance Targets
- Spelling correction: <10ms for typical input
- Grammar checking: <40ms for typical input
- Total pipeline: <50ms including overhead
- Memory usage: <50MB additional

---

## Project Context
This SymSpell + Harper integration addresses the critical false positive issues in the current dictionary system while providing superior performance and accuracy. By combining a proven spelling correction algorithm with grammar checking, users get better transcriptions without the current system's flaws.