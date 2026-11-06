import { userPrefix } from './objectKeys';
import type { ObjectStore } from './objectStore';

/** Everything a user has uploaded, as one thing to clean up when their account goes. */
export interface UserFiles {
  deleteAllFor(userId: string): Promise<void>;
}

/**
 * Lists the files under the user's own prefix (with its trailing slash, so user "a" never matches user "ab")
 * and deletes them. Safe to repeat: a second run finds nothing left.
 */
export function createUserFiles(store: ObjectStore): UserFiles {
  return {
    async deleteAllFor(userId) {
      for (const key of await store.list(userPrefix(userId))) await store.delete(key);
    },
  };
}
