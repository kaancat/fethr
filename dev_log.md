# Dev Log

## [2024-09-19] - Improved Cross-Platform Resource Bundling
Goal: Enhance Fethr's cross-platform compatibility and resource handling

### Changes Made:
- Modified `tauri.conf.json` for better resource bundling:
  - Updated external binary configuration to use platform-agnostic path `"vendor/whisper"` instead of `"vendor/whisper.exe"`
  - Added resources configuration for the models directory with `"vendor/models"` to ensure models are properly bundled

- Improved `config.rs` for simplified settings management:
  - Removed `whisper_directory` field from AppSettings as it's now handled directly by the app
  - Renamed `whisper_model` to `model_name` for clarity
  - Added `language` field to provide explicit language control
  - Added specific type annotation for TOML parsing with `toml::from_str::<AppSettings>`
  - Enhanced settings loading and saving with improved error handling

- Enhanced `transcription.rs` for robust path resolution:
  - Added platform-specific path handling that works correctly in both debug and release modes
  - Implemented proper detection of debug vs. release environments
  - Used Tauri's `resource_dir()` API for resolving bundled resources in release mode
  - Added OS detection for correct binary naming across Windows, macOS and Linux
  - Removed clipboard/paste operations that were causing redundant actions

- Refactored `audio_manager_rs.rs` for better clipboard handling:
  - Ensured clipboard operations happen only once
  - Moved clipboard/paste functionality out of the transcription module
  - Fixed auto-paste logic to prevent unintended double paste operations

- Removed unnecessary safety timer from `App.tsx` that was forcing state reset after 5 seconds

### Technical Details:
- Debug mode now correctly resolves paths using `CARGO_MANIFEST_DIR`
- Release mode uses Tauri's resource directory API for bundled resources
- Platform-specific binary naming is handled with conditional compilation:
  ```rust
  if cfg!(target_os = "windows") {
     "whisper-x86_64-pc-windows-msvc.exe"
  } else if cfg!(target_os = "macos") {
     if cfg!(target_arch = "aarch64") {
         "whisper-aarch64-apple-darwin"
     } else {
         "whisper-x86_64-apple-darwin"
     }
  }
  ```
- Improved path resolution handles the different locations between debug and release builds

### Impact:
- More robust cross-platform compatibility across Windows, macOS, and Linux
- Consistent resource bundling that works correctly in production builds
- Better separation of concerns between transcription and clipboard operations
- Improved error handling with more detailed logging
- Cleaner and more maintainable codebase with proper separation of functionality

### Next Steps:
- Implement comprehensive testing across platforms to verify compatibility
- Add platform-specific build scripts to automate bundling for all targets
- Consider adding configuration option for custom model directories
- Explore additional optimization for ARM architectures

## [2024-09-18] - Improved Timeout Handling with Cancel Action
Goal: Improve the timeout handling in the Rust backend to trigger a stop and transcribe action

### Changes Made:
- Removed the `TimeoutResetAndEmitUi` variant from the `PostEventAction` enum
- Added back `CancelRecordingAndEmitUi` with a repurposed function to trigger stop and transcribe
- Modified the state thread timeout logic:
  - Kept the state reset to Idle
  - Kept clearing the timer flag
  - Removed direct emit_state_update call
  - Set timeout_action to CancelRecordingAndEmitUi
- Restored and enhanced the timeout action handling in the state thread loop:
  - The action now first emits an Idle state to update UI immediately
  - Then triggers the stop/transcribe flow to clean up audio

### Technical Details:
- This approach provides a cleaner cancellation path that:
  - Properly cleans up any recording that may have started
  - Updates the UI to show the cancellation
  - Maintains a consistent event flow whether cancellation is from a timeout or user action
- The frontend listener for `fethr-stop-and-transcribe` will handle the result (likely a blank audio message) 
  and trigger the reset signal correctly
- The error message "Tap cancelled" is displayed to provide user feedback

### Impact:
- More consistent handling of timeout scenarios
- Proper cleanup of recording resources when a timeout occurs
- Better user feedback during cancellation
- Simplified state handling logic with more uniform event flow

