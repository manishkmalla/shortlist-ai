import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiKeyStatus } from '@shortlist-ai/shared';
import { useAuth } from '../auth/AuthProvider';
import { apiKeyApi } from './apiKeyApi';

export const apiKeyStatusKey = ['api-key-status'] as const;

export function useApiKeyStatus() {
  const { status } = useAuth();
  return useQuery({ queryKey: apiKeyStatusKey, queryFn: () => apiKeyApi.status(), enabled: status === 'signed-in' });
}

export function useSaveApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) => apiKeyApi.save(apiKey),
    // The key is a mutation variable: do not keep it in the mutation cache after it settles.
    gcTime: 0,
    onSuccess: (status) => qc.setQueryData(apiKeyStatusKey, status),
  });
}

export function useTestApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiKeyApi.test(),
    onSuccess: (status) => qc.setQueryData(apiKeyStatusKey, status),
    // A rejected key loses its verified state on the server, so re-read it.
    onError: () => qc.invalidateQueries({ queryKey: apiKeyStatusKey }),
  });
}

export function useRemoveApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiKeyApi.remove(),
    onSuccess: () =>
      qc.setQueryData<ApiKeyStatus>(apiKeyStatusKey, { configured: false, lastFour: null, validatedAt: null }),
  });
}
