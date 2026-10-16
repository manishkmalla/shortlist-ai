import { apiKeyStatusSchema } from '@shortlist-ai/shared';
import { apiRequest } from '../../lib/api';

const path = '/settings/api-key';

export const apiKeyApi = {
  status: () => apiRequest(path, { schema: apiKeyStatusSchema }),
  save: (apiKey: string) => apiRequest(path, { method: 'PUT', body: { apiKey }, schema: apiKeyStatusSchema }),
  test: () => apiRequest(`${path}/test`, { method: 'POST', schema: apiKeyStatusSchema }),
  remove: () => apiRequest(path, { method: 'DELETE' }),
};
