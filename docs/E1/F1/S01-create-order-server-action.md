# E1-F1-S01: Create Order Server Action & Public Tracker Read API

| Field | Value |
| --- | --- |
| **Jira** | [PTS-57](https://vassilievandrei.atlassian.net/browse/PTS-57) · [PTS-59](https://vassilievandrei.atlassian.net/browse/PTS-59) · [PTS-54](https://vassilievandrei.atlassian.net/browse/PTS-54) |
| **Epic** | `E1` — Step 0 - Order placed: the ticket exists and the customer is told (`PTS-3`) |
| **Feature** | `F1` — Backend - order creation and first read (`PTS-14`) |
| **Story** | `S01` — `createOrder` Server Action and Public Tracker Route |
| **Milestone** | `M1` |
| **Design Refs** | `DESIGN.md` §3.3 · `docs/TACTICAL-DESIGN.md` §13, §15 |

---

## Why

Expose the Next.js 15 App Router server API to accept a new order from the client, validate and persist it into DynamoDB using a server-derived session, emit console notification intents, and serve the customer's read-only tracker view with ETag / 304 support.

---

## Implementation Files

- `src/infra/auth/mockSession.ts` — Reads `x-mock-role`, `x-mock-tenant`, and `x-mock-actor-id` via Next.js 15 async `await headers()`; defaults missing headers to lowest-privilege `customer` / `acme`.
- `src/infra/notifications/consoleChannel.ts` — Logs `NotificationIntent` JSON payloads with `requestId` to stdout in development (`NOTIFICATION_DRIVER=console`).
- `src/domain/fsm/selectors.ts` — Adds `TrackerViewModel` and `toTrackerViewModel` whitelist projection mapper (loopback masking via `maxStepRank`, i18n, ETA, zero internal-field leakage).
- `src/app/actions/orders.ts` — `"use server"` `createOrderAction` enforcing session, RBAC (`order:create`), `createOrderSnapshot`, DynamoDB persistence, console notifications, and `revalidatePath`.
- `src/app/api/t/[tenant]/orders/[token]/route.ts` — Next.js 15 async `ctx.params` `GET` route handler returning `TrackerViewModel` with `ETag: W/"<version>"`, `Cache-Control: no-store`, `304 Not Modified`, and `404` for unknown/wrong-tenant tokens.
- Tests:
  - `src/infra/auth/mockSession.test.ts`
  - `src/domain/fsm/selectors.test.ts`
  - `src/app/actions/orders.test.ts`
  - `src/app/api/t/[tenant]/orders/[token]/route.test.ts`

---

## Acceptance Criteria

- [x] **AC1:** `tenantId` and `actor` are always resolved server-side via `getSession()`, never from client arguments.
- [x] **AC2:** `createOrderAction` validates items/totals/customer, checks `order:create`, persists `v1` order + `ORDER_PLACED` event atomically, emits console notices, and revalidates tracker/queue paths.
- [x] **AC3:** `GET /api/t/[tenant]/orders/[token]` awaits `ctx.params`, maps to `TrackerViewModel`, returns `ETag: W/"<version>"` and `304` on matching `If-None-Match`, and returns `404` for unknown or cross-tenant tokens.
- [x] **AC4:** `npm run typecheck`, `npm run lint`, and `npm test` pass cleanly.
