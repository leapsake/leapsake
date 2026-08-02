# Leapsake — project map (start here)

Leapsake is a **privacy-first people-management app** (a personal CRM): people, pets,
tags, a relationship graph with derived kinship, milestones, and contact methods. It is
**offline-first** (local SQLite, no cloud dependency to use it) and built for
**incremental, shippable delivery** — every increment is usable on its own. It grows
desktop (V1) → mobile (V2) → sync + web (V3) → media (v0.2+), with a shared,
client-agnostic data/core layer underneath all clients.

## Where the four kinds of knowledge live

This is the rule the whole repo is organized around. Learn it before looking for anything.

| You want to know… | Look in | Not in |
|---|---|---|
| **What was done, and why it was done that way** | `git log`, plus the doc-comments in the code it touched | here — finished work leaves `plans/` |
| **What is being worked on right now** | [`status.md`](./status.md) — short by design | anywhere else |
| **What *could* be built next** | this folder — one doc per workstream, each holding only **unbuilt** work | `status.md`, which never accumulates leftovers |
| **How the code works today** | the code, its tests, and the `README.md` beside it; [`../AGENTS.md`](../AGENTS.md) is the index | here — design docs describe intent, not the current build |

**A doc in this folder lives exactly as long as it has unbuilt work in it.** It shrinks as
increments land and is **deleted when it empties**, so `plans/` trends smaller unless a genuinely
new project starts. When you finish something: update the code's doc-comments, delete the entry
from its workstream doc, and let `git log` carry the history.

## How to read this folder (keep your context lean)

1. Read this file, then **[`status.md`](./status.md)** — it is short, and tells you what is
   actively in flight.
2. Open **only** the workstream doc your increment touches (table below). Each holds that
   workstream's backlog *and* its open questions, so you rarely need more than one.
3. For how the code you're about to change actually behaves, read the code and the README
   next to it — not a doc in here.

## Where to look

| You want to… | Go to |
|---|---|
| **Know what's in flight right now** | [`status.md`](./status.md) |
| **Know the product posture / user model (stable "why")** | [`product-truths.md`](./product-truths.md) — launch posture + the user/client/account/sharing/encryption model |
| **Ship v0.1 — packaging, signing, stores, the release gate** | [`launch.md`](./launch.md) |
| **Design the first-run experience — nudges, snooze, dismissals** | [`onboarding.md`](./onboarding.md). Read it before touching `ONBOARDING_STEPS` or the reminder-row actions |
| Understand the encryption / privacy / sync design, **or pick up sync work** | [`encryption/`](./encryption/) — start at its `README.md`, which also holds that workstream's backlog and open questions |
| **Build the web client (SSR / PWA), or prove it is still possible** | [`web.md`](./web.md) — the throwaway spike and what it must answer, increment by increment |
| Pick up dedup / merge work | [`reconciliation.md`](./reconciliation.md) (backlog) · [`packages/core/README.md`](../packages/core/README.md) (how the built part works) |
| Pick up reminder search, styling, i18n, or the mobile keyboard bug | [`client-ux.md`](./client-ux.md) |
| Extend holidays | [`holidays.md`](./holidays.md) (doors left open) · [`@leapsake/holidays`](../packages/holidays/README.md) (how it works) |
| Understand the file/media (photos v0.2) design | [`files.md`](./files.md) — the encrypted-blob invariants, pinned before build |
| Understand the testing strategy (all apps/packages) | [`testing/`](./testing/) — principles, the driver-contract keystone, the mobile-engine wall |
| Know why the SQLite native-ABI dance exists (and how it ends) | [`sqlite-abi-napi.md`](./sqlite-abi-napi.md) — watch-item, blocked on the fork |
| **Understand how key custody works** | [`encryption/model.md`](./encryption/model.md) **§7** — the one place custody is *specified*. The code map is [`@leapsake/key-custody`](../packages/key-custody/README.md) |
| Share UI or derivations across clients | [`packages/ui/README.md`](../packages/ui/README.md) and [`packages/view-models/README.md`](../packages/view-models/README.md) — the extraction is done |
| Understand a shared package's architecture & rationale | its own `README.md` — [`schema`](../packages/schema/README.md), [`data`](../packages/data/README.md), [`core`](../packages/core/README.md), [`crypto`](../packages/crypto/README.md) |
| Run the apps, drive them by hand, or debug the native ABI | the app's own README — [`desktop`](../apps/desktop/README.md), [`mobile`](../apps/mobile/README.md), [`server`](../apps/server/README.md) |
| Know conventions & guardrails | [`../AGENTS.md`](../AGENTS.md) |

## How the code is layered (for investigating further)

The non-UI surface is shared across every client and is where the real engineering
lives; clients are thin consumers of it.

```
schema  →  data  →  core  →  clients (apps/desktop, apps/mobile)
```

- **`packages/schema`** — Zod schemas → inferred types, plus pure portable domain logic
  (formatters, role algebra, normalization, search folding). Zero platform deps.
- **`packages/data`** — the `SqliteDriver` port, the hand-rolled migration runner,
  per-entity repositories, and cross-repo services (kinship, search, timeline). No DB
  driver import.
- **`packages/core`** — the client-agnostic `CoreApi`: transactional writes, cascade
  deletes, relationship orientation, view-model builders. `createCore(driver)` is the
  one entry point every client wires up.
- **`packages/crypto`** — symmetric envelope primitives (`seal`/`open`,
  `wrapKey`/`unwrapKey`) over `@noble/ciphers`, plus the `KeyStore` port. The V3
  encryption foundation; see the encryption docs.
- **Clients** consume `core` identically — desktop over typed IPC (`window.api`), mobile
  in-process. The driver/key-store ports are what make each platform an adapter swap,
  not a rewrite.

Tests are Vitest: unit tests on `schema`'s pure logic, integration tests running every
repo/service against the real production desktop engine. **`pnpm test`** runs the fast
local suite (static + unit + integration + the driver-coverage gate); **`pnpm test:all`**
adds the still-blocked native/E2E tiers as explicit ⏳ rows. The orchestrator is
`scripts/test-all.mjs`; the full strategy is in [`testing/`](./testing/).

## The one rule

**This file is a map, not a status board, and not a backlog.** Keep it short and stable so it
stays a reliable front door: when a workstream doc is created or deleted, edit the table above
and nothing else.
