#!/usr/bin/env tsx
/**
 * Provisions the PizzaTracker single-table schema (PK/SK + GSI1 + GSI2,
 * PROVISIONED 5 RCU / 5 WCU) idempotently.
 *
 * Mirrors `.devcontainer/init-dynamodb.sh` per docs/TACTICAL-DESIGN.md §16.
 */

import {
  CreateTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { createDynamoClients } from "../src/infra/dynamodb/client";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDynamoReady(client: DynamoDBClient, maxAttempts = 30): Promise<void> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      await client.send(new ListTablesCommand({ Limit: 1 }));
      return;
    } catch (err) {
      if (i === maxAttempts) {
        throw new Error(
          `DynamoDB did not become ready after ${maxAttempts} attempts: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      await sleep(500);
    }
  }
}

async function waitForTableActive(
  client: DynamoDBClient,
  tableName: string,
  maxAttempts = 30,
): Promise<void> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    const desc = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (desc.Table?.TableStatus === "ACTIVE") {
      return;
    }
    await sleep(300);
  }
  throw new Error(`Table ${tableName} did not reach ACTIVE state in time`);
}

export async function ensurePizzaTrackerTable(
  client: DynamoDBClient,
  tableName: string,
): Promise<{ created: boolean; tableName: string; gsis: string[] }> {
  await waitForDynamoReady(client);

  const tables = await client.send(new ListTablesCommand({}));
  if (tables.TableNames?.includes(tableName)) {
    const existing = await client.send(new DescribeTableCommand({ TableName: tableName }));
    const gsis =
      existing.Table?.GlobalSecondaryIndexes?.map((g) => g.IndexName ?? "").filter(Boolean) ?? [];
    return { created: false, tableName, gsis };
  }

  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PROVISIONED",
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5,
      },
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
        { AttributeName: "GSI2PK", AttributeType: "S" },
        { AttributeName: "GSI2SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI1",
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
        {
          IndexName: "GSI2",
          KeySchema: [
            { AttributeName: "GSI2PK", KeyType: "HASH" },
            { AttributeName: "GSI2SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
    }),
  );

  await waitForTableActive(client, tableName);
  const created = await client.send(new DescribeTableCommand({ TableName: tableName }));
  const gsis =
    created.Table?.GlobalSecondaryIndexes?.map((g) => g.IndexName ?? "").filter(Boolean) ?? [];
  return { created: true, tableName, gsis };
}

async function main(): Promise<void> {
  // For local CLI execution outside the devcontainer, default to localhost:8000.
  if (!process.env.DYNAMODB_ENDPOINT) {
    process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";
  }

  const { raw, tableName, endpoint } = createDynamoClients();
  console.log(`Initializing table '${tableName}' at ${endpoint ?? "AWS DynamoDB"}...`);

  const result = await ensurePizzaTrackerTable(raw, tableName);
  if (result.created) {
    console.log(`Created table '${result.tableName}' (GSIs: ${result.gsis.join(", ")}).`);
  } else {
    console.log(
      `Table '${result.tableName}' already exists (GSIs: ${result.gsis.join(", ")}) — skipped.`,
    );
  }
}

const isDirectRun = process.argv[1]?.endsWith("init-db.ts");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Failed to initialize DynamoDB table:", err);
    process.exit(1);
  });
}
