import type { ObjectInfo, ObjectStore, PresignedUpload } from './objectStore';

export interface RecordedUpload {
  key: string;
  contentType: string;
  size: number;
  expiresInSeconds: number;
}

export interface RecordedDownload {
  key: string;
  filename: string;
  expiresInSeconds: number;
}

/**
 * In-memory stand-in for the uploads bucket, for tests. Presigning only records what was asked for,
 * so tests can check the signed size, type, key and expiry. Simulate a browser upload with `put`.
 */
export function createFakeObjectStore() {
  const objects = new Map<string, { body: Uint8Array; contentType: string | undefined }>();
  const uploads: RecordedUpload[] = [];
  const downloads: RecordedDownload[] = [];

  const store: ObjectStore = {
    async put(key, body, contentType) {
      objects.set(key, { body: Uint8Array.from(body), contentType });
    },
    async read(key) {
      const found = objects.get(key);
      return found ? Uint8Array.from(found.body) : null;
    },
    async head(key): Promise<ObjectInfo | null> {
      const found = objects.get(key);
      return found ? { size: found.body.byteLength, contentType: found.contentType } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
    async presignUpload(key, options): Promise<PresignedUpload> {
      uploads.push({ key, ...options });
      return {
        url: `https://fake-storage.test/${key}?signed=upload`,
        method: 'PUT',
        headers: { 'Content-Type': options.contentType },
        expiresInSeconds: options.expiresInSeconds,
      };
    },
    async presignDownload(key, options) {
      downloads.push({ key, ...options });
      return {
        url: `https://fake-storage.test/${key}?signed=download`,
        expiresInSeconds: options.expiresInSeconds,
      };
    },
  };

  return { store, objects, uploads, downloads };
}
