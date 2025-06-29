import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Keyboard } from 'lucide-react';

interface HotkeySettings {
  key: string;
  modifiers: string[];
  hold_to_record: boolean;
  enabled: boolean;
}

interface HotkeySelectorProps {
  value: HotkeySettings;
  onChange: (settings: HotkeySettings) => void;
  onSave?: () => void;
}

export default function HotkeySelector({ value, onChange, onSave }: HotkeySelectorProps) {
  const { toast } = useToast();
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const captureInputRef = useRef<HTMLInputElement>(null);

  const getHotkeyDisplayText = () => {
    if (!value.key) return "Click to set hotkey";
    
    const parts = [];
    if (value.modifiers.length > 0) {
      parts.push(...value.modifiers);
    }
    parts.push(value.key);
    
    return parts.join(' + ');
  };

  const handleKeyCapture = (event: React.KeyboardEvent) => {
    if (!isCapturing) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    // Collect modifier keys
    const modifiers = [];
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.metaKey) modifiers.push('Cmd');
    
    // Map the main key
    let mainKey = '';
    
    // Don't capture pure modifier keys - require a main key
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
      // Just a modifier key - don't capture yet
      return;
    }
    
    // Function keys
    if (event.key.startsWith('F') && event.key.length <= 3) {
      mainKey = event.key;
    }
    // Special keys
    else if (event.key === ' ') {
      mainKey = 'Space';
    }
    else if (event.key === 'Enter') {
      mainKey = 'Enter';
    }
    else if (event.key === 'Escape') {
      mainKey = 'Escape';
    }
    // Letter keys
    else if (event.key.length === 1 && event.key.match(/[a-zA-Z]/)) {
      mainKey = event.key.toUpperCase();
    }
    // Number keys
    else if (event.key.length === 1 && event.key.match(/[0-9]/)) {
      mainKey = event.key;
    }
    // Special case for AltGr (right alt)
    else if (event.key === 'AltGraph') {
      mainKey = 'AltGr';
      modifiers.length = 0; // Clear modifiers for AltGr as it's standalone
    }
    else {
      // Unsupported key
      toast({
        variant: "destructive",
        title: "Unsupported Key",
        description: `The key "${event.key}" is not supported for hotkeys`
      });
      setIsCapturing(false);
      return;
    }
    
    // Update the hotkey configuration
    onChange({ 
      ...value, 
      key: mainKey,
      modifiers: modifiers
    });
    setIsCapturing(false);
    
    if (captureInputRef.current) {
      captureInputRef.current.blur();
    }
  };

  const startCapture = () => {
    setIsCapturing(true);
    if (captureInputRef.current) {
      captureInputRef.current.focus();
    }
  };

  const handleEnabledChange = (enabled: boolean) => {
    onChange({ ...value, enabled });
  };

  const handleHoldToRecordChange = (holdToRecord: boolean) => {
    onChange({ ...value, hold_to_record: holdToRecord });
  };

  const saveHotkeySettings = async () => {
    try {
      setIsSaving(true);
      await invoke('update_hotkey_settings', { hotkeySettings: value });
      toast({
        title: "Hotkey Settings Saved",
        description: `Hotkey set to ${value.key}${value.hold_to_record ? ' (hold to record)' : ' (tap to toggle)'}`,
      });
      if (onSave) {
        onSave();
      }
    } catch (error) {
      console.error('Failed to save hotkey settings:', error);
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: error instanceof Error ? error.message : "Could not save hotkey settings"
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Enable/Disable Hotkeys */}
      <div className="flex items-center justify-between space-x-2">
        <Label htmlFor="hotkey-enabled" className="text-gray-300 flex flex-col">
          <span>Enable Hotkey Recording</span>
          <span className="text-xs text-gray-400">Use keyboard shortcut to start/stop recording</span>
        </Label>
        <Switch
          id="hotkey-enabled"
          checked={value.enabled}
          onCheckedChange={handleEnabledChange}
        />
      </div>

      {value.enabled && (
        <>
          {/* Key Capture Field */}
          <div className="space-y-2">
            <Label htmlFor="hotkey-capture" className="text-gray-300">Recording Hotkey</Label>
            <div className="space-y-2">
              <div className="relative">
                <input
                  ref={captureInputRef}
                  type="text"
                  id="hotkey-capture"
                  value={isCapturing ? "Press your hotkey combination..." : getHotkeyDisplayText()}
                  onClick={startCapture}
                  onKeyDown={handleKeyCapture}
                  onBlur={() => setIsCapturing(false)}
                  readOnly
                  className="w-full bg-[#0b0719] border border-[#8A2BE2]/30 text-white px-3 py-2 rounded-md ring-offset-[#020409] focus:ring-2 focus:ring-[#8A2BE2]/50 focus:ring-offset-2 cursor-pointer font-mono"
                  placeholder="Click to set hotkey"
                />
                <Keyboard className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              </div>
              <p className="text-xs text-gray-400">
                Click and press your desired key combination (e.g., Ctrl+Alt+R, F2, etc.)
              </p>
            </div>
          </div>

          {/* Recording Mode */}
          <div className="flex items-center justify-between space-x-2">
            <Label htmlFor="hold-to-record" className="text-gray-300 flex flex-col">
              <span>Push-to-Talk Mode</span>
              <span className="text-xs text-gray-400">
                {value.hold_to_record 
                  ? "Hold hotkey while speaking (like a walkie-talkie)"
                  : "Press hotkey once to start, press again to stop"
                }
              </span>
            </Label>
            <Switch
              id="hold-to-record"
              checked={value.hold_to_record}
              onCheckedChange={handleHoldToRecordChange}
            />
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-2">
            <Button
              onClick={saveHotkeySettings}
              disabled={!value.key || isSaving}
              className="bg-gradient-to-r from-[#87CEFA] via-[#8A2BE2] to-[#DA70D6] hover:from-[#75B8E8] hover:via-[#7A25D2] hover:to-[#C85EC4] text-white"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                "Save Hotkey Settings"
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}