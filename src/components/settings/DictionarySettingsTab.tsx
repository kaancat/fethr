import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { toast } from 'sonner';
import { PlusCircle, Trash2, Loader2, AlertTriangle, ListX, Info, Search, BarChart3, Download, Upload } from 'lucide-react';
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

interface DictionaryStats {
  totalWords: number;
  averageLength: number;
  longestWord: string;
  shortestWord: string;
  lengthDistribution: Record<number, number>;
  recentlyAdded: string[];
}

const DictionarySettingsTab: React.FC = () => {
  const [dictionaryWords, setDictionaryWords] = useState<string[]>([]);
  const [newWord, setNewWord] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false); // For add/delete operations
  const [isListLoading, setIsListLoading] = useState<boolean>(true); // For initial list loading
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'alphabetical' | 'reverse'>('alphabetical');
  const [stats, setStats] = useState<DictionaryStats | null>(null);
  const [showStats, setShowStats] = useState<boolean>(false);
  const [selectedWords, setSelectedWords] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);

  const loadDictionary = useCallback(async () => {
    setIsListLoading(true);
    setError(null);
    try {
      const words = await invoke<string[]>('get_dictionary');
      setDictionaryWords(words.sort((a, b) => a.localeCompare(b)));
      
      // Load stats after dictionary is loaded
      try {
        const statsData = await invoke<DictionaryStats>('get_dictionary_stats');
        setStats(statsData);
      } catch (statsErr) {
        console.error('Failed to load dictionary stats:', statsErr);
        // Don't show error for stats, they're optional
      }
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

  const handleBatchDelete = async () => {
    if (selectedWords.size === 0) return;
    
    const confirmDelete = window.confirm(`Delete ${selectedWords.size} selected words?`);
    if (!confirmDelete) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Delete each selected word
      for (const word of selectedWords) {
        await invoke('delete_dictionary_word', { wordToDelete: word });
      }
      
      toast.success(`Deleted ${selectedWords.size} words`);
      setSelectedWords(new Set());
      setIsSelectionMode(false);
      loadDictionary();
    } catch (err) {
      console.error('Failed to delete words:', err);
      const errorMessage = (err instanceof Error) ? err.message : String(err);
      setError(`Failed to delete words: ${errorMessage}`);
      toast.error(`Failed to delete words: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleWordSelection = (word: string) => {
    const newSelection = new Set(selectedWords);
    if (newSelection.has(word)) {
      newSelection.delete(word);
    } else {
      newSelection.add(word);
    }
    setSelectedWords(newSelection);
  };

  const selectAll = () => {
    setSelectedWords(new Set(filteredWords));
  };

  const clearSelection = () => {
    setSelectedWords(new Set());
  };

  // Filter and sort dictionary words
  const filteredWords = useMemo(() => {
    let filtered = dictionaryWords;
    
    // Apply search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(word => 
        word.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Apply sorting
    const sorted = [...filtered];
    if (sortBy === 'alphabetical') {
      sorted.sort((a, b) => a.localeCompare(b));
    } else if (sortBy === 'reverse') {
      sorted.sort((a, b) => b.localeCompare(a));
    }
    
    return sorted;
  }, [dictionaryWords, searchQuery, sortBy]);

  const handleExport = async () => {
    try {
      const words = await invoke<string[]>('get_dictionary');
      const textContent = words.join('\n');
      const blob = new Blob([textContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fethr-dictionary-${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Dictionary exported successfully');
    } catch (error) {
      console.error('Failed to export dictionary:', error);
      toast.error('Failed to export dictionary');
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      // Split by newlines and filter out empty lines
      const words = content.split(/\r?\n/).filter(line => line.trim().length > 0);
      const jsonContent = JSON.stringify(words);
      const addedCount = await invoke<number>('import_dictionary', { jsonContent });
      
      if (addedCount > 0) {
        toast.success(`Imported ${addedCount} new words`);
        loadDictionary(); // Reload to show new words
      } else {
        toast.info('No new words to import');
      }
    } catch (error) {
      console.error('Failed to import dictionary:', error);
      toast.error('Failed to import dictionary. Please check the file format.');
    }
    
    // Reset file input
    event.target.value = '';
  };

  return (
    <div className="space-y-6 text-neutral-100">
      <h2 className="text-3xl font-semibold text-white">Custom Dictionary</h2>
      <p className="text-sm text-neutral-400 max-w-xl">
        Add words, names, or acronyms that Whisper often mis-transcribes.
        This list helps improve accuracy for your specific terminology.
      </p>

      {/* Search and Sort Controls */}
      <div className="flex items-center space-x-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-500" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search dictionary..."
            className="pl-10 bg-neutral-800 border-neutral-700 placeholder-neutral-500 text-neutral-100 focus:ring-fethr"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
            >
              ×
            </button>
          )}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'alphabetical' | 'reverse')}
          className="px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 text-sm focus:ring-fethr focus:border-fethr"
        >
          <option value="alphabetical">A → Z</option>
          <option value="reverse">Z → A</option>
        </select>
      </div>


      {/* Import/Export Controls */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExport}
          disabled={dictionaryWords.length === 0}
          className="flex items-center gap-2 bg-[#8B9EFF]/10 text-[#ADC2FF] hover:bg-[#8B9EFF]/20 hover:text-white focus-visible:ring-[#8B9EFF]"
        >
          <Download className="w-4 h-4" />
          Export Dictionary
        </Button>
        
        <div className="relative">
          <input
            type="file"
            accept=".txt"
            onChange={handleImport}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            disabled={isLoading || isListLoading}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={isLoading || isListLoading}
            className="flex items-center gap-2 bg-[#8B9EFF]/10 text-[#ADC2FF] hover:bg-[#8B9EFF]/20 hover:text-white focus-visible:ring-[#8B9EFF] pointer-events-none"
          >
            <Upload className="w-4 h-4" />
            Import Dictionary
          </Button>
        </div>
        
        <span className="text-xs text-neutral-500 ml-auto">
          Text file • One word per line • Merges with existing
        </span>
      </div>

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
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium text-neutral-200">
            Your Dictionary ({dictionaryWords.length}{searchQuery && ` • ${filteredWords.length} shown`})
          </h3>
          
          {dictionaryWords.length > 0 && (
            <div className="flex items-center gap-2">
              {isSelectionMode ? (
                <>
                  <span className="text-sm text-neutral-400">
                    {selectedWords.size} selected
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={selectAll}
                    className="text-xs text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800/50"
                  >
                    Select All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                    className="text-xs text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800/50"
                  >
                    Clear
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleBatchDelete}
                    disabled={selectedWords.size === 0 || isLoading}
                    className="text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20"
                  >
                    Delete Selected
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsSelectionMode(false);
                      setSelectedWords(new Set());
                    }}
                    className="text-xs text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800/50"
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsSelectionMode(true)}
                  className="text-xs text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800/50"
                >
                  Select Mode
                </Button>
              )}
            </div>
          )}
        </div>
        
        {/* Non-panicky warning for large dictionaries */}
        {dictionaryWords.length > 30 && (
          <div className="mb-4 p-3 bg-neutral-800/50 border border-neutral-700/50 rounded-md">
            <div className="flex items-start space-x-2">
              <Info className="h-4 w-4 text-neutral-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-neutral-400">
                Large dictionary ({dictionaryWords.length} words) may affect recognition speed. 
                Most frequently used words are prioritized automatically.
              </p>
            </div>
          </div>
        )}
        
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
              {filteredWords.map((word, index) => (
                <div
                  key={`${word}-${index}`} 
                  className={`flex items-center justify-between p-2.5 hover:bg-neutral-700/60 rounded-md group ${
                    isSelectionMode && selectedWords.has(word) ? 'bg-neutral-700/40' : ''
                  }`}
                  onClick={() => isSelectionMode && toggleWordSelection(word)}
                  style={{ cursor: isSelectionMode ? 'pointer' : 'default' }}
                >
                  <div className="flex items-center gap-3">
                    {isSelectionMode && (
                      <input
                        type="checkbox"
                        checked={selectedWords.has(word)}
                        onChange={() => toggleWordSelection(word)}
                        className="w-4 h-4 rounded border-neutral-600 bg-neutral-700 text-fethr focus:ring-fethr focus:ring-offset-0"
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <span className="text-neutral-100 text-sm">{word}</span>
                  </div>
                  {!isSelectionMode && (
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
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
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