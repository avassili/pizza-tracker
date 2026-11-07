#!/usr/bin/env node
/**
 * Generates docs/jira-import.csv from the backlog definition below.
 *
 * Why a script: the CSV is ~110 rows with hierarchy, labels and points. Keeping
 * the source of truth here means the backlog is reviewable in a diff and the CSV
 * can be regenerated whenever a story changes.
 *
 *   node scripts/jira-backlog.mjs
 *
 * Import notes live in docs/BACKLOG.md.
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** story */
const s = (id, title, want, points, ac) => ({ id, title, want, points, ac });
/** feature */
const f = (id, name, tag, stories) => ({ id, name, tag, stories });
/** epic */
const e = (id, title, bo, milestone, summary, features) => ({
  id,
  title,
  bo,
  milestone,
  summary,
  features,
});

const OBJECTIVES = [
  {
    id: "BO-1",
    title: "Operate at $0.00",
    kpi: "AWS bill $0.00/mo; local bootstrap <=10 min; domain suite <=5 s",
    body: "The tracker runs fully offline for development and inside the AWS Always-Free allowance in production.",
  },
  {
    id: "BO-2",
    title: "Customer certainty",
    kpi: "staff action visible <=3 s; 0 stale-tracker complaints; 'where is my order' contacts -50%",
    body: "A customer always knows the true state of their pizza across all five steps.",
  },
  {
    id: "BO-3",
    title: "Conversation at every step",
    kpi: "5/5 steps bidirectional; >=30% of orders carry a message; first response <=2 min",
    body: "Every step supports two-way customer-to-store communication, blocking only where a decision is required.",
  },
  {
    id: "BO-4",
    title: "Operational control and accountability",
    kpi: "100% of mutations audited; 0 unaudited terminal changes; 100% restart/loopback reasons",
    body: "Staff run the queue with advance, restart, loopback and cancel, and every action is attributable.",
  },
  {
    id: "BO-5",
    title: "Config-driven tenancy",
    kpi: "tenant #2 live with 0 code changes in <=1 day; branding and locale from config only",
    body: "A second store goes live by adding configuration, not by branching code.",
  },
];

const EPICS = [];