### Next Steps:
- Monitor log output to verify the cancel action is working as expected
- Consider adding analytics to track how often timeouts/cancellations occur
- Fine-tune timeout parameters if needed based on user feedback

## [2024-09-18] - Reverted Timeout Handling to Direct UI Updates
Goal: Simplify timeout handling by removing unnecessary audio processing

### Changes Made:
- Removed the `CancelRecordingAndEmitUi` variant from the `PostEventAction` enum
- Modified the state thread timeout logic:
  - Kept the state reset to Idle
  - Kept clearing the timer flag
  - Restored direct Idle state UI updates after timeout detection
  - Removed the timeout_action variable and handling block
- Simplified error handling for timeout edge cases

### Technical Details:
- This approach is cleaner for our use case because:
  - No audio recording is started in WaitingForSecondTap state, so no need to stop/cleanup
  - Directly updating the UI provides immediate feedback without unnecessary backend operations
  - Error messages in timeout cases are more specific ("Tap cancelled (Timeout)" vs generic "Tap cancelled")
- The timeout window logic remains the same, only the action taken on timeout is simpler

### Impact:
- More efficient handling of timeout scenarios
- Clear separation between UI state updates and audio recording operations
- Simplified control flow in the state thread loop

## [2024-09-18] – Session Start
Goal: Implement and enhance the Fethr application based on the project requirements

### Analysis of Current State:
- Application uses Tauri with Rust backend and React/TypeScript frontend
- Global hotkey system using RightAlt key for recording control
- Audio recording with WebM to WAV conversion
- Local Whisper transcription using whisper.exe

### Planned Improvements:
- Enhance state machine reliability in the Rust backend
- Improve audio quality for better transcription results
- Add more comprehensive debugging features
- Ensure smooth transitions between recording states
- Document all changes thoroughly

### Initial Tasks:
- Review the current state machine implementation for potential race conditions
- Examine the timeout handling logic in the callback function
- Verify lock usage patterns to prevent deadlocks
- Review audio recording process for optimization opportunities
- Update the dev_log.md with detailed explanations of all changes

### Technical Approach:
- Optimize the callback function in main.rs to improve state transitions
- Enhance timeout detection with better error recovery
- Improve coordination between frontend and backend state
- Document all core functionality for future maintenance

## [2024-09-18] - Enhanced Timeout Handling with Dedicated Action
Goal: Improve timeout handling with a specific action type

### Changes Made:
- Added `TimeoutIdleEmit` variant to the `PostEventAction` enum specifically for timeouts
- Modified the state thread timeout logic:
  - Kept the state reset to Idle
  - Kept clearing the timer flag
  - Set timeout_action to TimeoutIdleEmit instead of emitting directly
  - Added dedicated timeout action handling block
- Added catch-all in the process_hotkey_event function for safer debugging

### Technical Details:
- This approach separates the timeout UI notification from the state transition:
  - State is changed to Idle first
  - Then the dedicated TimeoutIdleEmit action is handled separately
  - Keeps timeouts from triggering audio recording operations
- The timeout is now handled consistently with other actions, maintaining code architecture
- Provides a clearer trace in logs when timeout events occur

### Impact:
- More consistent architecture for all state transitions
- Better separation of concerns between state changes and UI updates
- Improved debugging via the dedicated action type
- Enhanced log clarity for timeout scenarios

## [2024-07-17] - Implemented Improved State Machine for Recording
Goal: Revise the state machine to only start recording after confirming a Hold or Double-Tap.

### Problem Identified:
- Previous implementation started recording immediately on key press
- This caused unnecessary recordings for taps that didn't complete a gesture
- Created potential resource waste from starting/stopping recording frequently
- Made timeouts and state transitions more complex to handle

### Changes Made:
- Added new state enum variants:
  - `PressedWaitingForRelease`: Initial state after pressing key (replaces old `Recording` state)
  - `RecordingHold`: State for hold-to-record mode after confirming hold duration (renamed from `Recording`)
