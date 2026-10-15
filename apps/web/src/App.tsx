import { scoreLabel } from '@shortlist-ai/shared';

export function App() {
  return (
    <main className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100 grid place-items-center">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Shortlist AI</h1>
        <p className="mt-2 text-slate-500">Scaffold OK. Sample label: {scoreLabel(72)}</p>
      </div>
    </main>
  );
}
