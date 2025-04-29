console.log("%c---> EXECUTING HotkeyManager.ts <---", "background: lime; color: black; font-weight: bold; font-size: 14px; padding: 5px;");

/**
 * HotkeyManager.ts
 * 
 * Manages recording states for the Fethr app using native key events from Rust.
 * Implements a state machine with hold-to-record and double-tap-to-lock functionality
 * based on hotkey events from the Rust backend.
 * 
 * Key features:
 * - Singleton pattern for centralized state management
 * - State machine with four well-defined states (IDLE, RECORDING, LOCKED_RECORDING, TRANSCRIBING)
 * - Double-tap detection for entering locked recording mode
 * - Comprehensive error handling with force reset capability
 * - Event-based communication with Tauri backend
 */

import { emit, listen } from '@tauri-apps/api/event';

/**
 * Enum representing different states of the recording process
 * 
 * What it does: Defines all possible states for the recording feature
 * Why it exists: To provide a type-safe way to track recording state across components
 * 
 * State transitions:
 * - IDLE → RECORDING: Initial hotkey press
 * - RECORDING → LOCKED_RECORDING: Double-tap detected
 * - RECORDING → TRANSCRIBING: Single press after hold
 * - LOCKED_RECORDING → TRANSCRIBING: Press while locked
 * - TRANSCRIBING → IDLE: After transcription complete
 */
export enum RecordingState {
  IDLE = 'IDLE',                         // Not recording
  RECORDING = 'RECORDING',               // Recording (temporary state before LOCKED_RECORDING or returning to IDLE)
  LOCKED_RECORDING = 'LOCKED_RECORDING', // Recording is locked (continues until stopped)
  TRANSCRIBING = 'TRANSCRIBING',         // Processing recording and generating transcription
}

/**
 * HotkeyManager handles interactions with the system's global hotkeys
 * 
 * What it does: Provides an interface for hotkey events and state management
 * Why it exists: Centralizes hotkey functionality and allows components to react to hotkey events
 * 
 * Implementation details:
 * - Uses singleton pattern to ensure only one instance exists
 * - Communicates with Rust backend via Tauri events
 * - Handles state transitions with proper validation
 * - Implements double-tap detection with timers
 * - Provides force reset capability for error recovery
 */
export class HotkeyManager {
  private static instance: HotkeyManager | null = null;
  private currentState: RecordingState = RecordingState.IDLE;
  private isWaitingForPotentialRelease: boolean = false;
  private releaseOrDoubleTapTimerId: number | null = null;
  private static readonly HOLD_RELEASE_THRESHOLD_MS = 300;
  
  // Store unlisten functions for cleanup
  private unlisteners: (() => void)[] = [];
  
  // Timers
  private doubleTapTimeoutId: number | null = null;
  private resetStateTimeoutId: number | null = null;
  
  private constructor() {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.log(`%c[${timestamp}] [HotkeyManager] Singleton CONSTRUCTOR called. Initial state set to IDLE.`, 'color: cyan; font-weight: bold;');
    this.currentState = RecordingState.IDLE; // Ensure initial state
  }

  /**
   * Get or create the singleton instance of HotkeyManager
   * 
   * What it does: Implements the singleton pattern to ensure only one instance exists
   * Why it exists: Prevents multiple hotkey managers from being created and conflicting
   * 
   * @returns The singleton instance of HotkeyManager
   */
  public static getInstance(): HotkeyManager {
    if (!HotkeyManager.instance) {
      HotkeyManager.instance = new HotkeyManager();
    }
    return HotkeyManager.instance;
  }

  /**
   * Initialize the HotkeyManager
   * 
   * What it does: Sets up event listeners for hotkey and transcription events
   * Why it exists: Required to start listening for hotkey events from Rust backend
   * 
   * @returns Promise that resolves when initialization is complete
   */
  public async initialize(): Promise<void> {
    console.log('[HotkeyManager] Initializing hotkey manager');
    // Simplified: setup listeners directly
    await this.setupTauriListeners();
  }
  
