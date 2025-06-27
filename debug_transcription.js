console.log('Debugging transcription flow...');
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

async function debugTranscription() {
  console.log('Setting up listeners...');
  
  // Listen for transcription status changes
  await listen('transcription-status-changed', event => {
    console.log('Status changed:', event.payload);
  });
  
  // Listen for transcription results
  await listen('transcription-result', event => {
    console.log('Result received:', event.payload);
  });
  
  console.log('Listeners set up, ready to test');
  console.log('Type debug_test() in console to test manually');
}

// Function to manually test transcription
window.debug_test = async function() {
  console.log('Running debug test...');
  try {
    // Check if sample file exists
    const tempPath = 'C:\\Users\\kaan\\.fethr\\temp_audio.wav';
    const exists = await invoke('verify_file_exists', { path: tempPath });
    console.log('Test file exists:', exists);
    
    if (exists) {
      // Try transcribing
      console.log('Attempting to transcribe:', tempPath);
      await invoke('transcribe_local_audio', { 
        audio_path: tempPath, 
        auto_paste: false 
      });
      console.log('Transcription initiated');
    } else {
      console.error('Test file not found. Please record audio first.');
    }
  } catch (e) {
    console.error('Error during transcription test:', e);
  }
};

// Start debug session
debugTranscription().catch(console.error); 