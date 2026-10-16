import { profileSchema, type UpdateProfileRequest } from '@shortlist-ai/shared';
import { apiRequest } from '../../lib/api';

export const profileApi = {
  get: () => apiRequest('/me', { schema: profileSchema }),
  update: (body: UpdateProfileRequest) => apiRequest('/me', { method: 'PUT', body, schema: profileSchema }),
  deleteAccount: () => apiRequest('/me', { method: 'DELETE' }),
};
