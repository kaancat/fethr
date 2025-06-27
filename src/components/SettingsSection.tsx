import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * SettingsSection Component
 * 
 * What it does:
 * Provides a consistent scrollable container for all settings tab content.
 * Ensures uniform height management and scrolling behavior across different tabs.
 * 
 * Why it exists:
 * To eliminate inconsistent scrolling issues where some tabs overflow the viewport
 * while others have proper scrolling. This wrapper standardizes the layout pattern
 * and makes it easy to maintain consistent UX across all settings sections.
 */

interface SettingsSectionProps {
  children: React.ReactNode;
  className?: string;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({ 
  children, 
  className = "" 
}) => {
  return (
    <ScrollArea className={`h-full pr-4 ${className}`}>
      <div className="space-y-6">
        {children}
      </div>
    </ScrollArea>
  );
};

export default SettingsSection; 