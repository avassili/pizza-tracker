# Pizza Tracker — Tactical Design (5-Step Tracker)

| Field | Value |
| --- | --- |
| **Status** | Normative. Where this document and `DESIGN.md` disagree, this document wins. Every deviation is listed in §18. |
| **Scope** | FSM write path, customer tracker read path, staff queue read path, persistence contract, RBAC, customer↔store conversation. Out of scope: SST/Cognito/SES (Phase 5), checkout UX beyond `createOrder`. |
| **Baseline** | Next.js 15.5.28 (App Router) · React 19.1 · TypeScript 5.9 strict · Tailwind v4 · DynamoDB Local 3.3.2 |
| **Table** | `PizzaTrackerDev` locally / `PizzaTracker` in prod — `PK`/`SK` + `GSI1` + `GSI2`, all `PROVISIONED 5/5` |

---

## 1. The five steps — canonical registry

The stage list currently hardcoded in `src/app/page.tsx` (`ordered / prep / baking / delivery / delivered`) is **wrong** and is replaced by this.

| # | `StepKey` | Rank | Customer label key | Staff label | Owner role |
| --- | --- | --- | --- | --- | --- |
| 0 | `orderPlaced` | 0 | `step.orderPlaced.title` | Ticket in queue | kitchen |
| 1 | `orderInProgress_Stage1` | 1 | `step.stage1.title` | Prep / assembly | kitchen |
| 2 | `orderInProgress_Stage2` | 2 | `step.stage2.title` | Bake / QC | kitchen |
| 3 | `orderInProgress_Stage3` | 3 | `step.stage3.title` | Pack / dispatch | driver |
| 4 | `orderComplete` | 4 | `step.complete.title` | Closed | driver |

`cancelled` is a **terminal state**, not a step.

```ts
// src/domain/fsm/steps.ts
export const STEP_KEYS = [
  "orderPlaced",
  "orderInProgress_Stage1",
  "orderInProgress_Stage2",
  "orderInProgress_Stage3",
  "orderComplete",
] as const;
export type StepKey = (typeof STEP_KEYS)[number];
```

Ranks are contiguous `0..4`; `STEP_BY_RANK[rank]` is total; an unknown key is always rejected by `isStepKey`.

---

## 2. Core model decision: `status` ⟂ `stepKey` ⟂ `inputState`

`DESIGN.md` §5.3 says an input request "changes the order status to `awaiting_input`". That would create a sixth milestone and make the queue partition move on every message. **Rejected.** Three independent facets:

```ts
export type OrderStatus = "active" | "completed" | "cancelled";

interface OrderSnapshot {
  status: OrderStatus;      // lifecycle
  stepKey: StepKey;         // position in the 5-step flow
  inputState: InputState;   // is the customer blocking us?
}
```

Consequences:

- `awaiting_input` is **not** a status and **not** a step. It is `inputState.pending === true`, which *gates* `advance` (§7).
- `status === "completed"` ⟺ `stepKey === "orderComplete"`. Both are stored so GSI queries never infer one from the other.
- `cancelled` freezes `stepKey` at the step where the order died and records `cancelledAtStep`.

---

## 3. Order snapshot item — attribute contract

`PK = TENANT#<tenantId>` · `SK = ORDER#<orderId>`

| Attribute | Type | Req | Notes |
| --- | --- | --- | --- |
| `entity` | S | ✅ | `"order"` — discriminator for single-table queries |
| `tenantId` | S | ✅ | |
| `orderId` | S | ✅ | ULID — sortable by creation time |
| `status` | S | ✅ | `active \| completed \| cancelled` |
| `stepKey` | S | ✅ | one of the five |
| `stepRank` | N | ✅ | denormalized `STEP_RANK[stepKey]` |
| `maxStepRank` | N | ✅ | high-water mark, monotonically non-decreasing; masks loopbacks (§15) |
| `version` | N | ✅ | optimistic lock; starts at `1`, `+1` per accepted action |
| `publicToken` | S | ✅ | 26-char Crockford base32, **not** derived from `orderId` (§4.2) |
| `configVersion` | N | ✅ | pins the `TenantConfig` version the order started on |
| `customer` | M | ✅ | `{ name, phone?, locale? }` |
| `items` | L | ✅ | `[{ name, size, toppings[], qty, notes? }]` |
| `totals` | M | ✅ | `{ subtotalCents, taxCents, totalCents, currency }` |
| `paymentStatus` | S | ✅ | `unpaid \| authorized \| paid \| refunded` — a seam only, no provider |
| `fulfilment` | S | ✅ | `delivery \| pickup` |
| `inputState` | M | ✅ | `{ pending, inputId?, schemaKey?, requestedAt?, requestedBy? }` |
| `restartCount` | M | ✅ | `{ [stepKey]: number }`, sparse |
| `timeline` | L | ✅ | `[{ stepKey, enteredAt, exitedAt?, actorRole }]`, capped at 32 |
| `stepEnteredAt` | S | ✅ | ISO-8601 UTC — the ETA anchor |
| `createdBy` | M | ✅ | `{ role, id }` |
| `createdAt` / `updatedAt` | S | ✅ | ISO-8601 UTC, millisecond precision |
| `completedAt` | S | — | set on entry to `orderComplete` |
| `cancelledAt` / `cancelledAtStep` / `cancelReason` | S | — | set on cancel |
| `GSI1PK` | S | ✅ | `TENANT#<t>#QUEUE#active` \| `#QUEUE#terminal` |
| `GSI1SK` | S | ✅ | `STEP#<stepKey>#TS#<stepEnteredAt>#ORDER#<orderId>` |
| `GSI2PK` | S | ✅ | `TOKEN#<publicToken>` |
| `GSI2SK` | S | ✅ | `ORDER` |