// ---------------------------------------------------------------- E0 platform
EPICS.push(
  e(
    "E0",
    "Platform and 5-step domain foundation",
    ["BO-1", "BO-4", "BO-5"],
    "M0",
    "Pure FSM, persistence contract, mock session and the test harness. No AWS, no network.",
    [
      f("F1", "Backend - domain core (pure FSM)", "backend", [
        s("S01", "Step registry and rank invariants", "the FSM and every UI agree on exactly five steps", 2, [
          "STEP_KEYS has 5 keys with contiguous ranks 0-4",
          "isStepKey rejects unknown and non-string values",
          "nextStep/prevStep stop at the boundaries",
        ]),
        s("S02", "advance transition", "a ticket moves forward exactly one step", 3, [
          "advance increments version by 1 and rewrites stepEnteredAt",
          "exactly one ADVANCE event is produced",
          "the payment gate blocks the final advance when unpaid",
        ]),
        s("S03", "restart transition", "staff can redo the current step", 3, [
          "step is unchanged and restartCount[step] increments",
          "restart is rejected at orderPlaced",
          "maxStepRank is preserved",
        ]),
        s("S04", "loopback transition", "staff can send a ticket back one step", 3, [
          "rank decreases by 1 and floors at orderPlaced",
          "maxStepRank is preserved so the customer view does not regress",
          "the reason is recorded on the event",
        ]),
        s("S05", "cancel transition", "a manager can kill an order with a reason", 2, [
          "a reason shorter than 3 chars is rejected",
          "status becomes cancelled and the step is frozen",
          "cancelledAtStep and cancelledAt are stamped",
        ]),
        s("S06", "Guard ordering and Result envelope", "every failure has a stable, testable code", 2, [
          "order is VALIDATION, AUTH, TERMINAL, STRUCTURAL, PERMISSION, domain",
          "Result<T> is the only return shape and nothing is thrown",
        ]),
        s("S07", "Payment completion gate", "we never close an unpaid order when the tenant forbids it", 2, [
          "unpaid plus rule on returns PAYMENT_NOT_SETTLED",
          "rule off allows completion",
        ]),
        s("S08", "RBAC can() with segment-safe wildcards", "a grant cannot accidentally widen", 2, [
          "step:restart:* grants exactly one step",
          "step:advance:* does not grant a bare step:advance",
        ]),
        s("S09", "ULID and public token generation", "ids are sortable and tokens are unguessable", 2, [
          "ULIDs are 26 Crockford chars and strictly increasing within 1 ms",
          "publicToken is 26 chars with no collisions over 10k draws",
        ]),
      ]),
      f("F2", "Backend - persistence and seeding", "backend", [
        s("S01", "DynamoDB client with local/AWS switch", "one env var decides where data lives", 2, [
          "DYNAMODB_ENDPOINT set switches to DynamoDB Local with dummy creds",
          "absent, the client uses the ambient IAM role",
        ]),
        s("S02", "Key builders", "the key layout has exactly one definition", 1, [
          "every PK/SK/GSI helper lives in keys.ts",
          "no key string literals outside that module",
        ]),
        s("S03", "createOrder persistence", "a new ticket exists after one write", 3, [
          "v1 order at orderPlaced with timeline[0]",
          "ORDER_PLACED event written in the same transaction",
        ]),
        s("S04", "commit() with optimistic locking", "concurrent staff cannot clobber each other", 5, [
          "TransactWriteItems covers the order update plus the event put",
          "stale version returns STALE_VERSION and writes nothing",
        ]),
        s("S05", "Event ledger append", "every mutation is reconstructable", 2, [
          "events sort chronologically by ULID",
          "attribute_not_exists makes replay idempotent",
        ]),
        s("S06", "GSI1 queue query with cursor", "the kitchen board pages deterministically", 3, [
          "begins_with on the STEP#<step>#TS# prefix, oldest first",
          "limit clamped to 1..25 with an opaque cursor",
        ]),
        s("S07", "GSI2 public token lookup", "a customer URL resolves in one read", 2, [
          "single eventually-consistent query with ProjectionType ALL",
          "an unknown token returns null, not an error",
        ]),
        s("S08", "scripts/init-db.ts", "npm run db:init provisions the table", 2, [
          "identical schema to .devcontainer/init-dynamodb.sh",
          "re-running is idempotent",
        ]),
        s("S09", "scripts/seed-data.ts", "local dev has every state to click through", 3, [
          "tenant acme plus four roles",
          "nine orders covering all steps, terminal states, pending input and a loopbacked ticket",
        ]),
      ]),
      f("F3", "Frontend - session and tooling", "frontend", [
        s("S01", "Mock session from headers", "role switching works offline", 2, [
          "x-mock-role and x-mock-tenant are read via awaited headers()",
          "missing headers fall back to customer/acme and the tenant is never a client argument",
        ]),
        s("S02", "DevRoleSwitcher toolbar", "a developer can test any role instantly", 3, [
          "switches role and tenant in development only",
          "hidden when AUTH_MODE is not mock",
        ]),
        s("S03", "Vitest harness and FSM matrix", "the domain is provably correct offline", 3, [
          "npm test runs the full matrix with no AWS and no network",
          "the suite finishes in under 5 s",
        ]),
      ]),
    ],
  ),
);

