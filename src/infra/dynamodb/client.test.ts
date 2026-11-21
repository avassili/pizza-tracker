import { afterEach, describe, expect, it } from "vitest";
import { createDynamoClients, getTableName, resetDynamoClients } from "./client";

describe("DynamoDB client factory", () => {
  const originalEndpoint = process.env.DYNAMODB_ENDPOINT;
  const originalTable = process.env.DYNAMODB_TABLE_NAME;
  const originalRegion = process.env.AWS_REGION;

  afterEach(() => {
    if (originalEndpoint === undefined) delete process.env.DYNAMODB_ENDPOINT;
    else process.env.DYNAMODB_ENDPOINT = originalEndpoint;

    if (originalTable === undefined) delete process.env.DYNAMODB_TABLE_NAME;
    else process.env.DYNAMODB_TABLE_NAME = originalTable;

    if (originalRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = originalRegion;

    resetDynamoClients();
  });

  it("uses DynamoDB Local when DYNAMODB_ENDPOINT is set", () => {
    process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";
    process.env.DYNAMODB_TABLE_NAME = "PizzaTrackerDev";
    const clients = createDynamoClients();

    expect(clients.endpoint).toBe("http://localhost:8000");
    expect(clients.tableName).toBe("PizzaTrackerDev");
  });

  it("defaults to ambient AWS mode when DYNAMODB_ENDPOINT is absent", () => {
    delete process.env.DYNAMODB_ENDPOINT;
    delete process.env.DYNAMODB_TABLE_NAME;
    const clients = createDynamoClients();

    expect(clients.endpoint).toBeUndefined();
    expect(clients.tableName).toBe("PizzaTrackerDev");
    expect(getTableName()).toBe("PizzaTrackerDev");
  });
});
