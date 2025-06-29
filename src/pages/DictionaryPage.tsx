import DictionarySettingsTab from '../components/settings/DictionarySettingsTab';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { User } from '@supabase/supabase-js';
import LoggedOutState from '../components/LoggedOutState';
import { Loader2 } from 'lucide-react';

interface DictionaryPageProps {
  user: User | null;
  loadingAuth: boolean;
}

function DictionaryPage({ user, loadingAuth }: DictionaryPageProps) {
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
    return <LoggedOutState page="dictionary" />;
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-8">
        <div className="max-w-5xl mx-auto">
          <DictionarySettingsTab />
        </div>
      </div>
    </ScrollArea>
  );
}

export default DictionaryPage;