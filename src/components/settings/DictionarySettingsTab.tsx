import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { toast } from 'sonner';
import { PlusCircle, Trash2, Loader2, AlertTriangle, ListX, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

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

  useEffect(() => {
    loadDictionary();
  }, [loadDictionary]);

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
          variant="default" 
          className="h-auto bg-fethr hover:bg-fethr/90" // Ensure button height matches input
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

      {/* Simple Dictionary Information */}
      <div className="mt-8 pt-6 border-t border-neutral-700/60">
        <div className="flex items-center space-x-2 mb-4">
          <Settings className="h-5 w-5 text-neutral-400" />
          <h3 className="text-lg font-medium text-neutral-200">Dictionary Correction</h3>
        </div>
        
        <p className="text-sm text-neutral-400 mb-4 max-w-2xl">
          Your dictionary automatically corrects mis-transcribed words during transcription. 
          Works with all model sizes for improved accuracy on technical terms.
        </p>

        <div className="bg-neutral-800/50 border border-neutral-700/60 rounded-lg p-4">
          <div className="flex items-center space-x-3">
            <div className="h-2 w-2 bg-green-500 rounded-full"></div>
            <div>
              <p className="text-sm font-medium text-neutral-200">
                Dictionary correction is always enabled
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                Simple, reliable correction with zero configuration required
              </p>
            </div>
          </div>
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