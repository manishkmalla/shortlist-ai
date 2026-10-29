import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectInfo, ObjectStore, PresignedUpload } from './objectStore';

const isMissing = (e: unknown) =>
  e instanceof Error && (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.name === '404');

/** The uploads bucket. Keys come from objectKeys.ts, never from client input. */
export function createS3ObjectStore(
  bucket: string,
  // The SDK adds a checksum by default. For a presigned upload that would be the checksum of an empty body,
  // and storage would reject every real file. Only add checksums when an operation requires one.
  client: S3Client = new S3Client({
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  }),
): ObjectStore {
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async read(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return out.Body ? await out.Body.transformToByteArray() : null;
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },

    async head(key): Promise<ObjectInfo | null> {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: out.ContentLength ?? 0, contentType: out.ContentType };
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of page.Contents ?? []) if (o.Key) keys.push(o.Key);
        token = page.NextContinuationToken;
      } while (token);
      return keys;
    },

    async presignUpload(key, { contentType, size, expiresInSeconds }): Promise<PresignedUpload> {
      // Content-Type and Content-Length are part of the signature, so storage rejects a different type or size.
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: size,
        }),
        {
          expiresIn: expiresInSeconds,
          signableHeaders: new Set(['content-type', 'content-length']),
        },
      );
      // Browsers set Content-Length themselves from the file, so only Content-Type is sent explicitly.
      return { url, method: 'PUT', headers: { 'Content-Type': contentType }, expiresInSeconds };
    },

    async presignDownload(key, { filename, expiresInSeconds }) {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${filename}"`,
          ResponseContentType: 'application/octet-stream',
        }),
        { expiresIn: expiresInSeconds },
      );
      return { url, expiresInSeconds };
    },
  };
}
