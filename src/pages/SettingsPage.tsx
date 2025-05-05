import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { AppSettings, HistoryEntry } from '../types';
import { toast } from 'react-hot-toast';

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Loader2, Copy } from 'lucide-react';
import { ScrollArea } from "@/components/ui/scroll-area";

// Language options for the dropdown
const languageOptions = [
    { code: 'auto', name: 'Auto-Detect' },
    { code: 'en', name: 'English' },
    { code: 'da', name: 'Danish' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ru', name: 'Russian' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'zh', name: 'Chinese (Simplified)' },
];

// Sort alphabetically by name - Keep Auto-Detect first
languageOptions.sort((a, b) => {
   if (a.code === 'auto') return -1;
   if (b.code === 'auto') return 1;
   return a.name.localeCompare(b.name);
});

function SettingsPage() {
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    
    // History state
    const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
    const [historyLoading, setHistoryLoading] = useState<boolean>(true);
    const [historyError, setHistoryError] = useState<string | null>(null);
    
    // Section state
    const [activeSection, setActiveSection] = useState<'general' | 'history'>('general'); // Default to 'general'

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

    // Define loadHistory function with useCallback
    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        setHistoryError(null);
        console.log("[History] Fetching history from backend...");
        try {
            const fetchedHistory = await invoke<HistoryEntry[]>('get_history');
            console.log(`[History] Fetched ${fetchedHistory.length} entries.`);
            setHistoryEntries(fetchedHistory);
        } catch (err) {
            console.error('[History] Error loading history:', err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            setHistoryError(`Failed to load history: ${errorMsg}`);
            toast.error(`History load failed: ${errorMsg.substring(0, 50)}${errorMsg.length > 50 ? '...' : ''}`);
        } finally {
            setHistoryLoading(false);
        }
    }, []); // Empty dependency array for useCallback

    // Fetch history entries and set up update listener
    useEffect(() => {
        async function setupHistoryAndListener() {
            // Initial history load
            await loadHistory();
            
            // Set up listener for history updates
            console.log("[History] Setting up history update listener.");
            const unlistenHistoryUpdate = await listen<void>('fethr-history-updated', () => {
                console.log("[History] Received fethr-history-updated event. Re-fetching history.");
                loadHistory(); // Call the existing load function
            });
            console.log("[History] History update listener setup.");
            
            // Return cleanup function
            return () => {
                console.log("[History] Cleaning up history update listener.");
                unlistenHistoryUpdate();
            };
        }
        
        setupHistoryAndListener();
    }, [loadHistory]); // Add loadHistory to dependency array

    const copyHistoryItem = useCallback((text: string) => {
        navigator.clipboard.writeText(text)
            .then(() => {
                toast.success("Copied to clipboard!");
            })
            .catch(err => {
                console.error("Failed to copy history text:", err);
                toast.error("Failed to copy text.");
            });
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
         <div className="flex flex-col items-center justify-start min-h-screen bg-gradient-to-br from-[#0A0F1A] to-[#020409] p-8 font-sans text-white relative shadow-lg shadow-[#A6F6FF]/5">
            
            {/* Replaced CardHeader - Removed max-width */}
            <div className="pt-6 w-full mx-auto mb-4"> 
                {/* Replaced CardTitle */}
                <h1 className="text-xl font-semibold text-white tracking-wide flex items-center">
                    Fethr Settings
                </h1>
                {/* Replaced CardDescription */}
                <p className="text-gray-400">
                    Configure transcription model, language, and behavior.
                </p>
            </div>
            
            {/* Flex container for sidebar and content - Removed max-width */}
            <div className="flex w-full mx-auto">
                {/* Sidebar Navigation */}
                <div className="w-48 flex-shrink-0 border-r border-[#A6F6FF]/10 pt-2 px-4 space-y-2">
                    <Button
                        variant="ghost"
                        onClick={() => setActiveSection('general')}
                        className={`w-full justify-start text-left px-3 py-2 rounded bg-transparent ${
                            activeSection === 'general'
                                ? 'bg-[#A6F6FF]/10 text-white'
                                : 'text-gray-400 hover:bg-[#A6F6FF]/5 hover:text-gray-200'
                        }`}
                    >
                        General
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => setActiveSection('history')}
                        className={`w-full justify-start text-left px-3 py-2 rounded bg-transparent ${
                            activeSection === 'history'
                                ? 'bg-[#A6F6FF]/10 text-white'
                                : 'text-gray-400 hover:bg-[#A6F6FF]/5 hover:text-gray-200'
                        }`}
                    >
                        History
                    </Button>

                    {/* Placeholder: AI Actions */}
                    <Button
                        variant="ghost"
                        disabled // Make it non-interactive for now
                        className="w-full justify-start text-left px-3 py-2 rounded text-gray-600 cursor-not-allowed" // Dimmed text, no hover effect
                        title="Coming soon"
                    >
                        AI Actions
                    </Button>

                    {/* Placeholder: Dictionary */}
                    <Button
                        variant="ghost"
                        disabled
                        className="w-full justify-start text-left px-3 py-2 rounded text-gray-600 cursor-not-allowed"
                        title="Coming soon"
                    >
                        Dictionary
                    </Button>

                    {/* Placeholder: Account */}
                    <Button
                        variant="ghost"
                        disabled
                        className="w-full justify-start text-left px-3 py-2 rounded text-gray-600 cursor-not-allowed"
                        title="Coming soon"
                    >
                        Account
                    </Button>
                </div>
                
                {/* Content Area - Adjusted padding */}
                <div className="flex-grow px-6 pt-2 pb-4"> {/* Adjusted py-4 to pt-2 pb-4 */}
                    {/* General Settings Section */}
                    {activeSection === 'general' && (
                        <div>
                            <h2 className="text-lg font-semibold mb-4 text-white">General Settings</h2>
                            
                            {/* General Settings Content */}
                            <div className="space-y-6">
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
                                            <SelectTrigger 
                                                id="model-select" 
                                                className="w-full bg-[#0A0F1A] border border-[#A6F6FF]/30 text-white ring-offset-[#020409] focus:ring-2 focus:ring-[#A6F6FF]/50 focus:ring-offset-2"
                                            >
                                                <SelectValue placeholder="Select a model" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#0A0F1A] border-[#A6F6FF]/30 text-white">
                                                {availableModels.map(model => (
                                                    <SelectItem key={model} value={model} className="focus:bg-[#A6F6FF]/20 text-white">
                                                        {model}
                                                    </SelectItem>
                                                ))}
                                                {availableModels.length === 0 && <SelectItem value="" disabled className="text-gray-400">No models found</SelectItem>}
                                            </SelectContent>
                                        </Select>
                                    ) : <p className="text-gray-400">Loading models...</p>}
                                </div>

                                {/* Language Selection */}
                                <div className="space-y-2">
                                    <Label htmlFor="language-select" className="text-gray-300">Language</Label>
                                    <Select 
                                        value={settings?.language || 'auto'} 
                                        onValueChange={(value: string) => handleSettingChange('language', value)}
                                        disabled={isLoading || isSaving}
                                    >
                                        <SelectTrigger 
                                            id="language-select" 
                                            className="w-full bg-[#0A0F1A] border border-[#A6F6FF]/30 text-white ring-offset-[#020409] focus:ring-2 focus:ring-[#A6F6FF]/50 focus:ring-offset-2"
                                        >
                                            <SelectValue placeholder="Select language" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-[#0A0F1A] border-[#A6F6FF]/30 text-white">
                                            {languageOptions.map(lang => (
                                                <SelectItem key={lang.code} value={lang.code} className="focus:bg-[#A6F6FF]/20 text-white">
                                                    {lang.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Auto-Paste Toggle */}
                                <div className="flex items-center justify-between space-x-2 pt-2">
                                    <Label htmlFor="auto-paste-switch" className="text-gray-300 flex flex-col">
                                        <span>Auto-Paste Transcription</span>
                                        <span className="text-xs text-gray-400">Automatically paste result after transcription.</span>
                                    </Label>
                                    {settings ? (
                                        <Switch
                                            id="auto-paste-switch"
                                            checked={settings.auto_paste}
                                            onCheckedChange={(checked: boolean) => handleSettingChange('auto_paste', checked)}
                                            disabled={isLoading || isSaving}
                                            className="data-[state=checked]:bg-[#A6F6FF]/80 data-[state=unchecked]:bg-gray-600"
                                        />
                                    ) : <p className="text-gray-400">...</p>}
                                </div>
                            </div>
                            
                            {/* Footer Buttons - No longer CardFooter */}
                            <div className="flex justify-between mt-6 pt-4 border-t border-[#A6F6FF]/10">
                                {/* About Button */}
                                <Button 
                                    variant="ghost"
                                    className="w-auto justify-start text-left px-3 py-2 rounded bg-[#8B9EFF]/10 text-[#ADC2FF] hover:bg-[#8B9EFF]/20 hover:text-white focus-visible:ring-[#8B9EFF]"
                                    onClick={() => toast.success("About Fethr\nVersion " + aboutContent.version)}
                                    disabled={isSaving}
                                >
                                    About fethr
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
                            </div>
                        </div>
                    )}
                    
                    {/* History Section */}
                    {activeSection === 'history' && (
                        <div className="flex flex-col h-full">
                            <h2 className="text-lg font-semibold mb-4 text-white flex-shrink-0">Transcription History</h2>
                            
                            {/* History Content */}
                            <div className="space-y-4 flex-grow">
                                {historyLoading && (
                                    <div className="flex items-center justify-center text-gray-400 py-8">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading history...
                                    </div>
                                )}
                                {historyError && (
                                    <p className="text-sm text-[#FF4D6D] bg-[#FF4D6D]/10 p-2 rounded border border-[#FF4D6D]/30">{historyError}</p>
                                )}
                                {!historyLoading && !historyError && historyEntries.length === 0 && (
                                    <p className="text-center text-gray-400 py-8">No transcription history yet.</p>
                                )}
                                {!historyLoading && !historyError && historyEntries.length > 0 && (
                                    <ScrollArea className="h-full max-h-[calc(100vh-250px)] flex-grow pr-4">
                                        <div className="space-y-4">
                                            {historyEntries.map((entry, index) => (
                                                <div key={index} className="p-3 bg-[#0A0F1A]/50 rounded border border-[#A6F6FF]/10 flex flex-col space-y-2">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-xs text-gray-400 font-mono">
                                                            {new Date(entry.timestamp).toLocaleString()}
                                                        </span>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="w-6 h-6 text-gray-400 hover:text-white hover:bg-[#A6F6FF]/10"
                                                            onClick={() => copyHistoryItem(entry.text)}
                                                            title="Copy Transcription"
                                                        >
                                                            <Copy className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                    <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">
                                                        {entry.text}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            {/* Positioned Icon */}
            <img
                src="/feather-logo.png" // Make sure this path is correct relative to your public folder
                alt="fethr icon"
                className="absolute bottom-6 left-6 w-6 h-6 opacity-30 filter drop-shadow-[0_0_3px_#A6F6FF]" // Adjust size, position, opacity
            />
        </div>
    );
}

export default SettingsPage; 