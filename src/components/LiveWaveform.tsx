import React, { useState, useEffect, useRef } from 'react';

const NUM_BARS = 6; // Increased from 5 to 6 for better visualization
const MIN_BAR_HEIGHT_PERCENT = 5; // Default min height as a percentage
const SMOOTHING_FACTOR = 0.85; // Analyser smoothing
const FFT_SIZE = 256; // Increase for time domain data
const SCALE_FACTOR = 900; // Dramatically increased from 700 to 1100 for even better visual impact

// Define the props interface
interface LiveWaveformProps {
    barColor?: string;
    idleHeight?: number;
    maxHeight?: number; // Though not directly used in scaling logic, good to have if needed later
    barWidth?: number;
    gap?: number;
    isRecording?: boolean; // Can be used to conditionally run the analyser
}

const LiveWaveform: React.FC<LiveWaveformProps> = ({
    barColor = 'rgba(255,255,255,0.8)', // Default to white with some transparency
    idleHeight = MIN_BAR_HEIGHT_PERCENT,
    barWidth = 1.5, // Default to 1.5px width
    gap = 1, // Default to 1px gap
    isRecording, // This prop can be used to conditionally start/stop the analyser
}) => {
    const [barHeights, setBarHeights] = useState<number[]>(() => new Array(NUM_BARS).fill(idleHeight));
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const dataArrayRef = useRef<Uint8Array | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const animationFrameId = useRef<number | null>(null);
    const drawCountRef = useRef(0); // Add ref for throttling log
    const [error, setError] = useState<string | null>(null);
    const isMountedRef = useRef(true); // Track mount status

    // Define draw function using refs (stable reference)
    const draw = () => {
        // Stop if component unmounted or context closed/suspended
        if (!isMountedRef.current || audioContextRef.current?.state !== 'running' || !analyserRef.current || !dataArrayRef.current) {
             console.log("[LiveWaveform Draw] Stopping loop (unmounted, context closed, or refs missing).");
             if(animationFrameId.current) cancelAnimationFrame(animationFrameId.current); // Explicit stop
             animationFrameId.current = null;
            return;
        }

        // Request next frame immediately
        animationFrameId.current = requestAnimationFrame(draw);

        // Get time domain data (amplitude) instead of frequency data
        analyserRef.current.getByteTimeDomainData(dataArrayRef.current);

        const bufferLength = analyserRef.current.fftSize; // Use fftSize for time domain data
        const newHeights = new Array(NUM_BARS);
        const sliceWidth = Math.floor(bufferLength / NUM_BARS);
        
        // Log data range occasionally
        drawCountRef.current++;
        if (drawCountRef.current % 120 === 0) { // Less frequent logging
            const dataMin = Math.min(...Array.from(dataArrayRef.current));
            const dataMax = Math.max(...Array.from(dataArrayRef.current));
            console.log(`[LiveWaveform] Time domain data range: min=${dataMin}, max=${dataMax}, bufferLength=${bufferLength}`);
        }

        for (let i = 0; i < NUM_BARS; i++) {
            let maxAmplitude = 0;
            const start = i * sliceWidth;
            const end = Math.min(start + sliceWidth, bufferLength);

            // Find maximum deviation from the center point (128) in this slice
            for (let j = start; j < end; j++) {
                // Calculate deviation from silence (128)
                const deviation = Math.abs(dataArrayRef.current[j] - 128);
                if (deviation > maxAmplitude) {
                    maxAmplitude = deviation;
                }
            }
            
            // Scale max deviation (0-128) to height percentage (0-100)
            // Apply scaling factor to make it more visually responsive
            const heightPercent = Math.max(idleHeight, Math.min(100, (maxAmplitude / 128) * SCALE_FACTOR));
            newHeights[i] = heightPercent;
        }

        // Log heights occasionally to avoid console spam
        if (drawCountRef.current % 60 === 0) { // Log roughly once per second (assuming 60fps)
            console.log("[LiveWaveform] Bar Heights (Time Domain):", newHeights.map(h => h.toFixed(0)).join(', '));
        }

        // Update the bar heights
        setBarHeights(newHeights);
    };

    useEffect(() => {
        isMountedRef.current = true; // Mark as mounted
        drawCountRef.current = 0; // Initialize counter

        // Determine if audio should be set up based on isRecording prop if it's explicitly passed
        // If isRecording is undefined, always attempt to set up audio (original behavior)
        const shouldSetupAudio = typeof isRecording === 'undefined' || isRecording === true;

        if (!shouldSetupAudio) {
            console.log("[LiveWaveform] Audio setup skipped as isRecording is false.");
            // Ensure cleanup if audio was previously active and isRecording becomes false
            // This part might need more robust handling if isRecording can toggle during component lifetime
            return;
        }

        const setupAudio = async () => {
            setError(null); // Clear previous errors
            try {
                console.log("[LiveWaveform] Requesting mic...");
                const stream = await navigator.mediaDevices.getUserMedia({
                     audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                     video: false
                 });

                if (!isMountedRef.current) { stream.getTracks().forEach(track => track.stop()); return; } // Check after await

                streamRef.current = stream;
                console.log("[LiveWaveform] Mic access granted.");

                const context = new AudioContext();
                audioContextRef.current = context;

                const analyser = context.createAnalyser();
                analyser.fftSize = FFT_SIZE; // Use larger FFT size for time domain data
                analyser.minDecibels = -90; // Less relevant for time domain but keep it
                analyser.maxDecibels = -10; // Less relevant for time domain but keep it
                analyser.smoothingTimeConstant = SMOOTHING_FACTOR;
                analyserRef.current = analyser;

                // Create data array based on fftSize for time domain data
                dataArrayRef.current = new Uint8Array(analyser.fftSize);
                
                console.log(`[LiveWaveform] Analyser created with fftSize=${analyser.fftSize} for time domain visualization`);

                const source = context.createMediaStreamSource(stream);
                sourceRef.current = source;
                source.connect(analyser);

                console.log("[LiveWaveform] Audio setup complete. Starting draw loop.");
                // Start the draw loop *after* everything is initialized
                animationFrameId.current = requestAnimationFrame(draw);

            } catch (err) {
                 console.error("[LiveWaveform] Error setting up audio:", err);
                 if (isMountedRef.current) {
                     setError(err instanceof Error ? err.message : "Mic access failed.");
                 }
            }
        };

        setupAudio();

        // Cleanup function
        return () => {
            console.log("[LiveWaveform] Cleanup running...");
            isMountedRef.current = false; // Mark as unmounted
            drawCountRef.current = 0; // Reset counter
            if (animationFrameId.current) {
                console.log("[LiveWaveform] Cancelling animation frame");
                cancelAnimationFrame(animationFrameId.current);
                animationFrameId.current = null;
            }
            console.log("[LiveWaveform] Stopping mic tracks...");
            streamRef.current?.getTracks().forEach(track => track.stop());
            console.log("[LiveWaveform] Disconnecting source node...");
            sourceRef.current?.disconnect();
             // It's good practice to close the context on cleanup
             console.log("[LiveWaveform] Closing audio context...");
             audioContextRef.current?.close().then(() => {
                 console.log("[LiveWaveform] Audio context closed.");
                 audioContextRef.current = null; // Nullify after close
             }).catch(e => console.error("Error closing audio context:", e));

             // Clear other refs
             streamRef.current = null;
             sourceRef.current = null;
             analyserRef.current = null;
             dataArrayRef.current = null;

             console.log("[LiveWaveform] Cleanup finished.");
        };
    }, [isRecording]); // Add isRecording to dependency array to re-run effect if it changes

    // --- RENDER ---
    if (error) {
        return <div className="flex items-center justify-center w-full h-full text-red-400 text-xs px-1" title={error}>⚠️ Mic Err</div>;
    }

    // Use a consistent key for the container if needed, or rely on parent key
    return (
         <div 
            className="flex items-end justify-center h-full w-full overflow-hidden"
            style={{ columnGap: `${gap}px` }} // Apply gap using style
        >
             {barHeights.map((height, index) => (
                 <span
                     key={index}
                     className="block rounded-full"
                     style={{
                         backgroundColor: barColor,
                         width: `${barWidth}px`,
                         height: `${height}%`,
                         minHeight: `${idleHeight}%`,
                         transition: 'height 0.075s ease-out' 
                     }}
                 />
             ))}
         </div>
    );
};

export default LiveWaveform; 