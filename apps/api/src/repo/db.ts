import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** The subset of the document client the repos use, so tests can supply an in-memory fake. */
export type Db = Pick<DynamoDBDocumentClient, 'send'>;

export const createDb = (): Db => DynamoDBDocumentClient.from(new DynamoDBClient({}));
