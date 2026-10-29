import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateResumeRequest, UpdateResumeRequest } from '@shortlist-ai/shared';
import { useAuth } from '../auth/AuthProvider';
import { POLL_INTERVAL_MS } from './polling';
import { resumesApi } from './resumesApi';

export const resumesKey = ['resumes'] as const;
export const resumeKey = (id: string) => ['resume', id] as const;

export function useResumes() {
  const { status } = useAuth();
  return useQuery({
    queryKey: resumesKey,
    queryFn: () => resumesApi.list(),
    enabled: status === 'signed-in',
    // Files being read finish on their own, so keep checking until none are.
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.status === 'processing') ? POLL_INTERVAL_MS : false,
  });
}

export function useResume(id: string | undefined, options: { poll?: boolean } = {}) {
  const { status } = useAuth();
  return useQuery({
    queryKey: resumeKey(id ?? ''),
    queryFn: () => resumesApi.get(id!),
    enabled: status === 'signed-in' && Boolean(id),
    retry: false,
    refetchInterval: options.poll
      ? (query) => (query.state.data?.status === 'processing' ? POLL_INTERVAL_MS : false)
      : false,
  });
}

export function useCreateResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateResumeRequest) => resumesApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: resumesKey }),
  });
}

export function useUpdateResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateResumeRequest }) =>
      resumesApi.update(id, body),
    onSuccess: (resume) => {
      qc.setQueryData(resumeKey(resume.id), resume);
      // Setting a default changes other resumes too, so re-read the list.
      return qc.invalidateQueries({ queryKey: resumesKey });
    },
  });
}

export function useDuplicateResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resumesApi.duplicate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: resumesKey }),
  });
}

export function useDeleteResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => resumesApi.remove(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: resumeKey(id) });
      // The server may promote another resume to default.
      return qc.invalidateQueries({ queryKey: resumesKey });
    },
  });
}
