/**
 * DynamoDB repository for order creation and reads.
 * See docs/TACTICAL-DESIGN.md §5 and §12.
 */

import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { fail, ok, type Result } from "@/domain/errors";
import type { OrderEvent, OrderSnapshot } from "@/domain/fsm/types";
import { getDynamoClients } from "./client";
import {
  eventSkPrefix,
  fromOrderEventItem,
  fromOrderItem,
  GSI2SK_ORDER,
  gsi2pkToken,
  orderSk,
  tenantPk,
  toOrderEventItem,
  toOrderItem,
} from "./keys";

export interface OrderPersistence {
  createOrder(order: OrderSnapshot, events: OrderEvent[]): Promise<Result<OrderSnapshot>>;
  getOrder(tenantId: string, orderId: string): Promise<OrderSnapshot | null>;
  getOrderByPublicToken(publicToken: string): Promise<OrderSnapshot | null>;
  listOrderEvents(tenantId: string, orderId: string): Promise<OrderEvent[]>;
}

function getErrorName(err: unknown): string {
  if (err && typeof err === "object" && "name" in err) {
    return String((err as { name: unknown }).name);
  }
  return "";
}

export function createDynamoOrderRepository(
  docClient?: DynamoDBDocumentClient,
  tableNameOverride?: string,
): OrderPersistence {
  const resolveClient = () => {
    if (docClient && tableNameOverride) {
      return { doc: docClient, tableName: tableNameOverride };
    }
    const defaults = getDynamoClients();
    return {
      doc: docClient ?? defaults.doc,
      tableName: tableNameOverride ?? defaults.tableName,
    };
  };

  return {
    async createOrder(order, events) {
      if (events.length === 0) {
        return fail("VALIDATION_FAILED", "createOrder requires at least one initial event");
      }

      const { doc, tableName } = resolveClient();
      const orderItem = toOrderItem(order);
      const transactItems = [
        {
          Put: {
            TableName: tableName,
            Item: orderItem,
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        ...events.map((event) => ({
          Put: {
            TableName: tableName,
            Item: toOrderEventItem(event),
            ConditionExpression: "attribute_not_exists(PK)",
          },
        })),
      ];

      try {
        await doc.send(
          new TransactWriteCommand({
            TransactItems: transactItems,
          }),
        );
        return ok(order);
      } catch (err) {
        const name = getErrorName(err);
        if (name === "TransactionCanceledException") {
          return fail("STALE_VERSION", "Order or event already exists", {
            orderId: order.orderId,
          });
        }
        if (name === "ProvisionedThroughputExceededException") {
          return fail("RATE_LIMITED", "DynamoDB throughput exceeded; retry shortly");
        }
        return fail("INTERNAL", "Failed to persist order", {
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async getOrder(tenantId, orderId) {
      const { doc, tableName } = resolveClient();
      const res = await doc.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            PK: tenantPk(tenantId),
            SK: orderSk(orderId),
          },
        }),
      );
      if (!res.Item) return null;
      return fromOrderItem(res.Item);
    },

    async getOrderByPublicToken(publicToken) {
      const { doc, tableName } = resolveClient();
      const res = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "GSI2",
          KeyConditionExpression: "GSI2PK = :pk AND GSI2SK = :sk",
          ExpressionAttributeValues: {
            ":pk": gsi2pkToken(publicToken),
            ":sk": GSI2SK_ORDER,
          },
          Limit: 1,
        }),
      );
      const item = res.Items?.[0];
      if (!item) return null;
      return fromOrderItem(item);
    },

    async listOrderEvents(tenantId, orderId) {
      const { doc, tableName } = resolveClient();
      const res = await doc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
          ExpressionAttributeValues: {
            ":pk": tenantPk(tenantId),
            ":prefix": eventSkPrefix(orderId),
          },
          ScanIndexForward: true,
        }),
      );
      return (res.Items ?? []).map(fromOrderEventItem);
    },
  };
}
