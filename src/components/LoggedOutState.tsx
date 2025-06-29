import React from 'react';
import { Button } from "@/components/ui/button";
import { invoke } from '@tauri-apps/api/tauri';
import { FileText, Mic, Sparkles, Lock } from 'lucide-react';

interface LoggedOutStateProps {
  page: 'home' | 'history' | 'dictionary' | 'settings';
}

const LoggedOutState: React.FC<LoggedOutStateProps> = ({ page }) => {
  const handleSignIn = async () => {
    await invoke('navigate_to_settings_section', { section: 'account' });
    await invoke('show_settings_window_and_focus');
  };

  const content = {
    home: {
      icon: <Mic className="w-16 h-16 text-muted-foreground mb-4" />,
      title: "Welcome to Fethr",
      description: "Sign in to start transcribing and track your productivity",
      features: [
        "Real-time voice transcription",
        "Track your writing statistics",
        "Build your custom dictionary",
        "AI-powered text enhancement"
      ]
    },
    history: {
      icon: <FileText className="w-16 h-16 text-muted-foreground mb-4" />,
      title: "Your Transcription History",
      description: "Sign in to view and manage your past transcriptions",
      features: [
        "Access all your transcriptions",
        "Edit and refine your text",
        "Search through your history",
        "Export your content"
      ]
    },
    dictionary: {
      icon: <Sparkles className="w-16 h-16 text-muted-foreground mb-4" />,
      title: "Custom Dictionary",
      description: "Sign in to build your personal dictionary for accurate transcriptions",
      features: [
        "Add technical terms and jargon",
        "Improve transcription accuracy",
        "Import/export word lists",
        "Track word usage statistics"
      ]
    },
    settings: {
      icon: <Lock className="w-16 h-16 text-muted-foreground mb-4" />,
      title: "Account Settings",
      description: "Sign in to customize your Fethr experience",
      features: []
    }
  };

  const pageContent = content[page];

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] p-8">
      <div className="max-w-md w-full text-center">
        {pageContent.icon}
        <h2 className="text-2xl font-semibold mb-2">{pageContent.title}</h2>
        <p className="text-muted-foreground mb-6">{pageContent.description}</p>
        
        {pageContent.features.length > 0 && (
          <ul className="text-sm text-muted-foreground mb-6 space-y-2">
            {pageContent.features.map((feature, index) => (
              <li key={index} className="flex items-center justify-center gap-2">
                <span className="w-1 h-1 bg-muted-foreground rounded-full" />
                {feature}
              </li>
            ))}
          </ul>
        )}
        
        <Button onClick={handleSignIn} size="lg" className="w-full max-w-xs">
          Sign In to Continue
        </Button>
      </div>
    </div>
  );
};

export default LoggedOutState;