  /**
   * Set up Tauri event listeners for hotkey and transcription events
   * 
   * What it does: Registers event listeners for all relevant Tauri events
   * Why it exists: Connects the JavaScript frontend with Rust backend events
   * 
   * Events handled:
   * - hotkey-pressed: Triggered when the global hotkey is pressed
   * - hotkey-registered: Confirmation that hotkey was registered
   * - hotkey-registration-failed: Error when hotkey registration fails
   * - transcription-result: Received when transcription is complete
   * - transcription-error: Error during transcription process
   * - transcription-status-changed: Updates on transcription progress
   * 
   * @returns Promise that resolves when all listeners are set up
   */
  private async setupTauriListeners(): Promise<void> {
    try {
      console.log('[HotkeyManager] Setting up Tauri event listeners...');

      // Clear previous listeners if any (during hot reload, etc.)
      this.cleanupListeners();

      console.log('%c[HotkeyManager] SETUP START: Initializing event listeners', 'background-color: #3a0; color: white; font-weight: bold; padding: 2px 5px; border-radius: 3px;');

      // Listen for hotkey press event from Rust backend
      console.log('%c[HotkeyManager] ---> Attempting to listen for "hotkey-pressed"...', 'color: #3a0; font-weight: bold;');
      const unlistenHotkey = await listen('hotkey-pressed', (event) => {
        console.log('%c⌨️ HOTKEY PRESSED EVENT RECEIVED ⌨️', 'background-color: #f03; color: white; font-size: 14px; font-weight: bold; padding: 4px 8px; border-radius: 4px; margin: 5px 0;');
        console.log('%c[HotkeyManager] Event payload:', 'color: #f03;', event);
        console.log('%c[HotkeyManager] Current state before processing:', 'color: #f03;', this.currentState);
        this.handleHotkeyPress();
      });
      console.log('%c[HotkeyManager] ---> Successfully ATTACHED listener for "hotkey-pressed". If you press Ctrl+Shift+A, you should see the event logged above.', 'color: #3a0; font-weight: bold;');

      // Listen for hotkey registration confirmation
      console.log('[HotkeyManager] ---> Attempting to listen for "hotkey-registered"...');
      const unlistenRegistered = await listen('hotkey-registered', (event) => {
        console.log('%c[HotkeyManager] Received hotkey-registered event:', 'background-color: #0a3; color: white; padding: 2px 5px; border-radius: 3px;', event.payload);
      });
      console.log('[HotkeyManager] ---> Successfully ATTACHED listener for "hotkey-registered".');

      // Listen for registration failure
      console.log('[HotkeyManager] ---> Attempting to listen for "hotkey-registration-failed"...');
      const unlistenFailed = await listen('hotkey-registration-failed', (event) => {
        console.warn('%c[HotkeyManager] ❌ HOTKEY REGISTRATION FAILED:', 'background-color: #f30; color: white; font-weight: bold; padding: 2px 5px; border-radius: 3px;', event.payload);
      });
      console.log('[HotkeyManager] ---> Successfully ATTACHED listener for "hotkey-registration-failed".');

      // Listen for transcription results to reset state
      console.log('[HotkeyManager] ---> Attempting to listen for "transcription-result"...');
      const unlistenResult = await listen('transcription-result', () => {
        console.log(`%c[HotkeyManager] <<< PERMANENT 'transcription-result' LISTENER FIRED >>>`, 'background: #0F0; color: black; font-size: 16px; font-weight: bold; border: 2px solid black;');
        console.log('%c[HotkeyManager] Received transcription-result. State WILL NOT be reset here directly.', 'color: orange; font-weight: bold;');
      });
      console.log('[HotkeyManager] ---> Successfully ATTACHED listener for "transcription-result".');

      // Listen for transcription errors
      console.log('[HotkeyManager] ---> Attempting to listen for "transcription-error"...');
      const unlistenError = await listen('transcription-error', (event) => {
        console.error(`%c[HotkeyManager] <<< PERMANENT 'transcription-error' LISTENER FIRED >>>`, 'background: #F00; color: white; font-size: 16px; font-weight: bold; border: 2px solid white;');
        console.error('%c[HotkeyManager] ❌ PERMANENT LISTENER TRANSCRIPTION ERROR PAYLOAD:', 'color: red;', event.payload);
        console.log('%c[HotkeyManager] Received transcription-error. State WILL NOT be reset here directly.', 'color: orange; font-weight: bold;');
        // this.setState(RecordingState.IDLE); // Reset on error
        // Maybe add a brief ERROR state visual if needed
        // setTimeout(() => this.forceReset(), 500); // Optional force reset
      });
      console.log('[HotkeyManager] ---> Successfully ATTACHED listener for "transcription-error".');

      // Listen for transcription status changes
      console.log('[HotkeyManager] ---> Attempting to listen for "transcription-status-changed"...');
      const unlistenStatus = await listen('transcription-status-changed', (event: any) => {
        console.log("%c !!! transcription-status-changed LISTENER ENTERED !!!", "background: orange; color: black; font-size: 14px; font-weight: bold; padding: 4px;");
        const status = event.payload?.status;
        console.log(`%c[HotkeyManager] STATUS LISTENER: Received status: ${status}`, 'color: #00a;');
        if (status === 'Processing') {
          console.log('%c[HotkeyManager] STATUS LISTENER: Received PROCESSING status! Current state:', 'color: #00a; font-weight: bold;', this.currentState);
          // Only set to TRANSCRIBING if not in IDLE
          if (this.currentState !== RecordingState.IDLE) {
            console.log('%c[HotkeyManager] STATUS LISTENER: --> Setting state to TRANSCRIBING based on status.', 'color: red; font-weight: bold;');
            this.setState(RecordingState.TRANSCRIBING);
          } else {
            console.log('%c[HotkeyManager] STATUS LISTENER: Ignoring PROCESSING status because current state is IDLE.', 'color: orange;');
          }
        } else if (status === 'Complete' || status === 'Failed' || status === 'Error') {
          console.log(`%c[HotkeyManager] STATUS LISTENER: Received ${status}. State WILL NOT be reset here directly.`, 'color: orange;');
          // if (this.currentState === RecordingState.TRANSCRIBING) {
          //   console.log(`%c[HotkeyManager] STATUS LISTENER: Resetting to IDLE based on status: ${status}`, 'color: green;');
          //   this.setState(RecordingState.IDLE);
          // }
        }
      });
      console.log('[HotkeyManager] ---> Successfully ATTACHED listener for "transcription-status-changed".');

      // Store unlisten functions for cleanup
      this.unlisteners = [
        unlistenHotkey,
        unlistenRegistered,
        unlistenFailed,
        unlistenResult,
        unlistenError,
        unlistenStatus
      ];

      console.log('%c[HotkeyManager] SETUP COMPLETE: All event listeners registered successfully', 'background-color: #3a0; color: white; font-weight: bold; padding: 2px 5px; border-radius: 3px;');
    } catch (error) {
      console.error('%c[HotkeyManager] 🔥 FATAL ERROR SETTING UP LISTENERS 🔥', 'background-color: #f00; color: white; font-size: 14px; font-weight: bold; padding: 4px 8px; border-radius: 4px;', error);
      // Log detailed error information
      if (error instanceof Error) {
        console.error('[HotkeyManager] Error name:', error.name);
        console.error('[HotkeyManager] Error message:', error.message);
        console.error('[HotkeyManager] Error stack:', error.stack);
      }
    }
  }

