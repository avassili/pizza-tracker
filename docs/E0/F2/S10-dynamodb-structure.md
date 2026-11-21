# E0-F2-S10: Create DynamoDB Order Structure and Submit Sample Order

| Field | Value |
| --- | --- |
| **Jira** | [PTS-146](https://vassilievandrei.atlassian.net/browse/PTS-146) |
| **Epic** | `E0` — Platform and 5-step domain foundation (`PTS-1`) |
| **Feature** | `F2` — Backend - persistence and seeding (`PTS-12`) |
| **Story** | `S10` — Create DynamoDB order structure and submit sample order |
| **Milestone** | `M0` |
| **Design Refs** | `DESIGN.md` §3.3, §4 · `docs/TACTICAL-DESIGN.md` §3–5, §12, §16 |
| **Related Backlog Stories** | `PTS-45` (`E0-F2-S01`), `PTS-46` (`E0-F2-S02`), `PTS-47` (`E0-F2-S03`), `PTS-52` (`E0-F2-S08`) |

---

## Why

Establish the single-table DynamoDB database structure to accept orders and provide simple runnable code to submit a sample order into the database and read it back.

---

## Database Structure

- **Table:** `PizzaTrackerDev` (local) / `PizzaTracker` (prod)
- **Billing Mode:** `PROVISIONED` (`5 RCU / 5 WCU`)
- **Primary Key:**
  - `PK` (`S`): `TENANT#<tenantId>`
  - `SK` (`S`): `ORDER#<orderId>` (snapshot) · `ORDER#<orderId>#EVT#<ulid>` (event ledger)
- **GSI1 (Status Queue):**
  - `GSI1PK` (`S`): `TENANT#<tenantId>#QUEUE#<active|terminal>`
  - `GSI1SK` (`S`): `STEP#<stepKey>#TS#<stepEnteredAt>#ORDER#<orderId>`
  - Projection: `ALL` (`5 RCU / 5 WCU`)
- **GSI2 (Public Token Deep-Link):**
  - `GSI2PK` (`S`): `TOKEN#<publicToken>`
  - `GSI2SK` (`S`): `ORDER`
  - Projection: `ALL` (`5 RCU / 5 WCU`)

---

## Implementation Files

- `src/infra/dynamodb/client.ts` — Switches between DynamoDB Local (`DYNAMODB_ENDPOINT`) and ambient AWS IAM credentials; sets `removeUndefinedValues: true`.
- `src/infra/dynamodb/keys.ts` — Single source of truth for `PK`, `SK`, `GSI1`, `GSI2` builders and `toOrderItem`, `fromOrderItem`, `toOrderEventItem`, `fromOrderEventItem`.
- `src/infra/dynamodb/orderRepository.ts` — Transactional `createOrder` (`TransactWriteCommand` writing order snapshot + `ORDER_PLACED` event with `attribute_not_exists(PK)`), plus `getOrder`, `getOrderByPublicToken`, and `listOrderEvents`.
- `scripts/init-db.ts` — Idempotent TypeScript table provisioner (`npm run db:init`) matching `.devcontainer/init-dynamodb.sh`.
- `scripts/submit-sample-order.ts` — Builds a sample order with `createOrderSnapshot`, writes it to DynamoDB, and verifies retrieval by `PK`/`SK` and `GSI2` (`publicToken`).
- Tests:
  - `src/infra/dynamodb/client.test.ts`
  - `src/infra/dynamodb/keys.test.ts`
  - `src/infra/dynamodb/orderRepository.test.ts`
  - `src/infra/dynamodb/orderRepository.integration.test.ts` (runs when `DYNAMODB_ENDPOINT` is set)

---

## Acceptance Criteria

- [x] **AC1:** `src/infra/dynamodb/client.ts` switches to DynamoDB Local when `DYNAMODB_ENDPOINT` is set and uses ambient IAM credentials otherwise.
- [x] **AC2:** `src/infra/dynamodb/keys.ts` centralizes all `PK`/`SK`/`GSI1`/`GSI2` builders and item mappers.
- [x] **AC3:** `scripts/init-db.ts` (`npm run db:init`) idempotently provisions `PizzaTrackerDev` with `PK`/`SK`, `GSI1`, and `GSI2` (`PROVISIONED 5/5`).
- [x] **AC4:** `src/infra/dynamodb/orderRepository.ts` persists a new v1 order (`orderPlaced`) and its `ORDER_PLACED` event atomically via `TransactWriteItems`.
- [x] **AC5:** `scripts/submit-sample-order.ts` (`npm run db:sample-order`) submits a sample order to DynamoDB and verifies retrieval by `PK`/`SK` and `GSI2`.
- [x] **AC6:** Unit tests, `npm run typecheck`, and `npm run lint` pass cleanly.

---

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run db:init
npm run db:sample-order
```
