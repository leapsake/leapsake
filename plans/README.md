# Leapsake — project map (start here)

Leapsake is a **privacy-first people-management app** (a personal CRM): people, pets, tags, a
relationship graph with derived kinship, milestones, and contact methods. It is
**offline-first** (local SQLite, no cloud dependency to use it) and built for **incremental,
shippable delivery** — every increment is usable on its own. It grows desktop (V1) → mobile
(V2) → sync + web (V3) → media (v0.2+), with a shared, client-agnostic data/core layer under
all clients.

## Where the five kinds of knowledge live

This is the rule the whole repo is organized around. Learn it before looking for anything.

| You want to know…                                          | Look in                                                                                                                                             | Not in                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **What was done, and why that way**                        | `git log`, plus the doc-comments in the code it touched                                                                                             | here — finished work leaves `plans/`               |
| **What is being worked on right now**                      | [`status.md`](./status.md) — in flight + next, never over 30 lines                                                                                  | anywhere else                                      |
| **What to pick up next, and in what order**                | [`shipping.md`](./shipping.md) — the one sequence                                                                                                   | `status.md`, which shows only the head of it       |
| **Which platform ships when, and why that order**          | [`shipping.md`](./shipping.md) → _Part 2_ — iOS, then the org move, then Android and macOS                                                          | here; it is a decision, not a map                  |
| **What is deferred**                                       | [`v0-2.md`](./v0-2.md) — everything that does not gate v0.1                                                                                         | the v0.1 docs, which stay short by excluding it    |
| **The stable "why" — posture, the user model, invariants** | next to the code it constrains: the package `README.md`s, with [`../AGENTS.md`](../AGENTS.md) holding only what is repo-wide _and_ counterintuitive | `plans/`, which holds only _work_                  |
| **How the code works today**                               | the code, its tests, and the `README.md` beside it                                                                                                  | here — design docs describe intent, not the build  |
| **A rule the code must follow**                            | the check that enforces it — a type, a test, a lint rule                                                                                            | prose anywhere, if a program could have checked it |
| **How to set up, test, or cut a release**                  | [`../CONTRIBUTING.md`](../CONTRIBUTING.md)                                                                                                          | `AGENTS.md`, which is guardrails, not procedure    |

## The v0.1 docs are disposable, and that is the point

**The numbering is retired** _(2026-09-06)_, and the last two v0.1 docs became one
([`shipping.md`](./shipping.md), 2026-09-07). Allocation ids in `git log` stay meaningful — they
were never reused — but nothing new gets one. **A gating doc is named for what it delivers**, and
`plans/` gets _smaller_ over time: consolidate before you add.

Each such doc holds one unit of gating work and is **deleted the day that work lands**.
Nothing accumulates. When you finish one:

1. Move anything durable **next to the code it constrains** — a doc-comment, the package
   `README.md`, or an `ARCHITECTURE.md`. Not into another `plans/` file.
2. Delete the section, or the doc, and any pointer to it.
3. Let `git log` carry the history.

When [`shipping.md`](./shipping.md) is empty it goes too, and [`v0-2.md`](./v0-2.md) is promoted.

**Recent examples of step 1**, if you want the shape: the onboarding nudge reasoning now lives in
[`@leapsake/reminders`](../packages/reminders/README.md), why the signing identity owns the
enclave key lives in [`@leapsake/key-custody`](../packages/key-custody/README.md), and the E2E
release-gate policy — the rule, the rung table, the ratchet — is
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) → _The E2E release gate_, which is what let docs 06
and 10 be deleted whole.

**A doc that is _deferred_ rather than _done_ gets renamed, not deleted.** It keeps its detail
and loses its number, because the sequencing inside it is still the value:
[`android-pipeline.md`](./android-pipeline.md) (was 04) and
[`desktop-packaging.md`](./desktop-packaging.md) (was 05). The third pattern is
**consolidation**: `v0-1.md` and `ios-ga.md` (was 07) merged into
[`shipping.md`](./shipping.md), keeping only what is still ahead and pushing the settled _why_
next to the code — the bundle-ID reasoning to the app READMEs, the release-gate ratchet to
[`../CONTRIBUTING.md`](../CONTRIBUTING.md), the Flows 6/7a call to
[`testing/crucial-flows.md`](./testing/crucial-flows.md).

## Where to look

