/**
 * clipboardUtils.ts
 * 
 * Utility functions for clipboard operations in Fethr app
 */

import { invoke } from '@tauri-apps/api/tauri';

/**
 * Copy text to clipboard
 * 
 * What it does: Copies the provided text to the system clipboard
 * Why it exists: To allow easy copying of transcription results
 * 
 * @param text Text to copy to clipboard
 * @returns Promise resolving when copying is complete
 */
export const copyToClipboard = async (text: string): Promise<void> => {
  console.log('[clipboardUtils] Copying to clipboard (via Rust):', text.substring(0, 30) + '...');
  try {
    await invoke('write_to_clipboard_rust', { textToCopy: text });
    console.log('[clipboardUtils] Rust clipboard command invoked successfully.');
  } catch (error) {
    console.error('[clipboardUtils] Failed to invoke Rust clipboard command:', error);
    throw new Error(`Rust clipboard failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};

/**
 * Paste copied text to current cursor position
 * 
 * What it does: Simulates Ctrl+V keyboard shortcut to paste at current position
 * Why it exists: To enable auto-paste functionality for transcriptions
 * 
 * @returns Promise resolving when paste is complete
 */
export async function PasteCopiedText(): Promise<void> {
  try {
    console.log('[clipboardUtils] Pasting text at cursor position');
    
    // Use Tauri's paste_text_to_cursor command from Rust
    await invoke('paste_text_to_cursor');
    
    console.log('[clipboardUtils] Successfully pasted text');
    return Promise.resolve();
  } catch (error) {
    console.error('[clipboardUtils] Failed to paste text:', error);
    return Promise.reject(error);
  }
} 