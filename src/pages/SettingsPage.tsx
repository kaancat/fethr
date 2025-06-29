import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/api/shell';
import type { AppSettings, HistoryEntry } from '../types';
import { useToast } from "@/hooks/use-toast";
import { format } from 'date-fns';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Crown, RefreshCw, Copy } from 'lucide-react';
import TextareaAutosize from 'react-textarea-autosize';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { LoginForm } from '@/components/LoginForm';
import SettingsSection from '../components/SettingsSection';

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
    
    
    // Tab state
    const [activeTab, setActiveTab] = useState<'general' | 'ai_actions' | 'account'>('general');
    const [lastPaymentCheck, setLastPaymentCheck] = useState<number>(0);

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
    const lastUpdateTimeRef = useRef(0);
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

    // Reload settings when user changes (login/logout)
    useEffect(() => {
        if (!loadingAuth) {
            console.log("[SettingsPage] User auth state changed, reloading settings...");
            const loadData = async () => {
                try {
                    const settingsResult = await invoke<AppSettings>('get_settings');
                    if (settingsResult) {
                        setSettings(settingsResult);
                        console.log("Reloaded settings after auth change:", settingsResult);
                    }
                } catch (err) {
                    console.error("Failed to reload settings after auth change:", err);
                }
            };
            loadData();
        }
    }, [user, loadingAuth]);

    // useEffect to Load API Key from Local Storage on Mount
    useEffect(() => {
        const storedUserApiKey = localStorage.getItem('fethr_user_openrouter_api_key');
        if (storedUserApiKey) {
            setUserApiKey(storedUserApiKey);
            setApiKeyInput(storedUserApiKey); // Pre-fill input if key exists
            console.log("[Settings AI] Loaded user API key from local storage.");
        }
    }, []);


    const handleSettingChange = async (key: keyof AppSettings, value: string | boolean) => {
        console.log(`Updating setting: ${key} = ${value}`);
        setSettings(prev => prev ? { ...prev, [key]: value } : null);
        
        // Apply pill visibility immediately
        if (key === 'pill_enabled') {
            try {
                await invoke('set_pill_visibility', { visible: value as boolean });
                console.log(`Pill visibility set to: ${value}`);
            } catch (err) {
                console.error('Failed to set pill visibility:', err);
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: "Failed to toggle pill visibility",
                });
            }
        }
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


 

    // Navigation event listener for system tray context menu
    useEffect(() => {
        console.log("[SettingsPage] Setting up listener for navigate-to-section.");

        const unlistenNavigate = listen<string>('navigate-to-section', (event) => {
            console.log("[SettingsPage] Received navigate-to-section event:", event.payload);
            const tab = event.payload as 'general' | 'ai_actions' | 'account';
            setActiveTab(tab);
        });

        // Cleanup function
        return () => {
            console.log("[SettingsPage] Cleaning up navigate-to-section listener.");
            unlistenNavigate.then(f => f());
        };
    }, [setActiveTab]);

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
    const fetchSubscriptionUsage = useCallback(async (skipLoadingState = false) => {
        if (!user) {
            console.log("[SettingsPage] No user, skipping subscription usage fetch.");
            setProfile(null);
            setWordUsage(null);
            setWordLimit(null);
            return;
        }

        // Debounce: Skip if we just updated less than 2 seconds ago
        const now = Date.now();
        if (skipLoadingState && now - lastUpdateTimeRef.current < 2000) {
            console.log('[SettingsPage] Skipping update - too soon since last update');
            return;
        }
        
        lastUpdateTimeRef.current = now;
        if (!skipLoadingState) {
            setLoadingProfile(true);
            setLoadingUsage(true);
        }
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
            if (!skipLoadingState) {
                setLoadingProfile(false);
                setLoadingUsage(false);
            }
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
                // Add delay to ensure backend has processed
                setTimeout(() => fetchSubscriptionUsage(true), 1500); // Skip loading state
            } else {
                console.log('[SettingsPage] "word_usage_updated" event received, but no user logged in. Skipping refresh.');
            }
        });

        return () => {
            console.log('[SettingsPage] Cleaning up "word_usage_updated" listener.');
            unlistenWordUsageUpdate.then(f => f());
        };
    }, [user, fetchSubscriptionUsage]); // Dependencies: user and fetchSubscriptionUsage

    // --- Listener for subscription updates (from payment success) ---
    useEffect(() => {
        console.log('[SettingsPage] Setting up listener for "subscription-updated".');
        const unlistenSubscriptionUpdate = listen<{ userId: string }>('subscription-updated', (event) => {
            console.log('%c[SettingsPage] EVENT RECEIVED: "subscription-updated"!', 'color: blue; font-weight: bold; font-size: 1.2em;', event);
            if (user?.id && event.payload.userId === user.id) {
                console.log('%c[SettingsPage] REFRESHING SUBSCRIPTION DATA from payment success!', 'color: blue; font-weight: bold;', user.id);
                fetchSubscriptionUsage();
            } else {
                console.log('[SettingsPage] "subscription-updated" event received, but user ID mismatch or no user. Skipping refresh.');
            }
        });

        return () => {
            console.log('[SettingsPage] Cleaning up "subscription-updated" listener.');
            unlistenSubscriptionUpdate.then(f => f());
        };
    }, [user, fetchSubscriptionUsage]); // Dependencies: user and fetchSubscriptionUsage

    // --- Force refresh when switching to account tab (backup mechanism) ---
    useEffect(() => {
        if (activeTab === 'account' && user) {
            const now = Date.now();
            const timeSinceLastCheck = now - lastPaymentCheck;
            
            // If it's been less than 2 minutes since last check, force refresh (user might have just paid)
            if (timeSinceLastCheck < 120000) {
                console.log('[SettingsPage] Account section activated recently, force refreshing subscription...');
                fetchSubscriptionUsage();
            }
            
            setLastPaymentCheck(now);
        }
    }, [activeTab, user, fetchSubscriptionUsage, lastPaymentCheck]);

    // Handle subscription upgrade
    const handleInitiateSubscription = useCallback(async () => {
        try {
            toast({ title: "Opening checkout...", description: "Redirecting to payment page" });
            
            // Get session token for authentication
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError || !session) {
                throw new Error('Authentication required');
            }

            // Call Supabase Edge Function using proper client
            const { data, error } = await supabase.functions.invoke('create-checkout', {
                body: {
                    priceId: 'price_pro_monthly_usd_7' // Internal price ID
                },
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                }
            });

            if (error) {
                throw new Error(error.message || 'Failed to create checkout session');
            }

            if (!data?.url) {
                throw new Error('No checkout URL received');
            }

            // Open checkout in default browser using shell
            await open(data.url);
            toast({ title: "Checkout opened", description: "Complete your payment in the browser" });

        } catch (error) {
            console.error('Subscription error:', error);
            toast({ 
                variant: "destructive", 
                title: "Checkout Failed", 
                description: error instanceof Error ? error.message : 'Unknown error occurred' 
            });
        }
    }, [toast]);

    // --- Render Logic ---
    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-[#0b0719] text-[#87CEFA]">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="ml-2 text-lg">Loading Settings...</span>
            </div>
        );
    }

    if (error && !settings) { // Show fatal error only if settings didn't load at all
        return <div className="flex items-center justify-center min-h-screen bg-[#0b0719] text-[#FF4D6D] p-4">Error loading settings: {error}</div>;
    }

    // Show only Account tab for logged-out users
    if (!loadingAuth && !user) {
        return (
            <div className="h-full flex flex-col p-8">
                <div className="max-w-5xl mx-auto w-full flex flex-col h-full">
                    <div className="mb-6">
                        <h1 className="text-3xl font-semibold text-white mb-2">Settings</h1>
                        <p className="text-neutral-400">
                            Sign in to access all settings
                        </p>
                    </div>
                    
                    {/* Only show Account tab for logged-out users */}
                    <div className="border-b border-neutral-800">
                        <nav className="flex space-x-8">
                            <button
                                className="py-2 px-1 relative font-medium text-sm text-white"
                            >
                                Account
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#8A2BE2]" />
                            </button>
                        </nav>
                    </div>
                    
                    {/* Account Tab Content */}
                    <ScrollArea className="mt-6 flex-1">
                        <div className="max-w-2xl">
                            <SettingsSection title="Authentication" description="Sign in to unlock all features">
                                <LoginForm />
                            </SettingsSection>
                        </div>
                    </ScrollArea>
                </div>
            </div>
        );
    }

    // Render full settings for authenticated users
    return (
        <div className="h-full flex flex-col p-8">
            <div className="max-w-5xl mx-auto w-full flex flex-col h-full">
                <div className="mb-6">
                    <h1 className="text-3xl font-semibold text-white mb-2">Settings</h1>
                    <p className="text-neutral-400">
                        Configure your Fethr experience
                    </p>
                </div>
                
                {/* Tab Navigation */}
                <div className="border-b border-neutral-800">
                    <nav className="flex space-x-8">
                        <button
                            onClick={() => setActiveTab('general')}
                            className={`py-2 px-1 relative font-medium text-sm transition-colors ${
                                activeTab === 'general'
                                    ? 'text-white'
                                    : 'text-neutral-400 hover:text-neutral-200'
                            }`}
                        >
                            General
                            {activeTab === 'general' && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#8A2BE2]" />
                            )}
                        </button>
                        <button
                            onClick={() => setActiveTab('ai_actions')}
                            className={`py-2 px-1 relative font-medium text-sm transition-colors ${
                                activeTab === 'ai_actions'
                                    ? 'text-white'
                                    : 'text-neutral-400 hover:text-neutral-200'
                            }`}
                        >
                            AI & Actions
                            {activeTab === 'ai_actions' && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#8A2BE2]" />
                            )}
                        </button>
                        <button
                            onClick={() => setActiveTab('account')}
                            className={`py-2 px-1 relative font-medium text-sm transition-colors ${
                                activeTab === 'account'
                                    ? 'text-white'
                                    : 'text-neutral-400 hover:text-neutral-200'
                            }`}
                        >
                            Account
                            {activeTab === 'account' && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#8A2BE2]" />
                            )}
                        </button>
                    </nav>
                </div>
                
                {/* Tab Content - Scrollable area */}
                <ScrollArea className="mt-6 flex-1">
                    {/* General Tab */}
                    {activeTab === 'general' && (
                        <SettingsSection>
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
                                                className="w-full bg-[#0b0719] border border-[#8A2BE2]/30 text-white ring-offset-[#020409] focus:ring-2 focus:ring-[#8A2BE2]/50 focus:ring-offset-2"
                                            >
                                                <SelectValue placeholder="Select a model" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#0b0719] border-[#8A2BE2]/30 text-white">
                                                {availableModels.map(model => (
                                                    <SelectItem key={model} value={model} className="focus:bg-[#8A2BE2]/20 text-white">
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
                                            className="w-full bg-[#0b0719] border border-[#8A2BE2]/30 text-white ring-offset-[#020409] focus:ring-2 focus:ring-[#8A2BE2]/50 focus:ring-offset-2"
                                        >
                                            <SelectValue placeholder="Select language" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-[#0b0719] border-[#8A2BE2]/30 text-white">
                                            {languageOptions.map(lang => (
                                                <SelectItem key={lang.code} value={lang.code} className="focus:bg-[#8A2BE2]/20 text-white">
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
                                            className="data-[state=checked]:bg-[#8A2BE2]/80 data-[state=unchecked]:bg-gray-600"
                                        />
                                    ) : <p className="text-gray-400">...</p>}
                                </div>
                                
                                {/* Appearance Settings */}
                                <div className="pt-6 mt-6 border-t border-neutral-800">
                                    <h3 className="text-md font-semibold mb-4 text-neutral-200">Appearance</h3>
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="pill-enabled-switch" className="text-gray-300 flex flex-col">
                                            <span>Show Recording Pill</span>
                                            <span className="text-xs text-gray-400">Toggle the visibility of the always-on recording pill.</span>
                                        </Label>
                                        {settings ? (
                                            <Switch
                                                id="pill-enabled-switch"
                                                checked={settings.pill_enabled}
                                                onCheckedChange={(checked: boolean) => handleSettingChange('pill_enabled', checked)}
                                                disabled={isLoading || isSaving}
                                                className="data-[state=checked]:bg-[#8A2BE2]/80 data-[state=unchecked]:bg-gray-600"
                                            />
                                        ) : <p className="text-gray-400">...</p>}
                                    </div>
                                </div>
                                
                                {/* Audio Settings (Placeholder) */}
                                <div className="pt-6 mt-6 border-t border-neutral-800">
                                    <h3 className="text-md font-semibold mb-4 text-neutral-200">Audio</h3>
                                    <div className="space-y-4">
                                        <div className="opacity-50">
                                            <Label className="text-gray-300">Microphone Input</Label>
                                            <Select disabled>
                                                <SelectTrigger className="w-full bg-[#0b0719] border border-[#8A2BE2]/30 text-gray-500">
                                                    <SelectValue placeholder="Default Microphone (Coming Soon)" />
                                                </SelectTrigger>
                                            </Select>
                                        </div>
                                        <p className="text-xs text-gray-500">Audio device selection will be available in a future update.</p>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Footer Buttons - No longer CardFooter */}
                            <div className="flex justify-between mt-6 pt-4 border-t border-[#8A2BE2]/10">
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
                                    className="bg-[#8A2BE2]/80 text-[#020409] hover:bg-[#8A2BE2] px-6"
                                    onClick={handleSave}
                                    disabled={isLoading || isSaving || !settings}
                                >
                                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    {isSaving ? "Saving..." : "Save"}
                                </Button>
                            </div>
                        </SettingsSection>
                    )}

                    {/* AI Actions Section */}
                    {activeTab === 'ai_actions' && (
                        <SettingsSection>
                            {!user ? (
                                <div className="text-center py-12">
                                    <img src="/assets/logos/fethr-pro-logo.png" alt="PRO" className="h-16 w-auto mx-auto mb-4" />
                                    <h3 className="text-lg font-semibold mb-2 text-white">Sign In Required</h3>
                                    <p className="text-gray-400 mb-4">
                                        Please sign in to access AI Actions
                                    </p>
                                </div>
                            ) : !profile || profile.subscription_status !== 'pro' ? (
                                <div className="text-center py-12">
                                    <img src="/assets/logos/fethr-pro-logo.png" alt="PRO" className="h-16 w-auto mx-auto mb-4" />
                                    <h3 className="text-lg font-semibold mb-2 text-white">Pro Feature</h3>
                                    <p className="text-gray-400 mb-4">
                                        AI Actions require a Pro subscription
                                    </p>
                                    <Button 
                                        onClick={handleInitiateSubscription}
                                        className="bg-[#8A2BE2] hover:bg-[#8A2BE2]/90 text-white"
                                    >
                                        Upgrade to Pro
                                    </Button>
                                </div>
                            ) : (
                                <>
                                <h2 className="text-lg font-semibold mb-4 text-white">AI Action Settings</h2>
                                <p className="text-sm text-gray-400 mb-6">
                                    Configure your OpenRouter API key and customize the prompts used for AI actions.
                                    Fethr uses <a href="https://openrouter.ai/docs" target="_blank" rel="noopener noreferrer" className="text-[#8A2BE2] hover:underline">OpenRouter.ai</a> to provide access to various large language models.
                                </p>

                                {/* AI Prompts Customization Section - MOVED UP */}
                                <div>
                                    <h3 className="text-md font-semibold mb-3 text-gray-200">Customize AI Prompts</h3>
                                    <p className="text-xs text-gray-400 mb-4">
                                        View and modify the default prompts used for each AI action. Changes are saved automatically.
                                    </p>
                                    <div className="space-y-3">
                                        {DEFAULT_AI_ACTIONS.map(action => (
                                            <div key={action.id} className="p-3 border border-neutral-800 rounded-md bg-neutral-900/50">
                                                <div className="flex justify-between items-center">
                                                    <div>
                                                        <h4 className="font-medium text-gray-100">{action.name}</h4>
                                                        <p className="text-xs text-gray-400">{action.description}</p>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleViewPrompt(action.id)}
                                                        className="text-xs text-[#8A2BE2] hover:bg-[#8A2BE2]/10 hover:text-white"
                                                    >
                                                        {viewingPromptForActionId === action.id && !isLoadingPrompt ? 'Hide Prompt' : 'View/Edit Prompt'}
                                                        {viewingPromptForActionId === action.id && isLoadingPrompt && <Loader2 className="ml-2 h-3 w-3 animate-spin" />}
                                                    </Button>
                                                </div>
                                                {viewingPromptForActionId === action.id && (
                                                    <div className="mt-3 pt-3 border-t border-[#8A2BE2]/10">
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
                                                                    className="w-full bg-[#020409]/70 border border-[#8A2BE2]/25 text-gray-200 text-sm rounded-md p-2 focus:border-[#8A2BE2]/60 focus:ring-1 focus:ring-[#8A2BE2]/60 resize-none"
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
                                                                        className="text-xs px-2 py-1 h-auto bg-[#8A2BE2]/80 text-[#020409] hover:bg-[#8A2BE2]"
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
                                <div className="mt-8 p-4 border border-[#8A2BE2]/20 rounded-md bg-[#0b0719]/50"> {/* Added mt-8 for spacing */}
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
                                            className="flex-grow bg-[#020409]/70 border-[#8A2BE2]/25 text-gray-200 focus:border-[#8A2BE2]/60 focus:ring-1 focus:ring-[#8A2BE2]/60"
                                        />
                                        <Button
                                            onClick={handleSaveUserApiKey}
                                            size="sm"
                                            className="bg-[#8A2BE2]/80 text-white hover:bg-[#8A2BE2]"
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
                                </div>
                                </>
                            )}
                        </SettingsSection>
                    )}



                    {/* Account Section */} 
                    {activeTab === 'account' && (
                        <SettingsSection>
                            <h2 className="text-lg font-semibold mb-6 text-white">
                                Account & Subscription
                            </h2>

                            {loadingAuth ? (
                                <div className="flex items-center space-x-2 text-gray-400">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Loading account status...</span>
                                </div>
                            ) : user ? (
                                // Logged In State - Enhanced UI
                                <div className="space-y-6">
                                    {/* User Profile Card */}
                                    <div className="p-4 bg-neutral-900/50 rounded-lg border border-neutral-800">
                                        <h3 className="text-sm font-medium text-gray-300 mb-2">Account Details</h3>
                                        <p className="text-white font-medium">{user.email}</p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            User ID: {user.id.slice(0, 8)}...
                                        </p>
                                    </div>

                                    {/* Subscription Status Card */}
                                    {loadingProfile ? (
                                        <div className="p-4 bg-neutral-900/50 rounded-lg border border-neutral-800">
                                            <div className="flex items-center space-x-2 text-gray-400">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                <span>Loading subscription details...</span>
                                            </div>
                                        </div>
                                    ) : profile ? (
                                        <div className="p-4 bg-neutral-900/50 rounded-lg border border-neutral-800">
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center space-x-2">
                                                    <h3 className="text-sm font-medium text-gray-300">Subscription Plan</h3>
                                                    <button
                                                        onClick={() => {
                                                            console.log('[SettingsPage] Manual subscription refresh triggered');
                                                            fetchSubscriptionUsage();
                                                            toast({ title: "Refreshing...", description: "Updating subscription status" });
                                                        }}
                                                        className="p-1 hover:bg-gray-600/50 rounded transition-colors"
                                                        title="Refresh subscription status"
                                                    >
                                                        <RefreshCw className="w-3 h-3 text-gray-400 hover:text-gray-300" />
                                                    </button>
                                                </div>
                                                {profile.subscription_status === 'pro' ? (
                                                    <div className="flex items-center space-x-1.5 px-2 py-1 bg-[#b28dfa]/20 rounded-md border border-[#b28dfa]/30">
                                                        <img src="/assets/logos/fethr-pro-logo.png" alt="PRO" className="h-6 w-auto" />
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center space-x-1.5 px-2 py-1 bg-gray-500/20 rounded-md border border-gray-500/30">
                                                        <span className="text-xs font-medium text-gray-300">FREE</span>
                                                    </div>
                                                )}
                                            </div>
                                            
                                            {/* Usage Information */}
                                            {wordLimit !== null && wordUsage !== null ? (
                                                <div className="space-y-2">
                                                    <div className="flex justify-between text-sm">
                                                        <span className="text-gray-400">Word Usage</span>
                                                        <span className="text-white font-medium">
                                                            {wordUsage.toLocaleString()} / {wordLimit > 900000000 ? 'Unlimited' : wordLimit.toLocaleString()}
                                                        </span>
                                                    </div>
                                                    {wordLimit <= 900000000 && (
                                                        <div className="w-full bg-gray-700 rounded-full h-2">
                                                            <div 
                                                                className={`h-2 rounded-full transition-all duration-300 ${
                                                                    (wordUsage / wordLimit) >= 0.8 ? 'bg-yellow-500' : 'bg-[#8A2BE2]'
                                                                }`}
                                                                style={{ width: `${Math.min((wordUsage / wordLimit) * 100, 100)}%` }}
                                                            />
                                                        </div>
                                                    )}
                                                    {wordLimit > 900000000 && (
                                                        <p className="text-xs text-gray-400">
                                                            Unlimited transcription with Pro plan
                                                        </p>
                                                    )}
                                                </div>
                                            ) : loadingUsage ? (
                                                <div className="flex items-center space-x-2 text-gray-400">
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                    <span className="text-xs">Loading usage data...</span>
                                                </div>
                                            ) : null}

                                            {/* Action Buttons */}
                                            <div className="mt-4 flex space-x-2">
                                                {profile.subscription_status !== 'pro' && (
                                                    <Button
                                                        onClick={handleInitiateSubscription}
                                                        className="bg-[#8A2BE2] hover:bg-[#85E4F0] text-black font-medium text-xs px-3 py-1.5"
                                                    >
                                                        Upgrade to Pro
                                                    </Button>
                                                )}
                                                {profile.subscription_status === 'pro' && (
                                                    <Button
                                                        variant="outline"
                                                        className="border-gray-600 text-gray-300 hover:bg-gray-700 text-xs px-3 py-1.5"
                                                        disabled
                                                    >
                                                        Manage Billing (Coming Soon)
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                                            <p className="text-sm text-yellow-300">Could not load subscription details. Please try again later.</p>
                                        </div>
                                    )}

                                    {/* Account Actions */}
                                    <div className="p-4 bg-neutral-900/50 rounded-lg border border-neutral-800">
                                        <h3 className="text-sm font-medium text-gray-300 mb-3">Account Actions</h3>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={async () => {
                                                const { error } = await supabase.auth.signOut();
                                                if (error) {
                                                    console.error("Error logging out:", error);
                                                    toast({ variant: "destructive", title: "Logout Failed", description: error.message });
                                                } else {
                                                    // Reset pill visibility to true on logout
                                                    try {
                                                        await invoke('set_pill_visibility', { visible: true });
                                                        // Update local settings state
                                                        setSettings(prev => prev ? { ...prev, pill_enabled: true } : null);
                                                        // Save settings with pill_enabled = true
                                                        if (settings) {
                                                            await invoke('save_settings', { 
                                                                settings: { ...settings, pill_enabled: true } 
                                                            });
                                                        }
                                                    } catch (err) {
                                                        console.error("Failed to reset pill visibility on logout:", err);
                                                    }
                                                    
                                                    toast({ title: "Logged out successfully." });
                                                    // User state will update via the listener in App.tsx
                                                }
                                            }}
                                        >
                                            Sign Out
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                // Logged Out State - Enhanced Login
                                <div className="space-y-4 w-full max-w-md">
                                    <div className="p-6 bg-gradient-to-br from-[#8A2BE2]/10 to-[#DA70D6]/10 rounded-lg border border-[#8A2BE2]/20">
                                        <h3 className="text-lg font-semibold text-center mb-2 text-white">Welcome to Fethr</h3>
                                        <p className="text-sm text-center text-gray-400 mb-6">
                                            Sign in to access your transcription history and Pro features
                                        </p>
                                        <LoginForm />
                                    </div>
                                </div>
                            )}
                        </SettingsSection>
                    )}
                </ScrollArea>
            </div>
        </div>
    );
}

export default SettingsPage; 