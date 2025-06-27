/**
 * Custom type declarations for the Fethr application
 * 
 * What it does: Provides type definitions for modules that TypeScript can't find
 * Why it exists: To eliminate linter errors and improve type safety
 */

// Tauri API modules
declare module '@tauri-apps/api/globalShortcut' {
  export function register(shortcut: string, handler: () => void): Promise<void>;
  export function unregister(shortcut: string): Promise<void>;
  export function unregisterAll(): Promise<void>;
  export function isRegistered(shortcut: string): Promise<boolean>;
}

declare module '@tauri-apps/api/window' {
  export const appWindow: any;
}

declare module '@tauri-apps/api/event' {
  export function emit(event: string, payload?: any): Promise<void>;
  export function listen(event: string, handler: (event: any) => void): Promise<any>;
}

// Fix for specific Node.js types needed in the app
declare namespace NodeJS {
  interface Timeout {
    // Intentionally empty - just need the type to exist
  }
} 