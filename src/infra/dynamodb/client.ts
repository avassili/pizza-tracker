/**
 * DynamoDB client factory with automatic Local vs. AWS switching.
 * See DESIGN.md §3.3 and docs/TACTICAL-DESIGN.md §12.
 *
 * - When `DYNAMODB_ENDPOINT` is set, routes to DynamoDB Local with local dev creds.
 * - When absent, uses the ambient AWS SDK credential chain (Lambda IAM role).
 */

import { DynamoDBClient, type DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const DEFAULT_TABLE_NAME = "PizzaTrackerDev";
export const DEFAULT_REGION = "us-east-1";

export interface DynamoClients {
  raw: DynamoDBClient;
  doc: DynamoDBDocumentClient;
  tableName: string;
  endpoint?: string;
}

let cachedClients: DynamoClients | null = null;

export function getTableName(): string {
  return process.env.DYNAMODB_TABLE_NAME?.trim() || DEFAULT_TABLE_NAME;
}

export function createDynamoClients(): DynamoClients {
  const endpoint = process.env.DYNAMODB_ENDPOINT?.trim() || undefined;
  const region = process.env.AWS_REGION?.trim() || DEFAULT_REGION;
  const tableName = getTableName();

  const config: DynamoDBClientConfig = endpoint
    ? {
        region,
        endpoint,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim() || "localdevkey",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim() || "localdevsecret",
        },
      }
    : { region };

  const raw = new DynamoDBClient(config);
  const doc = DynamoDBDocumentClient.from(raw, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });

  return { raw, doc, tableName, endpoint };
}

export function getDynamoClients(): DynamoClients {
  if (!cachedClients) {
    cachedClients = createDynamoClients();
  }
  return cachedClients;
}

/** @internal test seam */
export function resetDynamoClients(): void {
  cachedClients = null;
}
