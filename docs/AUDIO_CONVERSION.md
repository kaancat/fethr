# Audio Conversion and Error Handling

## Overview

The audio conversion process in Fethr is a critical component that transforms WebM audio recordings into WAV format required by the Whisper transcription engine. This document outlines the robust conversion pipeline and error handling mechanisms implemented to ensure reliable operation.

## Conversion Pipeline

### 1. Format Detection and Validation

Before conversion begins, the system performs several validation steps:

- **MIME Type Check**: Verifies if the input is already in WAV format to avoid unnecessary conversion
- **File Signature Analysis**: Examines the file header to confirm it's a valid WebM file (0x1A45DFA3 signature)
- **Empty Blob Detection**: Special handling for empty audio recordings to prevent downstream errors
- **Size Validation**: Ensures the audio is within reasonable size limits (< 25MB)

### 2. Conversion Process

The main conversion follows these steps:

1. **AudioContext Creation**: Creates a Web Audio context with a fixed 16kHz sample rate
2. **Audio Decoding**: Decodes the WebM audio data with tiered fallback mechanisms:
   - Primary decoding with original MIME type
   - Fallback decoding with explicit WebM MIME type if primary fails
   - Timeout protection to prevent hanging on corrupt files
3. **Audio Analysis**: Examines the decoded audio for quality issues:
   - Measures peak and average amplitude
   - Identifies silent or near-silent recordings
4. **Audio Normalization**: Enhances the audio quality:
   - Scales amplitude to optimal levels for transcription
   - Adds reference tones for silent recordings
   - Applies soft compression to improve speech clarity
5. **WAV Encoding**: Converts the processed audio to WAV format
6. **WAV Validation**: Verifies the generated WAV has valid header structure

## Error Handling Strategy

The system implements a multi-layered error handling approach:

### Preventive Measures
- Timeout protection for all asynchronous operations
- Early format validation to catch problems before conversion
- Audio analysis to identify problematic recordings

### Fallbacks
- Multiple decoding paths with progressive fallbacks
- Explicit MIME type forcing when format detection fails
- Minimal valid WAV generation when all conversion attempts fail

### Recovery Mechanisms
- Returns a minimal valid WAV file instead of failing completely
- Synthetic audio generation for silent or corrupted recordings
- Normalization to improve marginal audio quality

### Diagnostics
- Comprehensive logging throughout the conversion process
- Detailed error reporting with context information
- WAV header analysis to verify conversion correctness

## Implementation Details

The core of the implementation is in `audioUtils.ts` which contains:

1. `webmToWavBlob()`: The main conversion function with robust error handling
2. `normalizeAudio()`: Audio processing to improve transcription quality

Key features of the implementation:

- **Non-blocking operation**: All processing is asynchronous
- **Memory efficient**: Processes audio in chunks to minimize memory usage
- **Graceful degradation**: Provides usable output even when optimal conversion fails
- **Detailed logging**: Helps diagnose issues across different browser environments

## Common Issues and Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| EncodingError | Browser codec limitations or corrupted audio | Multi-tiered fallback decoding |
| Silent Audio | Microphone issues or noise suppression | Reference tone insertion |
| Low Volume | Poor microphone gain or speaking too softly | Normalization and soft compression |
| Header Corruption | Incomplete recording or browser bugs | Header validation and regeneration |
| Timeout Errors | Large files or browser resource limitations | Tiered timeout protection |

## Future Improvements

- WebAssembly-based audio conversion for more consistent cross-browser results
- Adaptive sample rate conversion based on input quality
- Voice activity detection to trim silence
- Client-side noise reduction options
- Browser-specific optimizations for Chrome, Firefox, and Safari 