import * as RadixToast from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type ToastTone = 'neutral' | 'good' | 'bad';
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastApi {
  toast: (t: { title: string; description?: string; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const toneBorder: Record<ToastTone, string> = {
  neutral: 'border-slate-200 dark:border-slate-700',
  good: 'border-good',
  bad: 'border-bad',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback<ToastApi['toast']>(({ title, description, tone = 'neutral' }) => {
    setItems((prev) => [...prev, { id: Date.now() + Math.random(), title, description, tone }]);
  }, []);
  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      <RadixToast.Provider duration={5000}>
        {children}
        {items.map((item) => (
          <RadixToast.Root
            key={item.id}
            onOpenChange={(open) => {
              if (!open) setItems((prev) => prev.filter((i) => i.id !== item.id));
            }}
            className={cn(
              'rounded-card border bg-white p-4 shadow-lg dark:bg-slate-900',
              toneBorder[item.tone],
            )}
          >
            <RadixToast.Title className="text-sm font-semibold">{item.title}</RadixToast.Title>
            {item.description && (
              <RadixToast.Description className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {item.description}
              </RadixToast.Description>
            )}
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}
