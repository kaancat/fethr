import React, { useState } from 'react';
import type { HistoryEntry } from '../types'; // Adjust path if necessary
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { format } from 'date-fns'; // For formatting the timestamp

interface HistoryItemEditorProps {
  entry: HistoryEntry;
  onSave: (timestamp: string, newText: string) => void; // Function to call when saving
  onCancel: () => void; // Function to call when canceling
}

const HistoryItemEditor: React.FC<HistoryItemEditorProps> = ({ entry, onSave, onCancel }) => {
  const [editedText, setEditedText] = useState<string>(entry.text);

  const handleSave = () => {
    // Basic validation: Don't save if text is empty (optional)
    if (editedText.trim()) {
      onSave(entry.timestamp, editedText);
    } else {
      console.warn("Attempted to save empty transcription.");
      // Optionally, provide user feedback here (e.g., toast notification)
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

      {/* Action Buttons */}
      <div className="flex justify-end space-x-2">
        <Button
          variant="ghost"
          onClick={onCancel}
          className="text-gray-400 hover:text-white hover:bg-gray-700"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          className="bg-green-600 hover:bg-green-700 text-white" // Green save button
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
};

export default HistoryItemEditor; 