  /**
   * Core state machine logic for handling hotkey press events
   * 
   * What it does: Implements the state transition logic based on current state and timing
   * Why it exists: Central point for processing hotkey events and managing state transitions
   *
   * State transition logic:
   * - IDLE → RECORDING: Start recording and begin double-tap/hold detection
   * - RECORDING + Double-tap → LOCKED_RECORDING: Lock recording mode
   * - RECORDING + Single-tap → TRANSCRIBING: Stop recording and start transcription
   * - LOCKED_RECORDING → TRANSCRIBING: Stop locked recording and start transcription
   * - TRANSCRIBING: Ignore hotkey presses
   */
  private handleHotkeyPress(): void {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.log(`%c[${timestamp}] [HotkeyManager] 🔑 HOTKEY PRESS HANDLER TRIGGERED 🔑`, 'background-color: #f03; color: white; font-size: 14px; font-weight: bold; padding: 4px 8px; border-radius: 4px; margin: 5px 0;');
    console.log(`%c[${timestamp}] [HotkeyManager] CURRENT STATE IN HANDLER: ${this.currentState}`, 'background-color: #f03; color: white; font-weight: bold; padding: 2px 5px; border-radius: 3px;');

    try {
      if (this.currentState === RecordingState.TRANSCRIBING) {
        console.log(`%c[${timestamp}] [HotkeyManager] ⚠️ IGNORING HOTKEY PRESS - Currently in TRANSCRIBING state ⚠️`, 'background-color: orange; color: black; font-weight: bold; padding: 2px 5px; border-radius: 3px;');
        return;
      }

      // Event-driven: Only use timers for double-tap/hold detection, not for polling or legacy logic
      if (this.currentState === RecordingState.IDLE) {
        // Start recording and begin double-tap/hold detection
        this.setState(RecordingState.RECORDING);
        this.isWaitingForPotentialRelease = true;
        if (this.releaseOrDoubleTapTimerId) {
          clearTimeout(this.releaseOrDoubleTapTimerId);
          this.releaseOrDoubleTapTimerId = null;
        }
        // Timer for hold-release or double-tap
        this.releaseOrDoubleTapTimerId = window.setTimeout(() => {
          if (this.currentState === RecordingState.RECORDING && this.isWaitingForPotentialRelease) {
            // Hold-release: treat as single press
            this.isWaitingForPotentialRelease = false;
            this.releaseOrDoubleTapTimerId = null;
            this.setState(RecordingState.TRANSCRIBING);
          }
        }, HotkeyManager.HOLD_RELEASE_THRESHOLD_MS);
      } else if (this.currentState === RecordingState.RECORDING) {
        if (this.isWaitingForPotentialRelease) {
          // Double-tap detected: lock recording
          if (this.releaseOrDoubleTapTimerId) {
            clearTimeout(this.releaseOrDoubleTapTimerId);
            this.releaseOrDoubleTapTimerId = null;
          }
          this.isWaitingForPotentialRelease = false;
          this.setState(RecordingState.LOCKED_RECORDING);
        }
      } else if (this.currentState === RecordingState.LOCKED_RECORDING) {
        // Stop locked recording and start transcription
        this.setState(RecordingState.TRANSCRIBING);
      }
      // No legacy polling, no deprecated timers remain
      // All state transitions are now event-driven and robust
      console.log('%c[HotkeyManager] Hotkey press processing complete.', 'color: #3a0; font-weight: bold;');
    } catch (error) {
      console.error('%c[HotkeyManager] ❌ ERROR HANDLING HOTKEY PRESS:', 'background-color: #f00; color: white; font-weight: bold; padding: 2px 5px; border-radius: 3px;', error);
      if (error instanceof Error) {
        console.error('[HotkeyManager] Error name:', error.name);
        console.error('[HotkeyManager] Error message:', error.message);
        console.error('[HotkeyManager] Error stack:', error.stack);
      }
      this.forceReset();
    }
  }

