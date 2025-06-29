import React from 'react';
import { PillPosition } from '@/types';
import { cn } from '@/lib/utils';

interface PillPositionSelectorProps {
  value: PillPosition;
  onChange: (position: PillPosition) => void;
  disabled?: boolean;
}

const PillPositionSelector: React.FC<PillPositionSelectorProps> = ({ 
  value, 
  onChange, 
  disabled = false 
}) => {
  const positions: { position: PillPosition; className: string; label: string }[] = [
    { 
      position: PillPosition.TOP_LEFT, 
      className: "top-2 left-2",
      label: "Top Left"
    },
    { 
      position: PillPosition.TOP_CENTER, 
      className: "top-2 left-1/2 -translate-x-1/2",
      label: "Top Center"
    },
    { 
      position: PillPosition.TOP_RIGHT, 
      className: "top-2 right-2",
      label: "Top Right"
    },
    { 
      position: PillPosition.BOTTOM_LEFT, 
      className: "bottom-2 left-2",
      label: "Bottom Left"
    },
    { 
      position: PillPosition.BOTTOM_CENTER, 
      className: "bottom-2 left-1/2 -translate-x-1/2",
      label: "Bottom Center"
    },
    { 
      position: PillPosition.BOTTOM_RIGHT, 
      className: "bottom-2 right-2",
      label: "Bottom Right"
    },
  ];

  return (
    <div className="w-full max-w-xs">
      <div 
        className="relative bg-neutral-900 border border-neutral-700 rounded-lg overflow-hidden"
        style={{ aspectRatio: '16/9', maxHeight: '120px' }}
      >
        {/* Screen representation */}
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-800/20 to-neutral-900/20" />
        
        {/* Position indicators */}
        {positions.map(({ position, className, label }) => (
          <button
            key={position}
            type="button"
            disabled={disabled}
            onClick={() => onChange(position)}
            className={cn(
              "absolute w-6 h-6 rounded-full transition-all duration-200",
              "hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[#8A2BE2] focus:ring-offset-2 focus:ring-offset-neutral-900",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              className,
              value === position 
                ? "bg-[#8A2BE2] shadow-lg shadow-[#8A2BE2]/30" 
                : "bg-neutral-700 hover:bg-neutral-600"
            )}
            aria-label={label}
            title={label}
          >
            {value === position && (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-1.5 h-1.5 bg-white rounded-full" />
              </span>
            )}
          </button>
        ))}
        
        {/* Center visual guide - smaller */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-8 border border-dashed border-neutral-700/50 rounded-sm" />
        </div>
      </div>
      
      {/* Current position label */}
      <p className="text-left mt-2 text-xs text-neutral-400">
        Current position: <span className="text-white font-medium">
          {positions.find(p => p.position === value)?.label || 'Unknown'}
        </span>
      </p>
    </div>
  );
};

export default PillPositionSelector;