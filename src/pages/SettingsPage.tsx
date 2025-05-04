import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { AppSettings } from '../types';
import { toast } from 'react-hot-toast';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Loader2 } from 'lucide-react';

function SettingsPage() {
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // Placeholder for About content - Define outside component or fetch if needed
    const aboutContent = {
        version: "0.1.0", // Replace with actual version
        licenses: [
            { name: "Fethr", text: "© 2024 Fethr Project. All rights reserved." },
            { name: "Whisper.cpp", text: "MIT License (Bundled). See https://github.com/ggerganov/whisper.cpp" },
            { name: "FFmpeg", text: "LGPL v2.1+ (Bundled). Source code used/modified can be obtained by contacting support@fethr.app." },
            { name: "Tauri", text: "MIT/Apache 2.0 License. See https://tauri.app" },
            { name: "React", text: "MIT License. See https://react.dev" },
        ]
    };

    // Fetch settings and available models
    useEffect(() => {
        async function loadData() {
            try {
                setIsLoading(true);
                setError(null);
                console.log("Fetching application settings and available models...");

                // Fetch settings and models in parallel
                const [settingsResult, modelsResult] = await Promise.all([
                    invoke<AppSettings>('get_settings'),
                    invoke<string[]>('get_available_models')
                ]);

                console.log("Fetched settings:", settingsResult);
                console.log("Fetched available models:", modelsResult);
                
                if (!settingsResult) {
                    throw new Error("Received empty settings from backend");
                }

                setSettings(settingsResult);
                setAvailableModels(modelsResult);
            } catch (err) {
                console.error('Error loading settings:', err);
                const errorMsg = err instanceof Error ? err.message : String(err);
                setError(`Failed to load settings: ${errorMsg}`);
                toast.error(`Settings load failed: ${errorMsg.substring(0, 50)}${errorMsg.length > 50 ? '...' : ''}`);
                
                // Set default empty models array if fetch failed
                setAvailableModels([]);
            } finally {
                setIsLoading(false);
            }
        }

        loadData();
    }, []);

    const handleSettingChange = (key: keyof AppSettings, value: string | boolean) => {
        console.log(`Updating setting: ${key} = ${value}`);
        setSettings(prev => prev ? { ...prev, [key]: value } : null);
    };

    const handleSave = async () => {
        if (!settings) {
            toast.error("No settings to save");
            return;
        }
        
        setIsSaving(true);
        setError(null);
        console.log("Saving settings:", settings);
        
        try {
            await invoke('save_settings', { settings });
            console.log("Settings saved successfully");
            toast.success("Settings saved successfully");
        } catch (err) {
            console.error('Error saving settings:', err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            setError(`Failed to save settings: ${errorMsg}`);
            toast.error(`Save failed: ${errorMsg.substring(0, 50)}${errorMsg.length > 50 ? '...' : ''}`);
        } finally {
            setIsSaving(false);
        }
    };

    // --- Render Logic ---
    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#0A0F1A] to-[#020409] text-[#A6F6FF]">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="ml-2 text-lg">Loading Settings...</span>
            </div>
        );
    }

    if (error && !settings) { // Show fatal error only if settings didn't load at all
        return <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[#0A0F1A] to-[#020409] text-[#FF4D6D] p-4">Error loading settings: {error}</div>;
    }

    // Render settings form (even if there was a non-fatal error during load/save)
    return (
         <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-[#0A0F1A] to-[#020409] p-4 font-sans text-white">
            {/* Optional: App Title/Logo */}
            {/* <img src="/path/to/fethr-logo.svg" alt="Fethr Logo" className="w-16 h-16 mb-4 filter drop-shadow-[0_0_5px_#A6F6FF]" /> */}

            <Card className="w-full max-w-lg bg-[#0A0F1A]/60 border border-[#A6F6FF]/20 backdrop-blur-md shadow-xl shadow-[#A6F6FF]/10">
                 <CardHeader>
                     <CardTitle className="text-xl font-semibold text-white tracking-wide flex items-center">
                         Fethr Settings
                     </CardTitle>
                     <CardDescription className="text-gray-400">
                         Configure transcription model, language, and behavior.
                     </CardDescription>
                 </CardHeader>
                 <CardContent className="space-y-6 pt-2 pb-6">
                    {/* Error Display Area */}
                    {error && <p className="text-sm text-[#FF4D6D] bg-[#FF4D6D]/10 p-2 rounded border border-[#FF4D6D]/30">{error}</p>}

                    {/* Model Selection */}
                    <div className="space-y-2">
                        <Label htmlFor="model-select" className="text-gray-300">Whisper Model</Label>
                        {settings ? (
                            <Select
                                value={settings.model_name}
                                onValueChange={(value: string) => handleSettingChange('model_name', value)}
                                disabled={isLoading || isSaving}
                            >
                                <SelectTrigger id="model-select" className="bg-[#0A0F1A] border-[#A6F6FF]/30 text-white">
                                    <SelectValue placeholder="Select a model" />
                                </SelectTrigger>
                                <SelectContent className="bg-[#0A0F1A] border-[#A6F6FF]/30 text-white">
                                    {availableModels.map(model => (
                                        <SelectItem key={model} value={model} className="focus:bg-[#A6F6FF]/20">
                                            {model}
                                        </SelectItem>
                                    ))}
                                    {availableModels.length === 0 && <SelectItem value="" disabled>No models found</SelectItem>}
                                </SelectContent>
                            </Select>
                        ) : <p className="text-gray-500">Loading models...</p>}
                    </div>

                    {/* Language Selection (Placeholder) */}
                     <div className="space-y-2 opacity-50 cursor-not-allowed" title="Language selection coming soon">
                        <Label htmlFor="language-select" className="text-gray-400">Language</Label>
                        <Select value={settings?.language || 'en'} onValueChange={() => {}} disabled>
                            <SelectTrigger id="language-select" className="bg-[#0A0F1A] border-[#A6F6FF]/30 text-gray-400">
                                <SelectValue placeholder="English" />
                            </SelectTrigger>
                            <SelectContent className="bg-[#0A0F1A] border-[#A6F6FF]/30 text-gray-400">
                                <SelectItem value="en">English</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-gray-500">Language selection will be available in a future update.</p>
                     </div>

                    {/* Auto-Paste Toggle */}
                    <div className="flex items-center justify-between space-x-2 pt-2">
                        <Label htmlFor="auto-paste-switch" className="text-gray-300 flex flex-col">
                            <span>Auto-Paste Transcription</span>
                            <span className="text-xs text-gray-500">Automatically paste result after transcription.</span>
                        </Label>
                        {settings ? (
                            <Switch
                                id="auto-paste-switch"
                                checked={settings.auto_paste}
                                onCheckedChange={(checked: boolean) => handleSettingChange('auto_paste', checked)}
                                disabled={isLoading || isSaving}
                                className="data-[state=checked]:bg-[#A6F6FF]/80 data-[state=unchecked]:bg-gray-600"
                            />
                        ) : <p className="text-gray-500">...</p>}
                    </div>

                 </CardContent>
                 <CardFooter className="flex justify-between border-t border-[#A6F6FF]/10 pt-4 pb-4">
                     {/* About Button */}
                     <Button 
                        variant="outline"
                        className="border border-[#8B9EFF]/50 text-[#8B9EFF] hover:bg-[#8B9EFF]/10 hover:text-[#8B9EFF]" 
                        onClick={() => toast.success("About Fethr\nVersion " + aboutContent.version)}
                        disabled={isSaving}
                     >
                        About Fethr
                     </Button>

                     {/* Save Button */}
                     <Button
                         className="bg-[#A6F6FF]/80 text-[#020409] hover:bg-[#A6F6FF] px-6"
                         onClick={handleSave}
                         disabled={isLoading || isSaving || !settings}
                     >
                         {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                         {isSaving ? "Saving..." : "Save"}
                     </Button>
                 </CardFooter>
             </Card>
         </div>
    );
}

export default SettingsPage; 