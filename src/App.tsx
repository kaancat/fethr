import RecordingController from './components/RecordingController';

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

  return (
    <div className="h-screen w-screen overflow-hidden pointer-events-none">
      {/* RecordingController connects to backend through Tauri events */}
      <RecordingController configOptions={defaultOptions} />
      
      {/* Note: RecordingPill is now handled by RecordingController which passes the required props */}
      
      {/* REMOVED: TranscriptionFallback was here */}
      {/* <TranscriptionFallback /> */}
    </div>
  );
}

export default App; 