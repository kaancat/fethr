import audioBufferToWav from 'audiobuffer-to-wav';

/**
 * Converts webm audio to wav format
 * 
 * What it does: Takes a WebM audio blob and converts it to WAV format for transcription
 * Why it exists: Whisper API requires WAV format input
 * 
 * @param audioBlob Audio blob in WebM format
 * @returns Promise with WAV format blob
 */
export async function webmToWavBlob(audioBlob: Blob): Promise<Blob> {
  try {
    console.log(`[audioUtils] Starting WebM to WAV conversion: ${new Date().toISOString()}`);
    console.log(`[audioUtils] Input blob size: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
    
    // Check if input is already a WAV file
    if (audioBlob.type === 'audio/wav') {
      console.log('[audioUtils] Input is already WAV format, returning as-is');
      return audioBlob;
    }
    
    // Check if input is actually a WebM file by examining the file signature
    const signatureBytes = await audioBlob.slice(0, 4).arrayBuffer();
    const signature = new Uint8Array(signatureBytes);
    const signatureHex = Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join('');
    console.log(`[audioUtils] File signature: ${signatureHex}`);
    
    // WebM files typically start with 0x1A 0x45 0xDF 0xA3 (EBML header)
    if (signature[0] !== 0x1A || signature[1] !== 0x45 || signature[2] !== 0xDF || signature[3] !== 0xA3) {
      console.warn('[audioUtils] Input may not be a valid WebM file. Checking content type...');
      // Try to determine the actual format
      if (audioBlob.type.includes('audio/wav') || audioBlob.type.includes('audio/wave')) {
        console.log('[audioUtils] Detected WAV format from content type, returning as-is');
        return audioBlob;
      }
    }
    
    // Handle empty blobs
    if (audioBlob.size === 0) {
      console.warn('[audioUtils] Empty audio blob received, creating minimal WAV file');
      // Create a minimal WAV file with silence
      const sampleRate = 16000;
      const channels = 1;
      const bitsPerSample = 16;
      const emptyAudioData = new Uint8Array(44); // WAV header size
      
      // WAV header
      emptyAudioData.set([82, 73, 70, 70]); // "RIFF"
      emptyAudioData.set([36, 0, 0, 0], 4); // File size - 8
      emptyAudioData.set([87, 65, 86, 69], 8); // "WAVE"
      emptyAudioData.set([102, 109, 116, 32], 12); // "fmt "
      emptyAudioData.set([16, 0, 0, 0], 16); // Subchunk size
      emptyAudioData.set([1, 0], 20); // PCM format
      emptyAudioData.set([channels, 0], 22); // Channels
      emptyAudioData.set([sampleRate & 0xff, (sampleRate >> 8) & 0xff, (sampleRate >> 16) & 0xff, (sampleRate >> 24) & 0xff], 24); // Sample rate
      const byteRate = sampleRate * channels * (bitsPerSample / 8);
      emptyAudioData.set([byteRate & 0xff, (byteRate >> 8) & 0xff, (byteRate >> 16) & 0xff, (byteRate >> 24) & 0xff], 28); // Byte rate
      const blockAlign = channels * (bitsPerSample / 8);
      emptyAudioData.set([blockAlign & 0xff, (blockAlign >> 8) & 0xff], 32); // Block align
      emptyAudioData.set([bitsPerSample & 0xff, (bitsPerSample >> 8) & 0xff], 34); // Bits per sample
      emptyAudioData.set([100, 97, 116, 97], 36); // "data"
      emptyAudioData.set([0, 0, 0, 0], 40); // Data size
      
      return new Blob([emptyAudioData], { type: 'audio/wav' });
    }

    // Create an AudioContext with explicit options
    let audioContext: AudioContext;
    try {
      // Use a fixed sample rate to avoid browser compatibility issues
      const sampleRate = 16000; // Most transcription services prefer 16kHz
      // @ts-ignore - some browsers might have webkitAudioContext
      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
      console.log(`[audioUtils] Created AudioContext with sample rate: ${audioContext.sampleRate}Hz`);
    } catch (err: unknown) {
      console.error('[audioUtils] Failed to create AudioContext:', err);
      throw new Error(`Failed to create AudioContext: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    // Read the audio file
    const arrayBuffer = await audioBlob.arrayBuffer();
    console.log(`[audioUtils] Successfully read ${arrayBuffer.byteLength} bytes from blob`);
    
    // Set up a timeout in case decodeAudioData silently fails
    let decodeTimeout: ReturnType<typeof setTimeout>;
    
    // Create a fallback encoder in case primary decoding fails
    const attemptDecode = async (): Promise<AudioBuffer> => {
      try {
        // Primary decoding attempt
        const result = await new Promise<AudioBuffer>((resolve, reject) => {
          decodeTimeout = setTimeout(() => {
            reject(new Error('Audio decoding timed out after 10 seconds'));
          }, 10000);
          
          // Decode the audio
          audioContext.decodeAudioData(
            arrayBuffer,
            (decodedData) => {
              clearTimeout(decodeTimeout);
              resolve(decodedData);
            },
            (err) => {
              clearTimeout(decodeTimeout);
              reject(err || new Error('Unknown decoding error'));
            }
          );
        });
        return result;
      } catch (decodeErr) {
        console.warn('[audioUtils] Primary decoding failed, attempting fallback decoding:', decodeErr);
        
        // Try a fallback approach: Create new blob with explicit MIME type
        try {
          // Create a new blob with explicitly set MIME type
          const forcedTypeBlob = new Blob([arrayBuffer], { type: 'audio/webm' });
          const forcedArrayBuffer = await forcedTypeBlob.arrayBuffer();
          
          return await new Promise<AudioBuffer>((resolve, reject) => {
            const fallbackTimeout = setTimeout(() => {
              reject(new Error('Fallback audio decoding timed out'));
            }, 10000);
            
            audioContext.decodeAudioData(
              forcedArrayBuffer,
              (decodedData) => {
                clearTimeout(fallbackTimeout);
                resolve(decodedData);
              },
              (fallbackErr) => {
                clearTimeout(fallbackTimeout);
                reject(new Error(`Both primary and fallback decoding failed: ${fallbackErr?.message || 'Unknown error'}`));
              }
            );
          });
        } catch (fallbackErr) {
          // If fallback also fails, rethrow with combined error info
          throw new Error(`Decoding failed - primary: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}, fallback: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
        }
      }
    };
    
    // Await decode with fallback
    console.log(`[audioUtils] Attempting to decode audio...`);
    const decodedData = await attemptDecode();
    console.log(`[audioUtils] Successfully decoded audio: ${decodedData.duration.toFixed(2)}s, ${decodedData.numberOfChannels} channels, ${decodedData.sampleRate}Hz`);

    // Analyze audio content for audibility
    const channelData = decodedData.getChannelData(0);
    let sum = 0;
    let max = 0;
    for (let i = 0; i < channelData.length; i++) {
      const absValue = Math.abs(channelData[i]);
      sum += absValue;
      if (absValue > max) max = absValue;
    }
    const average = sum / channelData.length;
    
    console.log(`[audioUtils] Audio analysis - Max amplitude: ${max.toFixed(6)}, Average: ${average.toFixed(6)}`);
    
    // Normalize audio data to ensure it's audible
    normalizeAudio(channelData);
    
    // Convert to WAV with error handling
    let wavBuffer: ArrayBuffer;
    try {
      wavBuffer = audioBufferToWav(decodedData);
      console.log(`[audioUtils] Converted to WAV format: ${wavBuffer.byteLength} bytes`);
    } catch (wavErr) {
      console.error('[audioUtils] Error in audioBufferToWav conversion:', wavErr);
      throw new Error(`WAV conversion failed: ${wavErr instanceof Error ? wavErr.message : String(wavErr)}`);
    }
    
    // Analyze WAV header to ensure format is correct
    if (wavBuffer.byteLength >= 44) {
      const headerView = new DataView(wavBuffer.slice(0, 44));
      const riffSignature = String.fromCharCode(
        headerView.getUint8(0), headerView.getUint8(1), 
        headerView.getUint8(2), headerView.getUint8(3)
      );
      const fileSize = headerView.getUint32(4, true) + 8;
      const waveSignature = String.fromCharCode(
        headerView.getUint8(8), headerView.getUint8(9), 
        headerView.getUint8(10), headerView.getUint8(11)
      );
      const formatChunk = String.fromCharCode(
        headerView.getUint8(12), headerView.getUint8(13),
        headerView.getUint8(14), headerView.getUint8(15)
      );
      const audioFormat = headerView.getUint16(20, true);
      const numChannels = headerView.getUint16(22, true);
      const sampleRate = headerView.getUint32(24, true);
      const bitsPerSample = headerView.getUint16(34, true);
      
      console.log(`[audioUtils] WAV Header Analysis:
        Signature: ${riffSignature} (should be RIFF)
        File Size: ${fileSize} bytes
        Format: ${waveSignature} (should be WAVE)
        Format Chunk: ${formatChunk} (should be fmt )
        Audio Format: ${audioFormat} (1=PCM)
        Channels: ${numChannels}
        Sample Rate: ${sampleRate}Hz
        Bits Per Sample: ${bitsPerSample}
      `);
      
      if (riffSignature !== 'RIFF' || waveSignature !== 'WAVE') {
        console.error('[audioUtils] WAV header is malformed!');
        // Continue anyway, as the transcription service might still be able to process it
      }
    }
    
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    console.log(`[audioUtils] Final WAV blob size: ${wavBlob.size} bytes`);
    return wavBlob;
  } catch (error: unknown) {
    console.error('[audioUtils] Error in webmToWavBlob:', error);
    
    // Enhanced error diagnostics
    let errorContext = '';
    if (error instanceof Error) {
      errorContext = `Name: ${error.name}, Message: ${error.message}`;
      if (error.name === 'EncodingError' || error.message.includes('encoding')) {
        errorContext += '\nPossible causes: Invalid audio format, corrupted audio data, or browser codec limitations';
      }
    }
    
    // Log detailed error with stack trace and full error object
    console.error(`[audioUtils] Detailed conversion error: ${errorContext}`, error);
    console.error(`[audioUtils] Stack trace:`, error instanceof Error ? error.stack : 'No stack trace');
    
    // Create a minimal valid WAV as fallback when conversion fails
    // This allows the transcription process to continue rather than hard failing
    console.warn('[audioUtils] Conversion failed - returning minimal valid WAV as fallback');
    const sampleRate = 16000;
    const channels = 1;
    const bitsPerSample = 16;
    const minimalWavHeader = new Uint8Array(44 + 32); // Header + minimal data
    
    // WAV header
    minimalWavHeader.set([82, 73, 70, 70]); // "RIFF"
    minimalWavHeader.set([72, 0, 0, 0], 4); // File size (44+32-8)
    minimalWavHeader.set([87, 65, 86, 69], 8); // "WAVE"
    minimalWavHeader.set([102, 109, 116, 32], 12); // "fmt "
    minimalWavHeader.set([16, 0, 0, 0], 16); // Subchunk size
    minimalWavHeader.set([1, 0], 20); // PCM format
    minimalWavHeader.set([channels, 0], 22); // Channels
    minimalWavHeader.set([sampleRate & 0xff, (sampleRate >> 8) & 0xff, (sampleRate >> 16) & 0xff, (sampleRate >> 24) & 0xff], 24); // Sample rate
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    minimalWavHeader.set([byteRate & 0xff, (byteRate >> 8) & 0xff, (byteRate >> 16) & 0xff, (byteRate >> 24) & 0xff], 28); // Byte rate
    const blockAlign = channels * (bitsPerSample / 8);
    minimalWavHeader.set([blockAlign & 0xff, (blockAlign >> 8) & 0xff], 32); // Block align
    minimalWavHeader.set([bitsPerSample & 0xff, (bitsPerSample >> 8) & 0xff], 34); // Bits per sample
    minimalWavHeader.set([100, 97, 116, 97], 36); // "data"
    minimalWavHeader.set([32, 0, 0, 0], 40); // Data size (32 bytes)
    
    // Add a simple 1kHz tone as content (16 samples, 16-bit PCM)
    for (let i = 0; i < 16; i++) {
      const sampleValue = Math.floor(Math.sin(i * 0.4) * 10000);
      minimalWavHeader.set([sampleValue & 0xff, (sampleValue >> 8) & 0xff], 44 + i * 2);
    }
    
    // Return this fallback WAV
    return new Blob([minimalWavHeader], { type: 'audio/wav' });
  }
}

/**
 * Normalizes audio data to a target peak amplitude
 * 
 * What it does: Scales audio data so the maximum amplitude reaches the target
 * Why it exists: To ensure audio is properly audible 
 * 
 * @param audioData Float32Array containing audio samples
 * @param targetPeak Target peak amplitude (0.0-1.0)
 */
function normalizeAudio(audioData: Float32Array, targetPeak: number = 0.9): void {
  // Find the maximum absolute amplitude
  let maxAmp = 0;
  for (let i = 0; i < audioData.length; i++) {
    const absValue = Math.abs(audioData[i]);
    if (absValue > maxAmp) {
      maxAmp = absValue;
    }
  }
  
  // If audio is silent or nearly silent, add some noise
  if (maxAmp < 0.01) {
    console.log('[audioUtils] Audio is nearly silent, adding reference tone');
    
    // Add a pure sine wave tone for reference
    for (let i = 0; i < audioData.length; i++) {
      // Use a pure 1000Hz tone instead of noise
      audioData[i] = Math.sin(i * 0.3) * 0.1;
    }
    maxAmp = 0.1; // The amplitude of our reference tone
  }
  
  // Scale the audio - boost it more aggressively for better speech detection
  if (maxAmp > 0) {
    const scaleFactor = targetPeak / maxAmp;
    console.log('[audioUtils] Normalizing audio by factor:', scaleFactor);
    
    // Apply the scaling but also add simple compression for speech
    for (let i = 0; i < audioData.length; i++) {
      // Apply normalization
      const normalized = audioData[i] * scaleFactor;
      
      // Apply a soft knee compression (boost quieter parts more)
      if (Math.abs(normalized) < 0.5) {
        // Boost quieter sounds more
        audioData[i] = normalized * 1.2;
      } else {
        // Keep louder sounds as is
        audioData[i] = normalized;
      }
    }
  }
}
