/** Every Original lives at uploads/<user id>/<resume id>/<sanitised file name>. Built only from ids and the sanitised name. */
const ROOT = 'uploads';

export const userPrefix = (userId: string) => `${ROOT}/${userId}/`;
export const resumePrefix = (userId: string, resumeId: string) =>
  `${userPrefix(userId)}${resumeId}/`;
export const originalKey = (userId: string, resumeId: string, filename: string) =>
  `${resumePrefix(userId, resumeId)}${filename}`;

/** The owner and Resume an object key belongs to, or null if it is not shaped like an Original's key. */
export function parseOriginalKey(key: string): { userId: string; resumeId: string } | null {
  const match = /^uploads\/([^/]+)\/([0-9a-f-]{36})\/[^/]+$/.exec(key);
  return match ? { userId: match[1]!, resumeId: match[2]! } : null;
}
