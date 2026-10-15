import { cn } from '../../lib/cn';

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li
            key={label}
            aria-current={state === 'current' ? 'step' : undefined}
            className="flex flex-1 flex-col gap-1.5"
          >
            <span
              aria-hidden
              className={cn(
                'h-1.5 rounded-full',
                state === 'todo' ? 'bg-slate-200 dark:bg-slate-800' : 'bg-accent dark:bg-accent-dark',
              )}
            />
            <span
              className={cn(
                'text-xs font-medium',
                state === 'current' ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {label}
              {state === 'done' && <span className="sr-only"> (completed)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
