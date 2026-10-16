import { Logger } from '@aws-lambda-powertools/logger';

/** Log IDs and sizes only. Never emails, names, resume or job text, or API keys. */
export const logger = new Logger({ serviceName: 'shortlist-ai-api' });