  /**
   * Internal method to change state and emit change events
   * 
   * What it does: Updates internal state and notifies listeners via Tauri events
   * Why it exists: Centralizes state changes and event emission for consistency
   * 
   * @param newState The new state to transition to
   */
  private setState(newState: RecordingState): void {
    if (this.currentState === newState) return;
    try {
      const oldState = this.currentState;
      const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.log(`%c[${timestamp}] [HotkeyManager] ===> Attempting state transition: ${oldState} -> ${newState}`, 'background-color: magenta; color: white; font-size: 12px; font-weight: bold; padding: 2px 5px; border-radius: 3px;');
      console.trace(`Trace for state change to ${newState}`);
      this.currentState = newState;
      // If moving away from RECORDING, clear the release/double-tap timer
      if (oldState === RecordingState.RECORDING) {
        if (this.releaseOrDoubleTapTimerId) {
          clearTimeout(this.releaseOrDoubleTapTimerId);
          this.releaseOrDoubleTapTimerId = null;
        }
        this.isWaitingForPotentialRelease = false;
      }
      if (oldState === RecordingState.RECORDING || oldState === RecordingState.LOCKED_RECORDING) {
        this.clearDoubleTapTimer();
      }
      this.emitStateChange(oldState, newState);
    } catch (error) {
      console.error('%c[HotkeyManager] ❌ ERROR SETTING STATE:', 'background-color: #f00; color: white; font-weight: bold; padding: 2px 5px; border-radius: 3px;', error);
      if (error instanceof Error) {
        console.error('[HotkeyManager] Error name:', error.name);
        console.error('[HotkeyManager] Error message:', error.message);
        console.error('[HotkeyManager] Error stack:', error.stack);
      }
    }
  }

