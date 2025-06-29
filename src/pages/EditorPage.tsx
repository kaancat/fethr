import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event'; // Ensure listen is imported
import { appWindow } from '@tauri-apps/api/window';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea"; // Import Textarea
import { useToast } from "@/hooks/use-toast"; // Changed import
import { Toaster } from "@/components/ui/toaster"; // Added Toaster import
import { Copy, Check, Send, X as CloseIcon } from 'lucide-react'; // Import icons

function EditorPage() {
    const location = useLocation(); // Keep for potential future use, but not for text
    const navigate = useNavigate(); // Keep for potential future use
    const [text, setText] = useState(''); // Initialize empty
    const [isCopied, setIsCopied] = useState(false);
    const { toast } = useToast(); // Initialize useToast

    // Listen for transcription text via Tauri event
    useEffect(() => {
        let unlisten: (() => void) | null = null;
        let isMounted = true;

        async function setupListener() {
            try {
                console.log("EditorPage: Setting up listener for fethr-edit-transcription...");
                unlisten = await listen<string>('fethr-edit-transcription', (event) => {
                    if (isMounted) {
                        console.log("EditorPage: Received transcription text via event:", event.payload);
                        setText(event.payload || ''); // Set text from event payload
                    }
                });
                console.log("EditorPage: Listener setup complete.");
                 // Optional: Emit an event back to Rust saying the editor is ready,
                 // if we want Rust to wait before sending the text.
                 // await invoke("editor_ready");
            } catch (e) {
                 console.error("EditorPage: Failed to set up listener", e);
                 toast({ variant: "destructive", title: "Error", description: "Failed to initialize editor." });
            }
        }

        setupListener();

        // Cleanup function
        return () => {
            isMounted = false;
            console.log("EditorPage: Cleaning up listener.");
            if (unlisten) {
                unlisten();
            }
        };
    }, []); // Empty dependency array, runs once on mount


    const handleCopy = () => {
        navigator.clipboard.writeText(text)
            .then(() => {
                toast({ title: "Copied!", description: "Text copied to clipboard." });
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 1500); // Reset icon after delay
            })
            .catch(err => {
                console.error("Editor copy failed:", err);
                toast({ variant: "destructive", title: "Error", description: "Copy failed." });
            });
    };

    const handlePaste = () => {
        // First copy the potentially edited text, then invoke paste
         navigator.clipboard.writeText(text)
            .then(() => {
                invoke('paste_text_to_cursor') // Assuming this backend command exists
                    .then(() => toast({ title: "Pasted!", description: "Text pasted from editor." }))
                    .catch(err => {
                         console.error("Editor paste invoke failed:", err);
                         toast({ variant: "destructive", title: "Error", description: "Paste failed." });
                    });
            })
            .catch(err => {
                console.error("Editor copy-before-paste failed:", err);
                toast({ variant: "destructive", title: "Error", description: "Copy before paste failed." });
            });
    };

    const handleClose = () => {
        appWindow.close(); // Close this specific Tauri window
    };

    return (
        <div className="flex flex-col h-screen bg-[#0b0719] text-white p-4 space-y-4 font-sans">
            <Textarea
                value={text}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
                className="flex-grow bg-[#020409]/80 border-[#8A2BE2]/20 text-gray-200 text-sm rounded-md p-3 focus:border-[#8A2BE2]/50 focus:ring-1 focus:ring-[#8A2BE2]/50 resize-none"
                placeholder="Transcription..."
                rows={8} // Adjust initial rows
            />
            <div className="flex justify-between items-center flex-shrink-0">
                 <div className="space-x-2">
                    <Button onClick={handleCopy} variant="ghost" size="sm" className="text-[#87CEFA] hover:bg-[#8A2BE2]/10 hover:text-[#87CEFA]">
                        {isCopied ? <Check className="w-4 h-4 mr-1"/> : <Copy className="w-4 h-4 mr-1"/>}
                        Copy
                    </Button>
                     <Button onClick={handlePaste} variant="ghost" size="sm" className="text-[#87CEFA] hover:bg-[#8A2BE2]/10 hover:text-[#87CEFA]">
                         <Send className="w-4 h-4 mr-1"/>
                         Paste
                     </Button>
                    {/* TODO: Add future AI buttons here? Example: */}
                    {/* 
                    <Button disabled variant="ghost" size="sm" className="text-gray-500 cursor-not-allowed">
                         <Sparkles className="w-4 h-4 mr-1"/> AI Action
                     </Button> 
                     */}
                </div>
                 <Button onClick={handleClose} variant="ghost" size="icon" className="text-gray-500 hover:text-white hover:bg-white/5">
                    <CloseIcon className="w-5 h-5" />
                 </Button>
            </div>
            <Toaster /> {/* Added Toaster component */}
        </div>
    );
}

export default EditorPage; 