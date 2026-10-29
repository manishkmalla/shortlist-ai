import {
  resumeListSchema,
  resumeSchema,
  type CreateResumeRequest,
  type UpdateResumeRequest,
} from '@shortlist-ai/shared';
import { apiRequest } from '../../lib/api';

export const resumesApi = {
  list: async () => (await apiRequest('/resumes', { schema: resumeListSchema })).resumes,
  get: (id: string) => apiRequest(`/resumes/${id}`, { schema: resumeSchema }),
  create: (body: CreateResumeRequest) =>
    apiRequest('/resumes', { method: 'POST', body, schema: resumeSchema }),
  update: (id: string, body: UpdateResumeRequest) =>
    apiRequest(`/resumes/${id}`, { method: 'PUT', body, schema: resumeSchema }),
  remove: (id: string) => apiRequest(`/resumes/${id}`, { method: 'DELETE' }),
  duplicate: (id: string) =>
    apiRequest(`/resumes/${id}/duplicate`, { method: 'POST', schema: resumeSchema }),
};
