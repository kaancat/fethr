import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * Main entry point for the React application
 * 
 * What it does: Initializes the React app and mounts it to the DOM
 * Why it exists: Required entry point for any React application
 */

console.log('[main.tsx] Starting application initialization...');

console.log('[main.tsx] Setting up React root with ReactDOM.createRoot...');
const rootElement = document.getElementById('root');
console.log('[main.tsx] Root element found?', !!rootElement);

if (rootElement) {
  try {
    ReactDOM.createRoot(rootElement).render(
      // Temporarily disabling React.StrictMode to rule out double useEffect invocations
      // as the cause of MediaRecorder state becoming 'inactive' prematurely.
      // See: MediaRecorder state bug investigation (2024-06-09)
      <App />
    );
    console.log('[main.tsx] ✅ React render called successfully');
  } catch (error) {
    console.error('[main.tsx] ❌ Error rendering React app:', error);
  }
} else {
  console.error('[main.tsx] ❌ Root element not found in the DOM');
} 