// --------------------------------------------------------------- E1 step 0
EPICS.push(
  e(
    "E1",
    "Step 0 - Order placed: the ticket exists and the customer is told",
    ["BO-2", "BO-3"],
    "M1",
    "Entry point of the flow: order creation, the first advance, and the customer's first view of the five steps.",
    [
      f("F1", "Backend - order creation and first read", "backend", [
        s("S01", "createOrder Server Action", "the tracker has something real to show", 3, [
          "validates items, totals and customer name",
          "mints ULID and public token and pins configVersion",
          "returns the snapshot plus notification notices",
        ]),
        s("S02", "advanceOrder out of orderPlaced", "the kitchen picks the ticket up", 2, [
          "kitchen_staff may advance, delivery_driver may not",
          "produces exactly one ADVANCE event",
        ]),
        s("S03", "Public tracker route with ETag", "the customer page polls cheaply", 3, [
          "GET /api/t/[tenant]/orders/[token] returns the tracker view model",
          "params are awaited per Next 15",
          "a matching If-None-Match returns 304",
        ]),
        s("S04", "Notification intents at creation and transition", "we can watch the system talk", 2, [
          "the console driver prints structured JSON with requestId",
          "no SES or SMS call is made in development",
        ]),
        s("S05", "Manager cancel at orderPlaced", "a bad ticket can be killed immediately", 1, [
          "reason is required and a CANCEL event is written",
          "the order leaves the active queue bucket",
        ]),
      ]),
      f("F2", "Frontend - the five-milestone tracker", "frontend", [
        s("S01", "Milestones component with exactly five rows", "the customer sees a stable timeline", 3, [
          "state is done, current, upcoming or skipped",
          "aria-current marks the active step",
          "the component never branches on milestone count",
        ]),
        s("S02", "Tenant branding via CSS variables", "the tracker looks like the store", 2, [
          "primaryColor drives the existing --sauce token",
          "no hardcoded orange or amber classes remain",
        ]),
        s("S03", "ETA from configured step durations", "the estimate is honest, not decorative", 2, [
          "replaces the hardcoded remaining x 4 minutes",
          "null when the order is terminal",
        ]),
        s("S04", "SWR polling island", "the page updates without a manual refresh", 2, [
          "3 s interval with no polling while the tab is hidden",
          "ETag revalidation and a 2 s dedupe window",
        ]),
        s("S05", "Replace the fake setInterval demo", "there is no pretend progress left in the app", 3, [
          "page.tsx renders server data only",
          "the STAGES array is deleted",
        ]),
        s("S06", "Step 0 copy and locale switch", "the first screen reads correctly in both locales", 1, [
          "all strings resolve through i18n keys",
          "Spanish renders with no missing keys",
        ]),
      ]),
      f("F3", "Conversation - order notes and substitutions", "conversation", [
        s("S01", "Customer order note at placement", "the customer can ask for something before we start", 3, [
          "stored as a message with direction customer_to_store and stepKey orderPlaced",
          "appears on the kitchen card within one poll",
        ]),
        s("S02", "Store acknowledgement message", "the customer knows the order landed", 2, [
          "manual and templated acknowledgement both supported",
          "visible in the customer thread",
        ]),
        s("S03", "Out-of-stock substitution input request", "we resolve shortages without a phone call", 3, [
          "requesting sets inputState.pending and blocks advance",
          "the resolution is read from the input schema",
        ]),
        s("S04", "Step-grouped message thread", "conversation stays readable across the five steps", 2, [
          "messages grouped under their step heading",
          "staff identity is masked as 'the kitchen'",
        ]),
      ]),
    ],
  ),
);

// ------------------------------------------------------------------ E2 step 1
EPICS.push(
  e(
    "E2",
    "Step 1 - Prep and assembly",
    ["BO-2", "BO-3", "BO-4"],
    "M2",
    "First working step: forward movement, restart, loopback and the first blocking decision.",
    [
      f("F1", "Backend - prep transitions", "backend", [
        s("S01", "Advance Stage1 to Stage2", "prep hands off to the oven", 2, [
          "kitchen permission enforced",
          "the queue sort key is rewritten",
        ]),
        s("S02", "Restart at Stage1 with reason", "a dropped pizza is recoverable", 2, [
          "restartCount.Stage1 increments",
          "the reason is stored on the RESTART event",
        ]),
        s("S03", "Loopback Stage1 to orderPlaced", "a bad ticket returns to the queue", 3, [
          "maxStepRank is preserved",
          "the customer sees a recheck banner, not a regression",
        ]),
        s("S04", "requestCustomerInput from prep", "we can ask before we ruin the order", 2, [
          "a duplicate pending request returns INPUT_PENDING",
          "input item and inputState pointer are written atomically",
        ]),
      ]),
      f("F2", "Frontend - prep controls", "frontend", [
        s("S01", "Prep milestone rendering", "the customer knows we started", 1, [
          "detail copy comes from stepPresentations.detailKey",
        ]),
        s("S02", "Staff prep card with advance, restart and loopback", "the kitchen drives the flow from one card", 3, [
          "every button sends expectedVersion",
          "restart and loopback require confirmation",
        ]),
        s("S03", "Recheck banner", "a loopback never looks like lost work", 2, [
          "renders when stepRank is below maxStepRank",
        ]),
        s("S04", "STALE_VERSION recovery", "two cooks cannot silently overwrite each other", 2, [
          "toast plus automatic refetch",
          "the card re-renders at the new version without losing input",
        ]),
      ]),
      f("F3", "Conversation - modifications and allergens", "conversation", [
        s("S01", "Customer modification request", "the customer can change their mind early", 3, [
          "delivered to the prep card",
          "never mutates the FSM by itself",
        ]),
        s("S02", "Allergen confirmation input request", "we never serve an unconfirmed allergen note", 3, [
          "advance is blocked until it is submitted",
          "auto-resolution follows the schema",
        ]),
        s("S03", "Pinned instruction note", "special instructions are impossible to miss", 1, [
          "the instruction renders as a pinned sticker on the staff card",
        ]),
        s("S04", "Staff quick-reply templates", "staff answer in one tap", 2, [
          "templates are tenant-configurable",
        ]),
      ]),
    ],
  ),
);

