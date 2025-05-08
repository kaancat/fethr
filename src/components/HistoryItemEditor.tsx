import React, { useState, useEffect } from 'react';
import type { HistoryEntry } from '../types'; // Adjust path if necessary
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { format } from 'date-fns'; // For formatting the timestamp
import { invoke } from '@tauri-apps/api/tauri'; // Added invoke
import { useToast } from "@/hooks/use-toast"; // Changed import
import { Copy } from 'lucide-react'; // Added Copy icon import

interface HistoryItemEditorProps {
  entry: HistoryEntry;
  onSave: (timestamp: string, newText: string) => void; // Function to call when saving
  onCancel: () => void; // Function to call when canceling
}

const HistoryItemEditor: React.FC<HistoryItemEditorProps> = ({ entry, onSave, onCancel }) => {
  const [editedText, setEditedText] = useState<string>(entry.text);
  const [isAiLoading, setIsAiLoading] = useState<string | null>(null); // Re-added
  const [initialTextSnapshot, setInitialTextSnapshot] = useState<string>('');
  const { toast } = useToast(); // Initialize useToast

  // Effect to reset editedText when the entry prop changes
  useEffect(() => {
    setEditedText(entry.text);
    setInitialTextSnapshot(entry.text); // Also set initialTextSnapshot when entry changes
  }, [entry]);

  const handleSave = () => {
    if (editedText.trim()) {
      onSave(entry.timestamp, editedText);
    } else {
      console.warn("Attempted to save empty transcription.");
      toast({ variant: "destructive", title: "Error", description: "Cannot save an empty transcription." });
    }
  };

  // Re-added handleAiAction function
  const handleAiAction = async (actionType: string) => {
    if (!editedText.trim()) {
        toast({ variant: "destructive", title: "Error", description: "Cannot perform AI action on empty text." });
        return;
    }

    console.log(`[AI Action] Requesting '${actionType}' for text: "${editedText.substring(0, 50)}..."`);
    setIsAiLoading(actionType);

    let loadingTitle = "Working on it...";
    let loadingDescription = "Please wait while the AI processes your request.";
    let successTitle = "Action Completed!";
    let successDescription = "Result has been updated.";
    let errorTitle = "Hmm, an AI Hiccup...";

    switch (actionType) {
        case 'summarize':
            loadingTitle = "Distilling Wisdom...";
            loadingDescription = "Condensing your text into a neat summary!";
            successTitle = "Summary Ready!";
            successDescription = "Your concise summary has been generated.";
            break;
        case 'written_form':
            loadingTitle = "Polishing Prose...";
            loadingDescription = "Tidying up your text into a more formal written style.";
            successTitle = "Text Polished!";
            successDescription = "Your text is now in a spiffy written form.";
            break;
        case 'email':
            loadingTitle = "Drafting Email...";
            loadingDescription = "Whipping your notes into email shape!";
            successTitle = "Email Drafted!";
            successDescription = "Your email content is ready to go.";
            break;
        case 'promptify':
            loadingTitle = "Sparking Ideas...";
            loadingDescription = "Crafting an effective AI prompt from your text.";
            successTitle = "Prompt Perfected!";
            successDescription = "Your new AI prompt has been created.";
            break;
    }

    toast({ title: loadingTitle, description: loadingDescription });

    try {
        const result = await invoke<string>('perform_ai_action', {
            action: actionType,
            text: editedText
        });
        console.log(`[AI Action] Received result for '${actionType}': "${result.substring(0, 50)}..."`);
        setEditedText(result);
        toast({ title: successTitle, description: successDescription });
    } catch (error: any) {
        console.error(`[AI Action] Error performing '${actionType}':`, error);
        const errorMessage = typeof error === 'string' ? error : (error?.message || `Failed to perform ${actionType}.`);
        toast({ variant: "destructive", title: errorTitle, description: `The ${actionType} action encountered an issue. ${errorMessage}` });
    } finally {
        setIsAiLoading(null);
    }
  };

  return (
    <div className="p-4 border border-gray-700 rounded-md bg-gray-800/50 space-y-3">
      {/* Display Timestamp */}
      <div className="text-xs text-gray-400">
        Editing entry from: {format(new Date(entry.timestamp), 'yyyy-MM-dd HH:mm:ss')}
      </div>

      {/* Textarea for Editing - Reverted */}
      <Textarea
        value={editedText}
        onChange={(e) => setEditedText(e.target.value)}
        className="w-full h-40 bg-[#1e1e1e] border-gray-600 text-white resize-none focus:ring-1 focus:ring-offset-0 focus:ring-offset-transparent focus:ring-[#A6F6FF]/50 focus:border-[#A6F6FF]/50"
        placeholder="Edit transcription..."
      />

      {/* --- AI Action Buttons --- */}
      <div className="flex items-center space-x-2 pt-2 border-t border-gray-700/50 mt-3">
          <span className="text-xs text-gray-400 mr-2">AI Actions:</span>
          <Button // New "Written Form" button
              variant="outline"
              size="sm"
              className="text-xs px-2 py-1 h-auto border border-[#8B9EFF]/30 bg-transparent text-[#ADC2FF] hover:bg-[#8B9EFF]/10 hover:text-white focus-visible:ring-[#8B9EFF] disabled:opacity-40"
              disabled={isAiLoading !== null}
              title="Convert to clean written text"
              onClick={() => handleAiAction('written_form')} // Action type 'written_form'
          >
              {isAiLoading === 'written_form' ? 'Processing...' : 'Written Form'}
          </Button>
          <Button // Existing "Summarize" button, now connected
              variant="outline"
              size="sm"
              className="text-xs px-2 py-1 h-auto border border-[#8B9EFF]/30 bg-transparent text-[#ADC2FF] hover:bg-[#8B9EFF]/10 hover:text-white focus-visible:ring-[#8B9EFF] disabled:opacity-40"
              disabled={isAiLoading !== null}
              title="Summarize text"
              onClick={() => handleAiAction('summarize')}
          >
              {isAiLoading === 'summarize' ? 'Processing...' : 'Summarize'}
          </Button>
          <Button // Existing "Email Mode" button, now connected
              variant="outline"
              size="sm"
              className="text-xs px-2 py-1 h-auto border border-[#8B9EFF]/30 bg-transparent text-[#ADC2FF] hover:bg-[#8B9EFF]/10 hover:text-white focus-visible:ring-[#8B9EFF] disabled:opacity-40"
              disabled={isAiLoading !== null}
              title="Format as Email"
              onClick={() => handleAiAction('email')}
          >
              {isAiLoading === 'email' ? 'Processing...' : 'Email Mode'}
          </Button>
          <Button // New "Promptify" button
              variant="outline"
              size="sm"
              className="text-xs px-2 py-1 h-auto border border-[#8B9EFF]/30 bg-transparent text-[#ADC2FF] hover:bg-[#8B9EFF]/10 hover:text-white focus-visible:ring-[#8B9EFF] disabled:opacity-40"
              disabled={isAiLoading !== null}
              title="Refine this text into an effective AI prompt"
              onClick={() => handleAiAction('promptify')} // Action type 'promptify'
          >
              {isAiLoading === 'promptify' ? 'Processing...' : 'Promptify'}
          </Button>
      </div>

      {/* Existing Action Buttons (Save/Cancel) */}
      <div className="flex justify-end items-center space-x-2">
         <Button
            variant="ghost"
            size="icon"
            onClick={() => {
                if (editedText && editedText.trim() !== "") { // Check if there's non-whitespace text
                    navigator.clipboard.writeText(editedText)
                        .then(() => {
                            console.log("[Copy Editor] Text copied to clipboard successfully.");
                            toast({ title: "Copied!", description: "Text copied to clipboard." });
                        })
                        .catch(err => {
                            console.error("[Copy Editor] Failed to copy text:", err);
                            toast({ variant: "destructive", title: "Error", description: "Failed to copy text." });
                        });
                } else {
                    console.log("[Copy Editor] Attempted to copy empty text.");
                    toast({ variant: "destructive", title: "Error", description: "Nothing to copy." });
                }
            }}
            title="Copy Edited Text"
            className="w-7 h-7 text-gray-400 hover:text-[#A6F6FF] hover:bg-[#A6F6FF]/10"
            disabled={!editedText || editedText.trim() === ""} // Disable if textarea is effectively empty
        >
            <Copy className="w-3.5 h-3.5" />
        </Button>
         <Button
            variant="ghost"
            onClick={onCancel}
            className="text-gray-400 hover:text-white hover:bg-gray-700"
         >
            Cancel
         </Button>
         <Button
            variant="ghost"
            onClick={() => {
                setEditedText(initialTextSnapshot);
                toast({ title: "Reverted", description: "Changes have been reverted to the original text." });
            }}
            disabled={editedText === initialTextSnapshot}
            className="text-gray-400 hover:text-amber-400 hover:bg-amber-900/20 disabled:opacity-40"
        >
            Revert
        </Button>
         <Button
            onClick={handleSave}
            className="bg-[#A6F6FF]/80 text-[#020409] hover:bg-[#A6F6FF] px-6" // Reverted style
            disabled={editedText === initialTextSnapshot || !editedText.trim()} // Updated disabled logic
         >
           Save Changes
         </Button>
      </div>
    </div>
  );
};

export default HistoryItemEditor; 