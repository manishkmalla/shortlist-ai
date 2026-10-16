/** Every item for a user lives under this partition key; all repo access is scoped by it. */
export const userPk = (userId: string) => `USER#${userId}`;
export const PROFILE_SK = 'PROFILE';
