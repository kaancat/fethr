import DictionarySettingsTab from '../components/settings/DictionarySettingsTab';

function DictionaryPage() {
  return (
    <div className="h-full p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <DictionarySettingsTab />
      </div>
    </div>
  );
}

export default DictionaryPage;