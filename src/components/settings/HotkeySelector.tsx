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
  const [pendingAltGr, setPendingAltGr] = useState(false);
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
    
    // Special handling for AltGr on Windows
    // Windows sends Control followed by AltGraph for AltGr
    if (event.key === 'Control' && event.ctrlKey && event.altKey) {
      // This might be the start of an AltGr sequence
      setPendingAltGr(true);
      // Don't process this Control event yet
      setTimeout(() => setPendingAltGr(false), 100);
      return;
    }
    
    // If we see AltGraph, it's definitely AltGr
    if (event.key === 'AltGraph') {
      setPendingAltGr(false);
      onChange({ 
        ...value, 
        key: 'AltGr',
        modifiers: []
      });
      setIsCapturing(false);
      if (captureInputRef.current) {
        captureInputRef.current.blur();
      }
      return;
    }
    
    // If we were waiting for AltGr but got something else, process the pending Control
    if (pendingAltGr) {
      setPendingAltGr(false);
    }
    
    // Collect modifier keys
    const modifiers = [];
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.metaKey) modifiers.push('Cmd');
    
    // Map the main key
    let mainKey = '';
    
    // Handle standalone modifier keys (common for hotkeys)
    if (event.key === 'Control') {
      mainKey = event.location === 2 ? 'ControlRight' : 'Ctrl'; // Right Ctrl vs Left Ctrl
      modifiers.length = 0; // Clear modifiers since this IS the main key
    }
    else if (event.key === 'Alt') {
      mainKey = event.location === 2 ? 'AltGr' : 'Alt'; // Right Alt vs Left Alt  
      modifiers.length = 0; // Clear modifiers since this IS the main key
    }
    else if (event.key === 'Shift') {
      mainKey = event.location === 2 ? 'ShiftRight' : 'Shift'; // Right Shift vs Left Shift
      modifiers.length = 0; // Clear modifiers since this IS the main key
    }
    else if (event.key === 'Meta') {
      mainKey = 'Cmd';
      modifiers.length = 0; // Clear modifiers since this IS the main key
    }
    // Function keys
    else if (event.key.startsWith('F') && event.key.length <= 3) {
      mainKey = event.key;
    }
    // Arrow keys (commonly requested)
    else if (event.key === 'ArrowUp') {
      mainKey = 'Up';
    }
    else if (event.key === 'ArrowDown') {
      mainKey = 'Down';
    }
    else if (event.key === 'ArrowLeft') {
      mainKey = 'Left';
    }
    else if (event.key === 'ArrowRight') {
      mainKey = 'Right';
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
    else if (event.key === 'Tab') {
      mainKey = 'Tab';
    }
    else if (event.key === 'Backspace') {
      mainKey = 'Backspace';
    }
    else if (event.key === 'Delete') {
      mainKey = 'Delete';
    }
    // Letter keys
    else if (event.key.length === 1 && event.key.match(/[a-zA-Z]/)) {
      mainKey = event.key.toUpperCase();
    }
    // Number keys
    else if (event.key.length === 1 && event.key.match(/[0-9]/)) {
      mainKey = event.key;
    }
    // AltGraph is already handled above, this is just for safety
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
                Click and press your desired key (e.g., Ctrl, Alt, F2, Arrow keys, etc.)
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