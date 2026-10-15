import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'shortlist-theme';
const darkQuery = '(prefers-color-scheme: dark)';

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function apply(pref: ThemePreference) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia(darkQuery).matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Call once before first render to avoid a flash of the wrong theme. */
export function initTheme() {
  apply(readPreference());
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);

  const setPreference = useCallback((next: ThemePreference) => {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
    setPreferenceState(next);
  }, []);

  useEffect(() => {
    apply(preference);
    if (preference !== 'system') return;
    const mq = window.matchMedia(darkQuery);
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  return { preference, setPreference };
}