  /**
   * Emit a state change event to notify listeners
   * 
   * What it does: Broadcasts state changes via Tauri events
   * Why it exists: Enables loose coupling between HotkeyManager and UI components
   * 
   * @param oldState Previous recording state
   * @param newState New recording state
   */
  private emitStateChange(oldState: RecordingState, newState: RecordingState): void {
    console.log(`%c[HotkeyManager] Emitting state change: ${oldState} -> ${newState}`, 'color: purple; font-weight: bold;');
    emit('recording-state-changed', { 
      state: newState,
      oldState: oldState,
      timestamp: Date.now()
    }).catch(error => {
      console.error('%c[HotkeyManager] ❌ FAILED TO EMIT STATE CHANGE EVENT:', 'background-color: #f00; color: white; font-weight: bold; padding: 2px 5px; border-radius: 3px;', error);
      // Log detailed error information
      if (error instanceof Error) {
        console.error('[HotkeyManager] Error name:', error.name);
        console.error('[HotkeyManager] Error message:', error.message);
        console.error('[HotkeyManager] Error stack:', error.stack);
      }
    });
  }

  /**
   * Public method used by RecordingController when transcription actually starts/ends
   * 
   * What it does: Allows external components to update transcription state
   * Why it exists: Enables coordination between AudioManager and transcription process
   * 
   * @param isTranscribing Whether transcription is currently in progress
   */
  public setTranscribingState(isTranscribing: boolean): void {
    console.log(`%c[HotkeyManager] !!! External call to setTranscribingState(${isTranscribing})`, 'color: red; font-weight: bold;');
    console.trace("Trace for setTranscribingState call");
    console.log(`%c[HotkeyManager] External Set Transcribing State: ${isTranscribing}`, 'color: purple; font-weight: bold;');
    if (isTranscribing && this.currentState !== RecordingState.TRANSCRIBING) {
      this.setState(RecordingState.TRANSCRIBING);
    } else if (!isTranscribing && this.currentState === RecordingState.TRANSCRIBING) {
      // This case is usually handled by transcription-result/error listeners now
      // this.setState(RecordingState.IDLE);
    }
  }

  /**
   * Clear the double-tap detection timer
   * 
   * What it does: Cancels the timer used for double-tap detection
   * Why it exists: Prevents memory leaks and ensures clean state transitions
   */
  private clearDoubleTapTimer(): void {
    if (this.doubleTapTimeoutId) {
      window.clearTimeout(this.doubleTapTimeoutId);
      this.doubleTapTimeoutId = null;
    }
  }

