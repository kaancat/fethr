import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { toast } from 'sonner';
import { PlusCircle, Trash2, Loader2, AlertTriangle, ListX, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import type { AppSettings, FuzzyCorrectionSettings } from '@/types';

/**
 * DictionarySettingsTab Component
 * 
 * What it does:
 * This component provides a UI for managing a custom dictionary of words.
 * Users can view the current list of words, add new words, and delete existing ones.
 * It interacts with a backend (presumably via Tauri) to persist these changes.
 * 
 * Why it exists:
 * To allow users to customize the application's vocabulary, potentially improving
 * transcription accuracy or other text-processing features by recognizing specific terms.
 */

// --- NEW: Define Props interface ---
interface DictionarySettingsTabProps {
  currentModelName: string;
}

const DictionarySettingsTab: React.FC<DictionarySettingsTabProps> = ({ currentModelName }) => {
  const [dictionaryWords, setDictionaryWords] = useState<string[]>([]);
  const [newWord, setNewWord] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false); // For add/delete operations
  const [isListLoading, setIsListLoading] = useState<boolean>(true); // For initial list loading
  const [error, setError] = useState<string | null>(null);
  
  // Fuzzy correction settings state
  const [fuzzySettings, setFuzzySettings] = useState<FuzzyCorrectionSettings>({
    enabled: false,
    sensitivity: 0.7,
    max_corrections_per_text: 10,
    preserve_original_case: true,
    correction_log_enabled: false,
  });
  const [settingsLoading, setSettingsLoading] = useState<boolean>(false);

  const loadDictionary = useCallback(async () => {
    setIsListLoading(true);
    setError(null);
    try {
      const words = await invoke<string[]>('get_dictionary');
      setDictionaryWords(words.sort((a, b) => a.localeCompare(b)));
    } catch (err) {
      console.error('Failed to load dictionary:', err);
      setError('Failed to load dictionary. Please try again.');
      toast.error('Failed to load dictionary.');
    } finally {
      setIsListLoading(false);
    }
  }, []);

  // Load fuzzy correction settings
  const loadSettings = useCallback(async () => {
    try {
      const settings = await invoke<AppSettings>('get_settings');
      setFuzzySettings(settings.fuzzy_correction);
    } catch (err) {
      console.error('Failed to load fuzzy correction settings:', err);
      toast.error('Failed to load fuzzy correction settings.');
    }
  }, []);

  useEffect(() => {
    loadDictionary();
    loadSettings();
  }, [loadDictionary, loadSettings]);

  const handleAddWord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWord.trim()) {
      setError('Word cannot be empty.');
      return;
    }
    if (dictionaryWords.some(word => word.toLowerCase() === newWord.trim().toLowerCase())) {
        setError(`"${newWord.trim()}" is already in the dictionary.`);
        toast.warning(`"${newWord.trim()}" is already in your dictionary.`);
        return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await invoke('add_dictionary_word', { word: newWord.trim() });
      setNewWord('');
      toast.success(`"${newWord.trim()}" added to dictionary.`);
      loadDictionary(); // Reload to get the sorted list and ensure UI consistency
    } catch (err) {
      console.error('Failed to add word:', err);
      const errorMessage = (err instanceof Error) ? err.message : String(err);
      setError(`Failed to add word: ${errorMessage}`);
      toast.error(`Failed to add word: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteWord = async (wordToDelete: string) => {
    setIsLoading(true); // Use general loading for this action too
    setError(null);
    try {
      await invoke('delete_dictionary_word', { wordToDelete });
      toast.success(`"${wordToDelete}" removed from dictionary.`);
      loadDictionary(); // Reload to update the list
    } catch (err) {
      console.error('Failed to delete word:', err);
      const errorMessage = (err instanceof Error) ? err.message : String(err);
      setError(`Failed to delete word: ${errorMessage}`);
      toast.error(`Failed to delete word: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Save fuzzy correction settings
  const saveFuzzySettings = async (newSettings: FuzzyCorrectionSettings) => {
    setSettingsLoading(true);
    try {
      // Get current app settings
      const currentSettings = await invoke<AppSettings>('get_settings');
      
      // Update with new fuzzy correction settings
      const updatedSettings: AppSettings = {
        ...currentSettings,
        fuzzy_correction: newSettings,
      };
      
      // Save updated settings
      await invoke('save_settings', { settings: updatedSettings });
      setFuzzySettings(newSettings);
      toast.success('Fuzzy correction settings saved successfully.');
    } catch (err) {
      console.error('Failed to save fuzzy correction settings:', err);
      toast.error('Failed to save fuzzy correction settings.');
    } finally {
      setSettingsLoading(false);
    }
  };

  // --- NEW: Determine if the notification should be shown ---
  const showTinyModelNotification = useMemo(() => {
    // Ensure currentModelName is a string and not undefined/null before calling .includes()
    const modelIsTiny = typeof currentModelName === 'string' && currentModelName.includes("ggml-tiny.bin");
    return modelIsTiny && dictionaryWords.length > 0;
  }, [currentModelName, dictionaryWords]);

  return (
    <div className="space-y-6 text-neutral-100">
      <h2 className="text-2xl font-semibold text-white">Custom Dictionary</h2>
      <p className="text-sm text-neutral-400 max-w-xl">
        Add words, names, or acronyms that Whisper often mis-transcribes.
        This list helps improve accuracy for your specific terminology.
      </p>

      {showTinyModelNotification && (
        <div 
            className="p-3 mb-4 text-sm text-yellow-400 bg-yellow-700/30 border border-yellow-600/50 rounded-md" 
            role="alert"
        >
            <div className="flex items-center">
                <AlertTriangle className="h-5 w-5 mr-2 text-yellow-400" />
                <strong className="font-medium">Note for '{currentModelName}' Model Users:</strong>
            </div>
            <p className="ml-7 mt-1">
                To ensure stability, dictionary prompts are currently disabled when using the 'Tiny' model variants. For full dictionary support, please select a larger model (e.g., Base, Small) in General Settings.
            </p>
        </div>
      )}

      <form onSubmit={handleAddWord} className="flex items-stretch space-x-3">
        <Input
          type="text"
          value={newWord}
          onChange={(e) => {
            setNewWord(e.target.value);
            if (error) setError(null); // Clear error on new input
          }}
          placeholder="Enter a new word or phrase"
          className="bg-neutral-800 border-neutral-700 placeholder-neutral-500 text-neutral-100 focus:ring-fethr selection:bg-fethr/80 flex-grow"
          disabled={isLoading || isListLoading}
        />
        <Button 
          type="submit" 
          variant="fethr" 
          className="h-auto" // Ensure button height matches input
          disabled={isLoading || isListLoading || !newWord.trim()}
        >
          {isLoading && !isListLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PlusCircle className="mr-2 h-5 w-5" />
          )}
          Add Word
        </Button>
      </form>

      {error && (
        <div className="p-3 text-sm text-red-400 bg-red-900/30 border border-red-700/50 rounded-md flex items-center">
          <AlertTriangle className="h-5 w-5 mr-2 text-red-400" />
          {error}
        </div>
      )}

      <div className="mt-6">
        <h3 className="text-lg font-medium text-neutral-200 mb-3">
          Your Dictionary ({dictionaryWords.length})
        </h3>
        {isListLoading ? (
          <div className="flex items-center justify-center text-neutral-400 py-8">
            <Loader2 className="mr-2 h-6 w-6 animate-spin" />
            <span>Loading dictionary...</span>
          </div>
        ) : dictionaryWords.length === 0 && !error ? (
          <div className="text-center text-neutral-500 py-8 px-4 border-2 border-dashed border-neutral-700/70 rounded-lg">
            <ListX className="mx-auto h-10 w-10 mb-3 text-neutral-600" />
            <p className="font-medium">Your dictionary is empty.</p>
            <p className="text-sm">Add some words using the form above to get started.</p>
          </div>
        ) : (
          <ScrollArea className="h-64 w-full border border-neutral-700/80 rounded-md bg-neutral-800/50">
            <div className="p-1">
              {dictionaryWords.map((word, index) => (
                <div
                  key={index} 
                  className="flex items-center justify-between p-2.5 hover:bg-neutral-700/60 rounded-md group"
                >
                  <span className="text-neutral-100 text-sm">{word}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteWord(word)}
                    disabled={isLoading}
                    className="text-neutral-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity px-2"
                    aria-label={`Delete ${word}`}
                  >
                    {isLoading && dictionaryWords.includes(word) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Fuzzy Dictionary Correction Settings */}
      <div className="mt-8 pt-6 border-t border-neutral-700/60">
        <div className="flex items-center space-x-2 mb-4">
          <Settings className="h-5 w-5 text-neutral-400" />
          <h3 className="text-lg font-medium text-neutral-200">Fuzzy Dictionary Correction</h3>
        </div>
        
        <p className="text-sm text-neutral-400 mb-6 max-w-2xl">
          Enable post-processing correction to fix transcription errors using your dictionary. 
          This works with all model sizes including tiny models, and helps improve accuracy for technical terms.
        </p>

        <div className="space-y-6">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="fuzzy-enabled" className="text-sm font-medium text-neutral-200">
                Enable Fuzzy Correction
              </Label>
              <p className="text-xs text-neutral-500">
                Apply intelligent word correction using your dictionary
              </p>
            </div>
            <Switch
              id="fuzzy-enabled"
              checked={fuzzySettings.enabled}
              onCheckedChange={(enabled) => {
                const newSettings = { ...fuzzySettings, enabled };
                saveFuzzySettings(newSettings);
              }}
              disabled={settingsLoading}
            />
          </div>

          {/* Sensitivity Slider */}
          {fuzzySettings.enabled && (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="fuzzy-sensitivity" className="text-sm font-medium text-neutral-200">
                    Correction Sensitivity
                  </Label>
                  <span className="text-xs text-neutral-400 bg-neutral-800 px-2 py-1 rounded">
                    {(fuzzySettings.sensitivity * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="space-y-2">
                  <Slider
                    id="fuzzy-sensitivity"
                    min={0.6}
                    max={0.9}
                    step={0.05}
                    value={[fuzzySettings.sensitivity]}
                    onValueChange={([value]) => {
                      const newSettings = { ...fuzzySettings, sensitivity: value };
                      saveFuzzySettings(newSettings);
                    }}
                    disabled={settingsLoading}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-neutral-500">
                    <span>Conservative</span>
                    <span>Aggressive</span>
                  </div>
                </div>
                <p className="text-xs text-neutral-500">
                  Higher values correct more words but may introduce false positives
                </p>
              </div>

              {/* Max Corrections Setting */}
              <div className="space-y-2">
                <Label htmlFor="max-corrections" className="text-sm font-medium text-neutral-200">
                  Max Corrections per Text
                </Label>
                <div className="flex items-center space-x-3">
                  <Input
                    id="max-corrections"
                    type="number"
                    min="1"
                    max="50"
                    value={fuzzySettings.max_corrections_per_text}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 1;
                      const newSettings = { ...fuzzySettings, max_corrections_per_text: Math.max(1, Math.min(50, value)) };
                      saveFuzzySettings(newSettings);
                    }}
                    disabled={settingsLoading}
                    className="w-20 bg-neutral-800 border-neutral-700 text-neutral-100"
                  />
                  <span className="text-xs text-neutral-500">
                    Prevents over-correction of long texts
                  </span>
                </div>
              </div>

              {/* Additional Options */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="preserve-case" className="text-sm font-medium text-neutral-200">
                      Preserve Original Casing
                    </Label>
                    <p className="text-xs text-neutral-500">
                      Maintain the original capitalization pattern when applying corrections
                    </p>
                  </div>
                  <Switch
                    id="preserve-case"
                    checked={fuzzySettings.preserve_original_case}
                    onCheckedChange={(preserve_original_case) => {
                      const newSettings = { ...fuzzySettings, preserve_original_case };
                      saveFuzzySettings(newSettings);
                    }}
                    disabled={settingsLoading}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="correction-log" className="text-sm font-medium text-neutral-200">
                      Enable Correction Logging
                    </Label>
                    <p className="text-xs text-neutral-500">
                      Log corrections to help debug and improve accuracy
                    </p>
                  </div>
                  <Switch
                    id="correction-log"
                    checked={fuzzySettings.correction_log_enabled}
                    onCheckedChange={(correction_log_enabled) => {
                      const newSettings = { ...fuzzySettings, correction_log_enabled };
                      saveFuzzySettings(newSettings);
                    }}
                    disabled={settingsLoading}
                  />
                </div>
              </div>
            </>
          )}

          {/* Status Indicator */}
          {settingsLoading && (
            <div className="flex items-center text-sm text-neutral-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving settings...
            </div>
          )}
        </div>
      </div>
      
      {/* Custom scrollbar styling (applied globally or via a CSS file ideally) */}
      {/* This is a conceptual comment; actual styles would be in CSS. */}
      {/* 
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #2d2d2d; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #777; }
      */}
    </div>
  );
};

export default DictionarySettingsTab; 