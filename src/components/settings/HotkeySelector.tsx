import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, TestTube, CheckCircle, XCircle } from 'lucide-react';

interface HotkeySettings {
  key: string;
  modifiers: string[];
  hold_to_record: boolean;
  enabled: boolean;
}

interface HotkeyOption {
  value: string;
  label: string;
}

interface HotkeySelectorProps {
  value: HotkeySettings;
  onChange: (settings: HotkeySettings) => void;
  onSave?: () => void;
}

export default function HotkeySelector({ value, onChange, onSave }: HotkeySelectorProps) {
  const { toast } = useToast();
  const [supportedKeys, setSupportedKeys] = useState<HotkeyOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Load supported hotkeys on component mount
  useEffect(() => {
    loadSupportedKeys();
  }, []);

  const loadSupportedKeys = async () => {
    try {
      setIsLoading(true);
      const keys = await invoke<[string, string][]>('get_supported_hotkeys');
      setSupportedKeys(keys.map(([value, label]) => ({ value, label })));
    } catch (error) {
      console.error('Failed to load supported hotkeys:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load supported hotkeys"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyChange = (newKey: string) => {
    onChange({ ...value, key: newKey });
    setTestResult(null); // Reset test result when key changes
  };

  const handleEnabledChange = (enabled: boolean) => {
    onChange({ ...value, enabled });
  };

  const handleHoldToRecordChange = (holdToRecord: boolean) => {
    onChange({ ...value, hold_to_record: holdToRecord });
  };

  const testHotkey = async () => {
    if (!value.key) {
      toast({
        variant: "destructive",
        title: "No Key Selected",
        description: "Please select a hotkey to test"
      });
      return;
    }

    try {
      setIsTesting(true);
      const isValid = await invoke<boolean>('test_hotkey', { key: value.key });
      setTestResult(isValid);
      
      if (isValid) {
        toast({
          title: "Hotkey Valid",
          description: `${value.key} is a valid hotkey`,
        });
      } else {
        toast({
          variant: "destructive", 
          title: "Invalid Hotkey",
          description: `${value.key} is not supported`
        });
      }
    } catch (error) {
      console.error('Hotkey test failed:', error);
      setTestResult(false);
      toast({
        variant: "destructive",
        title: "Test Failed",
        description: "Could not test the selected hotkey"
      });
    } finally {
      setIsTesting(false);
    }
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

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Hotkey Settings</CardTitle>
          <CardDescription>Configure your recording hotkey</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[#87CEFA]" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hotkey Settings</CardTitle>
        <CardDescription>
          Configure your recording hotkey and behavior
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable/Disable Hotkeys */}
        <div className="flex items-center space-x-2">
          <Switch
            id="hotkey-enabled"
            checked={value.enabled}
            onCheckedChange={handleEnabledChange}
          />
          <Label htmlFor="hotkey-enabled">Enable hotkey recording</Label>
        </div>

        {value.enabled && (
          <>
            {/* Key Selection */}
            <div className="space-y-2">
              <Label htmlFor="hotkey-select">Hotkey</Label>
              <div className="flex space-x-2">
                <Select value={value.key} onValueChange={handleKeyChange}>
                  <SelectTrigger className="flex-1 bg-[#020409]/80 border-[#8A2BE2]/20 text-gray-200">
                    <SelectValue placeholder="Select a hotkey" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#020409] border-[#8A2BE2]/20">
                    {supportedKeys.map((option) => (
                      <SelectItem 
                        key={option.value} 
                        value={option.value}
                        className="text-gray-200 focus:bg-[#8A2BE2]/20"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={testHotkey}
                  disabled={!value.key || isTesting}
                  className="border-[#8A2BE2]/20 text-[#87CEFA] hover:bg-[#8A2BE2]/10"
                >
                  {isTesting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <TestTube className="h-4 w-4" />
                  )}
                  Test
                </Button>
              </div>

              {/* Test Result */}
              {testResult !== null && (
                <div className={`flex items-center space-x-2 text-sm ${
                  testResult ? 'text-green-400' : 'text-red-400'
                }`}>
                  {testResult ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <span>
                    {testResult ? 'Hotkey is valid' : 'Hotkey is not supported'}
                  </span>
                </div>
              )}
            </div>

            {/* Recording Mode */}
            <div className="space-y-3">
              <Label>Recording Mode</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="hold-to-record"
                    checked={value.hold_to_record}
                    onCheckedChange={handleHoldToRecordChange}
                  />
                  <Label htmlFor="hold-to-record" className="text-sm">
                    Hold to record
                  </Label>
                </div>
                <p className="text-xs text-gray-400">
                  {value.hold_to_record 
                    ? "Hold down the hotkey to record, release to stop"
                    : "Tap the hotkey to start/stop recording (toggle mode)"
                  }
                </p>
              </div>
            </div>

            {/* Current Hotkey Display */}
            <div className="space-y-2">
              <Label>Current Hotkey</Label>
              <div className="p-3 bg-[#020409]/80 border border-[#8A2BE2]/20 rounded-md">
                <div className="flex items-center justify-between">
                  <span className="text-[#87CEFA] font-mono text-lg">
                    {value.key || "No key selected"}
                  </span>
                  <span className="text-xs text-gray-400">
                    {value.hold_to_record ? "Hold mode" : "Toggle mode"}
                  </span>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end">
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
      </CardContent>
    </Card>
  );
}