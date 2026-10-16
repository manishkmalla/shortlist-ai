import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateProfileRequest } from '@shortlist-ai/shared';
import { useAuth } from '../auth/AuthProvider';
import { profileApi } from './profileApi';

export const profileKey = ['profile'] as const;

export function useProfile() {
  const { status } = useAuth();
  return useQuery({ queryKey: profileKey, queryFn: () => profileApi.get(), enabled: status === 'signed-in' });
}

export function useRenameProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) => profileApi.rename(body),
    onSuccess: (profile) => qc.setQueryData(profileKey, profile),
  });
}

/** Deletes the account, then signs out and clears everything cached for this user. */
export function useDeleteAccount() {
  const qc = useQueryClient();
  const { signOut } = useAuth();
  return useMutation({
    mutationFn: () => profileApi.deleteAccount(),
    onSuccess: async () => {
      qc.clear();
      // The login no longer exists, so a failed server-side sign-out is fine: clear local state regardless.
      await signOut().catch(() => undefined);
    },
  });
}
