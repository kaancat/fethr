# Fethr Development Roadmap

## Phase 1: Hotkey Detection and UI ✅

### Status: COMPLETED
- Basic project structure established
- Core HotkeyManager for Right Alt detection implemented
- UI pill with state transitions implemented
- Tailwind CSS styling applied
- Platform-specific key handling implemented
- TypeScript support added

### Remaining Phase 1 Tasks ⏳
- Resolve TypeScript linter errors
  - Install dependencies with `npm install`
  - Verify types are properly recognized
- Test platform-specific hotkey handling
  - Verify Right Alt detection on Windows ('AltGraph' / 'AltRight')
  - Document macOS Right Alt detection approach
- Final UI polish and animation refinements

## Phase 2: Audio Recording 🎙️

### Phase 2a: Core Audio Capture ✅

- Implemented basic audio recording using Web Audio API and MediaRecorder
- Added microphone permissions handling
- Implemented in-memory audio storage as Blob
- Added recording start/stop based on hotkey states
- Integrated with existing state machine for proper transitions
- **Implemented native Rust key detection for true hold-to-record functionality**
  - Added device_query for low-level key monitoring
  - Created background thread for continuous key state detection
  - Implemented proper keydown/keyup event handling
  - Connected Rust key events to TypeScript via Tauri events
- **Fixed double-tap detection with native key events**
  - Restored the ability to double-tap Ctrl+Shift+A to lock recording
  - Improved state handling to properly differentiate between hold and double-tap
  - Made key release behavior smarter during double-tap attempts
- **Increased double-tap window to 400ms** for better user experience

#### Debugging Progress:
- Added extensive logging to trace event flow from hotkey to recording
- Expanded key identifiers for Right Alt detection on Windows
- Added fallback registration for multiple possible key identifiers
- Improved error reporting in AudioManager
- Added detailed state transition logging

#### Key Detection Evolution:
1. **Initial Approach**: Used Tauri's globalShortcut API with timer-based workarounds
2. **Improved Approach**: Implemented press-to-toggle with double-tap detection
3. **Native Solution**: Added Rust key detection with true keyup/keydown events
4. **Final Refinement**: Enhanced state management for reliable double-tap detection

#### Fixed State Behavior ✅
Now supports all required interactions reliably:
- **Hold**: Press and hold Ctrl+Shift+A → recording starts (green border)
- **Release**: Release Ctrl+Shift+A → recording stops
- **Double-Tap**: Two presses within 400ms → locked recording starts (red border)
- **Single Tap in Locked Mode**: One press while locked → returns to idle

### Phase 2b: Audio Visualization ✅

- **Implemented simple volume meter visualization**:
  - Added real-time volume level indicator in the recording pill
  - Used Web Audio API's AnalyserNode for audio analysis
  - Color-coded meter (green, yellow, red) based on volume intensity
  - Seamlessly integrated with existing UI
- **Enhanced AudioManager with analysis capabilities**:
  - Added non-destructive audio analysis during recording
  - Implemented efficient frequency data sampling
  - Provided normalized volume data to UI components
  - Added proper resource management and cleanup
- **Maintained separation of concerns**:
  - AudioManager handles analysis, not visualization
  - RecordingPill handles visualization, not audio processing
  - No direct DOM manipulation from audio processing code

#### Technical Implementation Details
- Used requestAnimationFrame for efficient updates
- Lightweight DOM updates to minimize UI overhead
- Proper cleanup of AudioContext resources
- Smart state handling to prevent unnecessary renders

### Phase 2c: Enhanced Visualization ⏳ (FUTURE - NOT REQUIRED YET)

Possible future enhancements:
- Full waveform visualization
- Frequency spectrum display
- Voice activity detection
- Noise level indicators

## Phase 3: Transcription 🔄 (NEXT PHASE)

After completing Phase 2, we'll begin work on:

- Research and select the best transcription service API
- Implement API integration with error handling
- Add clipboard functionality to paste transcribed text
- Implement caching of recent transcriptions
- Add transcription history UI
- Support saving transcriptions to files

### Key Requirements for Phase 3:
- Evaluate cloud vs. local transcription options
- Consider latency vs. accuracy tradeoffs
- Support multiple languages if possible
- Implement proper error handling for network/service issues
- Design user-friendly transcription result interface

## Phase 4: Settings & Customization ⚙️ (FUTURE - DO NOT IMPLEMENT YET)

Final polish phase:

- Add system tray functionality
- Create settings panel for:
  - Customizing hotkeys
  - Audio settings (quality, bitrate)
  - Transcription settings
  - Language selection
  - UI preferences
- Add startup with system option
- Add update notifications 