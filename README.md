# Fethr - Voice Recording & Transcription App

Fethr is a desktop application built with Tauri, React, and TypeScript that provides quick and easy voice recording and transcription functionality.

## Default Environment

- **OS:** Windows 10+ (platform.system() = Windows)
- **Python:** 3.11.9
- **Note:** The %OS% environment variable is not set in this shell, but platform.system() is reliable.
- **Status:** App is developed and tested on Windows 10+ with Python 3.11+.

## Features

- **Global Hotkey Activation** - Press Ctrl+Shift+A to start/stop recording
  - Single press: Hold to record, release to stop and transcribe
  - Double press: Lock recording mode (continues even when hotkey is released)
  - Press during locked recording: Stop recording and start transcription
- **Audio Recording** - High-quality audio capture with volume visualization
  - 256kbps audio quality with noise suppression
  - Real-time volume monitoring and visualization
  - Optimized for speech clarity
- **Whisper Transcription** - Fast and accurate speech-to-text conversion using local whisper.exe
  - Efficient offline transcription with tiny.en model
  - Optimized parameters for better accuracy
  - Language-specific optimization for English
- **Auto-Paste** - Option to automatically paste transcriptions into any app

## Architecture

The app is built using a layered architecture:

### Frontend (TypeScript/React)
- **UI Components** - React components for the user interface
- **HotkeyManager** - Manages global hotkey detection and state transitions
  - Implements state machine (IDLE, RECORDING, LOCKED_RECORDING, TRANSCRIBING)
  - Handles single-press and double-press detection
  - Emits state change events to coordinate recording workflow
- **AudioManager** - Handles audio recording, processing, and monitoring
  - Manages MediaRecorder for high-quality audio capture
  - Provides real-time volume analysis
  - Implements sophisticated error handling and recovery
- **RecordingController** - Coordinates the recording workflow
  - Manages UI state based on recording status
  - Handles window visibility and focus
  - Initiates transcription process when recording stops
- **LocalTranscriptionManager** - Handles communication with the backend for transcription
  - Manages transcription state and error recovery
  - Handles communication with the Rust backend

### Backend (Rust/Tauri)
- **Native Integration** - System-level hotkey detection and audio processing
- **Whisper Integration** - Executes whisper.exe for offline speech-to-text transcription
  - Direct execution of whisper.exe with optimized parameters
  - Efficient stdout capture for reliable results
  - Error handling and recovery mechanisms
- **Clipboard Manager** - System-level clipboard operations

## Recent Enhancements

### 2024-09-05: Audio Conversion Optimization
- **WebM to WAV Conversion** - Enhanced audio conversion process with robust error handling
  - Added signature validation for WebM files
  - Implemented detailed audio quality analysis (amplitude, silence detection)
  - Improved error diagnostics with detailed logs and context
  - Fixed empty audio blob handling with fallback mechanism
  - Normalized audio data to prevent clipping and improve transcription quality

### 2024-08-30: Event System and Whisper Optimization
- **Hotkey Handling** - Fixed event name mismatch between frontend and backend
- **Transcription Process** - Improved whisper output capture and error handling
- **State Recovery** - Enhanced mechanisms to prevent UI from getting stuck

### 2024-08-24: Hotkey and Recording Fixes
- **Enhanced Hotkey Registration** - Improved Ctrl+Shift+A global shortcut reliability
- **Recording Controller** - Refactored to directly handle hotkey events
- **State Management** - Fixed coordination between HotkeyManager and AudioManager

### 2023-07-11: Deep Cleaning and Bug Fixes
- **Event Handling** - Fixed multiple window creation issues
- **Backend Optimization** - Removed unused dependencies (whisper-rs, lazy_static)
- **Transcription Process** - Improved locking mechanism to prevent duplicate transcriptions
- **Frontend Stability** - Enhanced event listener management and cleanup

### Audio Management 
- **Callback Debugging** - Added timestamp tracking and detailed logging for callback execution
- **Error Handling** - Comprehensive error detection and recovery
- **Diagnostic Methods** - Added `getLastRecordingTime()` and `forceCallbackTrigger()` for testing
- **Detailed Logging** - Enhanced logs with color coding and emoji indicators

## Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run tauri dev
   ```

## Build for Production

```bash
npm run tauri build
```

## Technical Notes

- Audio is recorded in WebM format at 256kbps (upgraded from 128kbps)
- Recording uses the Web Audio API and MediaRecorder
- Volume monitoring uses AnalyzerNode for real-time visualization
- Transcription uses a locally installed whisper.exe with fixed paths:
  - Executable: `C:\Users\kaan\.fethr\whisper.exe`
  - Model: `C:\Users\kaan\.fethr\models\ggml-tiny.en.bin`
- Whisper parameters are optimized for better speech detection:
  - `--language en` for English-specific optimization
  - `--no-timestamps` to simplify output
  - `--output-stdout` for reliable result capture

## Hotkey System Technical Details

The hotkey system uses a state machine with the following states:
- **IDLE** - No recording in progress
- **RECORDING** - Recording in progress (hold-to-record mode)
- **LOCKED_RECORDING** - Recording in progress (double-tap lock mode)
- **TRANSCRIBING** - Processing the recorded audio

State transitions are managed by the HotkeyManager and triggered by Ctrl+Shift+A events:
1. IDLE → RECORDING: Single press of Ctrl+Shift+A
2. RECORDING → IDLE: Release of Ctrl+Shift+A
3. RECORDING → LOCKED_RECORDING: Double press of Ctrl+Shift+A
4. LOCKED_RECORDING → IDLE: Single press of Ctrl+Shift+A during locked recording

The system uses event-based communication between components:
- Rust backend emits 'hotkey-pressed' events through Tauri's event system
- HotkeyManager processes these events and manages state transitions
- RecordingController responds to state changes and controls audio recording
- Transcription is automatically initiated when recording stops

### Hotkey Implementation Details
- Backend uses Tauri's `register_global_shortcut` API for system-wide key detection
- Custom debounce logic prevents multiple events from rapid key presses
- Double-press detection uses a 300ms window to identify quick successive presses
- Event propagation is managed through a custom EventEmitter to coordinate between components

### Audio Processing Pipeline
1. **Recording Initiation**: Start MediaRecorder with optimized settings
2. **Audio Capture**: Stream audio data into memory with volume monitoring
3. **Data Storage**: Collect audio chunks as Blob with type 'audio/webm'
4. **Conversion**: Transform WebM audio to WAV format for whisper
   - Detect and validate WebM audio signature (0x1A45DFA3)
   - Decode audio data with AudioContext
   - Analyze audio quality (presence of sound, amplitude levels)
   - Generate WAV headers with correct format parameters
   - Create final WAV blob with proper RIFF chunks
5. **Transcription**: Process WAV file with local whisper.exe
6. **Result Handling**: Process transcription text and optionally auto-paste

## Troubleshooting Audio Issues

If audio recording is not working properly:

1. Check the browser console for detailed logging messages
2. Verify microphone permissions are granted
3. Use the debug features added to AudioManager:
   - Check `getLastRecordingTime()` to see if callbacks are executing
   - Try `forceCallbackTrigger()` to test the callback pathway
4. Examine the detailed logs for error messages
5. If recording is very quiet, check your microphone settings in Windows

## Troubleshooting Transcription Issues

If transcription is not working correctly:

1. Verify whisper.exe is installed at `C:\Users\kaan\.fethr\whisper.exe`
2. Check that the model file exists at `C:\Users\kaan\.fethr\models\ggml-tiny.en.bin`
3. Check the console for any error messages from the transcription process
4. Review `dev_log.md` for known issues and their resolutions
5. For transcription accuracy issues:
   - Speak clearly and at a normal pace
   - Reduce background noise
   - Consider trying a better microphone
   - The tiny.en model has limitations - consider using base.en for better results

## Known Issues and Limitations

- Tauri does not support global shortcut release events, so key-up is simulated with timeouts
- The tiny.en model has accuracy limitations for complex speech or noisy environments
- Audio preprocessing can sometimes remove important speech content with aggressive noise reduction

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on contributing to the project.

## License

MIT 