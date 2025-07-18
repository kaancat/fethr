import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { HistoryEntry } from '../types'; // Adjust path if necessary
import { Button } from "@/components/ui/button";
import TextareaAutosize from 'react-textarea-autosize'; // For custom prompt input
import { format } from 'date-fns'; // For formatting the timestamp
import { invoke } from '@tauri-apps/api/tauri'; // Added invoke
import { useToast } from "@/hooks/use-toast"; // Changed import
import { Copy } from 'lucide-react'; // Added Copy icon import
import type { User } from '@supabase/supabase-js';
import { useSubscription } from '@/hooks/useSubscription';

interface HistoryItemEditorProps {
  entry: HistoryEntry;
  onSave: (timestamp: string, newText: string) => void; // Function to call when saving
  onCancel: () => void; // Function to call when canceling
  user: User | null;
}

// Define the character limit constant (can be defined outside the component or as a const inside)
const CUSTOM_PROMPT_MAX_LENGTH = 500;

const HistoryItemEditor: React.FC<HistoryItemEditorProps> = ({ entry, onSave, onCancel, user }) => {
  const [editedText, setEditedText] = useState<string>(entry.text);
  const [isAiLoading, setIsAiLoading] = useState<string | null>(null); // Re-added
  const [initialTextSnapshot, setInitialTextSnapshot] = useState<string>('');
  const { toast } = useToast(); // Initialize useToast
  const { hasActiveSubscription } = useSubscription(user?.id);

  // --- NEW STATE FOR CUSTOM PROMPT ---
  const [customUserPrompt, setCustomUserPrompt] = useState<string>('');
  const [isApplyingCustomPrompt, setIsApplyingCustomPrompt] = useState<string | boolean>(false);
  

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
    
    // Check authentication and subscription
    if (!user) {
        toast({ 
            variant: "destructive", 
            title: "Authentication Required", 
            description: "Please log in to use AI actions." 
        });
        return;
    }
    
    if (!hasActiveSubscription) {
        toast({ 
            variant: "destructive", 
            title: "Pro Feature", 
            description: "AI Actions require a Pro subscription." 
        });
        return;
    }

    console.log(`[AI Action] Requesting '${actionType}' for text: "${editedText.substring(0, 50)}..."`);
    setIsAiLoading(actionType);
    // Disable custom prompt button while other AI actions are running
    if (typeof setIsApplyingCustomPrompt === 'function') setIsApplyingCustomPrompt(true);

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
        // Re-enable custom prompt button
        if (typeof setIsApplyingCustomPrompt === 'function') setIsApplyingCustomPrompt(false);
    }
  };


  const handleApplyCustomPrompt = async () => {
      if (!customUserPrompt.trim()) {
          toast({variant: "destructive", title: "Input Error", description:"Please enter a custom prompt to apply."});
          return;
      }
      if (!editedText.trim()) {
          toast({variant: "destructive", title: "Input Error", description:"There is no text to apply the prompt to."});
          return;
      }
      
      // Check authentication and subscription
      if (!user) {
          toast({ 
              variant: "destructive", 
              title: "Authentication Required", 
              description: "Please log in to use AI actions." 
          });
          return;
      }
      
      if (!hasActiveSubscription) {
          toast({ 
              variant: "destructive", 
              title: "Pro Feature", 
              description: "Custom AI prompts require a Pro subscription." 
          });
          return;
      }

      setIsApplyingCustomPrompt(true);
      setIsAiLoading('custom_prompt'); // Visually disable other AI buttons

      try {
          const result = await invoke<string>('perform_ai_action', {
              action: "custom_direct_prompt", 
              text: editedText,
              directPrompt: customUserPrompt,
          });
          setEditedText(result);
          toast({title: "Custom Prompt Applied", description: "The text has been transformed."});
      } catch (error) {
          console.error("Failed to apply custom prompt:", error);
          const errorMessage = typeof error === 'string' ? error : "An unexpected error occurred.";
          toast({ variant: "destructive", title: "Custom Prompt Error", description: errorMessage });
      } finally {
          setIsApplyingCustomPrompt(false);
          setIsAiLoading(null); // Re-enable other AI buttons
      }
  };

  return (
    <div className="p-4 border border-gray-700 rounded-md bg-gray-800/50 space-y-3">
      {/* Display Timestamp */}
      <div className="text-xs text-gray-400">
        Editing entry from: {format(new Date(entry.timestamp), 'yyyy-MM-dd HH:mm:ss')}
      </div>

      {/* Textarea for Editing - Reverted */}
      <TextareaAutosize
        value={editedText}
        onChange={(e) => setEditedText(e.target.value)}
        className="w-full h-40 bg-[#1e1e1e] border-gray-600 text-white resize-none focus:ring-1 focus:ring-offset-0 focus:ring-offset-transparent focus:ring-[#8A2BE2]/50 focus:border-[#8A2BE2]/50 p-2.5 text-sm min-h-[80px]" // Added p-2.5, text-sm, min-h
        placeholder="Edit transcription..."
        minRows={3} // Added minRows
      />

      {/* --- AI Action Buttons --- */}
      <div className="mt-0 pt-3 border-t border-neutral-700"> {/* Adjusted mt-0 for tighter spacing initially */}
        <div className="flex items-center space-x-2 mb-3"> {/* mb-3 for spacing before next section */}
            <h4 className="text-xs font-medium text-neutral-400 mr-2">Predefined AI Actions:</h4>
            <Button
                variant="outline"
                size="sm"
                className="text-xs px-2 py-1 h-auto border border-[#8A2BE2]/30 bg-transparent text-[#8A2BE2] hover:bg-[#8A2BE2]/10 hover:text-white focus-visible:ring-[#8A2BE2] disabled:opacity-40"
                disabled={isAiLoading !== null || !!isApplyingCustomPrompt}
                title="Convert to clean written text"
                onClick={() => handleAiAction('written_form')}
            >
                {isAiLoading === 'written_form' ? 'Processing...' : 'Written Form'}
            </Button>
            <Button
                variant="outline"
                size="sm"
                className="text-xs px-2 py-1 h-auto border border-[#8A2BE2]/30 bg-transparent text-[#8A2BE2] hover:bg-[#8A2BE2]/10 hover:text-white focus-visible:ring-[#8A2BE2] disabled:opacity-40"
                disabled={isAiLoading !== null || !!isApplyingCustomPrompt}
                title="Summarize text"
                onClick={() => handleAiAction('summarize')}
            >
                {isAiLoading === 'summarize' ? 'Processing...' : 'Summarize'}
            </Button>
            <Button 
                variant="outline"
                size="sm"
                className="text-xs px-2 py-1 h-auto border border-[#8A2BE2]/30 bg-transparent text-[#8A2BE2] hover:bg-[#8A2BE2]/10 hover:text-white focus-visible:ring-[#8A2BE2] disabled:opacity-40"
                disabled={isAiLoading !== null || !!isApplyingCustomPrompt}
                title="Format as Email"
                onClick={() => handleAiAction('email')}
            >
                {isAiLoading === 'email' ? 'Processing...' : 'Email Mode'}
            </Button>
            <Button
                variant="outline"
                size="sm"
                className="text-xs px-2 py-1 h-auto border border-[#8A2BE2]/30 bg-transparent text-[#8A2BE2] hover:bg-[#8A2BE2]/10 hover:text-white focus-visible:ring-[#8A2BE2] disabled:opacity-40"
                disabled={isAiLoading !== null || !!isApplyingCustomPrompt}
                title="Refine this text into an effective AI prompt"
                onClick={() => handleAiAction('promptify')}
            >
                {isAiLoading === 'promptify' ? 'Processing...' : 'Promptify'}
            </Button>
        </div>

        {/* --- NEW CUSTOM PROMPT SECTION (Revised Layout) --- */}
        <div className="mt-3 pt-3 border-t border-neutral-700/50"> 
            <h4 className="text-sm font-medium text-neutral-300 mb-2">
                Transform with your prompt:
            </h4>
            <TextareaAutosize
                value={customUserPrompt}
                onChange={(e) => setCustomUserPrompt(e.target.value)}
                placeholder="e.g., 'Translate this to Spanish.' or 'Make this more formal. The text is: ${text}'"
                className="w-full p-2.5 bg-neutral-700 border border-neutral-600 rounded-md text-neutral-100 placeholder-neutral-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm min-h-[40px]"
                minRows={2}
                maxRows={6}
                disabled={!!isApplyingCustomPrompt || isAiLoading !== null} 
                maxLength={CUSTOM_PROMPT_MAX_LENGTH} 
            />
            {/* Helper text with reduced top margin */}
            <p className="text-xs text-neutral-500 mt-0.5 mb-1.5"> {/* Adjusted top margin, slightly increased bottom margin for spacing before counter */}
                Optional: Use <code className="bg-neutral-750 px-1 py-0.5 rounded text-neutral-300 text-[0.7rem]">${'{text}'}</code> in your prompt to specify where the current transcription text should be inserted. If omitted, your prompt will be used as a general instruction for the text.
            </p>
            {/* Character counter, moved here and right-aligned */}
            <div className="text-xs text-neutral-500 text-right">
                {customUserPrompt.length} / {CUSTOM_PROMPT_MAX_LENGTH}
            </div>
            
            {/* Container for button, now only button, aligned right */}
            <div className="mt-2 flex justify-end w-full"> {/* Button container, mt-2 for spacing from counter */}
                <Button 
                    onClick={handleApplyCustomPrompt}
                    disabled={!!isApplyingCustomPrompt || isAiLoading !== null || !customUserPrompt.trim() || !editedText.trim()} 
                    size="sm" 
                    className="px-4 py-2 bg-[#8A2BE2] hover:bg-[#8A2BE2]/90 text-white text-sm font-medium rounded-md disabled:opacity-50 transition-colors"
                >
                    {isApplyingCustomPrompt === true || isAiLoading === 'custom_prompt' ? 'Applying...' : 'Apply Custom Prompt'}
                </Button>
            </div>
        </div>
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
            className="w-7 h-7 text-gray-400 hover:text-[#87CEFA] hover:bg-[#8A2BE2]/10"
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
            className="bg-[#8A2BE2]/80 text-white hover:bg-[#8A2BE2] px-6" // Reverted style
            disabled={editedText === initialTextSnapshot || !editedText.trim()} // Updated disabled logic
         >
           Save Changes
         </Button>
      </div>
    </div>
  );
};

export default HistoryItemEditor; 