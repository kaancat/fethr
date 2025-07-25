import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { format } from 'date-fns';
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Copy } from 'lucide-react';
import HistoryItemEditor from '../components/HistoryItemEditor';
import type { HistoryEntry } from '../types';
import type { User } from '@supabase/supabase-js';
import LoggedOutState from '../components/LoggedOutState';

interface HistoryPageProps {
  user: User | null;
  loadingAuth: boolean;
}

function HistoryPage({ user, loadingAuth }: HistoryPageProps) {
  const { toast } = useToast();
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<HistoryEntry | null>(null);
  const lastUpdateTimeRef = useRef(0);

  // Load history function
  const loadHistory = useCallback(async (skipLoadingState = false) => {
    // Don't load history if user is not authenticated
    if (!user) {
      setHistoryEntries([]);
      setHistoryLoading(false);
      return;
    }
    // Debounce: Skip if we just updated less than 2 seconds ago
    const now = Date.now();
    if (skipLoadingState && now - lastUpdateTimeRef.current < 2000) {
      console.log('[History] Skipping update - too soon since last update');
      return;
    }
    
    lastUpdateTimeRef.current = now;
    if (!skipLoadingState) {
      setHistoryLoading(true);
      setHistoryError(null);
    }
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
      if (!skipLoadingState) {
        setHistoryLoading(false);
      }
    }
  }, [toast, user]);

  // Setup history and listener
  useEffect(() => {
    async function setupHistoryAndListener() {
      // Initial history load
      await loadHistory();
      
      // Set up listener for history updates
      console.log("[History] Setting up history update listener.");
      const unlistenHistoryUpdate = await listen<void>('fethr-history-updated', () => {
        console.log('[History] Received fethr-history-updated event. Fetching history...');
        setTimeout(() => loadHistory(true), 1500); // Skip loading state
      });
      
      console.log("[History] History listeners setup.");
      
      // Return cleanup function
      return () => {
        console.log("[History] Cleaning up history listeners.");
        unlistenHistoryUpdate();
      };
    }
    
    setupHistoryAndListener();
  }, [loadHistory, user]);

  // Check for edit-latest flag on component mount and when history loads
  useEffect(() => {
    const shouldEditLatest = window.localStorage.getItem('edit-latest-on-load');
    if (shouldEditLatest === 'true' && historyEntries.length > 0 && !historyLoading) {
      console.log('[History] Found edit-latest-on-load flag, opening latest entry for editing');
      setEditingEntry(historyEntries[0]);
      window.localStorage.removeItem('edit-latest-on-load');
    }
  }, [historyEntries, historyLoading]);

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

  const handleCancelEdit = () => setEditingEntry(null);

  const handleSaveEdit = async (timestamp: string, newText: string) => {
    if (!newText.trim()) {
      toast({ variant: "destructive", title: "Save Error", description: "Transcription text cannot be empty." });
      return;
    }
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

  // Show loading state while auth is loading
  if (loadingAuth) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-[#87CEFA]" />
      </div>
    );
  }

  // Show logged-out state if user is not authenticated
  if (!user) {
    return <LoggedOutState page="history" />;
  }

  return (
    <div className="h-full flex flex-col p-8">
      <div className="max-w-5xl mx-auto w-full flex flex-col h-full">
        <div>
          <h1 className="text-3xl font-semibold text-white mb-2">History</h1>
          <p className="text-neutral-400">
            View and edit your transcription history. Click edit to modify any entry.
          </p>
        </div>

        <ScrollArea className="flex-1 mt-6">
          {historyLoading && (
            <div className="flex items-center justify-center text-gray-400 py-8">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading history...
            </div>
          )}
          {historyError && (
            <p className="text-sm text-[#FF4D6D] bg-[#FF4D6D]/10 p-2 rounded border border-[#FF4D6D]/30">{historyError}</p>
          )}
          
          {!historyLoading && !historyError && (
            <div className="space-y-4">
              {editingEntry ? (
                <HistoryItemEditor
                  key={editingEntry.timestamp}
                  entry={editingEntry}
                  onSave={handleSaveEdit}
                  onCancel={handleCancelEdit}
                  user={user}
                />
              ) : (
                historyEntries.length > 0 ? (
                  historyEntries.map((entry) => (
                    <div key={entry.timestamp} className="p-3 bg-[#0A0F1A]/50 rounded border border-[#8A2BE2]/10 flex flex-col space-y-2">
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
                            className="w-6 h-6 text-gray-400 hover:text-white hover:bg-[#8A2BE2]/10"
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
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

export default HistoryPage;