All timestamps are **millisecond-precision ISO strings** (`toISOString()`), never epoch numbers — `GSI1SK` must sort lexicographically.

The domain layer does **not** set `GSI*` or `entity`: `src/infra/dynamodb/keys.ts` is the single source of truth and maps a snapshot to an item (`toOrderItem`). Tests assert `queueBucket(order)` and the step, never raw key strings.

## 4. Key builders and the GSI1 redesign

```ts
// src/infra/dynamodb/keys.ts
export const tenantPk = (t: string) => `TENANT#${t}`;
export const orderSk = (o: string) => `ORDER#${o}`;
export const eventSk = (o: string, ulid: string) => `ORDER#${o}#EVT#${ulid}`;
export const inputSk = (o: string, i: string) => `ORDER#${o}#INPUT#${i}`;
export const msgSk = (o: string, ulid: string) => `ORDER#${o}#MSG#${ulid}`;
export const roleSk = (r: string) => `ROLE#${r}`;
export const configSk = (v: number) => `CONFIG#${String(v).padStart(5, "0")}`;
export const PROFILE_SK = "PROFILE";

export const gsi1pkQueue = (t: string, bucket: "active" | "terminal") => `TENANT#${t}#QUEUE#${bucket}`;
export const gsi1skStep = (step: StepKey, enteredAt: string, orderId: string) =>
  `STEP#${step}#TS#${enteredAt}#ORDER#${orderId}`;
export const gsi1skStepPrefix = (step: StepKey) => `STEP#${step}#TS#`;

export const gsi2pkToken = (token: string) => `TOKEN#${token}`;
export const GSI2SK_ORDER = "ORDER";
```

### 4.1 Why GSI1 has two buckets instead of one per status

`DESIGN.md` §4.2 specified `GSI1PK = TENANT#<id>#STATUS#<status>`. Taken literally that creates one partition per status — six once input requests exist — and an item *moves between partitions* on every input request, which breaks cursor stability mid-pagination.

Instead: **two buckets**, with step filtering on the sort key.

```
Query GSI1: GSI1PK = "TENANT#acme#QUEUE#active"
            begins_with(GSI1SK, "STEP#orderInProgress_Stage1#TS#")
            ScanIndexForward = true      // oldest ticket first
```

Why this is better:

- One query per board tab, with correct FIFO ordering for free.
- `restart` / `loopback` rewrite `GSI1SK`, so the ticket re-sorts at its new `stepEnteredAt` — exactly the desired queue behaviour — without changing partition.
- Completed and cancelled orders leave the hot partition immediately, which is what keeps the board inside 5 RCU.
- Invariant: every order sits in exactly one queue bucket at all times (asserted in tests).

### 4.2 `publicToken`

`orderId` is a ULID and therefore leaks creation time — acceptable, it is internal. `publicToken` is a **bearer capability placed in a URL**, so it must not be inferable or enumerable.

```
publicToken = Crockford-Base32(128 bits from crypto.getRandomValues)   // 26 chars
```

Stored in plaintext because it *is* the GSI2 lookup key; hashing it would forbid the lookup and buy nothing. Non-expiring in v1; `tokenRotatedAt` is the extension point if revocation is ever needed. **Known limitation, stated explicitly rather than implied.**

---

## 5. Atomicity: one `TransactWriteItems` per mutation

A transition is never a lone `UpdateItem`:

```
TransactWriteItems {
  Update  order item   ConditionExpression: version = :expected AND status = :active
  Put     event item   ConditionExpression: attribute_not_exists(PK)
  Put     input / message item   (only when the action produces one)
}
```

