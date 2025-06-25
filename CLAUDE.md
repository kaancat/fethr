# Fethr - Voice Transcription App

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

## Planned Feature: Fuzzy Dictionary Correction

### Problem Statement
Dictionary mode currently only works with larger Whisper models (small/medium/large) due to stability issues with tiny models. Users want accurate technical term transcription without the performance penalty of larger models.

### Proposed Solution
Implement post-processing fuzzy matching to correct transcription errors using the existing dictionary, working with all model sizes including tiny.

### Implementation Plan

#### 1. Core Algorithm Design
- **Location**: New module `src-tauri/src/fuzzy_dictionary.rs`
- **Integration Point**: Modify `whisper_output_trim()` in `transcription.rs:520`
- **Algorithm**: Custom Levenshtein distance with confidence scoring

#### 2. Distance Thresholds (Conservative)
```rust
// Word length → Max edit distance, Min confidence
4-5 chars → distance 1, confidence 0.8
6-8 chars → distance 2, confidence 0.7  
9+ chars → distance 3, confidence 0.6
1-3 chars → exact match only (too risky for fuzzy)
```

#### 3. Confidence Scoring
```rust
confidence = base_score * length_penalty * position_bonus * frequency_boost
```

#### 4. Critical Edge Cases
- **Short word protection**: No fuzzy matching for words ≤3 characters
- **Number preservation**: All numeric tokens unchanged
- **Punctuation handling**: Match word cores, preserve punctuation
- **Case sensitivity**: Case-insensitive matching, preserve original casing
- **Common word whitelist**: Protect frequent English words from incorrect corrections

#### 5. Performance Optimizations
- **Pre-indexing**: Dictionary grouped by length and first character
- **Early termination**: Skip words with length difference >2 characters
- **LRU caching**: Cache recent corrections (100 entries)
- **Timeout protection**: Abort after 200ms for very long texts

#### 6. Integration Points

**Backend Changes:**
```rust
// In transcription.rs
fn whisper_output_trim(output: &str) -> String {
    let cleaned = /* existing cleanup */;
    
    if should_apply_fuzzy_correction() {
        match dictionary_manager::get_dictionary() {
            Ok(dict) if !dict.is_empty() => {
                fuzzy_dictionary::correct_text_with_dictionary(&cleaned, &dict)
            },
            _ => cleaned
        }
    } else {
        cleaned
    }
}
```

**Configuration:**
```rust
// Add to config.rs
pub struct FuzzyCorrectionSettings {
    pub enabled: bool,                    // Default: false (opt-in)
    pub sensitivity: f32,                // 0.6-0.9, default: 0.7
    pub max_corrections_per_text: usize, // Default: 10
    pub preserve_original_case: bool,    // Default: true
    pub correction_log_enabled: bool,    // For debugging
}
```

**UI Integration:**
- Add fuzzy correction controls to `DictionarySettingsTab.tsx`
- Enable/disable toggle
- Sensitivity slider (0.6-0.9)
- Debug panel showing recent corrections

#### 7. Error Handling Strategy
- **Dictionary load failure**: Fall back to original text, log warning
- **Fuzzy matching crash**: Catch panic, return original text, disable temporarily
- **Performance timeout**: Abort after 200ms, return partial corrections
- **Memory protection**: Skip correction for texts >1000 words

#### 8. Testing Strategy
- **Unit tests**: Algorithm correctness, edge cases, performance
- **Integration tests**: Full transcription pipeline
- **Test datasets**: Programming terms, technical vocabulary, common false positives
- **Validation metrics**: Precision, recall, speed, false positive rate

#### 9. Implementation Timeline
- **Phase 1** (4 hours): Core algorithm + basic integration
- **Phase 2** (2 hours): Performance optimization + caching
- **Phase 3** (2 hours): Configuration system + UI
- **Phase 4** (2 hours): Testing + edge case handling
- **Total**: 10-12 hours for production-ready implementation

#### 10. Dependencies
- No new crates required - custom Levenshtein implementation
- Existing dictionary_manager.rs provides dictionary access
- Existing config system for settings storage

### Expected Benefits
- **Tiny model compatibility**: Dictionary correction works with all model sizes
- **Improved accuracy**: 70-90% correction rate for technical terms
- **No API costs**: Completely local processing
- **Fast processing**: <100ms overhead for typical transcriptions
- **User control**: Configurable sensitivity and enable/disable options

### Risk Mitigation
- **Conservative thresholds**: Prioritize precision over recall to minimize false positives
- **Opt-in feature**: Disabled by default, user must explicitly enable
- **Extensive testing**: Focus on false positive detection and prevention
- **Performance monitoring**: Timeout protection and resource limits
- **Graceful degradation**: Always fall back to original text on any error

### Next Steps
1. Create `fuzzy_dictionary.rs` module with core algorithm
2. Implement Levenshtein distance with confidence scoring
3. Add configuration settings and UI controls
4. Integrate with existing transcription pipeline
5. Create comprehensive test suite
6. Performance testing and optimization
7. User acceptance testing with real transcriptions

---

## Project Context
This fuzzy dictionary correction feature addresses a key user pain point: the trade-off between transcription speed (tiny models) and accuracy (larger models with dictionary support). By implementing post-processing correction, users can achieve both fast transcription and accurate technical term recognition.