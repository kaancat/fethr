console.log("%c---> EXECUTING HotkeyManager.ts <---", "background: lime; color: black; font-weight: bold; font-size: 14px; padding: 5px;");

/**
 * HotkeyManager.ts (Simplified - No State Logic)
 *
 * Manages only non-state related hotkey events (registration, errors).
 * State management is now handled directly by RecordingController.
 */

import { listen } from '@tauri-apps/api/event';

/**
 * Enum representing different states of the recording process
 * Kept for type safety in other components.
 */
export enum RecordingState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  LOCKED_RECORDING = 'LOCKED_RECORDING', // Keep for enum completeness
  TRANSCRIBING = 'TRANSCRIBING',
}

/**
 * HotkeyManager (Simplified)
 */
export class HotkeyManager {
  private static instance: HotkeyManager | null = null;
  private unlisteners: (() => void)[] = []; // Keep for other listeners

  private constructor() {
    console.log(`%c[HotkeyManager] CONSTRUCTOR (Simplified - No State)`, 'color: gray;');
  }

  public static getInstance(): HotkeyManager {
    if (!HotkeyManager.instance) {
      HotkeyManager.instance = new HotkeyManager();
    }
    return HotkeyManager.instance;
  }

  /**
   * Initialize the HotkeyManager (Simplified)
   * Sets up listeners only for registration events and errors.
   */
  public async initialize(): Promise<void> {
    console.log('[HotkeyManager] INITIALIZE (Simplified - Registration Listeners Only)');
    await this.setupRegistrationListeners();
  }

  /**
   * Set up Tauri event listeners for registration and error events.
   */
  private async setupRegistrationListeners(): Promise<void> {
      console.log('[HotkeyManager] Setting up ONLY Registration/Error listeners...');
      this.cleanupListeners(); // Clear any previous

      try {
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

          // Optional: Keep transcription-error listener for central logging?
          // console.log('[HotkeyManager] ---> Attempting to listen for "transcription-error"...');
          // const unlistenError = await listen('transcription-error', (event) => {
          //   console.error(`%c[HotkeyManager] <<< PERMANENT 'transcription-error' LISTENER FIRED >>>`, 'background: #F00; color: white; font-size: 16px; font-weight: bold; border: 2px solid white;');
          //   console.error('%c[HotkeyManager] ❌ PERMANENT LISTENER TRANSCRIPTION ERROR PAYLOAD:', 'color: red;', event.payload);
          // });
          // console.log('[HotkeyManager] ---> Successfully ATTACHED listener for "transcription-error".');

          // Store unlisten functions for cleanup
          this.unlisteners = [
            unlistenRegistered,
            unlistenFailed,
            // unlistenError // Add if kept
          ];

          console.log('[HotkeyManager] Registration listeners setup complete.');
      } catch (error) {
          console.error('%c[HotkeyManager] 🔥 FATAL ERROR SETTING UP Registration Listeners 🔥', 'background-color: #f00; color: white; font-size: 14px; font-weight: bold; padding: 4px 8px; border-radius: 4px;', error);
      }
  }

  /**
   * Remove all event listeners registered by this simplified manager.
   */
  private cleanupListeners(): void {
     console.log('%c[HotkeyManager] Cleaning up registration listeners...', 'color: orange;');
     this.unlisteners.forEach(unlisten => {
         try {
             unlisten();
         } catch (e) {
             console.error('%c[HotkeyManager] Error unlistening registration listener:', 'color: red;', e);
         }
     });
     this.unlisteners = [];
     console.log('[HotkeyManager] Registration listeners cleaned up');
  }

  /**
   * Clean up registration listeners.
   */
  public cleanup(): void {
    console.log('%c[HotkeyManager] CLEANUP (Simplified)', 'color: orange; font-weight: bold;');
    this.cleanupListeners();
  }

  // --- STATE RELATED METHODS REMOVED ---
  // private currentState: RecordingState = RecordingState.IDLE;
  // private pressTimestamp: number = 0;
  // private pressCount: number = 0;
  // private resetPressCountTimer: number | null = null;
  // private readonly DOUBLE_TAP_WINDOW_MS = 350;
  // private handleHotkeyPress(): void { ... }
  // private setState(newState: RecordingState): void { ... }
  // private emitStateChange(oldState: RecordingState, newState: RecordingState): void { ... }
  // public setTranscribingState(isTranscribing: boolean): void { ... }
  // public forceReset(): void { ... }
  // public getCurrentState(): RecordingState { ... }
  // Removed setupTauriListeners (replaced by setupRegistrationListeners)
  // Removed handleDoubleTap, handleSinglePressOrHold
}

// Export the singleton instance
export default HotkeyManager.getInstance();

// --- HOOK REMOVED as it's no longer relevant ---
// export function useTauriHotkeys() { ... }