- ≤4 items — far under the 100-item / 4 MB transaction limit; DynamoDB Local 3.3.2 supports transactions.
- The `version` condition is the real optimistic lock; `attribute_not_exists` makes the ledger idempotent per event.
- `TransactWriteItems` returns no values, so the handler computes the post-state **in memory** from the snapshot it just read and returns that projection — one read saved per action, which matters at 5 RCU.
- `TransactionCanceledException.CancellationReasons[0].Code === "ConditionalCheckFailed"` ⇒ `STALE_VERSION`.

### 5.1 Event ledger item

`PK = TENANT#<t>` · `SK = ORDER#<o>#EVT#<ulid>`

| Attribute | Notes |
| --- | --- |
| `entity` | `"orderEvent"` |
| `type` | `ORDER_PLACED \| ADVANCE \| RESTART \| LOOPBACK \| CANCEL \| INPUT_REQUESTED \| INPUT_SUBMITTED` |
| `fromStep` / `toStep` | equal for `RESTART` and both `INPUT_*` types |
| `fromStatus` / `toStatus` | lifecycle |
| `actorRole` / `actorId` | `customer \| kitchen_staff \| delivery_driver \| store_manager \| system` |
| `orderVersion` | the version **after** this event |
| `at` / `requestId` | ISO-8601 / correlates with the console notification log |
| `reason?` / `resolution?` / `metadata?` | optional |

A plain `Query` on the order's `EVT#` prefix returns the ledger chronologically — no extra index, thanks to ULIDs.

### 5.2 ULID, zero dependency

`src/domain/ids.ts`: 48-bit millisecond timestamp + 80 bits of randomness, Crockford base32, with a monotonic counter so two IDs generated in the same millisecond are strictly increasing. Uses `globalThis.crypto.getRandomValues` (Node 20+ and every browser). No `ulid` package.

## 6. Input checkpoints — blocking customer decisions

`DESIGN.md` §5.3 says an input result "can automatically trigger" a transition but never says how that is decided. **The input schema declares the resolution**, so behaviour is tenant data rather than code.

```ts
export interface InputSchema {
  schemaKey: string;                                   // "ingredient_substitution"
  promptKey: string;                                   // i18n key
  options: { value: string; labelKey: string }[];
  freeText: boolean;
  resolution: {
    onAccept: "advance" | "restart" | "loopback" | "none";
    onDecline: "advance" | "restart" | "loopback" | "none";
  };
  expiresAfterSeconds?: number;                        // default 900
}
```

`ORDER#<o>#INPUT#<inputId>`:

| Attribute | Notes |
| --- | --- |
| `entity` | `"orderInput"` |
| `status` | `pending \| submitted \| expired` |
| `schemaKey` / `requestedAt` / `requestedBy` | who asked, and from which point in the flow |
| `response?` / `submittedAt?` / `resolutionApplied?` | written on submit |

Flow:

