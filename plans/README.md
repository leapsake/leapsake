# Leapsake — project map (start here)

Leapsake is a **privacy-first people-management app** (a personal CRM): people, pets,
tags, a relationship graph with derived kinship, milestones, and contact methods. It is
**offline-first** (local SQLite, no cloud dependency to use it) and built for
**incremental, shippable delivery** — every increment is usable on its own. It grows
desktop (V1) → mobile (V2) → sync + web (V3), with a shared, client-agnostic data/core
layer underneath all clients.

## Where we are right now

- **V1 — desktop (Electron) + V1.5 local CRM** — ✅ done, runs locally.
- **V2 — mobile (Expo / React Native)** — ✅ done, feature-complete vs. desktop,
  verified on iOS + Android.
- **V3 — sync + distribution + web** — 🚧 in progress, two workstreams (full state in
  **[`status.md`](./status.md)**, the single cross-workstream oracle):
  - **Encryption + sync foundations** — **Stage 1 (zero-knowledge sync) is done** on both
    clients (verified desktop ↔ mobile over the wire); Stages 2–4 (at-rest, sharing, SSR)
    are ahead. Design:
    [`encryption/`](./encryption/).
  - **Entity reconciliation (dedup & merge)** — Increments A, B, and C's merge-on-join are
    built; only C's bulk-import dedup remains (deferred until the importer exists). A
    cross-cutting substrate (detect/merge distinct records that mean the same person) serving
    multi-device merge-on-join *and* a future bulk-contact-import. Design:
    [`packages/core/README.md`](../packages/core/README.md).

## Where to look

| You want to… | Go to |
|---|---|
| **Know what's done and what's next (any workstream)** | **[`status.md`](./status.md)** — the single status oracle |
| Understand the encryption / privacy / sync design | [`encryption/`](./encryption/) — start at its `README.md` (then `model.md`, `sync.md`, `schema.md`, `custody-sequence.md`) |
| Understand the dedup / merge design | [`packages/core/README.md`](../packages/core/README.md) — the two-kinds-of-merge framing + the person reference graph |
| Understand the testing strategy (all apps/packages) | [`testing/`](./testing/) — start at its `README.md` (principles, the driver-contract keystone, the mobile-engine wall, open decisions + task backlog) |
| Understand a shared package's architecture & rationale | its own `README.md` — [`schema`](../packages/schema/README.md), [`data`](../packages/data/README.md), [`core`](../packages/core/README.md), [`crypto`](../packages/crypto/README.md) |
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
repo/service against a real in-memory SQLite. Run `pnpm test` (or per-package filters).

## The one rule

**This file is a map, not a status board.** Live status and next-step decisions for every
workstream live in the single [`status.md`](./status.md). Update *that*; keep this map short
and stable so it stays a reliable front door.
