import React from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import type { AppSettings } from '../../types'; // Adjust path to your types file
import { Label } from "@/components/ui/label";     // Assuming Shadcn/ui
import { Switch } from "@/components/ui/switch";   // Assuming Shadcn/ui
import { useToast } from "@/hooks/use-toast";     // Assuming Shadcn/ui toast

interface AppearanceSettingsTabProps {
  settings: AppSettings | null;
  onSettingChange: (key: keyof AppSettings, value: boolean | string) => void; // Matches existing handleSettingChange
}

const AppearanceSettingsTab: React.FC<AppearanceSettingsTabProps> = ({ settings, onSettingChange }) => {
  const { toast } = useToast();

  const handlePillToggle = async (enabled: boolean) => {
    // 1. Update the settings state in the parent (SettingsPage) immediately for visual consistency
    //    and so it gets saved when the main "Save" button is clicked.
    onSettingChange('pill_enabled', enabled);

    // 2. Call the Rust command to immediately show/hide the pill.
    try {
      await invoke('set_pill_visibility', { visible: enabled });
      toast({
        title: "Pill Visibility Changed",
        description: `Recording pill will now be ${enabled ? 'shown' : 'hidden'}. Save settings to persist.`,
      });
    } catch (error) {
      console.error("Failed to set pill visibility:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: `Failed to ${enabled ? 'show' : 'hide'} pill: ${error}`,
      });
      // Optionally revert the onSettingChange if the invoke fails, though usually settings save is separate.
      // onSettingChange('pill_enabled', !enabled); 
    }
  };

  if (!settings) {
    // This tab might be rendered before settings are fully loaded in SettingsPage.
    // Or, settings could have failed to load.
    return <p className="text-neutral-400">Loading appearance settings...</p>; 
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-white">Appearance</h2>
      
      <div className="p-4 border border-neutral-700 rounded-md bg-neutral-800/30">
        <h3 className="text-md font-semibold mb-3 text-neutral-200">Recording Pill</h3>
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="pill-enabled-switch" className="text-neutral-300">
              Show Recording Pill
            </Label>
            <p className="text-xs text-neutral-500">
              Toggle the visibility of the always-on recording pill.
              Hotkeys will still work if hidden.
            </p>
          </div>
          <Switch
            id="pill-enabled-switch"
            checked={settings.pill_enabled}
            onCheckedChange={handlePillToggle}
            className="data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-neutral-600" // Example styling
          />
        </div>
      </div>

      {/* Placeholder for Light/Dark mode toggle - to be added later */}
      {/*
      <div className="p-4 border border-neutral-700 rounded-md bg-neutral-800/30 mt-6">
        <h3 className="text-md font-semibold mb-3 text-neutral-200">Theme</h3>
        <div className="flex items-center justify-between">
          <Label htmlFor="theme-switch" className="text-neutral-300">
            Enable Light Mode
          </Label>
          <Switch
            id="theme-switch"
            // checked={isLightMode} // State to be added
            // onCheckedChange={toggleTheme} // Function to be added
            disabled // Disabled for now
          />
        </div>
      </div>
      */}
    </div>
  );
};

export default AppearanceSettingsTab; 