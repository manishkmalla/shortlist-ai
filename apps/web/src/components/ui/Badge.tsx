import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'neutral' | 'accent' | 'good' | 'caution' | 'bad';

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  accent: 'bg-accent-soft text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  good: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  caution: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  bad: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}
      {...rest}
    />
  );
}
