import React, { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { writeText } from '@tauri-apps/api/clipboard';

interface TranscriptionFallbackProps {
  text?: string | null;
}

/**
 * TranscriptionFallback component displays transcription results when auto-paste fails
 * 
 * What it does: Shows transcription text with a copy button when auto-paste functionality fails
 * Why it exists: To give users a way to manually copy text when the automatic pasting doesn't work
 */
const TranscriptionFallback: React.FC<TranscriptionFallbackProps> = ({ text: propText }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [text, setText] = useState('');
  
  // Handle text prop changes
  useEffect(() => {
    if (propText) {
      console.log('[TranscriptionFallback] Text prop received:', propText);
      setText(propText);
      setIsVisible(true);
    }
  }, [propText]);
  
  useEffect(() => {
    // Listen for copy-to-clipboard events from Tauri
    const setupListener = async () => {
      const unlisten = await listen('copy-to-clipboard', (event: any) => {
        const payload = event.payload;
        console.log('[TranscriptionFallback] Copy to clipboard event received:', payload);
        
        // Handle both object with text property and direct string payload
        if (payload) {
          let actualText = '';
          
          if (typeof payload === 'object' && payload.text) {
            actualText = payload.text;
          } else if (typeof payload === 'string') {
            actualText = payload;
          }
          
          if (actualText) {
            console.log('[TranscriptionFallback] Setting text:', actualText);
            setText(actualText);
            setIsVisible(true);
          }
        }
      });
      
      return unlisten;
    };
    
    const listenerPromise = setupListener();
    
    // Cleanup function
    return () => {
      listenerPromise.then(unlisten => unlisten());
    };
  }, []);
  
  // Function to handle copying text to clipboard
  const handleCopy = () => {
    if (text) {
      writeText(text)
        .then(() => {
          console.log('[TranscriptionFallback] Text copied to clipboard');
        })
        .catch((err) => {
          console.error('[TranscriptionFallback] Failed to copy text:', err);
        });
    }
  };
  
  // Function to close the fallback UI
  const handleClose = () => {
    setIsVisible(false);
  };
  
  if (!isVisible) {
    return null;
  }
  
  return (
    <div className="fixed bottom-6 right-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 max-w-md w-full z-50 border border-gray-200 dark:border-gray-700">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">Transcription Result</h3>
        <button
          onClick={handleClose}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      <div className="bg-gray-100 dark:bg-gray-700 rounded p-3 mb-3 max-h-60 overflow-y-auto">
        <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">{text}</p>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={handleCopy}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Copy Text
        </button>
      </div>
    </div>
  );
};

export default TranscriptionFallback; 