1. `requestCustomerInput` writes the input item `status:"pending"` **and** sets `order.inputState = { pending: true, inputId, schemaKey, requestedAt, requestedBy }`. The step does not change.
2. The public tracker renders the prompt straight from `inputState` — no auth needed, so the customer can answer.
3. `submitCustomerInput` validates the response against the schema, sets `status:"submitted"`, clears `inputState.pending`, then **applies `resolution` inside the same transaction**, recording a second event (`INPUT_SUBMITTED` then e.g. `ADVANCE`, with `version` bumped twice).
4. Auto-resolution **bypasses the actor permission check** (the system is acting on the customer's answer) but **must still satisfy** the payment guard and the terminal-state guard. Documented invariant, tested.

---

## 6b. Conversation — messages are not input requests

Every step (0–4) must let the customer and the store talk. This is `BO-3`. It needs an entity the original design did not have.

| | Message (`MSG#`) | Input request (`INPUT#`) |
| --- | --- | --- |
| Purpose | Free-form conversation / notes | Structured decision the business needs |
| Blocks `advance` | **No** | **Yes** |
| Auth | public token (customer) / role (staff) | public token + schema validation |
| Cardinality | many per order | at most one pending per order |
| Resolution | none — never mutates the FSM | `advance \| restart \| loopback \| none` |

`ORDER#<o>#MSG#<ulid>`:

| Attribute | Notes |
| --- | --- |
| `entity` | `"message"` |
| `direction` | `customer_to_store \| store_to_customer` |
| `stepKey` | the step the message was sent in — makes threads groupable per step |
| `visibility` | `customer_visible \| internal` (internal notes never leave the store) |
| `body` | plain text, ≤2000 chars, trimmed |
| `authorRole` / `authorId` | who sent it |
| `readAt?` | read receipt per side |
| `at` | ISO-8601 |

Rules: rate-limited per order (`RATE_LIMITED`); PII (phone, address, gate codes) redacted for roles that do not own the order; attachments deferred to S3 in Phase 5.

### 6c. Per-step conversation matrix

| Step | Customer → Store | Store → Customer | Blocking input request |
| --- | --- | --- | --- |
| **0 `orderPlaced`** | Order note, "fix my address" | "We've got it" + promised ETA | Out-of-stock substitution |
| **1 `Stage1`** | Add/remove item, "well done", allergy note | Allergen/quantity confirmation | Allergen confirmation |
| **2 `Stage2`** | "how's it going?", "don't burn it" | "Remaking it, +8 min" | Photo approval / remake consent |
| **3 `Stage3`** | Gate code, "leave at door", "call me" | "Arriving in 5 min" | "Confirm you're home" |
| **4 `orderComplete`** | Rating, complaint, "missing item" | Receipt + thank-you | — (terminal; non-blocking only) |

Every step therefore ships at least one customer→store and one store→customer path; that is the acceptance shape for `BO-3`.

## 7. Transition table — authoritative

| From | Action | To | Guards (all must pass) | Required permission |
| --- | --- | --- | --- | --- |
| — | `create` | `orderPlaced` | ≥1 item, totals non-negative, tenant resolves | `order:create` |
| `orderPlaced` | `advance` | `Stage1` | not input-pending | `step:advance:orderPlaced` |
| `Stage1` | `advance` | `Stage2` | not input-pending | `step:advance:orderInProgress_Stage1` |
| `Stage2` | `advance` | `Stage3` | not input-pending | `step:advance:orderInProgress_Stage2` |
| `Stage3` | `advance` | `orderComplete` | not input-pending **AND** payment settled¹ | `step:advance:orderInProgress_Stage3` |
| `Stage1` | `restart` | `Stage1` | — | `step:restart:orderInProgress_Stage1` |
| `Stage2` | `restart` | `Stage2` | — | `step:restart:orderInProgress_Stage2` |
| `Stage3` | `restart` | `Stage3` | — | `step:restart:orderInProgress_Stage3` |
| `Stage1` | `loopback` | `orderPlaced` | — | `step:loopback:orderInProgress_Stage1` |
| `Stage2` | `loopback` | `Stage1` | — | `step:loopback:orderInProgress_Stage2` |
| `Stage3` | `loopback` | `Stage2` | — | `step:loopback:orderInProgress_Stage3` |
| any `active` | `cancel` | `cancelled` (step frozen) | `reason` ≥3 chars | `order:cancel` |
| any `active` | `requestInput` | unchanged | no pending input, `schemaKey` known | `input:request` |
| pending input | `submitInput` | per `resolution` | input pending, id matches, response valid | `input:submit` |

¹ `paymentStatus === "paid"` **or** `!config.businessRules.requirePaymentSettledToComplete`.

### 7.1 Invariants (all asserted in tests)

- `restart` is allowed on Stages 1–3 only — not on `orderPlaced`, not on `orderComplete`.
- `advance` can never skip a rank; `loopback` can never go below `orderPlaced`.
- `orderComplete` and `cancelled` are terminal: every action other than a read returns `TERMINAL_STATE`.
- `maxStepRank = max(maxStepRank, STEP_RANK[toStep])` on every write — it never decreases.
- `version` increases by exactly `1` per accepted action (`2` for `submitInput` that auto-resolves).
- `stepEnteredAt` is rewritten on `advance`, `restart` and `loopback` — this is what re-sorts the queue and pushes the ETA out.
- Every order occupies exactly one queue bucket.

---

## 8. Errors — one envelope, fixed code set

```ts
export type AppErrorCode =
  | "VALIDATION_FAILED"     // 400  bad payload, unknown schemaKey, short reason
  | "UNAUTHENTICATED"       // 401  no session / unknown role / bad token
  | "FORBIDDEN"             // 403  permission missing
  | "NOT_FOUND"             // 404  order or token unknown
  | "INVALID_TRANSITION"    // 409  structurally impossible move (restart at rank 0)
  | "STALE_VERSION"         // 409  optimistic lock lost — client refetches
  | "INPUT_PENDING"         // 409  advance blocked by an open input request
  | "INPUT_NOT_PENDING"     // 409  submitInput with nothing pending
  | "PAYMENT_NOT_SETTLED"   // 409  completion gate
  | "TERMINAL_STATE"        // 409  order completed or cancelled
  | "RATE_LIMITED"          // 429  DynamoDB throttled or message flood
  | "INTERNAL";             // 500

export type AppError = { code: AppErrorCode; message: string; details?: Record<string, unknown> };
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };
```

Guard evaluation order is fixed — required for deterministic tests:

```
VALIDATION → UNAUTHENTICATED → NOT_FOUND → TERMINAL_STATE
           → STRUCTURAL_FEASIBILITY → FORBIDDEN → STALE_VERSION → domain guards
```

`STRUCTURAL_FEASIBILITY` sits before `FORBIDDEN` because a move that cannot exist (`restart` at `orderPlaced`, `advance` past `orderComplete`) is a client error, not an authorisation one. It leaks nothing: the current step is already visible to anyone who can name the order. `TERMINAL_STATE` stays ahead of it so a dead order always reports as dead.

`STALE_VERSION` is produced by the repository (DynamoDB condition), not the domain, so the domain reducer never sees it.

---

## 9. RBAC — normalized permission grammar

`DESIGN.md` §6 mixed styles (`step:advance:orderInProgress_Stage1` vs `step:restart:*`). Normalized to **colon-separated segments with `*` as a whole-segment wildcard**, matched only when segment counts are equal:

```ts
export function can(granted: readonly string[], required: string): boolean {
  const req = required.split(":");
  return granted.some((g) => {
    const seg = g.split(":");
    if (seg.length !== req.length) return false;
    return seg.every((s, i) => s === "*" || s === req[i]);
  });
}
```

Segment-count equality means `step:advance:*` grants `step:advance:orderPlaced` but **not** bare `step:advance` — no accidental over-grant.

| Role | Granted permissions |
| --- | --- |
| `customer` | `order:create`, `order:read_public`, `input:submit` |
| `kitchen_staff` | `order:read`, `step:advance:orderPlaced`, `step:advance:orderInProgress_Stage1`, `step:advance:orderInProgress_Stage2`, `step:restart:*`, `step:loopback:orderInProgress_Stage1`, `step:loopback:orderInProgress_Stage2`, `input:request` |
| `delivery_driver` | `order:read`, `step:advance:orderInProgress_Stage3`, `step:restart:orderInProgress_Stage3`, `step:loopback:orderInProgress_Stage3`, `input:request` |
| `store_manager` | Explicit full list (not a literal wildcard, so it stays auditable): all of the above + `order:cancel` + `tenant:config:write` |

The driver's completion right is `step:advance:orderInProgress_Stage3`, which produces `orderComplete`. `DESIGN.md` also listed `step:advance:orderComplete` — that permission guards a transition *out of* the terminal step and is removed as dead.

## 10. `TenantConfig` — required additions

```ts
export interface TenantConfig {
  tenantId: string;
  version: number;
  branding: { displayName: string; primaryColor: string; logoUrl?: string };
  defaultLocale: string;
  i18n: Record<string, Record<string, string>>;
  stepPresentations: Record<StepKey, { titleKey: string; detailKey: string; icon: string }>;
  stepDurations: Record<StepKey, number>;      // seconds — drives the ETA
  inputSchemas: Record<string, InputSchema>;   // drives §6
  rolePermissions: Record<string, Permission[]>;
  businessRules: {
    allowAdvanceWhileAwaitingInput: boolean;
    requirePaymentSettledToComplete: boolean;
  };
}
```

Loaded by `loadTenantConfig(tenantId, version)` → `GetItem(TENANT#<t>, CONFIG#<00003>)`, memoized **per request** in a module-level `Map` keyed `${tenantId}:${version}` (Lambda container reuse makes this a real saving at 5 RCU). Orders pin `configVersion` at creation, so bumping a config never reinterprets an in-flight order.

---

## 11. Domain layer — files and signatures (pure, no I/O)

```
src/domain/
├── ids.ts                    ulid(), publicToken(), ULID_CHARSET
├── errors.ts                 AppError, AppErrorCode, Result<T>, ok(), fail()
├── fsm/
│   ├── steps.ts              STEP_KEYS, STEP_RANK, STEP_BY_RANK, isStepKey, nextStep, prevStep
│   ├── types.ts              OrderStatus, InputState, OrderSnapshot, OrderEvent, OrderAction, TransitionContext, TransitionResult, NotificationIntent
│   ├── guards.ts             assertActive, assertNotInputPending, assertPaymentSettled
│   ├── create.ts             createOrderSnapshot() — validates and mints a v1 order
│   ├── transition.ts         transition() — the pure reducer
│   └── resolve.ts            resolveInputDecision(), applyMovement()
├── rbac/permissions.ts       Permission, can(), DEFAULT_ROLE_PERMISSIONS
└── config/schema.ts          TenantConfig, InputSchema, DEFAULT_TENANT_CONFIG
```

The reducer is synchronous, clock-injected and side-effect free:

```ts
export function transition(ctx: TransitionContext): TransitionResult;

export interface TransitionContext {
  actor: { role: Role; id: string };
  now: string;              // injected ISO timestamp — deterministic tests
  requestId: string;
  config: TenantConfig;
  order: OrderSnapshot;
  action: OrderAction;
}

export type TransitionResult =
  | {
      ok: true;
      order: OrderSnapshot;         // full next state, ready to persist
      events: OrderEvent[];         // 1, or 2 when an input auto-resolves
      input?: OrderInputItem;       // requestInput / submitInput
      notices: NotificationIntent[];
    }
  | { ok: false; error: AppError };
```

`events` is an array (not a single event) because `submitInput` can produce `INPUT_SUBMITTED` followed by `ADVANCE`/`RESTART`/`LOOPBACK` in one transaction.

`notices` is the notification port boundary: `ConsoleNotificationChannel` today, EventBridge in Phase 5. The domain never imports `@aws-sdk/*`, `next/*` or `react` — enforced by an ESLint `no-restricted-imports` rule scoped to `src/domain/**`.

---

## 12. Persistence — exact expressions

```ts
export interface OrderRepository {
  create(item: OrderSnapshot): Promise<Result<void>>;
  get(tenantId: string, orderId: string): Promise<OrderSnapshot | null>;
  getByPublicToken(tenantId: string, token: string): Promise<OrderSnapshot | null>;
  listQueue(tenantId: string, step: StepKey, opts: { cursor?: string; limit?: number }): Promise<
    { items: OrderSnapshot[]; cursor?: string }
  >;
  commit(
    next: OrderSnapshot,
    expectedVersion: number,
    events: OrderEvent[],
    sideItem?: OrderInputItem | OrderMessage,
  ): Promise<Result<void>>;
}
```

`commit` writes only touched attributes — never a whole-item `PUT`:

```
UpdateExpression:
  SET #status = :status, #stepKey = :stepKey, #stepRank = :rank,
      #maxStepRank = :maxRank, #version = :nextVersion,
      #stepEnteredAt = :stepEnteredAt, #updatedAt = :now,
      #inputState = :inputState,
      #timeline = list_append(#timeline, :timelineAppend),
      #GSI1PK = :gsi1pk, #GSI1SK = :gsi1sk,
      #completedAt = :completedAt,          -- only when entering orderComplete
      #cancelledAt = :cancelledAt,          -- only on cancel
      #cancelledAtStep = :cancelledAtStep,
      #cancelReason = :cancelReason,
      #restartCount.#step = if_not_exists(#restartCount.#step, :zero) + :one   -- only on restart
ConditionExpression: #version = :expectedVersion AND #status = :active
```

Details that bite if missed:

- `#step` inside `restartCount.#step` **must** be an `ExpressionAttributeNames` entry — never interpolated.
- `status` and `version` are reserved words: every attribute gets a `#` alias, no raw names anywhere.
- Optional attributes are **omitted** from `SET`, never set to `NULL` (`SET x = NULL` is invalid DynamoDB; deletion is `REMOVE`, which this design never needs).
- Entering a terminal state rewrites `GSI1PK` to `TENANT#<t>#QUEUE#terminal`, which is what keeps the active partition small.
- `DynamoDBDocumentClient` uses `marshallOptions: { removeUndefinedValues: true }`.

## 13. Executable surface — Next.js 15.5.28 specifics

### 13.1 Server Actions (mutations)

```ts
// src/app/actions/orders.ts
"use server";

export type OrderActionResult =
  | { ok: true; order: OrderSnapshot; notices: string[] }
  | { ok: false; error: AppError };

export async function advanceOrder(input: { orderId: string; expectedVersion: number }): Promise<OrderActionResult>;
export async function restartStep(input: { orderId: string; expectedVersion: number; reason?: string }): Promise<OrderActionResult>;
export async function loopbackStep(input: { orderId: string; expectedVersion: number; reason?: string }): Promise<OrderActionResult>;
export async function cancelOrder(input: { orderId: string; expectedVersion: number; reason: string }): Promise<OrderActionResult>;
export async function requestCustomerInput(input: { orderId: string; expectedVersion: number; schemaKey: string }): Promise<OrderActionResult>;
export async function submitCustomerInput(input: { orderId: string; inputId: string; response: Record<string, unknown> }): Promise<OrderActionResult>;
```

- `tenantId` and `actor` come from `getSession()`, **never** from client arguments — otherwise the mock header is a one-line privilege escalation.
- `expectedVersion` originates on the client from the version it rendered; missing ⇒ `VALIDATION_FAILED`.
- On success the action calls `revalidatePath` for the queue and tracker routes.

```ts
// src/infra/auth/mockSession.ts
export interface Session {
  tenantId: string;
  role: Role;
  actorId: string;
}
export async function getSession(): Promise<Result<Session>>; // reads `await headers()` — async in 15.x
```

Absent headers default to `{ tenantId: "acme", role: "customer" }` — lowest privilege.

### 13.2 Route handlers (reads and polling)

```ts
// src/app/api/t/[tenant]/orders/[token]/route.ts
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string; token: string }> }, // ⚠️ Promise in Next 15
) {
  const { tenant, token } = await ctx.params;
  // ...
}
```

- `GET /api/t/[tenant]/orders/[token]` → `TrackerViewModel`, `Cache-Control: no-store`, `ETag: W/"<version>"`, and **304** when `If-None-Match` matches.
- Unknown token ⇒ `404`, never `403` — don't leak token existence.
- `GET /api/t/[tenant]/queue?step=<stepKey>&cursor=<opaque>` → staff page, requires `order:read`. Cursor is base64 of `LastEvaluatedKey`. `limit` clamped to `1..25`, default 25 — the cap is what protects 5 RCU.

**Split of responsibility:** Server Actions for writes (same-origin, no CSRF surface); route handlers for polling (304s, cache-header friendly later).

---

## 14. Polling and free-tier arithmetic

| Consumer | Interval | Cost per request | Steady-state |
| --- | --- | --- | --- |
| Customer tracker | 3 s | 1 GSI2 query, eventually consistent, `ProjectionType: ALL` ⇒ whole item = **0.5 RCU** | ≈0.17 RCU/s per open tracker |
| Staff queue | 1 s (2 s in dev) | 1 GSI1 query, eventually consistent, ~1–2 RCU per page | ≈3–6 RCU/s for 3 boards |
| Any mutation | — | 1 transaction ≈ 1 WCU order + 1 WCU event + GSI propagation ≈ 4–5 WCU | — |

Provisioned total: table 5/5 + GSI1 5/5 + GSI2 5/5 = **15 RCU / 15 WCU** of the 25/25 free allowance → 10/10 headroom.

Customer traffic is the real risk (each open tracker ≈0.17 RCU/s; ~28 concurrent trackers saturate 5 RCU). Mitigations in order: (1) ETag/304 short-circuit, (2) SWR `refreshWhenHidden: false` + `dedupingInterval: 2000`, (3) only then raise GSI2 capacity, still inside the free allowance.

`ProvisionedThroughputExceededException` ⇒ `RATE_LIMITED`; the client backs off ×2 and never retries in a storm.

---

## 15. Tracker read model — the customer contract

```ts
export interface TrackerViewModel {
  tenant: { displayName: string; primaryColor: string; logoUrl?: string; locale: string };
  order: { publicToken: string; status: OrderStatus; placedAt: string };
  /** Exactly five entries, always, in rank order — the UI never branches on count. */
  milestones: Array<{
    stepKey: StepKey;
    label: string;
    detail: string;
    icon: string;
    state: "done" | "current" | "upcoming" | "skipped";
  }>;
  currentStepKey: StepKey;
  maxStepRank: number;
  recheck: boolean;
  etaIso: string | null;
  etaMinutes: number | null;
  pendingInput: {
    inputId: string;
    schemaKey: string;
    prompt: string;
    options: { value: string; label: string }[];
    freeText: boolean;
  } | null;
  cancelled: { at: string; reason: string } | null;
  version: number; // ETag source
}
```

**ETA** (replaces the hardcoded `remaining × 4 min`):

```
remaining   = Σ config.stepDurations[s] for s where rank(s) > order.stepRank
currentLeft = max(0, config.stepDurations[order.stepKey] - (now - stepEnteredAt) / 1000)
etaIso      = now + remaining·1000 + currentLeft·1000      // clamped to [0, 4h]
```

`completed` ⇒ `etaIso = null`; `cancelled` ⇒ `etaIso = null` plus the `cancelled` block. `restart` pushes the ETA out for free because `stepEnteredAt` resets.

**Loopback masking.** Milestone `state` is computed from `maxStepRank`, so a Stage2→Stage1 loopback never un-ticks "In the oven" for the customer; instead `recheck: true` renders "Quality recheck in progress". This needs `maxStepRank` on the item (§3) and is the resolution of the open loopback-UX question in `DESIGN.md`.

**Public projection is a whitelist mapper** (`toTrackerViewModel`), never a spread of the item. `restartCount`, `cancelledBy`, `actorId`, `GSI*` and internal notes must never reach a customer, and a spread is how they leak.

## 16. Seed specification (`scripts/seed-data.ts`)

One tenant `acme` with `PROFILE` + `CONFIG#00001` (brand `#c2410c`, `en`/`es`, `stepDurations = { orderPlaced: 60, Stage1: 240, Stage2: 480, Stage3: 420, orderComplete: 0 }`), four staff roles per §9, and eight orders covering every reachable shape:

| # | Shape | Purpose |
| --- | --- | --- |
| 1 | `orderPlaced`, fresh | the entry state |
| 2 | `Stage1` | prep queue |
| 3 | `Stage2` | bake queue |
| 4 | `Stage3` + `paymentStatus:"paid"` | completion path unlocked |
| 5 | `orderComplete` | terminal bucket |
| 6 | `orderComplete` + payment `refunded` | terminal, payment edge |
| 7 | `cancelled` with reason | terminal bucket |
| 8 | `Stage2` + `inputState.pending` + input item | the advancement blocker |
| 9 | `Stage1` + `restartCount.Stage1 = 2` + `maxStepRank = 3` | loopback masking |

Idempotent: `PutItem` with `ConditionExpression: attribute_not_exists(PK)`, logging skips. Wired to `npm run db:seed`. `scripts/init-db.ts` is the TypeScript port of `.devcontainer/init-dynamodb.sh` (identical schema, so both paths stay valid).

---

## 17. Test matrix (Vitest, `npm test`)

| # | Case | Expect |
| --- | --- | --- |
| 1–4 | `advance` across all four forward edges | new step, `version+1`, one `ADVANCE` event, `stepEnteredAt` moved |
| 5 | `advance` from `orderComplete` | `TERMINAL_STATE` |
| 6 | `advance` from `cancelled` | `TERMINAL_STATE` |
| 7 | `advance` with `inputState.pending` | `INPUT_PENDING` |
| 8 | same, `allowAdvanceWhileAwaitingInput: true` | accepted |
| 9 | `Stage3 → complete`, `unpaid`, rule on | `PAYMENT_NOT_SETTLED` |
| 10 | same, rule off | accepted |
| 11–13 | `restart` on Stages 1/2/3 | step unchanged, `restartCount[s]+1`, `stepEnteredAt` bumped, `maxStepRank` unchanged |
| 14 | `restart` on `orderPlaced` | `INVALID_TRANSITION` |
| 15–17 | `loopback` Stage3→2→1→`orderPlaced` | rank−1, `maxStepRank` unchanged |
| 18 | `cancel` with a 2-char reason | `VALIDATION_FAILED` |
| 19 | `cancel` from Stage2 | `status:"cancelled"`, `cancelledAtStep === Stage2`, step frozen, queue bucket `terminal` |
| 20 | kitchen `advance` on Stage3 | `FORBIDDEN` |
| 21 | driver `advance` on Stage1 | `FORBIDDEN` |
| 22 | wildcard `step:restart:*` on Stage2 | granted |
| 23 | `step:advance:*` vs bare `step:advance` | not granted |
| 24 | `requestInput` twice | second ⇒ `INPUT_PENDING` |
| 25 | `submitInput` with nothing pending | `INPUT_NOT_PENDING` |
| 26 | `submitInput` accept with `onAccept:"restart"` | 2 events, step unchanged, `restartCount+1`, `version+2` |
| 27 | ULID monotonic within one millisecond | strictly increasing |
| 28 | `publicToken` over 10k draws | 26 chars, Crockford alphabet, no collisions |
| 29 | `can()` segment-count safety | `step:advance:*:*` does not grant `step:advance:X` |
| 30 | queue-bucket invariant after every accepted action | exactly one bucket set |

Adapter tests against DynamoDB Local (skipped unless `DYNAMODB_ENDPOINT` is set): stale-version rejection, transaction rollback on duplicate event SK, GSI1 `begins_with` step ordering.

---

## 18. Deviations from `DESIGN.md`

| § | `DESIGN.md` said | This document / the code says | Why |
| --- | --- | --- | --- |
| §4.2 | `GSI1PK = TENANT#<id>#STATUS#<status>` | `GSI1PK = TENANT#<id>#QUEUE#<active\|terminal>` | status partitions multiply, break cursor stability, and scramble the queue during input cycles |
| §5.1 / §5.3 | `awaiting_input` is an order status | `inputState.pending` | keeps exactly five milestones and a stable queue partition |
| §6 | `TenantConfig` had no `stepDurations` / `inputSchemas` / `detailKey` | added | ETA needs durations; input resolution must be tenant data; detail copy was unkeyed |
| §6 | driver had `step:advance:orderComplete`; customer had `input:submit_customer` | removed (dead) / renamed `input:submit`; `order:create` added | guards a transition out of a terminal step; grammar normalized |
| §4.1 | `#INPUT#` only | `#MSG#` added (§6b) | free-form conversation is a distinct, non-blocking concern |
| §5.3 | `restart`/`loopback` loops shown with no consumer rule | loopbacks masked via `maxStepRank`, `recheck` flag | a silent regression in the customer timeline is unacceptable |
| §7 | file tree omitted `src/domain/ids.ts`, `create.ts`, `resolve.ts` | included | ULID and order creation are domain concerns, not infra |






