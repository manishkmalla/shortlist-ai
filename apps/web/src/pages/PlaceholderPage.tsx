import { Card } from '../components/ui';

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <Card>
        <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>
      </Card>
    </div>
  );
}
