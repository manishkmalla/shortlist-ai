import { Link, useLocation } from 'react-router-dom';
import { useApiKeyStatus } from './hooks';

/** Persistent notice when generation cannot work. Hidden on Settings, where the fix lives. */
export function ApiKeyBanner() {
  const { data } = useApiKeyStatus();
  const { pathname } = useLocation();
  if (!data || pathname.startsWith('/settings')) return null;
  if (data.configured && data.validatedAt) return null;

  const message = data.configured
    ? 'Your Anthropic API key needs attention. Analyses are switched off until it is fixed.'
    : 'Add your Anthropic API key to start analysing jobs.';

  return (
    <div
      role="region"
      aria-label="API key notice"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      {message}{' '}
      <Link to="/settings" className="font-semibold underline">
        Go to Settings
      </Link>
    </div>
  );
}
