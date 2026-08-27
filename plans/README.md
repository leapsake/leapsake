# Leapsake — project map (start here)

Leapsake is a **privacy-first people-management app** (a personal CRM): people, pets, tags, a
relationship graph with derived kinship, milestones, and contact methods. It is
**offline-first** (local SQLite, no cloud dependency to use it) and built for **incremental,
shippable delivery** — every increment is usable on its own. It grows desktop (V1) → mobile
(V2) → sync + web (V3) → media (v0.2+), with a shared, client-agnostic data/core layer under
all clients.

## Where the five kinds of knowledge live

This is the rule the whole repo is organized around. Learn it before looking for anything.

| You want to know… | Look in | Not in |
|---|---|---|
| **What was done, and why that way** | `git log`, plus the doc-comments in the code it touched | here — finished work leaves `plans/` |
| **What is being worked on right now** | [`status.md`](./status.md) — in flight + next, never over 30 lines | anywhere else |
| **What to pick up next, and in what order** | [`v0-1.md`](./v0-1.md) — the one sequence | `status.md`, which shows only the head of it |
| **What is deferred** | [`v0-2.md`](./v0-2.md) — everything that does not gate v0.1 | the v0.1 docs, which stay short by excluding it |
| **The stable "why" — posture, the user model, invariants** | next to the code it constrains: the package `README.md`s, with [`../AGENTS.md`](../AGENTS.md) holding only what is repo-wide *and* counterintuitive | `plans/`, which holds only *work* |
| **How the code works today** | the code, its tests, and the `README.md` beside it | here — design docs describe intent, not the build |
| **A rule the code must follow** | the check that enforces it — a type, a test, a lint rule | prose anywhere, if a program could have checked it |
| **How to set up, test, or cut a release** | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | `AGENTS.md`, which is guardrails, not procedure |

## The v0.1 docs are disposable, and that is the point

Each numbered doc holds one unit of gating work and is **deleted the day that work lands**.
Nothing accumulates. When you finish one:

1. Move anything durable **next to the code it constrains** — a doc-comment, the package
   `README.md`, or an `ARCHITECTURE.md`. Not into another `plans/` file.
2. Delete the doc, and its row in [`v0-1.md`](./v0-1.md).
3. Let `git log` carry the history.

When the last one goes, so does [`v0-1.md`](./v0-1.md), and [`v0-2.md`](./v0-2.md) is promoted.

**Recent examples of step 1**, if you want the shape: the onboarding nudge reasoning now lives in
[`@leapsake/reminders`](../packages/reminders/README.md), and why the signing identity owns the
enclave key lives in [`@leapsake/key-custody`](../packages/key-custody/README.md).

## Where to look

| You want to… | Go to |
|---|---|
| **Know what's in flight** | [`status.md`](./status.md) |
| **Know what to build next** | [`v0-1.md`](./v0-1.md) → the numbered doc it points at |
| **Find something we deliberately deferred** | [`v0-2.md`](./v0-2.md) |
| **Cut a release, or add a platform to the pipeline** | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *Versioning and releases* for the rules, `pnpm release --help` for the current rung/platform matrix, and `scripts/release/` for the policy itself |
| **Ship the desktop app** | [`desktop-packaging.md`](./desktop-packaging.md) — packaging, notarization and auto-update, deferred past v0.1 |
| **Build the web / PWA client for real** | [`web-client.md`](./web-client.md) — what the spike proved and what an `apps/web` inherits — then [`v0-2.md`](./v0-2.md) → *Post-launch* item 1. The rule it produced is [`encryption/model.md`](./encryption/model.md) §10.1: **web requires a sync account** |
| **Know the product posture (laypeople-first, pre-v0.1 latitude)** | [`../AGENTS.md`](../AGENTS.md) → *Product posture* |
| **Know the user / client / account model** | [`@leapsake/key-custody`](../packages/key-custody/README.md) → *The product model this serves* |
| **Know the custody vocabulary (the three axes)** | [`@leapsake/key-custody`](../packages/key-custody/README.md) → *Three questions, three vocabularies* |
| Understand the encryption / privacy / sync **design** | [`encryption/`](./encryption/) — start at its `README.md`. Design only; no backlog |
| **Understand how key custody works** | [`@leapsake/key-custody`](../packages/key-custody/README.md) — the one place custody is *specified*, and the code map for it |
| Understand the testing strategy | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *Testing* — the principles and the tiers. The E2E flow catalog is [`testing/crucial-flows.md`](./testing/crucial-flows.md) |
| Understand the file/media (photos) design | [`v0-2.md`](./v0-2.md) → *Files and media* — encrypted-blob invariants, pinned before build |
| Know how the SQLite native-ABI dance bites (and how it ends) | [`../AGENTS.md`](../AGENTS.md) today · [`v0-2.md`](./v0-2.md) → *The N-API exit* |
| Understand the shared layer as a whole | [`../packages/README.md`](../packages/README.md) — the layering, the Hermes floor, and why some shipped code is unreachable |
| Understand a shared package's architecture | its own `README.md` — [`schema`](../packages/schema/README.md), [`data`](../packages/data/README.md), [`core`](../packages/core/README.md), [`crypto`](../packages/crypto/README.md), [`reminders`](../packages/reminders/README.md), [`ui`](../packages/ui/README.md), [`view-models`](../packages/view-models/README.md) |
| Run the apps, drive them by hand, or debug the native ABI | the app's own README — [`desktop`](../apps/desktop/README.md), [`mobile`](../apps/mobile/README.md), [`server`](../apps/server/README.md) |
| Know conventions & guardrails | [`../AGENTS.md`](../AGENTS.md) |

## How the code is layered (for investigating further)

The non-UI surface is shared across every client and is where the real engineering lives;
clients are thin consumers of it.

```
schema  →  data  →  core  →  clients (apps/desktop, apps/mobile)
```

- **`packages/schema`** — Zod schemas → inferred types, plus pure portable domain logic
  (formatters, role algebra, normalization, search folding). Zero platform deps.
- **`packages/data`** — the `SqliteDriver` port, the hand-rolled migration runner, per-entity
  repositories, and cross-repo services (kinship, search, timeline). No DB driver import.
- **`packages/core`** — the client-agnostic `CoreApi`: transactional writes, cascade deletes,
  relationship orientation, view-model builders. `createCore(driver)` is the one entry point.
- **`packages/crypto`** — symmetric envelope primitives (`seal`/`open`, `wrapKey`/`unwrapKey`)
  over `@noble/ciphers`, plus the `KeyStore` port.
- **Clients** consume `core` identically — desktop over typed IPC (`window.api`), mobile
  in-process. The driver/key-store ports are what make each platform an adapter swap.

Tests are Vitest: unit tests on `schema`'s pure logic, integration tests running every
repo/service against the real production desktop engine. **`pnpm test`** runs the fast local
suite; **`pnpm test:all`** adds the still-blocked native/E2E tiers as explicit ⏳ rows. The
orchestrator is `scripts/test-all.mjs`; the principles are [`../CONTRIBUTING.md`](../CONTRIBUTING.md) →
*Testing*.

## The one rule

**This file is a map, not a status board, and not a backlog.** Keep it short and stable so it
stays a reliable front door: when a doc is created or deleted, edit the tables above and nothing
else.