- Modified state transition flow:
  - Initial press: `Idle → PressedWaitingForRelease` (no recording starts)
  - Short release: `PressedWaitingForRelease → WaitingForSecondTap` (no recording starts)
  - Second tap press: `WaitingForSecondTap → LockedRecording` (recording starts)
  - Long press release: `PressedWaitingForRelease → RecordingHold` (recording starts)
  - Hold release: `RecordingHold → Transcribing` (recording stops)
  - Tap on locked: `LockedRecording → Transcribing` (recording stops)
- Updated timeout handling to not need recording stop (since no recording started yet)
- Updated frontend enum in types.ts to maintain compatibility

### Technical Details:
- Recording now only starts in two scenarios:
  1. After confirming a hold by releasing the key after TAP_MAX_DURATION_MS (entering RecordingHold)
  2. After confirming a double-tap by pressing the key a second time (entering LockedRecording)
- This is more efficient as recording is only started when a gesture is confirmed 
- WaitingForSecondTap timeout now just transitions to Idle without needing to stop a recording
- Frontend enum is simplified as the intermediate states (PressedWaitingForRelease, WaitingForSecondTap) don't need direct UI representation

### Impact:
- More resource-efficient - avoids starting/stopping recording unnecessarily
- Cleaner state transitions - each state has a clearer purpose
- Better separation between user input detection and recording actions
- Improved handling of timeouts and edge cases
- No orphaned recordings since recording only starts after confirmed gestures

### Next Steps:
- Monitor user feedback on the new interaction model
- Consider adding subtle UI feedback for the "waiting" states
- Fine-tune timing parameters (TAP_MAX_DURATION_MS, DOUBLE_TAP_WINDOW_MS)
- Add detailed analytics to measure key interaction patterns

## [2023-07-12] - Initial Architecture Setup
Goal: Create the foundation for the Fethr app

- Set up Tauri with React/TypeScript
- Implemented basic UI components
- Created HotkeyManager for global hotkey detection
- Established AudioManager for basic recording

## [2023-07-25] - Audio Processing Pipeline
Goal: Complete audio recording and processing workflow

- Added MediaRecorder integration for audio capture
- Implemented volume level monitoring via AnalyserNode
- Created audio visualization component
- Setup basic error handling for permissions

## [2023-09-05] - Transcription Integration
Goal: Connect audio recording with Whisper transcription

- Integrated Whisper.cpp for offline transcription
- Added format conversion pipeline (WebM to WAV)
- Implemented auto-paste functionality
- Created fallback UI for transcription review

## [2023-11-18] - AudioManager Debugging Enhancements
Goal: Improve robustness and debuggability of audio recording subsystem

- Added `lastRecordingTime` timestamp tracking to identify stalled callbacks
- Enhanced `setRecordingCompleteCallback` with comprehensive error handling and diagnostic logging
- Improved logging throughout recording lifecycle with emoji indicators for better visibility
- Added new diagnostic methods:
  - `getLastRecordingTime()` - Returns timestamp of last callback execution
  - `forceCallbackTrigger()` - Manually triggers recording callback for testing

### Technical Details
- Updated callback wrapping to provide detailed information about blob contents
- Added try/catch blocks around all callback executions to prevent silent failures
- Implemented timing measurements between recording stop and callback execution
- Enhanced log messages with type information and size reporting

### Impact
These changes significantly improve our ability to:
1. Debug audio recording issues that previously presented as "silent failures"
2. Identify timing problems in the recording pipeline
3. Trace the full lifecycle of an audio recording session
4. Recover gracefully from errors in user-provided callbacks

### Architecture Notes
The audio system in Fethr follows this flow:
1. User triggers recording via HotkeyManager
2. RecordingController coordinates state changes
3. AudioManager handles the actual recording via MediaRecorder
4. Recorded audio is processed through callbacks
5. Audio is sent to the Whisper service for transcription
6. Transcribed text is returned to the UI

NOTE: The enhanced logging is especially valuable on Windows where console access can be limited and timing issues are more common.

### Next Steps
- Add configurable audio quality settings
- Implement noise reduction capabilities
- Consider adding audio chunking for processing longer recordings

## [2024-09-18] - Simplified State Machine with Direct Tap-to-Lock
Goal: Simplify the state machine by removing the WaitingForSecondTap state and timeout logic

