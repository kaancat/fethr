import React, { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useToast } from "@/hooks/use-toast";
import { GradientButton } from "@/components/ui/gradient-button";
import { Label } from "@/components/ui/label";
import { Mic, MicOff, CheckCircle2, AlertTriangle } from 'lucide-react';

interface MicrophoneTesterProps {
  selectedDevice: string | null;
  disabled?: boolean;
}

const MicrophoneTester: React.FC<MicrophoneTesterProps> = ({
  selectedDevice,
  disabled = false
}) => {
  const { toast } = useToast();
  const [isTesting, setIsTesting] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micStatus, setMicStatus] = useState<'unknown' | 'working' | 'silent'>('unknown');
  const testIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const levelDecayRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (testIntervalRef.current) {
        clearInterval(testIntervalRef.current);
      }
      if (levelDecayRef.current) {
        clearTimeout(levelDecayRef.current);
      }
    };
  }, []);

  const startTesting = async () => {
    if (!selectedDevice) {
      toast({
        variant: "destructive",
        title: "No Device Selected",
        description: "Please select a microphone to test",
      });
      return;
    }

    setIsTesting(true);
    setAudioLevel(0);
    setMicStatus('unknown');

    // Start continuous level monitoring
    testIntervalRef.current = setInterval(async () => {
      try {
        // Quick 100ms sample to get real-time levels
        const level = await invoke<number>('test_microphone_levels', {
          deviceId: selectedDevice,
          durationMs: 100
        });
        
        // Convert to percentage with increased sensitivity for visual feedback
        // Multiply by 500 instead of 100 to make normal speech more visible
        const levelPercentage = Math.min(level * 500, 100);
        setAudioLevel(levelPercentage);
        
        // Determine mic status - focus on detection, not quality prediction
        // Use the original lower sensitivity for status detection
        const originalLevel = level * 100;
        if (originalLevel > 0.5) { // Even quieter threshold for detection
          setMicStatus('working');
        } else {
          setMicStatus('silent'); // Only show error if truly no audio
        }
        
        // Reset level decay timer
        if (levelDecayRef.current) {
          clearTimeout(levelDecayRef.current);
        }
        
        // Decay the level if no new audio
        levelDecayRef.current = setTimeout(() => {
          setAudioLevel(prev => Math.max(0, prev * 0.7));
        }, 150);
        
      } catch (error) {
        console.error('Level monitoring error:', error);
        // Continue monitoring even if individual samples fail
      }
    }, 100);
  };

  const stopTesting = () => {
    setIsTesting(false);
    setAudioLevel(0);
    setMicStatus('unknown');
    
    if (testIntervalRef.current) {
      clearInterval(testIntervalRef.current);
      testIntervalRef.current = null;
    }
    
    if (levelDecayRef.current) {
      clearTimeout(levelDecayRef.current);
      levelDecayRef.current = null;
    }
  };

  const handleTestToggle = () => {
    if (isTesting) {
      stopTesting();
    } else {
      startTesting();
    }
  };

  // Create simple activity level bar - just shows audio detection
  const renderLevelBar = () => {
    const segments = 12; // Clean number of segments
    const activeSegments = Math.floor((audioLevel / 100) * segments);
    
    return (
      <div className="space-y-2">
        <div className="flex space-x-1 h-4">
          {Array.from({ length: segments }, (_, i) => {
            const isActive = i < activeSegments;
            
            // Simple gradient from purple to blue (brand colors)
            let bgColor = 'bg-neutral-700';
            if (isActive) {
              // Use brand gradient colors for active segments
              if (i < segments * 0.3) {
                bgColor = 'bg-[#DA70D6]'; // Magenta
              } else if (i < segments * 0.7) {
                bgColor = 'bg-[#8A2BE2]'; // Purple  
              } else {
                bgColor = 'bg-[#87CEFA]'; // Sky blue
              }
            }
            
            return (
              <div
                key={i}
                className={`flex-1 rounded-sm transition-all duration-150 ${bgColor}`}
                style={{
                  opacity: isActive ? 0.9 : 0.3,
                }}
              />
            );
          })}
        </div>
        
        {/* Simple activity indicator */}
        <div className="text-xs text-center text-neutral-500">
          {audioLevel > 5 ? "Audio detected" : "Speak to see activity"}
        </div>
      </div>
    );
  };

  const getStatusMessage = () => {
    switch (micStatus) {
      case 'working':
        return (
          <div className="flex items-center space-x-2 text-green-400">
            <CheckCircle2 className="w-4 h-4" />
            <span>Audio detected - your microphone is working!</span>
          </div>
        );
      case 'silent':
        return (
          <div className="flex items-center space-x-2 text-red-400">
            <AlertTriangle className="w-4 h-4" />
            <span>No audio detected. Check mic connection and permissions.</span>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-gray-300">Microphone Test</Label>
      </div>

      {/* Description */}
      <div className="text-sm text-neutral-400">
        Test your microphone to make sure it's connected and capturing audio. This helps verify your setup before recording.
      </div>

      {/* Fethr Branded Gradient Button */}
      <GradientButton
        onClick={handleTestToggle}
        disabled={disabled || !selectedDevice}
        size="sm"
        variant={isTesting ? "destructive" : "primary"}
      >
        <div className="flex items-center space-x-2">
          {isTesting ? (
            <>
              <MicOff className="w-4 h-4" />
              <span>Stop Test</span>
            </>
          ) : (
            <>
              <Mic className="w-4 h-4" />
              <span>Test Microphone</span>
            </>
          )}
        </div>
      </GradientButton>

      {/* Level Bar with Context */}
      {isTesting && (
        <div className="space-y-3">
          {renderLevelBar()}
          <div className="text-xs text-neutral-400 text-center">
            Speak normally into your microphone
          </div>
          {getStatusMessage()}
        </div>
      )}

      {/* Help Text */}
      {!selectedDevice && (
        <div className="text-xs text-neutral-500">
          Select a microphone device above to test audio levels
        </div>
      )}
    </div>
  );
};

export default MicrophoneTester;