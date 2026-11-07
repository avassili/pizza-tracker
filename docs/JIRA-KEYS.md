# Jira key map — project `PTS`

`vassilievandrei.atlassian.net` → project **PTS** ("Pizza-Tracker-Sapce"), team-managed (`style: next-gen`).

Loaded via the Jira API on 2026-10-31: **145 issues**, 0 failures.

## How the hierarchy was modelled

Team-managed projects expose only `Epic → Story/Task/Bug → Subtask`, and **no `Feature` issue type**.
So the three-level Epic → Feature → Story backlog is represented as:

| Level | Jira issue type | Identification |
| --- | --- | --- |
| Epic | `Epic` | summary `E<n> - title` |
| Feature | `Task` | summary `E<n>-F<m> name`, label `feature-backend` \| `feature-frontend` \| `feature-conversation` |
| Story | `Story` | summary `E<n>-F<m>-S<k> title`, labels `feature-*` + `epic-E<n>` |

Every story also carries its stable external id in the description (`PT-E2-F1-S03`), so the backlog can
be regenerated and reconciled without duplicating issues.

## Epics

| External | Key | Summary |
| --- | --- | --- |
| PT-E0 | PTS-1 | Platform and 5-step domain foundation |
| PT-E1 | PTS-3 | Step 0 Order placed |
| PT-E2 | PTS-4 | Step 1 Prep and assembly |
| PT-E3 | PTS-5 | Step 2 Bake and quality check |
| PT-E4 | PTS-6 | Step 3 Pack and out for delivery |
| PT-E5 | PTS-7 | Step 4 Complete and delivered |
| PT-E6 | PTS-8 | Conversation substrate across all five steps |
| PT-E7 | PTS-9 | Staff operations console |
| PT-E8 | PTS-10 | Tenant configuration, branding and i18n |
| PT-E9 | PTS-11 | $0.00 production deployment |

## Features (Tasks)

| External | Key | | External | Key |
| --- | --- | --- | --- | --- |
| PT-E0-F1 | PTS-2 | | PT-E3-F1 | PTS-20 |
| PT-E0-F2 | PTS-12 | | PT-E3-F2 | PTS-21 |
| PT-E0-F3 | PTS-13 | | PT-E3-F3 | PTS-22 |
| PT-E1-F1 | PTS-14 | | PT-E4-F1 | PTS-23 |
| PT-E1-F2 | PTS-15 | | PT-E4-F2 | PTS-24 |
| PT-E1-F3 | PTS-16 | | PT-E4-F3 | PTS-25 |
| PT-E2-F1 | PTS-17 | | PT-E5-F1 | PTS-26 |
| PT-E2-F2 | PTS-18 | | PT-E5-F2 | PTS-27 |
| PT-E2-F3 | PTS-19 | | PT-E5-F3 | PTS-28 |
| | | | PT-E6-F1 | PTS-29 |
| | | | PT-E6-F2 | PTS-30 |
| | | | PT-E7-F1 | PTS-31 |
| | | | PT-E7-F2 | PTS-32 |
| | | | PT-E8-F1 | PTS-33 |
| | | | PT-E8-F2 | PTS-34 |
| | | | PT-E9-F1 | PTS-35 |

## Story ranges

Keys are contiguous and follow creation order:

| Epic | Stories | Keys | Count |
| --- | --- | --- | --- |
| E0 | PT-E0-F1-S01 … F3-S03 | PTS-36 … PTS-56 | 21 |
| E1 | PT-E1-F1-S01 … F3-S04 | PTS-57 … PTS-71 | 15 |
| E2 | PT-E2-F1-S01 … F3-S04 | PTS-72 … PTS-83 | 12 |
| E3 | PT-E3-F1-S01 … F3-S03 | PTS-84 … PTS-93 | 10 |
| E4 | PT-E4-F1-S01 … F3-S04 | PTS-94 … PTS-104 | 11 |
| E5 | PT-E5-F1-S01 … F3-S03 | PTS-105 … PTS-113 | 9 |
| E6 | PT-E6-F1-S01 … F2-S05 | PTS-114 … PTS-125 | 12 |
| E7 | PT-E7-F1-S01 … F2-S05 | PTS-126 … PTS-132 | 7 |
| E8 | PT-E8-F1-S01 … F2-S02 | PTS-133 … PTS-138 | 6 |
| E9 | PT-E9-F1-S01 … S07 | PTS-139 … PTS-145 | 7 |

## Applied post-load

| Fix | Status |
| --- | --- |
| Priorities | **Done** — all 10 epics, 25 features (`High`) and 110 stories set from the point estimate (5→Highest, 3→High, 2→Medium, 1→Low). Only 3 issues are `Highest`: `PTS-48` (commit + optimistic locking), `PTS-139` (sst.config + OpenNext), `PTS-142` (Cognito). Distribution: 3 Highest / 66 High / 61 Medium / 15 Low = 145. |
| Fix Versions | **Done** — `M0`–`M6` created and assigned: each epic carries its milestone, and the five `F3` conversation features carry `M5 Conversation coverage`. |
| Story points | **Blocked** — this project has no story-point field. Estimation must be enabled first (Project settings → Features → Estimation → Story points), after which the 245 points can be written from `docs/jira-import.csv`. The estimate currently lives in each story description as `Est: N`. |

Useful queries:

```
project = PTS AND priority = Highest
project = PTS AND fixVersion = "M0 Domain foundation" ORDER BY key
project = PTS AND issuetype = Story AND fixVersion is EMPTY
```

## Known gaps in the Jira load

- **Story points were not set.** Estimation is not enabled on the project
  (only `Development`, `Team`, `Start date`, `Rank`, `Flagged` exist as custom
  fields), so no story-point field id could be written to. The estimate is
  preserved in each story description as `Est: N` and in `docs/jira-import.csv`
  (245 points total) for a one-shot bulk fill once estimation is on.

- **Priority is Jira's default (`Medium`)** on every issue. The intended value
  (Highest/High/Medium/Low) is in the CSV `Priority` column.
- `Fix Version` is empty because the project has no versions yet; milestones are carried
  as the `milestone-M<n>` label instead.