| You want to…                                                      | Go to                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Know what's in flight**                                         | [`status.md`](./status.md)                                                                                                                                                                                                                                                                                                 |
| **Remove or simplify code without a user-visible change**         | [`fable-investigation/`](./fable-investigation/README.md) — four decided workstreams (relay removal, core decomposition, comment pass, shared form hooks), each deleted when it lands                                                                                                                                      |
| **Know what to build next**                                       | [`shipping.md`](./shipping.md) — Part 1 is every GA blocker in order with acceptance for each; Part 2 is the org move that follows                                                                                                                                                                                         |
| **Find something we deliberately deferred**                       | [`v0-2.md`](./v0-2.md)                                                                                                                                                                                                                                                                                                     |
| **Cut a release, or add a platform to the pipeline**              | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → _Versioning and releases_ for the rules, `pnpm release --help` for the current rung/platform matrix, and `scripts/release/` for the policy itself                                                                                                                             |
| **Ship the iOS app**                                              | [`shipping.md`](./shipping.md) → Part 1. ⚠️ The exporter (step 1) **must not use iCloud**: an iCloud entitlement in any shipped version permanently disqualifies the app transfer to the company account                                                                                                                   |
| **Read an export back in, or bring export to desktop**            | [`export.md`](./export.md) — the two unbuilt halves. The exporter itself shipped; what it writes and why is [`@leapsake/vcard`](../packages/vcard/README.md) and [`@leapsake/export`](../packages/export/README.md)                                                                                                        |
| **Ship the desktop app**                                          | [`desktop-packaging.md`](./desktop-packaging.md) — packaging, notarization and auto-update, deferred past v0.1. ⚠️ Sign it under the _company_ identity, not the personal one                                                                                                                                              |
| **Ship the Android app**                                          | [`android-pipeline.md`](./android-pipeline.md) — the Play target, shipping from the **personal** account since 2026-09-13. `pnpm release` reaches the internal and closed tracks; `final` refuses until Play grants production access                                                                                       |
| **Build the web / PWA client for real**                           | [`web-client.md`](./web-client.md) — what the spike proved and what an `apps/web` inherits — then [`v0-2.md`](./v0-2.md) → _Post-launch_ item 1. The rule it produced is [`encryption/model.md`](./encryption/model.md) §10.1: **web requires a sync account**                                                             |
| **Know the product posture (laypeople-first, pre-v0.1 latitude)** | [`../AGENTS.md`](../AGENTS.md) → _Product posture_                                                                                                                                                                                                                                                                         |
| **Know the user / client / account model**                        | [`@leapsake/key-custody`](../packages/key-custody/README.md) → _The product model this serves_                                                                                                                                                                                                                             |
| **Know the custody vocabulary (the three axes)**                  | [`@leapsake/key-custody`](../packages/key-custody/README.md) → _Three questions, three vocabularies_                                                                                                                                                                                                                       |
| Understand the encryption / privacy / sync **design**             | [`encryption/`](./encryption/) — start at its `README.md`. Design only; no backlog                                                                                                                                                                                                                                         |
| **Understand how key custody works**                              | [`@leapsake/key-custody`](../packages/key-custody/README.md) — the one place custody is _specified_, and the code map for it                                                                                                                                                                                               |
| Understand the testing strategy                                   | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → _Testing_ — the principles and the tiers. The E2E flow catalog is [`testing/crucial-flows.md`](./testing/crucial-flows.md)                                                                                                                                                    |
| Understand the file/media (photos) design                         | [`v0-2.md`](./v0-2.md) → _Files and media_ — encrypted-blob invariants, pinned before build                                                                                                                                                                                                                                |
| Know how the SQLite native-ABI dance bites (and how it ends)      | [`../AGENTS.md`](../AGENTS.md) today · [`v0-2.md`](./v0-2.md) → _The N-API exit_                                                                                                                                                                                                                                           |
| Understand the shared layer as a whole                            | [`../packages/README.md`](../packages/README.md) — the layering, the Hermes floor, and why some shipped code is unreachable                                                                                                                                                                                                |
| Understand a shared package's architecture                        | its own `README.md` — [`schema`](../packages/schema/README.md), [`data`](../packages/data/README.md), [`core`](../packages/core/README.md), [`crypto`](../packages/crypto/README.md), [`reminders`](../packages/reminders/README.md), [`ui`](../packages/ui/README.md), [`view-models`](../packages/view-models/README.md) |
| Run the apps, drive them by hand, or debug the native ABI         | the app's own README — [`desktop`](../apps/desktop/README.md), [`mobile`](../apps/mobile/README.md), [`server`](../apps/server/README.md)                                                                                                                                                                                  |
| **Change the website, or publish a doc or the privacy policy**    | [`apps/website`](../apps/website/README.md) — Astro, zero JS, deployed by Cloudflare Pages on every push to `main`. **Deploying it cuts no release**, which is the whole reason it lives in the monorepo                                                                                                                   |
| Know conventions & guardrails                                     | [`../AGENTS.md`](../AGENTS.md)                                                                                                                                                                                                                                                                                             |

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
suite; **`pnpm test:all`** adds the tiers that need a simulator or an emulator — the mobile
driver contract on both platforms, and the crucial-flow catalog. **Every tier is `ready`**; the
orchestrator still reports a `blocked` tier as an explicit ⏳ row, and `--strict` fails on one,
but there are none today. The orchestrator is `scripts/test-all.mjs`; the principles are
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) → _Testing_.

## The one rule

**This file is a map, not a status board, and not a backlog.** Keep it short and stable so it
stays a reliable front door: when a doc is created or deleted, edit the tables above and nothing
else.
