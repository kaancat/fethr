import React from 'react';
import { motion } from 'framer-motion';
import { Check, Zap, Target } from 'lucide-react';

interface ModelInfo {
  id: string;
  displayName: string;
  fileName: string;
  description: string;
  benefits: string[];
  stats: {
    accuracy: string;
    speed: string;
    size: string;
  };
  imagePath: string;
  recommended?: boolean;
}

const models: ModelInfo[] = [
  {
    id: 'swift',
    displayName: 'Fethr Swift',
    fileName: 'ggml-tiny.bin',
    description: 'Lightning-fast transcription for everyday use',
    benefits: [
      'Perfect for daily conversations',
      'Minimal resource usage',
      'Near-instant results'
    ],
    stats: {
      accuracy: '95%',
      speed: 'Lightning Fast',
      size: '~39MB'
    },
    imagePath: '/assets/ai-model-images/fethr_swift.png',
    recommended: true
  },
  {
    id: 'glide',
    displayName: 'Fethr Glide',
    fileName: 'ggml-base.bin',
    description: 'Enhanced accuracy for professional needs',
    benefits: [
      'Superior accuracy for technical terms',
      'Better punctuation handling',
      'Ideal for professional documents'
    ],
    stats: {
      accuracy: '98%',
      speed: 'Fast',
      size: '~142MB'
    },
    imagePath: '/assets/ai-model-images/fethr_glide.png'
  }
];

interface WhisperModelSelectorProps {
  value: string;
  onChange: (modelFileName: string) => void;
  disabled?: boolean;
}

const WhisperModelSelector: React.FC<WhisperModelSelectorProps> = ({ 
  value, 
  onChange, 
  disabled = false 
}) => {
  // Find the currently selected model
  const selectedModel = models.find(m => m.fileName === value) || models[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {models.map((model) => {
          const isSelected = selectedModel.fileName === model.fileName;
          
          return (
            <motion.div
              key={model.id}
              whileHover={{ scale: disabled ? 1 : 1.02 }}
              whileTap={{ scale: disabled ? 1 : 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              className={`relative ${model.recommended ? 'md:-mt-2' : ''}`}
            >
              {model.recommended && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 z-10">
                  <span className="px-3 py-1 bg-gradient-to-r from-[#8A2BE2] to-[#DA70D6] text-white text-xs font-semibold rounded-full shadow-lg">
                    RECOMMENDED
                  </span>
                </div>
              )}
              
              <motion.button
                onClick={() => !disabled && onChange(model.fileName)}
                disabled={disabled}
                className={`
                  relative w-full text-left rounded-lg border-2 transition-all overflow-hidden
                  ${isSelected 
                    ? 'border-[#8A2BE2] bg-[#8A2BE2]/10' 
                    : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700'
                  }
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  ${model.recommended ? 'shadow-lg shadow-[#8A2BE2]/20' : ''}
                `}
                whileHover={disabled ? {} : {
                  boxShadow: '0 10px 30px -10px rgba(138, 43, 226, 0.3)'
                }}
              >
                {/* Selection indicator */}
                {isSelected && (
                  <div className="absolute top-3 right-3 w-6 h-6 bg-[#8A2BE2] rounded-full flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
                
                {/* Hero Image */}
                <div className="relative h-32 bg-gradient-to-br from-[#0b0719] to-[#1a0f2e] overflow-hidden">
                  <img 
                    src={model.imagePath} 
                    alt={model.displayName}
                    className="absolute inset-0 w-full h-full object-contain p-4"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                </div>
                
                {/* Content */}
                <div className="p-5">
                  <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
                    {model.displayName}
                    {model.id === 'swift' && <Zap className="w-4 h-4 text-yellow-500" />}
                    {model.id === 'glide' && <Target className="w-4 h-4 text-blue-500" />}
                  </h3>
                  <p className="text-sm text-gray-400 mb-4">{model.description}</p>
                  
                  {/* Benefits */}
                  <ul className="space-y-2 mb-4">
                    {model.benefits.map((benefit, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <div className="w-1 h-1 bg-[#8A2BE2] rounded-full mt-1.5 flex-shrink-0" />
                        <span className="text-gray-300">{benefit}</span>
                      </li>
                    ))}
                  </ul>
                  
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2 pt-3 border-t border-neutral-800">
                    <div className="text-center">
                      <p className="text-xs text-gray-500">Accuracy</p>
                      <p className="text-sm font-semibold text-white">{model.stats.accuracy}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500">Speed</p>
                      <p className="text-sm font-semibold text-white">{model.stats.speed}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500">Size</p>
                      <p className="text-sm font-semibold text-white">{model.stats.size}</p>
                    </div>
                  </div>
                </div>
              </motion.button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default WhisperModelSelector;