import DictionarySettingsTab from '../components/settings/DictionarySettingsTab';
import { ScrollArea } from '@/components/ui/scroll-area';

function DictionaryPage() {
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