// ------------------------------------------------------------------ E3 step 2
EPICS.push(
  e(
    "E3",
    "Step 2 - Bake and quality check",
    ["BO-2", "BO-3", "BO-4"],
    "M2",
    "The oven step: longest dwell time, worst-case recovery, and the ramp-up to completion.",
    [
      f("F1", "Backend - bake transitions", "backend", [
        s("S01", "Advance Stage2 to Stage3", "a baked pizza reaches dispatch", 2, [
          "guard ordering and kitchen permission enforced",
        ]),
        s("S02", "Restart at Stage2 (remake)", "a failed quality check can be redone", 2, [
          "reason preset or free text stored on the event",
          "restartCount.Stage2 increments",
        ]),
        s("S03", "Loopback Stage2 to Stage1", "a wrong bake returns to prep", 2, [
          "staff see it immediately and the customer stays masked",
        ]),
        s("S04", "paymentStatus read and write seam", "completion can be gated without a payment provider", 2, [
          "unpaid, authorized, paid and refunded are all representable",
          "no external payment call is made",
        ]),
      ]),
      f("F2", "Frontend - quality panel", "frontend", [
        s("S01", "Bake milestone with dwell timer", "the kitchen sees how long it has been in the oven", 2, [
          "timer derived from stepEnteredAt plus stepDurations",
        ]),
        s("S02", "Quality panel with remake decision", "the cook records why it was remade", 2, [
          "preset reasons plus free text",
          "optimistic UI with audit visibility",
        ]),
        s("S03", "Loopback preview of customer impact", "staff know what the customer will see", 2, [
          "shows the recheck banner state before confirming",
        ]),
      ]),
      f("F3", "Conversation - remake notices and consent", "conversation", [
        s("S01", "Remake notice with a new ETA", "the customer is never surprised by a delay", 2, [
          "ETA recomputed from the restarted stepEnteredAt",
          "message appended to the thread",
        ]),
        s("S02", "Customer status nudge", "the customer can ask how it is going", 1, [
          "rate-limited and surfaced on the quality card",
        ]),
        s("S03", "Remake consent input request", "we only remake on the customer's terms", 3, [
          "onAccept restart, onDecline none, read from the schema",
          "the audit records which resolution applied",
        ]),
      ]),
    ],
  ),
);

