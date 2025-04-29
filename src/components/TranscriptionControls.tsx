import React, { useState } from 'react';

/**
 * TranscriptionControls component provides UI for managing transcription settings
 * 
 * What it does: Allows users to select transcription options and see current status
 * Why it exists: To provide a control panel for the transcription functionality
 */
const TranscriptionControls: React.FC = () => {
  const [selectedModel, setSelectedModel] = useState('tiny.en');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcription] = useState('');

  // Handle model change
  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(e.target.value);
  };

  return (
    <div className="p-4 bg-white shadow-md rounded">
      <h2 className="text-xl font-bold mb-4">Transcription Settings</h2>
      
      <div className="mb-4">
        <label htmlFor="model-select" className="block text-sm font-medium mb-1">
          Whisper Model
        </label>
        <select
          id="model-select"
          value={selectedModel}
          onChange={handleModelChange}
          className="w-full p-2 border border-gray-300 rounded"
        >
          <option value="tiny.en">Tiny (English)</option>
          <option value="base.en">Base (English)</option>
          <option value="small.en">Small (English)</option>
        </select>
      </div>
      
      <button
        className={`px-4 py-2 rounded text-white ${
          isTranscribing ? 'bg-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
        }`}
        disabled={isTranscribing}
        onClick={() => setIsTranscribing(!isTranscribing)}
            >
        {isTranscribing ? 'Transcribing...' : 'Start Transcription'}
      </button>
      
      {transcription && (
        <div className="mt-4 p-3 bg-gray-100 rounded">
          <p>{transcription}</p>
        </div>
        )}
    </div>
  );
};

export default TranscriptionControls; 