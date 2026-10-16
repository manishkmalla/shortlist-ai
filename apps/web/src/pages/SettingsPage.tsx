import { ApiKeyForm } from '../features/apiKey/ApiKeyForm';
import { Card } from '../components/ui';
import { AccountSettings } from '../features/profile/AccountSettings';
import { ModelPicker } from '../features/profile/ModelPicker';

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Anthropic API key</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Shortlist AI runs on your own Anthropic key. You pay Anthropic directly for usage.
        </p>
        <ApiKeyForm />
      </Card>
      <ModelPicker />
      <AccountSettings />
    </div>
  );
}
