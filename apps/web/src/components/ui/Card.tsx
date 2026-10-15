import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-card border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
      {...rest}
    />
  );
}
