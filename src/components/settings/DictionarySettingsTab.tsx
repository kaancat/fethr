import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Trash2 } from 'lucide-react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

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
const DictionarySettingsTab: React.FC = () => {
    const { toast } = useToast();
    const [dictionary, setDictionary] = useState<string[]>([]);
    const [newWord, setNewWord] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isUpdating, setIsUpdating] = useState<boolean>(false); // For add/delete operations
    const [error, setError] = useState<string | null>(null);

    /**
     * Fetches the dictionary from the backend when the component mounts.
     * Handles loading and error states for the initial fetch.
     */
    const fetchDictionary = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            console.log("[DictionaryTab] Fetching dictionary...");
            const currentDictionary = await invoke<string[]>('get_dictionary');
            setDictionary(currentDictionary);
            console.log("[DictionaryTab] Dictionary fetched:", currentDictionary);
        } catch (err) {
            console.error('[DictionaryTab] Error fetching dictionary:', err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            setError(`Failed to load dictionary: ${errorMsg}`);
            toast({
                variant: "destructive",
                title: "Dictionary Load Failed",
                description: errorMsg,
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchDictionary();
    }, [fetchDictionary]);

    /**
     * Handles adding a new word to the dictionary.
     * It invokes a backend command to add the word and then updates the local state.
     * Prevents adding empty or duplicate words.
     */
    const handleAddWord = async () => {
        const trimmedWord = newWord.trim();
        if (!trimmedWord) {
            toast({
                variant: "destructive",
                title: "Invalid Word",
                description: "Word cannot be empty.",
            });
            return;
        }
        if (dictionary.includes(trimmedWord.toLowerCase())) {
             toast({
                variant: "destructive",
                title: "Duplicate Word",
                description: `"${trimmedWord}" is already in the dictionary.`,
            });
            return;
        }

        setIsUpdating(true);
        setError(null);
        try {
            console.log(`[DictionaryTab] Adding word: "${trimmedWord}"`);
            const updatedDictionary = await invoke<string[]>('add_dictionary_word', { word: trimmedWord });
            setDictionary(updatedDictionary);
            setNewWord(''); // Clear input field
            toast({
                title: "Word Added",
                description: `"${trimmedWord}" has been added to the dictionary.`,
            });
            console.log("[DictionaryTab] Word added, updated dictionary:", updatedDictionary);
        } catch (err) {
            console.error('[DictionaryTab] Error adding word:', err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            setError(`Failed to add word: ${errorMsg}`);
            toast({
                variant: "destructive",
                title: "Add Failed",
                description: errorMsg,
            });
        } finally {
            setIsUpdating(false);
        }
    };

    /**
     * Handles deleting a word from the dictionary.
     * It invokes a backend command to delete the word and then updates the local state.
     */
    const handleDeleteWord = async (wordToDelete: string) => {
        setIsUpdating(true);
        setError(null);
        try {
            console.log(`[DictionaryTab] Deleting word: "${wordToDelete}"`);
            const updatedDictionary = await invoke<string[]>('delete_dictionary_word', { wordToDelete });
            setDictionary(updatedDictionary);
            toast({
                title: "Word Deleted",
                description: `"${wordToDelete}" has been removed from the dictionary.`,
            });
            console.log("[DictionaryTab] Word deleted, updated dictionary:", updatedDictionary);
        } catch (err) {
            console.error('[DictionaryTab] Error deleting word:', err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            setError(`Failed to delete word: ${errorMsg}`);
            toast({
                variant: "destructive",
                title: "Delete Failed",
                description: errorMsg,
            });
        } finally {
            setIsUpdating(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center text-gray-400 py-8">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#A6F6FF]" />
                <span className="text-gray-300">Loading Dictionary...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-white mb-3">Custom Dictionary</h2>
                <p className="text-sm text-gray-400 mb-1">
                    Add words that should always be transcribed as written, improving accuracy for specific terms, names, or jargon.
                </p>
                <p className="text-xs text-gray-500">
                    Words are case-insensitive and will be stored in lowercase.
                </p>
            </div>

            {error && (
                <p className="text-sm text-[#FF4D6D] bg-[#FF4D6D]/10 p-3 rounded border border-[#FF4D6D]/30">
                    Error: {error}
                </p>
            )}

            <div className="flex items-center space-x-2">
                <Input
                    type="text"
                    placeholder="Add a new word"
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddWord()}
                    className="flex-grow bg-[#020409]/70 border-[#A6F6FF]/25 text-gray-200 focus:border-[#A6F6FF]/60 focus:ring-1 focus:ring-[#A6F6FF]/60"
                    disabled={isUpdating}
                />
                <Button
                    onClick={handleAddWord}
                    disabled={isUpdating || !newWord.trim()}
                    className="bg-[#A6F6FF]/80 text-[#020409] hover:bg-[#A6F6FF] px-5"
                >
                    {isUpdating && !isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Add Word
                </Button>
            </div>

            {dictionary.length > 0 ? (
                <ScrollArea className="h-full max-h-[calc(100vh-400px)] border border-[#A6F6FF]/10 rounded-md bg-[#0A0F1A]/30">
                    <div className="p-1">
                        {dictionary.map((word) => (
                            <div
                                key={word}
                                className="flex items-center justify-between p-2.5 hover:bg-[#A6F6FF]/5 rounded group"
                            >
                                <span className="text-sm text-gray-200">{word}</span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteWord(word)}
                                    disabled={isUpdating}
                                    className="w-7 h-7 text-gray-500 hover:text-red-400 hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title={`Delete "${word}"`}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            ) : (
                !error && !isLoading && ( // Only show "No words" if not loading and no primary error
                    <div className="text-center text-gray-400 py-10 border border-dashed border-[#A6F6FF]/10 rounded-md bg-[#0A0F1A]/20">
                        <p className="text-sm">Your custom dictionary is empty.</p>
                        <p className="text-xs mt-1 text-gray-500">Add words using the input field above.</p>
                    </div>
                )
            )}
        </div>
    );
};

export default DictionarySettingsTab; 