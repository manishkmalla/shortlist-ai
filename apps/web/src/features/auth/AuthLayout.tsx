import type { ReactNode } from 'react';
import { Card } from '../../components/ui';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold">
          <span aria-hidden className="inline-block size-5 rounded-md bg-accent dark:bg-accent-dark" />
          Shortlist AI
        </div>
        <Card>
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </Card>
      </div>
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-control bg-red-50 px-3 py-2 text-sm text-bad dark:bg-red-950 dark:text-red-300">
      {message}
    </p>
  );
}
