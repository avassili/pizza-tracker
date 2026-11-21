# Pizza Tracker

A multi-tenant, 5-step pizza order tracker built with **Next.js 15 (App Router, TypeScript)** and **Amazon DynamoDB** (with full offline support via **DynamoDB Local**), designed for $0.00/month AWS Always Free Tier operation.

## Documentation Structure

- **Main Backlog (Top of `docs/`):** [`docs/BACKLOG.md`](./docs/BACKLOG.md)
- **Technical Design:** [`DESIGN.md`](./DESIGN.md)
- **Tactical Design (Normative):** [`docs/TACTICAL-DESIGN.md`](./docs/TACTICAL-DESIGN.md)
- **Jira Key Map:** [`docs/JIRA-KEYS.md`](./docs/JIRA-KEYS.md)
- **Story Documents:** Organized under `docs/<epic>/<feature>/<story>.md`
  - Example: [`docs/E0/F2/S10-dynamodb-structure.md`](./docs/E0/F2/S10-dynamodb-structure.md)

See [`AGENTS.md`](./AGENTS.md) for repository conventions, architectural boundaries, and story documentation rules.

## Local Development

```bash
npm install
npm test
npm run typecheck
npm run lint
```

### DynamoDB Local

```bash
npm run db:init          # Provision PizzaTrackerDev table + GSI1 + GSI2 (PROVISIONED 5/5)
npm run db:sample-order  # Submit a sample order into DynamoDB and verify reads
npm run dev              # Start Next.js dev server at http://localhost:3000
```