### Changes Made:
- Removed the `WaitingForSecondTap` variant from the `AppRecordingState` enum
- Removed the `FIRST_TAP_RELEASE_TIME` global and `DOUBLE_TAP_WINDOW_MS` constant
- Simplified the `PostEventAction` enum by removing timeout-related variants
- Replaced the `process_hotkey_event` function with a streamlined version:
  - Short tap now goes directly from Recording to LockedRecording
  - Removed all timer-based state transitions
- Simplified the state thread to use blocking `recv()` instead of timeout-based polling

### Technical Details:
- New simplified state flow:
  - Initial press: `Idle → Recording`
  - Short tap release: `Recording → LockedRecording` (immediate, no waiting)
  - Long press release: `Recording → Transcribing`
  - Tap while locked: `LockedRecording → Transcribing`
- This approach eliminates the intermediate waiting state and all timeout-related complexity
- Provides a more predictable user experience with immediate feedback

### Impact:
- Simplified codebase with fewer states and less complex logic
- Removed potential race conditions related to timeout detection
- More responsive UI as state changes happen immediately on user input
- Better maintainability with a more straightforward state machine implementation
- Reduced thread contention by eliminating the polling loop and associated locks

## [2024-09-18] - Fixed LockedRecording State Mapping in Frontend
Goal: Fix the state mapping for LockedRecording state in the React frontend

### Changes Made:
- Modified the state mapping in App.tsx to correctly handle "LOCKEDRECORDING" (without underscore) coming from the backend
- Changed case "LOCKED_RECORDING" to case "LOCKEDRECORDING" in the switch statement
- Added better error logging for unknown states and non-string state types

### Technical Details:
- The Rust backend emits "LOCKEDRECORDING" as a string (without underscore)
- The TypeScript frontend uses RecordingState.LOCKED_RECORDING enum (with underscore)
- The mismatch in naming conventions caused the LockedRecording state to be incorrectly mapped to IDLE
- Added detailed logging to help identify similar issues in the future

### Impact:
- Fixed the visual feedback in the UI when transitioning to LockedRecording state
- Ensures proper state transitions when tapping the hotkey
- Improves debugging capability with more detailed logging for state mapping errors

## [2024-09-18] - Improved Timer Logic in Frontend
Goal: Enhance the timer management in the React UI component

### Changes Made:
- Rewritten the timer logic in the PillPage component with a more precise implementation
- Added explicit variables `shouldBeRunning` and `isRunning` to improve code clarity
- Improved timer state management with better conditional checks
- Added safety mechanism to prevent memory leaks if startTime becomes null unexpectedly
- Preserved the timer display during transcription state

### Technical Details:
- The new approach is more declarative, using boolean variables for clear state representation
- Used more explicit condition checking: `shouldBeRunning && !isRunning` and `!shouldBeRunning && isRunning`
- Improved timer cleanup by ensuring interval reference is properly nullified
- Added specific behavior to keep duration visible during transcription state
- Preserved the standard display rules for Idle and Error states

### Impact:
- More robust timer management with fewer edge cases
- Clearer code makes maintenance easier
- Improves user experience by preserving duration during transcription
- Fixes potential memory leaks in timer interval management
- Provides better logging for debugging timer-related issues

## [2024-09-19] - Implemented "Single Tap Does Nothing" Functionality
Goal: Implement the ability for a single tap to effectively do nothing while preserving hold-to-record and double-tap-to-lock functionality

### Changes Made:
- Restored the `WaitingForSecondTap` state to the AppRecordingState enum
- Added back the `FIRST_TAP_RELEASE_TIME` global and `DOUBLE_TAP_WINDOW_MS` constant
- Updated `process_hotkey_event` to handle WaitingForSecondTap state transitions:
  - Short tap now goes to WaitingForSecondTap instead of directly to LockedRecording
  - Second tap during WaitingForSecondTap transitions to LockedRecording
- Implemented timeout detection logic in the state thread
- Added fallback re-emit mechanism to ensure UI updates properly after timeout
- Ensured StateUpdatePayload derives Default and Clone for simplified payload construction

