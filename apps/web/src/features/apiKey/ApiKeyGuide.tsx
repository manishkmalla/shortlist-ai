export const ANTHROPIC_KEYS_URL = 'https://console.anthropic.com/settings/keys';

const steps = [
  'Go to console.anthropic.com and sign up or log in.',
  'Add billing: Settings > Billing, add a payment method and buy a small amount of credit (pay-as-you-go; a full analysis costs a few cents).',
  'Open Settings > API Keys and click Create Key; name it "Shortlist AI".',
  'Copy the key immediately (it starts with sk-ant-); it is shown only once.',
  'Paste it here, click Save, then Test connection.',
  'Optional: set a monthly spend limit in the Anthropic console; revoke the key there at any time.',
];

export function GetKeyLink() {
  return (
    <a
      href={ANTHROPIC_KEYS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center rounded-control border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
    >
      Get key
      <span className="sr-only"> (opens the Anthropic console in a new tab)</span>
    </a>
  );
}

export function ApiKeyGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details
      open={defaultOpen}
      className="rounded-control border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
    >
      <summary className="cursor-pointer text-sm font-semibold">How to get your Anthropic API key</summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="mt-4">
        <GetKeyLink />
      </div>
    </details>
  );
}

export function ApiKeyPrivacyNote() {
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      Your key is encrypted at rest and used only to call Anthropic on your behalf. It is never shown again after you
      save it, and you can remove it at any time.
    </p>
  );
}
