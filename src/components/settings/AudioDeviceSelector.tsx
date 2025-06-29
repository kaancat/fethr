import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RefreshCw, Mic, Volume2 } from 'lucide-react';

interface AudioDeviceInfo {
  id: string;
  name: string;
  is_default: boolean;
  sample_rate: number;
  channels: number;
}

interface AudioDeviceSelectorProps {
  selectedDevice: string | null;
  onDeviceChange: (deviceId: string) => void;
  disabled?: boolean;
}

const AudioDeviceSelector: React.FC<AudioDeviceSelectorProps> = ({
  selectedDevice,
  onDeviceChange,
  disabled = false
}) => {
  const { toast } = useToast();
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadDevices = async (showRefreshMessage = false) => {
    try {
      setIsRefreshing(true);
      const audioDevices = await invoke<AudioDeviceInfo[]>('get_audio_devices');
      setDevices(audioDevices);
      
      console.log('[AudioDeviceSelector] Loaded devices:', audioDevices);
      
      if (showRefreshMessage) {
        toast({
          title: "Devices Refreshed",
          description: `Found ${audioDevices.length} audio input device${audioDevices.length !== 1 ? 's' : ''}`,
        });
      }
      
      // Auto-select first device if none selected and devices available
      if (!selectedDevice && audioDevices.length > 0) {
        const defaultDevice = audioDevices.find(d => d.is_default) || audioDevices[0];
        onDeviceChange(defaultDevice.id);
      }
      
    } catch (error) {
      console.error('Failed to load audio devices:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load audio devices",
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const handleRefresh = () => {
    loadDevices(true);
  };

  const handleDeviceChange = async (deviceId: string) => {
    try {
      await invoke('set_audio_device', { deviceId });
      onDeviceChange(deviceId);
      
      const selectedDeviceInfo = devices.find(d => d.id === deviceId);
      toast({
        title: "Audio Device Selected",
        description: `Now using: ${selectedDeviceInfo?.name || 'Unknown device'}`,
      });
    } catch (error) {
      console.error('Failed to set audio device:', error);
      
      // Handle device disconnection error
      const errorMessage = String(error);
      if (errorMessage.includes('not found') || errorMessage.includes('not available')) {
        toast({
          variant: "destructive",
          title: "Device Unavailable",
          description: "Selected device is no longer available. Refreshing device list...",
        });
        // Automatically refresh device list when a device becomes unavailable
        loadDevices(false);
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to set audio device",
        });
      }
    }
  };

  const getDeviceDisplayName = (device: AudioDeviceInfo) => {
    let displayName = device.name;
    if (device.is_default) {
      displayName += " (System Default)";
    }
    return displayName;
  };

  const getDeviceIcon = (device: AudioDeviceInfo) => {
    if (device.name.toLowerCase().includes('airpods') || 
        device.name.toLowerCase().includes('bluetooth')) {
      return <Volume2 className="w-4 h-4 text-blue-400" />;
    }
    return <Mic className="w-4 h-4 text-neutral-400" />;
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label className="text-gray-300">Microphone Input</Label>
        <div className="flex items-center space-x-2">
          <div className="flex-1 h-10 bg-neutral-800 border border-neutral-700 rounded-md animate-pulse" />
          <Button disabled size="sm" className="px-3">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-neutral-500">Loading audio devices...</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="audio-device-select" className="text-gray-300">
        Microphone Input
      </Label>
      
      <div className="flex items-center space-x-2">
        <div className="flex-1">
          <Select
            value={selectedDevice || ""}
            onValueChange={handleDeviceChange}
            disabled={disabled || devices.length === 0}
          >
            <SelectTrigger 
              id="audio-device-select"
              className="w-full bg-[#0b0719] border border-[#8A2BE2]/40 text-white ring-offset-[#020409] focus:ring-2 focus:ring-[#8A2BE2]/60 focus:ring-offset-2"
            >
              <SelectValue placeholder={devices.length === 0 ? "No devices found" : "Select microphone"} />
            </SelectTrigger>
            <SelectContent className="bg-[#0b0719] border-[#8A2BE2]/30 text-white">
              {devices.map(device => (
                <SelectItem 
                  key={device.id} 
                  value={device.id} 
                  className="focus:bg-[#8A2BE2]/20 text-white cursor-pointer"
                >
                  <div className="flex items-center space-x-2">
                    {getDeviceIcon(device)}
                    <span>{getDeviceDisplayName(device)}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <Button
          onClick={handleRefresh}
          disabled={disabled || isRefreshing}
          size="sm"
          className="px-3 bg-gradient-to-r from-[#8A2BE2]/30 to-[#DA70D6]/30 border border-[#8A2BE2]/50 text-white hover:from-[#8A2BE2]/40 hover:to-[#DA70D6]/40 hover:border-[#8A2BE2]/70 transition-all duration-200"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {devices.length === 0 ? (
        <p className="text-xs text-red-400">
          No audio input devices found. Please check your microphone connection.
        </p>
      ) : (
        <div className="text-xs text-neutral-500 space-y-1">
          <p>{devices.length} device{devices.length !== 1 ? 's' : ''} available</p>
          {selectedDevice && (
            <div className="flex items-center space-x-1">
              <span>Selected:</span>
              <span className="text-white font-medium">
                {devices.find(d => d.id === selectedDevice)?.name || 'Unknown'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AudioDeviceSelector;