### Technical Details:
- The implementation uses a clever approach where recording starts on initial press
- If a second tap doesn't occur within DOUBLE_TAP_WINDOW_MS (350ms), the recording is abandoned
- The frontend is updated to Idle state but no stop/transcribe event is triggered
- We added a fallback emit with a 150ms delay to ensure frontend state updates correctly
- This creates the user-facing impression that a single tap does nothing, while internally handling orphaned recordings

### Impact:
- Improved user experience with a more intuitive interaction model
- Users can now:
  1. Tap once to effectively do nothing
  2. Hold to record and immediately transcribe
  3. Double-tap to lock recording
- The implementation balances functionality with code maintainability

### Next Steps:
- Monitor performance implications of potentially abandoned recordings
- Consider improvements to resource handling for abandoned recordings
- Collect user feedback on the new interaction model

## [2024-09-19] - Added Safety Timeout Feature to Frontend
Goal: Implement a failsafe mechanism to prevent the UI from getting stuck in recording states

### Changes Made:
- Added a new `useEffect` hook in the PillPage component that monitors the current state
- Implemented a 5-second safety timeout for RECORDING and LOCKED_RECORDING states
- If the UI remains in these states for more than 5 seconds, it automatically resets to IDLE
- The safety reset also calls `signal_reset_complete` to ensure the backend state is synchronized

### Technical Details:
- The safety timeout only activates for states that should naturally transition (recording states)
- The timeout is cleared and recreated whenever the state changes, preventing false triggers
- Proper cleanup is implemented to avoid memory leaks when the component unmounts
- Detailed console warnings are displayed when the safety timeout is triggered to help with debugging

### Impact:
- Improves application reliability by preventing the UI from getting stuck
- Provides a failsafe mechanism for race conditions or edge cases in the state transitions
- Better user experience by ensuring the app recovers gracefully from unexpected conditions
- Helps diagnose potential issues by logging when timeouts are triggered

### Next Steps:
- Monitor the application logs to identify if the safety timeout is triggered frequently
- If frequent triggering occurs, investigate the underlying causes of state transition issues
- Consider adding analytics to track safety timeout occurrences for further optimization

## [2024-09-19] - Fixed Compilation Issues
Goal: Resolve compilation errors in the Rust backend

### Changes Made:
- Implemented the `Default` trait for `FrontendRecordingState` enum
  - Set `FrontendRecordingState::Idle` as the default value
- Removed unreachable catch-all pattern in `process_hotkey_event` function
  - The enum was fully covered by the existing match arms, making the catch-all unreachable

### Technical Details:
- The error occurred because we added `#[derive(Default)]` to `StateUpdatePayload` struct
- Since `StateUpdatePayload` contains a `FrontendRecordingState` field, that type also needs to implement `Default`
- The unreachable pattern warning occurred because all possible variants of `PostEventAction` were already covered

### Impact:
- Resolves compilation errors allowing the application to build and run
- Maintains the same functionality while improving code quality
- Sets a sensible default state (Idle) for the frontend recording state

## [2023-06-01] – Session Start: Configuration System Implementation

Goal: Implement a configuration system for the Fethr application to store and manage user settings.

### Changes Made:

1. **Added Dependencies**
   - Added `directories = "5.0"` for finding standard config/data directories
   - Added `toml = "0.8"` for parsing TOML config files
   - Added `once_cell = "1.19"` for thread-safe singleton initialization

2. **Created Configuration Module (`src-tauri/src/config.rs`)**
   - Created `AppSettings` struct to hold configuration values:
     - `whisper_directory`: Path to Whisper installation
     - `whisper_model`: Name of the Whisper model file
     - `auto_paste`: Boolean flag to control auto-paste behavior
   - Implemented `SETTINGS` global variable using `Lazy<Mutex<AppSettings>>`
   - Added functions to load settings from a TOML file in the standard config directory
   - Added automatic creation of default config when none exists

3. **Updated Main Module (`src-tauri/src/main.rs`)**
   - Added `mod config` and exported it for use by other modules
   - Modified `emit_stop_transcribe` to use the `auto_paste` setting from config
   - Updated the setup function to initialize the configuration system

