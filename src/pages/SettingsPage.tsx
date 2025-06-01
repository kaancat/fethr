import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import type { AppSettings, HistoryEntry } from '../types';
import { useToast } from "@/hooks/use-toast";
import { format } from 'date-fns';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Loader2, Copy, Trash2 } from 'lucide-react';
import { ScrollArea } from "@/components/ui/scroll-area";
import HistoryItemEditor from '../components/HistoryItemEditor';
import TextareaAutosize from 'react-textarea-autosize';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { LoginForm } from '@/components/LoginForm';
import DictionarySettingsTab from '../components/settings/DictionarySettingsTab';
import AppearanceSettingsTab from '../components/settings/AppearanceSettingsTab';

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

// Update Props Interface
interface SettingsPageProps {
    user: User | null;
    loadingAuth: boolean;
}

// Define UserProfile interface
interface UserProfile {
    id: string;
    email?: string; // Make email optional as it might not always be needed directly from profile
    subscription_status?: string;
    // Add other profile fields here later if needed
}

function SettingsPage({ user, loadingAuth }: SettingsPageProps) {
    const { toast } = useToast();
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
    const [activeSection, setActiveSection] = useState<'general' | 'history' | 'appearance' | 'audio' | 'ai_actions' | 'account' | 'dictionary'>('general');
    const [apiKey, setApiKey] = useState<string>('');
    const [isApiKeyValid, setIsApiKeyValid] = useState<boolean | null>(null);

    // State for viewing AI action prompts
    const [viewingPromptForActionId, setViewingPromptForActionId] = useState<string | null>(null);
    const [currentPromptText, setCurrentPromptText] = useState<string | null>(null);
    const [editedPromptText, setEditedPromptText] = useState<string | null>(null);
    const [isLoadingPrompt, setIsLoadingPrompt] = useState<boolean>(false);

    // State for User API Key
    const [userApiKey, setUserApiKey] = useState<string>('');
    const [apiKeyInput, setApiKeyInput] = useState<string>('');

    // Add State for Profile Data:
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loadingProfile, setLoadingProfile] = useState<boolean>(false);
    const [wordUsage, setWordUsage] = useState<number | null>(null);
    const [wordLimit, setWordLimit] = useState<number | null>(null);
    const [loadingUsage, setLoadingUsage] = useState<boolean>(false);

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
                toast({
                    variant: "destructive",
                    title: "Settings Load Failed",
                    description: errorMsg.substring(0, 100) + (errorMsg.length > 100 ? '...' : ''),
                });
                
                // Set default empty models array if fetch failed
                setAvailableModels([]);
            } finally {
                setIsLoading(false);
            }
        }

        loadData();
    }, [toast]);

    // useEffect to Load API Key from Local Storage on Mount
    useEffect(() => {
        const storedUserApiKey = localStorage.getItem('fethr_user_openrouter_api_key');
        if (storedUserApiKey) {
            setUserApiKey(storedUserApiKey);
            setApiKeyInput(storedUserApiKey); // Pre-fill input if key exists
            console.log("[Settings AI] Loaded user API key from local storage.");
        }
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
            toast({
                variant: "destructive",
                title: "History Load Failed",
                description: errorMsg.substring(0, 100) + (errorMsg.length > 100 ? '...' : ''),
            });
        } finally {
            setHistoryLoading(false);
        }
    }, [toast]); // Empty dependency array for useCallback

    // Fetch history entries and set up update listener
    useEffect(() => {
        async function setupHistoryAndListener() {
            // Initial history load
            await loadHistory();
            
            // Set up listener for history updates
            console.log("[History] Setting up history update listener.");
            const unlistenHistoryUpdate = await listen<void>('fethr-history-updated', () => {
                console.log('[SaveDebug] Received fethr-history-updated event. Fetching history...');
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
                toast({
                    title: "Copied!",
                    description: "Text copied to clipboard.",
                });
            })
            .catch(err => {
                console.error("Failed to copy history text:", err);
                toast({
                    variant: "destructive",
                    title: "Copy Failed",
                    description: "Could not copy text to clipboard.",
                });
            });
    }, [toast]);

    const handleSettingChange = (key: keyof AppSettings, value: string | boolean) => {
        console.log(`Updating setting: ${key} = ${value}`);
        setSettings(prev => prev ? { ...prev, [key]: value } : null);
    };

    const handleSave = async () => {
        if (!settings) {
            toast({
                variant: "destructive",
                title: "Save Error",
                description: "No settings to save.",
            });
            return;
        }
        
        setIsSaving(true);
        setError(null);
        console.log("Saving settings:", settings);
        
        try {
            await invoke('save_settings', { settings });
            console.log("Settings saved successfully");
            toast({
                title: "Settings Saved",
                description: "Your settings have been saved successfully.",
            });
        } catch (err) {
            console.error('Error saving settings:', err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            setError(`Failed to save settings: ${errorMsg}`);
            toast({
                variant: "destructive",
                title: "Save Failed",
                description: errorMsg.substring(0, 100) + (errorMsg.length > 100 ? '...' : ''),
            });
        } finally {
            setIsSaving(false);
        }
    };

    const [editingEntry, setEditingEntry] = useState<HistoryEntry | null>(null);

    // --- ADD HANDLERS for Edit --- 
    const handleCancelEdit = () => setEditingEntry(null);

    // --- REPLACE handleSaveEdit with Debug Version ---
    const handleSaveEdit = async (timestamp: string, newText: string) => {
        if (!newText.trim()) {
            toast({ variant: "destructive", title: "Save Error", description: "Transcription text cannot be empty." });
            return;
        }
        // Removed toast.loading() call here
        try {
            await invoke('update_history_entry', { timestamp, newText });
            toast({ title: "History Updated", description: "The history entry has been updated." });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            toast({ variant: "destructive", title: "Update Failed", description: `Failed to save update: ${errorMsg}` });
        } finally {
            setEditingEntry(null);
        }
    };
    // --- END REPLACE ---

    // --- Refined useEffect for Edit Latest Event --- 
    useEffect(() => {
        console.log("[SettingsPage] Setting up listener for fethr-edit-latest-history.");

        // Make the callback async
        const unlistenEditLatest = listen<void>('fethr-edit-latest-history', async (event) => {
            console.log("[SettingsPage] Received fethr-edit-latest-history event!", event);

            try {
                // --- Fetch latest history DIRECTLY --- 
                console.log("[SettingsPage] Event received. Fetching latest history BEFORE editing...");
                // Invoke get_history directly for guaranteed freshness *within this callback scope*
                const freshHistory = await invoke<HistoryEntry[]>('get_history');
                console.log(`[SettingsPage] Fresh history fetched (${freshHistory.length} entries). Now finding latest...`);

                // --- Now find the first entry (assuming newest first) --- 
                if (freshHistory && freshHistory.length > 0) {
                    const latestEntry = freshHistory[0]; // Get the newest entry
                    console.log("[SettingsPage] Found latest entry to edit:", latestEntry.timestamp);
                    setActiveSection('history'); // Switch to history tab
                    setEditingEntry(latestEntry); // Set the SPECIFIC entry to edit
                } else {
                    console.warn("[SettingsPage] Received edit latest event, but FRESH history list is empty.");
                    // Fallback: Just switch to history tab
                    setActiveSection('history');
                    setEditingEntry(null); // Ensure no previous edit state persists
                }

            } catch (error) {
                 console.error("[SettingsPage] Error during immediate edit handling (fetching/finding entry):", error);
                 setActiveSection('history'); // Still switch tab on error
                 setEditingEntry(null);
                 toast({
                    variant: "destructive",
                    title: "Load Error",
                    description: "Failed to load entry for editing.",
                 });
            }
        });

        // Cleanup function
        return () => {
             console.log("[SettingsPage] Cleaning up fethr-edit-latest-history listener.");
             unlistenEditLatest.then(f => f());
        };

    }, [setActiveSection, setEditingEntry]); // Update dependencies - we don't directly use historyEntries state *within* the listener logic anymore for finding the item, but loadHistory might be needed if it does more than just fetch. Let's keep it minimal for now.
    // --- END REFINED useEffect --- 

    // Define DEFAULT_AI_ACTIONS
    const DEFAULT_AI_ACTIONS = [
        { id: 'written_form', name: 'Written Form', description: 'Converts spoken text to clean, written text while preserving tone.' },
        { id: 'summarize', name: 'Summarize', description: 'Provides a concise summary highlighting key points.' },
        { id: 'email', name: 'Email Mode', description: 'Formats text as a professional email body.' },
        { id: 'promptify', name: 'Promptify', description: 'Refines spoken ideas into effective AI prompts.' }
    ];

    const handleViewPrompt = async (actionId: string) => {
        if (viewingPromptForActionId === actionId && !isLoadingPrompt) {
            setViewingPromptForActionId(null);
            // Consider if editedPromptText should be cleared or preserved on toggle
            // setEditedPromptText(currentPromptText); // Option: reset edits on hide
            return;
        }
        setIsLoadingPrompt(true);
        setViewingPromptForActionId(actionId);
        setCurrentPromptText(null);
        setEditedPromptText(null);

        try {
            let promptToDisplay: string | null = null;
            // Try to get custom prompt first
            console.log(`[Settings AI] Attempting to fetch custom prompt for: ${actionId}`);
            const customPrompt = await invoke<string | null>('get_custom_prompt', { actionId });

            if (customPrompt) {
                console.log(`[Settings AI] Found custom prompt for ${actionId}`);
                promptToDisplay = customPrompt;
            } else {
                console.log(`[Settings AI] No custom prompt found for ${actionId}, fetching default.`);
                promptToDisplay = await invoke<string>('get_default_prompt_for_action', { actionId });
            }
            setCurrentPromptText(promptToDisplay);
            setEditedPromptText(promptToDisplay);

        } catch (error) {
            console.error(`[Settings AI] Error loading prompt for ${actionId}:`, error);
            const errorMsg = `Failed to load prompt for ${actionId}.`;
            toast({
                variant: "destructive",
                title: "Load Error",
                description: errorMsg,
            });
            setCurrentPromptText(errorMsg);
            setEditedPromptText(errorMsg);
        } finally {
            setIsLoadingPrompt(false);
        }
    };

    const handleSaveUserApiKey = () => {
        const trimmedKey = apiKeyInput.trim();

        if (!trimmedKey) {
            // If input is empty, clear any existing saved key
            handleClearUserApiKey();
            return;
        }

        // Basic format check for OpenRouter keys
        if (trimmedKey.startsWith('sk-or-v1-') && trimmedKey.length > 15) { // Check prefix and a reasonable minimum length
            localStorage.setItem('fethr_user_openrouter_api_key', trimmedKey);
            setUserApiKey(trimmedKey);
            toast({ 
                title: "Success!",
                description: "API Key saved!",
            });
            console.log("[Settings AI] User API Key saved to local storage.");
        } else {
            toast({ 
                variant: "destructive",
                title: "Invalid API Key",
                description: "OpenRouter keys typically start with 'sk-or-v1-'. Please check your key.",
            });
            console.log("[Settings AI] AFTER shadcn toast for invalid format was called."); 
            console.warn("[Settings AI] Invalid API Key format entered by user:", apiKeyInput);
        }
    };

    const handleClearUserApiKey = () => {
        localStorage.removeItem('fethr_user_openrouter_api_key');
        setUserApiKey('');
        setApiKeyInput('');
        toast({ title: "API Key Cleared" }); 
        console.log("[Settings AI] User API Key cleared from local storage.");
    };

    // Function to fetch user's subscription and usage
    const fetchSubscriptionUsage = useCallback(async () => {
        if (!user) {
            console.log("[SettingsPage] No user, skipping subscription usage fetch.");
            setProfile(null);
            setWordUsage(null);
            setWordLimit(null);
            return;
        }

        setLoadingProfile(true);
        setLoadingUsage(true);
        console.log("[SettingsPage] Fetching profile and subscription usage for user:", user.id);

        try {
            const currentUserId = user.id;

            // Fetch profile data (if needed separately, or rely on subscription data)
            const { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('id, email, subscription_status')
                .eq('id', currentUserId)
                .single();

            if (profileError) {
                console.error('[SettingsPage] Error fetching profile:', profileError.message);
                // Don't toast error for profile, as subscription is the primary focus for usage
            } else if (profileData) {
                setProfile(profileData as UserProfile);
                console.log('[SettingsPage] Profile data fetched:', profileData);
            }

            // Fetch subscription usage data
            const { data, error } = await supabase
                .from('subscriptions')
                .select('word_usage_this_period, word_limit_this_period, status, current_period_end') // Fetch status and current_period_end
                .eq('user_id', currentUserId)
                .in('status', ['active', 'trialing']) // Ensure we only get active or trialing subscriptions
                .order('current_period_end', { ascending: false }); // Get the one ending latest first

            if (error) {
                console.error('[SettingsPage] Error fetching subscription usage:', error.message);
                toast({
                    variant: "destructive",
                    title: "Usage Fetch Error",
                    description: `Error fetching usage: ${error.message}`,
                });
                setWordUsage(null);
                setWordLimit(null);
            } else if (data && data.length > 0) {
                if (data.length > 1) {
                    console.warn('[SettingsPage] Multiple active/trialing subscriptions found for user. Using the first one based on current_period_end:', data);
                    toast({
                        title: "Account Warning",
                        description: "Multiple active subscriptions found. Please contact support.",
                        variant: "destructive"
                    });
                }
                const primarySubscription = data[0]; // Take the first one (latest ending)
                console.log('[SettingsPage] Subscription usage data (primary):', primarySubscription);
                setWordUsage(primarySubscription.word_usage_this_period);
                setWordLimit(primarySubscription.word_limit_this_period);
            } else {
                console.log('[SettingsPage] No active or trialing subscription found for usage details.');
                setWordUsage(0); 
                setWordLimit(0); // Assuming 0 limit for no active subscription, or fetch free tier default
            }

        } catch (err) {
            console.error('[SettingsPage] Unexpected error in fetchSubscriptionUsage:', err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            toast({
                variant: "destructive",
                title: "Account Details Error",
                description: `Failed to load account details: ${errorMsg}`,
            });
            setProfile(null);
            setWordUsage(null);
            setWordLimit(null);
        } finally {
            setLoadingProfile(false);
            setLoadingUsage(false);
        }
    }, [user, toast]); // Dependencies: user, toast

    // Effect to fetch profile and usage when user object is available or changes
    useEffect(() => {
        if (user?.id) {
            fetchSubscriptionUsage();
        } else {
            setProfile(null);
            setWordUsage(null);
            setWordLimit(null);
        }
    }, [user, fetchSubscriptionUsage]); // Added fetchSubscriptionUsage to dependencies

    // --- Listener for word usage updates ---
    useEffect(() => {
        console.log('[SettingsPage] Setting up listener for "word_usage_updated".');
        const unlistenWordUsageUpdate = listen<void>('word_usage_updated', (event) => {
            console.log('%c[SettingsPage] EVENT RECEIVED: "word_usage_updated"!', 'color: green; font-weight: bold; font-size: 1.2em;', event);
            if (user?.id) {
                console.log('%c[SettingsPage] REFRESHING USAGE from event for user:', 'color: green; font-weight: bold;', user.id);
                fetchSubscriptionUsage();
            } else {
                console.log('[SettingsPage] "word_usage_updated" event received, but no user logged in. Skipping refresh.');
            }
        });

        return () => {
            console.log('[SettingsPage] Cleaning up "word_usage_updated" listener.');
            unlistenWordUsageUpdate.then(f => f());
        };
    }, [user, fetchSubscriptionUsage]); // Dependencies: user and fetchSubscriptionUsage

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
                    fethr settings
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
                        History Editor
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => setActiveSection('ai_actions')}
                        className={`w-full justify-start text-left px-3 py-2 rounded bg-transparent ${
                            activeSection === 'ai_actions'
                                ? 'bg-[#A6F6FF]/10 text-white'
                                : 'text-gray-400 hover:bg-[#A6F6FF]/5 hover:text-gray-200'
                        }`}
                    >
                        AI Actions
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => setActiveSection('dictionary')}
                        className={`w-full justify-start text-left px-3 py-2 rounded bg-transparent ${
                            activeSection === 'dictionary'
                                ? 'bg-[#A6F6FF]/10 text-white'
                                : 'text-gray-400 hover:bg-[#A6F6FF]/5 hover:text-gray-200'
                        }`}
                    >
                        Dictionary
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => setActiveSection('account')}
                        className={`w-full justify-start text-left px-3 py-2 rounded bg-transparent ${
                            activeSection === 'account'
                                ? 'bg-[#A6F6FF]/10 text-white'
                                : 'text-gray-400 hover:bg-[#A6F6FF]/5 hover:text-gray-200'
                        }`}
                    >
                        Account
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => setActiveSection('appearance')}
                        className={`w-full justify-start text-left px-3 py-2 rounded bg-transparent ${
                            activeSection === 'appearance'
                                ? 'bg-[#A6F6FF]/10 text-white'
                                : 'text-gray-400 hover:bg-[#A6F6FF]/5 hover:text-gray-200'
                        }`}
                        title="Appearance Settings"
                    >
                        Appearance
                    </Button>
                    <Button
                        variant="ghost"
                        disabled
                        onClick={() => {/* Placeholder */}}
                        className="w-full justify-start text-left px-3 py-2 rounded bg-transparent text-gray-600 cursor-not-allowed"
                        title="Coming soon"
                    >
                        Audio
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
                                    onClick={() => toast({title: "About Fethr", description: "Version " + aboutContent.version})}
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
                            <h2 className="text-lg font-semibold mb-4 text-white flex-shrink-0">History Editor</h2>
                            
                            <ScrollArea className="h-full flex-grow pr-4 max-h-[calc(100vh-250px)]">
                                <div className="space-y-4">
                                    {historyLoading && (
                                        <div className="flex items-center justify-center text-gray-400 py-8">
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading history...
                                        </div>
                                    )}
                                    {historyError && (
                                        <p className="text-sm text-[#FF4D6D] bg-[#FF4D6D]/10 p-2 rounded border border-[#FF4D6D]/30">{historyError}</p>
                                    )}
                                    
                                    {!historyLoading && !historyError && (
                                        <>
                                          {editingEntry ? (
                                            <HistoryItemEditor
                                                key={editingEntry.timestamp}
                                                entry={editingEntry}
                                                onSave={handleSaveEdit}
                                                onCancel={handleCancelEdit}
                                            />
                                          ) : (
                                            historyEntries.length > 0 ? (
                                                historyEntries.map((entry) => (
                                                    <div key={entry.timestamp} className="p-3 bg-[#0A0F1A]/50 rounded border border-[#A6F6FF]/10 flex flex-col space-y-2">
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-xs text-gray-400 font-mono">
                                                                {format(new Date(entry.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                                                            </span>
                                                            <div className="flex space-x-1 flex-shrink-0">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="w-6 h-6 text-gray-400 hover:text-green-400 hover:bg-green-900/30"
                                                                    onClick={() => {
                                                                        setEditingEntry(entry);
                                                                    }}
                                                                    title="Edit Transcription"
                                                                >
                                                                    <img src="/Icons/edit icon.png" alt="Edit" className="w-5 h-5" />
                                                                </Button>
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
                                                        </div>
                                                        <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">
                                                            {entry.text}
                                                        </p>
                                                    </div>
                                                ))
                                            ) : (
                                                <p className="text-center text-gray-400 py-8">No transcription history yet.</p>
                                            )
                                          )}
                                        </>
                                    )}
                                </div>
                            </ScrollArea>
                        </div>
                    )}

                    {/* AI Actions Section */}
                    {activeSection === 'ai_actions' && (
                        <ScrollArea className="h-full max-h-[calc(100vh-200px)] flex-grow pr-4">
                            <div>
                                <h2 className="text-lg font-semibold mb-4 text-white">AI Action Settings</h2>
                                <p className="text-sm text-gray-400 mb-6">
                                    Configure your OpenRouter API key and customize the prompts used for AI actions.
                                    Fethr uses <a href="https://openrouter.ai/docs" target="_blank" rel="noopener noreferrer" className="text-[#A6F6FF] hover:underline">OpenRouter.ai</a> to provide access to various large language models.
                                </p>

                                {/* AI Prompts Customization Section - MOVED UP */}
                                <div>
                                    <h3 className="text-md font-semibold mb-3 text-gray-200">Customize AI Prompts</h3>
                                    <p className="text-xs text-gray-400 mb-4">
                                        View and modify the default prompts used for each AI action. Changes are saved automatically.
                                    </p>
                                    <div className="space-y-3">
                                        {DEFAULT_AI_ACTIONS.map(action => (
                                            <div key={action.id} className="p-3 border border-[#A6F6FF]/15 rounded-md bg-[#0A0F1A]/40">
                                                <div className="flex justify-between items-center">
                                                    <div>
                                                        <h4 className="font-medium text-gray-100">{action.name}</h4>
                                                        <p className="text-xs text-gray-400">{action.description}</p>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleViewPrompt(action.id)}
                                                        className="text-xs text-[#A6F6FF] hover:bg-[#A6F6FF]/10 hover:text-white"
                                                    >
                                                        {viewingPromptForActionId === action.id && !isLoadingPrompt ? 'Hide Prompt' : 'View/Edit Prompt'}
                                                        {viewingPromptForActionId === action.id && isLoadingPrompt && <Loader2 className="ml-2 h-3 w-3 animate-spin" />}
                                                    </Button>
                                                </div>
                                                {viewingPromptForActionId === action.id && (
                                                    <div className="mt-3 pt-3 border-t border-[#A6F6FF]/10">
                                                        {isLoadingPrompt ? (
                                                            <div className="flex items-center text-gray-400">
                                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading prompt...
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <TextareaAutosize
                                                                    minRows={3}
                                                                    value={editedPromptText ?? ''}
                                                                    onChange={(e) => setEditedPromptText(e.target.value)}
                                                                    className="w-full bg-[#020409]/70 border border-[#A6F6FF]/25 text-gray-200 text-sm rounded-md p-2 focus:border-[#A6F6FF]/60 focus:ring-1 focus:ring-[#A6F6FF]/60 resize-none"
                                                                />
                                                                <div className="mt-2 flex justify-end space-x-2">
                                                                    <Button
                                                                        size="sm" /* Changed from xs */ variant="outline"
                                                                        className="text-xs px-2 py-1 h-auto border-[#FFB4A6]/30 bg-transparent text-[#FFC8B8] hover:bg-[#FFB4A6]/10 hover:text-white focus-visible:ring-[#FFB4A6]"
                                                                        onClick={async () => {
                                                                            try {
                                                                                await invoke('delete_custom_prompt', { actionId: action.id });
                                                                                setEditedPromptText(await invoke<string>('get_default_prompt_for_action', { actionId: action.id }));
                                                                                setCurrentPromptText(editedPromptText); // update current to match new default
                                                                                toast({ title: "Prompt Reset", description: "Prompt has been reset to default." });
                                                                            } catch (error) {
                                                                                toast({ variant: "destructive", title: "Reset Error", description: "Failed to reset prompt." });
                                                                            }
                                                                        }}
                                                                    >
                                                                        Reset to Default
                                                                    </Button>
                                                                    <Button
                                                                        size="sm" /* Changed from xs */
                                                                        className="text-xs px-2 py-1 h-auto bg-[#A6F6FF]/80 text-[#020409] hover:bg-[#A6F6FF]"
                                                                        disabled={editedPromptText === currentPromptText || editedPromptText === null}
                                                                        onClick={async () => {
                                                                            if (editedPromptText !== null) {
                                                                                try {
                                                                                    await invoke('save_custom_prompt', { actionId: action.id, customPrompt: editedPromptText });
                                                                                    setCurrentPromptText(editedPromptText);
                                                                                    toast({ title: "Prompt Saved", description: "Custom prompt has been saved." });
                                                                                } catch (error) {
                                                                                    toast({ variant: "destructive", title: "Save Error", description: "Failed to save custom prompt." });
                                                                                }
                                                                            }
                                                                        }}
                                                                    >
                                                                        Save Custom Prompt
                                                                    </Button>
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* API Key Management Section - MOVED DOWN */}
                                <div className="mt-8 p-4 border border-[#A6F6FF]/20 rounded-md bg-[#0A0F1A]/50"> {/* Added mt-8 for spacing */}
                                    <h3 className="text-md font-semibold mb-2 text-gray-200">OpenRouter API Key</h3>
                                    <p className="text-xs text-gray-400 mb-3">
                                        Your API key is stored locally and never sent to Fethr servers.
                                        {userApiKey && " An API key is currently saved."}
                                    </p>
                                    <div className="flex items-center space-x-2">
                                        <Input
                                            type="password"
                                            id="api-key-input"
                                            placeholder="Enter your OpenRouter API key (e.g., sk-or-v1-...)"
                                            value={apiKeyInput}
                                            onChange={(e) => setApiKeyInput(e.target.value)}
                                            className="flex-grow bg-[#020409]/70 border-[#A6F6FF]/25 text-gray-200 focus:border-[#A6F6FF]/60 focus:ring-1 focus:ring-[#A6F6FF]/60"
                                        />
                                        <Button
                                            onClick={handleSaveUserApiKey}
                                            size="sm"
                                            className="bg-[#A6F6FF]/80 text-[#020409] hover:bg-[#A6F6FF]"
                                        >
                                            Save Key
                                        </Button>
                                        {userApiKey && (
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={handleClearUserApiKey}
                                                className="bg-red-700/80 text-white hover:bg-red-600"
                                            >
                                                Clear Key
                                            </Button>
                                        )}
                                    </div>
                                    {isApiKeyValid === false && ( // This state is not currently used, but kept for potential future validation UI
                                        <p className="text-xs text-red-400 mt-1">The entered API key appears to be invalid.</p>
                                    )}
                                </div>
                            </div>
                        </ScrollArea>
                    )}

                    {/* Dictionary Settings Section */}
                    {activeSection === 'dictionary' && (
                        <DictionarySettingsTab currentModelName={settings?.model_name || ''} />
                    )}

                    {/* Appearance Settings Section - NEW CASE */}
                    {activeSection === 'appearance' && (
                        <AppearanceSettingsTab 
                            settings={settings} 
                            onSettingChange={handleSettingChange} 
                        />
                    )}

                    {/* Account Section */} 
                    {activeSection === 'account' && (
                        <div className="flex flex-col h-full">
                            <h2 className="text-lg font-semibold mb-6 text-white flex-shrink-0">
                                Account
                            </h2>

                            {loadingAuth ? (
                                <p className="text-gray-400">Loading account status...</p>
                            ) : user ? (
                                // Logged In State - Updated with Profile Info
                                <div className="space-y-4">
                                    <p className="text-gray-300">
                                        Logged in as: <span className="font-medium text-white">{user.email}</span>
                                    </p>

                                    {/* Display Profile Info */} 
                                    {loadingProfile && <p className="text-sm text-gray-400">Loading profile details...</p>}
                                    {!loadingProfile && profile && (
                                        <div className="text-sm space-y-1">
                                            <p className="text-gray-400">
                                                Subscription: <span className="font-medium capitalize text-[#A6F6FF]">{profile.subscription_status || 'Unknown'}</span>
                                            </p>
                                            {/* TODO: Add "Manage Subscription" button later */} 
                                        </div>
                                    )}
                                    {!loadingProfile && !profile && user && (
                                        <p className="text-sm text-yellow-400">Could not load profile details. Try again later.</p>
                                    )}

                                    {/* Word Usage Display */}
                                    {wordLimit !== null && wordUsage !== null && user && (
                                        <p className="text-sm text-gray-400 mt-1">
                                            Word Usage: {wordUsage.toLocaleString()} / {wordLimit === 999999999 ? 'Unlimited' : wordLimit.toLocaleString()}
                                        </p>
                                    )}
                                    {loadingUsage && <p className="text-sm text-gray-500 mt-1">Loading usage...</p>}

                                    <Button
                                        variant="destructive"
                                        onClick={async () => {
                                            const { error } = await supabase.auth.signOut();
                                            if (error) {
                                                console.error("Error logging out:", error);
                                                toast({ variant: "destructive", title: "Logout Failed", description: error.message });
                                            } else {
                                                toast({ title: "Logged out successfully." });
                                                // User state will update via the listener in App.tsx
                                            }
                                        }}
                                    >
                                        Log Out
                                    </Button>
                                </div>
                            ) : (
                                // Logged Out State - Keep LoginForm
                                <div className="space-y-4 w-full max-w-sm">
                                    {/* --- Login Form Area --- */}
                                    <div className="p-4 border border-gray-700 rounded-md bg-gray-800/30">
                                        <h3 className="text-md font-semibold text-center mb-4">Login to Fethr</h3>
                                        <LoginForm />
                                    </div>
                                    {/* --- End Login Form Area --- */}
                                </div>
                            )}
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