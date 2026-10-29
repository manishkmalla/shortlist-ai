/** A short-lived URL the browser uses to send a file straight to storage. */
export interface PresignedUpload {
  url: string;
  method: 'PUT';
  /** The exact headers the browser must send. The signature covers them, so anything else is rejected. */
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface ObjectInfo {
  size: number;
  contentType: string | undefined;
}

/**
 * Where Originals live. The app talks to storage only through this interface, so tests can use an
 * in-memory version and the real one can be S3. Keys are built from user and Resume ids, never from client input.
 */
export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  /** The object's bytes, or null if there is none. */
  read(key: string): Promise<Uint8Array | null>;
  /** Size and type without reading the bytes, or null if there is no object. */
  head(key: string): Promise<ObjectInfo | null>;
  /** Deleting something that does not exist is not an error. */
  delete(key: string): Promise<void>;
  /** Every key that starts with the prefix. */
  list(prefix: string): Promise<string[]>;
  /** A URL that accepts exactly one upload of this size and type. */
  presignUpload(
    key: string,
    options: { contentType: string; size: number; expiresInSeconds: number },
  ): Promise<PresignedUpload>;
  /** A URL that downloads the object as an attachment under the given name. */
  presignDownload(
    key: string,
    options: { filename: string; expiresInSeconds: number },
  ): Promise<{ url: string; expiresInSeconds: number }>;
}
