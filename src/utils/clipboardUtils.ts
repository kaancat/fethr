/**
 * clipboardUtils.ts
 * 
 * Utility functions for clipboard operations in Fethr app
 */

import { invoke } from '@tauri-apps/api';

/**
 * Copy text to clipboard
 * 
 * What it does: Copies the provided text to the system clipboard
 * Why it exists: To allow easy copying of transcription results
 * 
 * @param text Text to copy to clipboard
 * @returns Promise resolving when copying is complete
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    console.log('[clipboardUtils] Copying to clipboard:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
    
    // Use Tauri's write_text_clipboard command from Rust
    await invoke('write_text_clipboard', { text });
    
    console.log('[clipboardUtils] Successfully copied to clipboard');
    return Promise.resolve();
  } catch (error) {
    console.error('[clipboardUtils] Failed to copy to clipboard:', error);
    return Promise.reject(error);
  }
}

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