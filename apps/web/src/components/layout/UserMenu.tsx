import * as Menu from '@radix-ui/react-dropdown-menu';
import { useTheme, type ThemePreference } from '../../hooks/useTheme';

const themes: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const itemClass =
  'cursor-default rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-slate-100 dark:data-[highlighted]:bg-slate-800';

export function UserMenu({ onSignOut }: { onSignOut?: () => void }) {
  const { preference, setPreference } = useTheme();
  return (
    <Menu.Root>
      <Menu.Trigger className="rounded-control border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
        Account
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-44 rounded-card border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
        >
          <Menu.Label className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Theme
          </Menu.Label>
          <Menu.RadioGroup value={preference} onValueChange={(v) => setPreference(v as ThemePreference)}>
            {themes.map((t) => (
              <Menu.RadioItem key={t.value} value={t.value} className={`${itemClass} flex justify-between`}>
                {t.label}
                <Menu.ItemIndicator aria-hidden>✓</Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
          <Menu.Separator className="my-1 h-px bg-slate-200 dark:bg-slate-800" />
          <Menu.Item className={itemClass} disabled={!onSignOut} onSelect={onSignOut}>
            Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
