# Leapsake — project map (start here)

Leapsake is a **privacy-first people-management app** (a personal CRM): people, pets,
tags, a relationship graph with derived kinship, milestones, and contact methods. It is
**offline-first** (local SQLite, no cloud dependency to use it) and built for
**incremental, shippable delivery** — every increment is usable on its own. It grows
desktop (V1) → mobile (V2) → sync + web (V3) → media (v0.2+), with a shared,
client-agnostic data/core layer underneath all clients.

## How to read this folder (keep your context lean)

1. Read this file, then **[`status.md`](./status.md)** — the single cross-workstream
   oracle for what's done, what's next, and the decided product posture.
2. Open **only** the design doc your increment touches (table below). The design docs are
   stable "why" references; you rarely need more than one.
3. For the history of a *finished* increment, read `git log` and the doc-comments in the
   code it touched — that's where delivery detail and rationale live, not a separate doc.

## Where to look

| You want to… | Go to |
|---|---|
| **Know what's done and what's next (any workstream)** | **[`status.md`](./status.md)** — the single status oracle |
| **Know the product posture / user model (stable "why")** | **[`product-truths.md`](./product-truths.md)** — launch posture + the user/client/account/sharing/encryption model |
| **Ship v0.1 — packaging, signing, stores, the release gate** | [`launch.md`](./launch.md) — the distribution plan + its increments |
| Understand the encryption / privacy / sync design | [`encryption/`](./encryption/) — start at its `README.md` (then `model.md`, `sync.md`, `schema.md`, `custody-sequence.md`) |
| Understand the file/media (photos v0.2) design | [`files.md`](./files.md) — the encrypted-blob invariants, pinned before build |
| Know why the SQLite native-ABI dance exists (and how it ends) | [`sqlite-abi-napi.md`](./sqlite-abi-napi.md) — watch-item, blocked on the fork |
| Understand the holidays design | [`holidays/research.md`](./holidays/research.md) — the catalog/observance/rule layering + decisions, pinned before build |
| Share UI or derivations across clients | [`packages/ui/README.md`](../packages/ui/README.md) (presentational components + the adapter/messages/ports seams) and [`packages/view-models/README.md`](../packages/view-models/README.md) (headless derivations) — the extraction is done |
| Understand the dedup / merge design | [`packages/core/README.md`](../packages/core/README.md) — the two-kinds-of-merge framing + the person reference graph |
| Understand the testing strategy (all apps/packages) | [`testing/`](./testing/) — start at its `README.md` (principles, the driver-contract keystone, the mobile-engine wall) |
| Understand a shared package's architecture & rationale | its own `README.md` — [`schema`](../packages/schema/README.md), [`data`](../packages/data/README.md), [`core`](../packages/core/README.md), [`crypto`](../packages/crypto/README.md) |
| Read how a *finished* increment was built/verified | `git log` + the code's own doc-comments |
| Know conventions & guardrails | [`../AGENTS.md`](../AGENTS.md) |
| Read the code | `packages/{schema,data,core,crypto,highlight}`, `apps/{desktop,mobile,server}` |

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

**This file is a map, not a status board.** Live status and next-step decisions for every
workstream live in the single [`status.md`](./status.md); finished-increment history lives in
`git log` + the code's doc-comments. Update *status.md*; keep this map short and stable so
it stays a reliable front door.
