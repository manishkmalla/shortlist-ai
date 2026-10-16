import { AccountSettings } from '../features/profile/AccountSettings';

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <AccountSettings />
    </div>
  );
}