// ------------------------------------------------------------------ E4 step 3
EPICS.push(
  e(
    "E4",
    "Step 3 - Pack and out for delivery",
    ["BO-2", "BO-3", "BO-4"],
    "M3",
    "Dispatch: the only step a driver owns, and the step that decides whether an order can be completed.",
    [
      f("F1", "Backend - dispatch and completion", "backend", [
        s("S01", "Advance Stage3 to orderComplete", "the order finally closes", 3, [
          "payment gate applied when the tenant requires it",
          "completedAt stamped and the order moves to the terminal bucket",
        ]),
        s("S02", "Restart at Stage3", "a forgotten side can still be fixed", 2, [
          "driver permission granted for this step only",
        ]),
        s("S03", "Loopback Stage3 to Stage2", "a mis-packed bag returns to the oven queue", 2, [
          "timeout handling when the driver is already en route",
        ]),
        s("S04", "fulfilment branch for delivery and pickup", "one flow serves both service models", 1, [
          "pickup substitutes 'ready for pickup' copy and permissions",
        ]),
      ]),
      f("F2", "Frontend - dispatch views", "frontend", [
        s("S01", "Dispatch milestone with driver ETA", "the customer knows how close the driver is", 2, [
          "shows minutes when the driver has sent an arrival ping",
        ]),
        s("S02", "Driver board scoped to its own step", "drivers cannot disturb the kitchen flow", 3, [
          "Stage1 and Stage2 orders are invisible to the driver role",
        ]),
        s("S03", "Completion button disabled with a reason", "staff are never left guessing why it failed", 1, [
          "reason text derived from PAYMENT_NOT_SETTLED",
        ]),
      ]),
      f("F3", "Conversation - arrival and drop-off", "conversation", [
        s("S01", "Driver arrival broadcast", "the customer can meet the driver", 2, [
          "thread message plus notification intent",
        ]),
        s("S02", "Customer drop-off instruction", "gate codes and leave-at-door reach the driver", 2, [
          "PII redacted for roles that do not own the order",
        ]),
        s("S03", "Confirm-you-are-home input request", "we do not abandon a pizza at an empty house", 3, [
          "completion blocked until answered or expired",
        ]),
        s("S04", "Call-on-arrival toggle", "the customer picks the handover method", 1, [
          "persisted as message metadata",
        ]),
      ]),
    ],
  ),
);

// ------------------------------------------------------------------ E5 step 4
EPICS.push(
  e(
    "E5",
    "Step 4 - Complete and delivered",
    ["BO-2", "BO-3", "BO-4"],
    "M3",
    "Terminal state: the order is closed, feedback is captured, and nothing can mutate the FSM any more.",
    [
      f("F1", "Backend - terminal guarantees", "backend", [
        s("S01", "Terminal enforcement", "a delivered order can never move again", 1, [
          "every action on completed or cancelled returns TERMINAL_STATE",
          "zero writes are attempted",
        ]),
        s("S02", "Feedback persistence", "we can measure whether the tracker helped", 2, [
          "1-5 rating plus optional comment, one per order",
          "re-submission is idempotent",
        ]),
        s("S03", "Post-completion issue report", "a complaint is captured without reopening the flow", 2, [
          "creates a support note or thread",
          "never mutates the FSM",
        ]),
      ]),
      f("F2", "Frontend - completed screen", "frontend", [
        s("S01", "Completed state with receipt summary", "the customer sees a clean finish", 2, [
          "all five milestones ticked and etaIso is null",
          "receipt totals rendered from the order",
        ]),
        s("S02", "Rating widget", "feedback takes five seconds", 2, [
          "1-5 stars plus optional comment, optimistic submit",
        ]),
        s("S03", "Something-is-wrong escalation", "an unhappy customer has a path that is not a phone call", 2, [
          "opens a thread and shows service-level copy",
          "no FSM change is made",
        ]),
      ]),
      f("F3", "Conversation - receipt and complaints", "conversation", [
        s("S01", "Receipt and thank-you message", "the last touch is automatic", 1, [
          "auto-sent on orderComplete",
        ]),
        s("S02", "Complaint thread for store reply", "complaints stay inside the tracker", 3, [
          "store receives an unread badge and the thread stays open",
        ]),
        s("S03", "Read-only archived thread", "old conversations do not silently change", 1, [
          "archived after the configured retention window with a banner",
        ]),
      ]),
    ],
  ),
);

