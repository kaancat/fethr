import { useEffect } from 'react';
import RecordingController from './components/RecordingController';
import TranscriptionFallback from './components/TranscriptionFallback';
import hotkeyManager from './HotkeyManager';

// MOVED: Define options outside component to prevent recreation on render
const defaultOptions = {
  useWhisperAPI: false, // Assuming local whisper for now
  autoCopyToClipboard: true,
  autoPasteTranscription: true,
} as const; // Make this const to ensure it's never recreated

/**
 * App is the main component for the Fethr application
 * 
 * What it does: Renders the floating UI elements
 * Why it exists: To serve as the entry point for the React application
 */
function App() {
  // ADD: Render logging
  console.log('%c[App] Rendering...', 'color: #666; font-weight: bold');

  useEffect(() => {
    // We already initialize hotkeyManager in main.tsx, but ensure it's initialized here as well
    console.log('[App] Ensuring HotkeyManager is initialized');
    
    // Clean up listeners when component unmounts
    return () => {
      console.log('[App] Cleaning up HotkeyManager on unmount');
      hotkeyManager.cleanup();
    };
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden pointer-events-none">
      {/* RecordingController connects HotkeyManager, AudioManager, and TranscriptionManager */}
      <RecordingController configOptions={defaultOptions} />
      
      {/* Note: RecordingPill is now handled by RecordingController which passes the required props */}
      
      {/* TranscriptionFallback only shows when auto-paste fails */}
      <TranscriptionFallback />
    </div>
  );
}

export default App; 