4. **Updated Transcription Module (`src-tauri/src/transcription.rs`)**
   - Simplified `TranscriptionState` by removing hardcoded paths
   - Removed the `init_transcription` function that contained hardcoded paths
   - Modified `transcribe_local_audio_impl` to get paths from the config
   - Added proper handling of the `auto_paste` parameter

5. **Updated Audio Manager Module (`src-tauri/src/audio_manager_rs.rs`)**
   - Added import for the configuration system
   - Modified `stop_backend_recording` to respect both the parameter and config setting

### Next Steps:

1. Test the configuration system with different settings
2. Add UI controls in the settings window to modify the configuration
3. Consider adding more configuration options as needed

---

## [2023-06-01] – Bug Fixes for Configuration System

After implementing the configuration system, several bugs were identified and fixed:

1. **Added Default Implementation for TranscriptionStatus**
   - Added `impl Default for TranscriptionStatus` to provide a default value (Idle)
   - This was needed because TranscriptionState now derives Default

2. **Fixed Type Conversion in cleanup_files**
   - Updated calls to `cleanup_files` function to handle the type conversion:
     - Used `converted_wav_path_opt.as_ref().map(|v| &**v)` to convert `Option<&PathBuf>` to `Option<&Path>`
     - Added type hint `None::<&Path>` to disambiguate the None case

3. **Fixed Moved Value Issue**
   - Corrected code that attempted to use `output.stdout` after it was moved
   - Used the already-converted string `stdout_text` instead

4. **Addressed Non-binding Lock Warning**
   - Changed `let _ = config::SETTINGS.lock().unwrap()` to `drop(config::SETTINGS.lock().unwrap())`
   - This satisfies the Rust compiler's requirement for proper handling of mutex locks

5. **Added #[allow(dead_code)] for Utility Functions**
   - Added attributes to the utility functions that are retained for future use
   - This silences warnings about unused functions that we want to keep

All these fixes have resulted in a clean compilation with no warnings or errors.

---

## [2023-06-01] – Summary of Today's Work

Today I implemented a configuration management system for the application. The system uses the `directories` crate to find the standard configuration directory for the user's platform and stores settings in a TOML file in that location.

Key improvements:
- Created a standard location for configuration that follows platform conventions
- Eliminated hardcoded paths that were previously scattered throughout the codebase
- Made it possible for users to customize settings by editing the config file
- Simplified the codebase by centralizing configuration values

The implementation includes proper error handling and fallbacks to default values when the configuration file is missing or invalid. It also automatically creates a default configuration file with sensible defaults when none exists.

Next session will focus on creating a UI for modifying these settings directly from the application.

## [2024-09-26] - Implemented Bundled Resources for Whisper Integration
Goal: Modify the application to use Tauri's bundled resources for Whisper binary and models

### Changes Made:
1. Updated tauri.conf.json:
   - Added `externalBin` array with path to whisper.exe
   - Added `resources` array with path to models directory

2. Modified config.rs:
   - Removed `whisper_directory` field from `AppSettings` struct
   - Renamed `whisper_model` to `model_name` for clarity
   - Added `language` field for language selection
   - Updated default settings and loading/saving logic
   - Removed unnecessary configuration code related to directory paths

3. Updated transcription.rs:
   - Added Tauri's `resource_dir` import for path resolution
   - Replaced manual path construction with Tauri resource path resolution
   - Updated command execution to use bundled resources
   - Improved error messages and debug logging

### Technical Details:
- Resources are now bundled with the application using Tauri's resource and externalBin mechanisms
- Whisper binary is included as an external binary (vendor/whisper.exe)
- Model files are included as resources (vendor/models/*)
- Path resolution is now handled by Tauri's API instead of manual configuration
- User no longer needs to configure whisper_directory manually

### Impact:
- Simplified user setup - no manual configuration of Whisper directory required
- More reliable path resolution using Tauri's built-in APIs
- Cleaner configuration with only model name, language, and auto-paste options
- Consistent directory structure across all installations
- Improved error handling with more descriptive messages

### Next Steps:
- Test bundling on different platforms to ensure resource paths resolve correctly
- Consider adding a UI for selecting different model sizes
- Add support for additional languages beyond English