  /**
   * Remove all event listeners
   * 
   * What it does: Unregisters all Tauri event listeners
   * Why it exists: Prevents memory leaks and duplicate listeners
   */
  private cleanupListeners(): void {
    console.log('%c[HotkeyManager] Cleaning up existing listeners...', 'color: orange;');
    this.unlisteners.forEach(unlisten => {
      try {
        unlisten();
      } catch (e) { 
        console.error('%c[HotkeyManager] Error unlistening:', 'color: red;', e); 
      }
    });
    this.unlisteners = [];
    console.log('[HotkeyManager] All listeners cleaned up');
  }

  /**
   * Clean up event listeners and timeouts
   * 
   * What it does: Performs full cleanup of all resources
   * Why it exists: Ensures proper resource management when component unmounts
   */
  public cleanup(): void {
    console.log('%c[HotkeyManager] Cleaning up resources', 'color: orange; font-weight: bold;');
    this.cleanupListeners();
    this.clearDoubleTapTimer();
    if (this.releaseOrDoubleTapTimerId) {
      clearTimeout(this.releaseOrDoubleTapTimerId);
      this.releaseOrDoubleTapTimerId = null;
    }
    this.isWaitingForPotentialRelease = false;
    if (this.resetStateTimeoutId) {
      window.clearTimeout(this.resetStateTimeoutId);
      this.resetStateTimeoutId = null;
    }
    this.currentState = RecordingState.IDLE;
    console.log('[HotkeyManager] Cleanup complete');
  }
  
  /**
   * Force reset the state machine to IDLE
   * 
   * What it does: Emergency reset mechanism for error recovery
   * Why it exists: Provides a way to recover from unexpected states
   * 
   * Note: This is now synchronous and only emits state change if not already IDLE
   */
  public forceReset(): void {
    console.log('%c[HotkeyManager] ⚠️ FORCE RESETTING STATE MACHINE ⚠️', 'background-color: #f50; color: white; font-weight: bold; padding: 2px 5px; border-radius: 3px;');
    
    // Clear all timers and flags
    this.clearDoubleTapTimer();
    if (this.releaseOrDoubleTapTimerId) {
      clearTimeout(this.releaseOrDoubleTapTimerId);
      this.releaseOrDoubleTapTimerId = null;
      this.isWaitingForPotentialRelease = false;
    }

    // Get current state before reset
    const oldState = this.currentState;
    
    // Only change state and emit event if not already IDLE
    if (oldState !== RecordingState.IDLE) {
      this.currentState = RecordingState.IDLE;
      
      // Emit state change since we actually changed state
      this.emitStateChange(oldState, RecordingState.IDLE);
      console.log('%c[HotkeyManager] State machine reset complete (Synchronous)', 'color: green;');
    } else {
      console.log('%c[HotkeyManager] State already IDLE, forceReset did nothing extra.', 'color: gray;');
    }
  }
  
  /**
   * Public method to get current state (for debugging)
   * 
   * What it does: Returns the current recording state
   * Why it exists: Enables external components to query state for debugging
   * 
   * @returns Current recording state
   */
  public getCurrentState(): RecordingState {
    return this.currentState;
  }
}

export default HotkeyManager.getInstance();

/**
 * React hook for initializing Tauri hotkeys in components
 * 
 * What it does: Provides a React-friendly interface to the HotkeyManager
 * Why it exists: Simplifies integration with React components
 * 
 * @returns Object indicating if hotkeys are initialized
 */
export function useTauriHotkeys() {
  console.log('[useTauriHotkeys] Setting up Tauri hotkeys...');
  
  // This is just a hook to initialize and manage hooks in React components
  // The actual implementation is managed by the HotkeyManager singleton
  
  return {
    isInitialized: true
  };
}