// ------------------------------------------------------- E6 conversation layer
EPICS.push(
  e(
    "E6",
    "Conversation substrate across all five steps",
    ["BO-3"],
    "M1",
    "The shared message plumbing every step's conversation feature depends on. Build before E1-E5 conversation work.",
    [
      f("F1", "Backend - messages", "backend", [
        s("S01", "Message entity and key builder", "conversation has a home in the table", 2, [
          "ORDER#<orderId>#MSG#<ulid> with msgSk()",
          "entity discriminator set to message",
        ]),
        s("S02", "sendMessage action", "any role can talk at any step", 3, [
          "captures direction, stepKey, visibility and an idempotency key",
          "rejects bodies over 2000 chars",
        ]),
        s("S03", "listMessages with cursor and since", "delta polling keeps the thread cheap", 2, [
          "supports since=<ulid> for incremental fetches",
          "opaque cursor for older pages",
        ]),
        s("S04", "Per-order rate limiting", "a single order cannot flood the store", 2, [
          "returns RATE_LIMITED with a backoff hint",
        ]),
        s("S05", "PII redaction for non-owners", "gate codes never leak to the wrong role", 2, [
          "phone and address masked unless the role owns the order",
        ]),
        s("S06", "Notification fan-out for messages", "staff and customers hear about new messages", 2, [
          "emits notification intents through the console driver",
        ]),
        s("S07", "Unread counters per role and order", "staff can see what is waiting", 3, [
          "unread count derived per order per role",
          "cleared by a read receipt",
        ]),
      ]),
      f("F2", "Frontend - thread surfaces", "frontend", [
        s("S01", "Shared MessageThread component", "one component serves customer and staff", 3, [
          "customer and staff variants share layout and behaviour",
        ]),
        s("S02", "Unread badges on queue cards", "the board shows conversation debt", 2, [
          "badge reflects unread counters",
        ]),
        s("S03", "Staff inbox filtered by step, unread and age", "conversations are triaged, not hunted", 3, [
          "filter chips for step, unread and oldest-first",
        ]),
        s("S04", "Message versus input request affordance", "customers understand what is blocking them", 1, [
          "blocking requests look different from free-form messages",
        ]),
        s("S05", "Attachment spike", "photos may be needed later", 2, [
          "spike documents the S3 path and its free-tier cost",
          "no implementation in this milestone",
        ]),
      ]),
    ],
  ),
);

// ------------------------------------------------------------ E7 staff console
EPICS.push(
  e(
    "E7",
    "Staff operations console",
    ["BO-4"],
    "M4",
    "The board staff actually work from: queues per step, audited actions, and role-aware controls.",
    [
      f("F1", "Backend - queue and audit reads", "backend", [
        s("S01", "Queue board query per step", "the kitchen works one step at a time", 3, [
          "oldest-first, 25 per page, cursor paginated",
          "requires order:read",
        ]),
        s("S02", "Audit ledger read for one order", "every state change is explainable", 3, [
          "events returned in chronological order with actor and reason",
        ]),
      ]),
      f("F2", "Frontend - the board", "frontend", [
        s("S01", "Step tabs with live counts", "staff see workload at a glance", 2, [
          "count per step from the queue query",
        ]),
        s("S02", "Action bar with conflict handling", "actions are safe under concurrency", 2, [
          "every action carries expectedVersion",
          "STALE_VERSION triggers refetch, never a blind retry",
        ]),
        s("S03", "Audit drawer per order", "a manager can reconstruct what happened", 2, [
          "timeline of events with actor, step and reason",
        ]),
        s("S04", "Cancel modal with typed confirmation", "cancellation is deliberate", 1, [
          "reason of at least 3 chars and an explicit confirm step",
        ]),
        s("S05", "Role-based control visibility", "nobody clicks a button they cannot use", 1, [
          "buttons hidden from rolePermissions, not disabled after the fact",
        ]),
      ]),
    ],
  ),
);

// --------------------------------------------------------------- E8 tenancy
EPICS.push(
  e(
    "E8",
    "Tenant configuration, branding and i18n",
    ["BO-5"],
    "M4",
    "Everything a second store needs to go live without a code change.",
    [
      f("F1", "Backend - config lifecycle", "backend", [
        s("S01", "Config load with per-request cache", "we do not read config on every transition", 2, [
          "GetItem on CONFIG#<version> memoized per request",
        ]),
        s("S02", "configVersion pinning per order", "a config bump never reinterprets an in-flight order", 2, [
          "the order keeps the version it was created with",
        ]),
        s("S03", "Immutable config version write", "changes are auditable and reversible", 3, [
          "manager-only, writes a new CONFIG#<version>",
          "existing versions are never mutated",
        ]),
        s("S04", "Tenant #2 onboarding runbook", "we can prove BO-5", 2, [
          "seeded second tenant with zero code changes",
          "documented checklist",
        ]),
      ]),
      f("F2", "Frontend - branding and locale", "frontend", [
        s("S01", "Branding consumed from config", "each store looks like itself", 2, [
          "logo and primaryColor applied to tracker and console",
        ]),
        s("S02", "Locale switcher for en and es", "the tracker works for both audiences", 2, [
          "locale resolves from config with a per-order override",
        ]),
      ]),
    ],
  ),
);

