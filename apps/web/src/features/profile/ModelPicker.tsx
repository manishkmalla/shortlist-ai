import { MODEL_OPTIONS, type ModelId } from '@shortlist-ai/shared';
import { Card, useToast } from '../../components/ui';
import { useProfile, useUpdateProfile } from './hooks';

export function ModelPicker() {
  const { toast } = useToast();
  const profile = useProfile();
  const update = useUpdateProfile();
  if (!profile.data) return null;

  const choose = (modelId: ModelId) =>
    update.mutate(
      { modelId },
      {
        onSuccess: () => toast({ title: 'Model updated', tone: 'good' }),
        onError: () => toast({ title: 'Could not update the model', description: 'Please try again.', tone: 'bad' }),
      },
    );

  return (
    <Card className="space-y-4">
      <fieldset disabled={update.isPending} className="space-y-3">
        <legend className="text-lg font-semibold">Model</legend>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Used for your analyses. You pay Anthropic directly, and larger models cost more per analysis.
        </p>
        {MODEL_OPTIONS.map((m) => (
          <label
            key={m.id}
            className="flex cursor-pointer items-start gap-3 rounded-control border border-slate-200 p-3 has-[:checked]:border-accent dark:border-slate-800 dark:has-[:checked]:border-accent-dark"
          >
            <input
              type="radio"
              name="model"
              value={m.id}
              checked={profile.data.modelId === m.id}
              onChange={() => choose(m.id)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium">{m.label}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{m.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Card>
  );
}