// ---------------------------------------------------------------- E9 shipping
EPICS.push(
  e(
    "E9",
    "$0.00 production deployment",
    ["BO-1"],
    "M6",
    "SST v3 plus OpenNext on Lambda and CloudFront, with the free-tier limits encoded in infrastructure.",
    [
      f("F1", "Infrastructure and cloud adapters", "backend", [
        s("S01", "sst.config.ts with OpenNext", "the app ships serverlessly for free", 5, [
          "Lambda memory 512-1024 MB with a 10 s timeout",
          "static assets served through CloudFront",
        ]),
        s("S02", "DynamoDB PROVISIONED 5 and 5 in IaC", "the free tier cannot be accidentally exceeded", 2, [
          "table and both GSIs provisioned, not on-demand",
        ]),
        s("S03", "CloudFront cache headers for static assets", "repeat visits cost almost nothing", 2, [
          "long-lived immutable caching for /_next/static",
          "no-store for the tracker API",
        ]),
        s("S04", "Cognito swap behind the auth port", "staff authentication becomes real", 5, [
          "AUTH_MODE=cognito validates the JWT and maps claims to roles",
          "mock mode still works locally",
        ]),
        s("S05", "EventBridge and SES notification driver", "notifications leave the console", 3, [
          "same NotificationIntent contract as the console driver",
          "SMS stays stubbed and disabled",
        ]),
        s("S06", "Cost guardrails", "we notice a free-tier breach immediately", 2, [
          "budget alarm at $1, resource tags, and a runbook entry",
        ]),
        s("S07", "Production smoke test and rollback", "a bad deploy is reversible", 2, [
          "scripted smoke run over all five steps",
          "documented rollback procedure",
        ]),
      ]),
    ],
  ),
);

// ---------------------------------------------------------------------- export

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const HEADERS = [
  "External ID",
  "Issue Type",
  "Summary",
  "Parent External ID",
  "Epic Name",
  "Business Objective",
  "Milestone",
  "Story Points",
  "Priority",
  "Labels",
  "Components",
  "Description",
  "Acceptance Criteria",
  "Tactical Ref",
];

const componentFor = (tag) => (tag === "conversation" ? "backend,frontend" : tag);
const priorityFor = (points) =>
  points >= 5 ? "Highest" : points >= 3 ? "High" : points >= 2 ? "Medium" : "Low";

const rows = [];
for (const epic of EPICS) {
  const epicSummary = `${epic.id} - ${epic.title}`;
  rows.push({
    id: `PT-${epic.id}`,
    type: "Epic",
    summary: epicSummary,
    parent: "",
    epicName: epicSummary,
    bo: epic.bo.join(" "),
    milestone: epic.milestone,
    points: "",
    priority: "High",
    labels: epic.bo.map((bo) => `bo-${bo}`).join(" "),
    components: "",
    description: epic.summary,
    ac: "",
    ref: "docs/TACTICAL-DESIGN.md",
  });

  for (const feature of epic.features) {
    rows.push({
      id: `PT-${epic.id}-${feature.id}`,
      type: "Feature",
      summary: `${epic.id}-${feature.id} ${feature.name}`,
      parent: `PT-${epic.id}`,
      epicName: epicSummary,
      bo: epic.bo.join(" "),
      milestone: epic.milestone,
      points: "",
      priority: "High",
      labels: `feature-${feature.tag}`,
      components: componentFor(feature.tag),
      description: `${feature.name} for ${epicSummary}.`,
      ac: "",
      ref: "docs/TACTICAL-DESIGN.md",
    });

    for (const story of feature.stories) {
      rows.push({
        id: `PT-${epic.id}-${feature.id}-${story.id}`,
        type: "Story",
        summary: `${epic.id}-${feature.id}-${story.id} ${story.title}`,
        parent: `PT-${epic.id}-${feature.id}`,
        epicName: epicSummary,
        bo: epic.bo.join(" "),
        milestone: epic.milestone,
        points: story.points,
        priority: priorityFor(story.points),
        labels: `feature-${feature.tag} epic-${epic.id}`,
        components: componentFor(feature.tag),
        description: `Why: ${story.want}.`,
        ac: story.ac.map((criterion, index) => `AC${index + 1}: ${criterion}`).join("\n"),
        ref: "docs/TACTICAL-DESIGN.md",
      });
    }
  }
}

const csv = [
  HEADERS.map(csvCell).join(","),
  ...rows.map((row) =>
    [
      row.id,
      row.type,
      row.summary,
      row.parent,
      row.epicName,
      row.bo,
      row.milestone,
      row.points,
      row.priority,
      row.labels,
      row.components,
      row.description,
      row.ac,
      row.ref,
    ]
      .map(csvCell)
      .join(","),
  ),
].join("\n");

writeFileSync(resolve(here, "../docs/jira-import.csv"), `${csv}\n`, "utf8");

const epicPoints = (epic) =>
  epic.features.reduce(
    (total, feature) => total + feature.stories.reduce((sum, story) => sum + story.points, 0),
    0,
  );
const storyCount = (epic) =>
  epic.features.reduce((total, feature) => total + feature.stories.length, 0);

const totalPoints = EPICS.reduce((total, epic) => total + epicPoints(epic), 0);
const totalStories = EPICS.reduce((total, epic) => total + storyCount(epic), 0);

const md = [];
md.push("# Pizza Tracker — Backlog");
md.push("");
md.push("Generated by `node scripts/jira-backlog.mjs`. Edit the script, not this file.");
md.push("");
md.push(`**${EPICS.length} epics · ${rows.filter((r) => r.type === "Feature").length} features · ${totalStories} stories · ${totalPoints} points**`);
md.push("");
md.push("## Business objectives");
md.push("");
md.push("| ID | Objective | KPI |");
md.push("| --- | --- | --- |");
for (const objective of OBJECTIVES) {
  md.push(`| **${objective.id}** | **${objective.title}** — ${objective.body} | ${objective.kpi} |`);
}
md.push("");
md.push("## Epics by step");
md.push("");
md.push("| Epic | Title | Objectives | Milestone | Stories | Points |");
md.push("| --- | --- | --- | --- | --- | --- |");
for (const epic of EPICS) {
  md.push(
    `| **${epic.id}** | ${epic.title} | ${epic.bo.join(", ")} | ${epic.milestone} | ${storyCount(epic)} | ${epicPoints(epic)} |`,
  );
}
md.push(`| | **Total** | | | **${totalStories}** | **${totalPoints}** |`);
md.push("");
md.push("## Feature layout");
md.push("");
md.push("Every step epic contains the same three features, so backend and frontend work is always");
md.push("visible and conversation coverage is measurable per step:");
md.push("");
md.push("| Feature | Label | Owns |");
md.push("| --- | --- | --- |");
md.push("| `Backend` | `feature-backend` | domain, persistence, Server Actions, route handlers |");
md.push("| `Frontend` | `feature-frontend` | tracker UI, staff controls, polling |");
md.push("| `Conversation` | `feature-conversation` | customer-to-store messaging for that step (stories tagged BE/FE) |");
md.push("");
md.push("## Importing into Jira");
md.push("");
md.push("`docs/jira-import.csv` is flat and self-referencing.");
md.push("");
md.push("1. **Company-managed project** — map `Issue Type`, `Summary`, `Epic Name`, `Story Points`,");
md.push("   `Labels`, `Components`, `Description`, `Acceptance Criteria`. Import epics and features");
md.push("   first: Jira resolves `Epic Name` against epics in the same file.");
md.push("2. **Team-managed project** — same order, then map `Parent External ID` to `Parent` using the");
md.push("   key map Jira reports after each pass. Stories reference feature summaries, so import");
md.push("   epics, then features, then stories.");
md.push("3. Keep `External ID` (`PT-E2-F1-S03`) in a custom field. Regenerating and re-importing then");
md.push("   updates issues instead of duplicating them.");
md.push("");
md.push("Milestones map to `Fix Version`: M0 domain, M1 step 0 + conversation substrate, M2 steps 1-2,");
md.push("M3 steps 3-4, M4 console + tenancy, M5 conversation coverage, M6 deployment.");
md.push("");
writeFileSync(resolve(here, "../docs/BACKLOG.md"), `${md.join("\n")}\n`, "utf8");

console.log(
  `wrote ${rows.length} issues: ${EPICS.length} epics, ` +
    `${rows.filter((row) => row.type === "Feature").length} features, ` +
    `${totalStories} stories, ${totalPoints} points`,
);












