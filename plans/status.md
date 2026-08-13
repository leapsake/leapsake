# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **The web spike, Increments 1-4 — read, write and sharing all answered yes**
  *(2026-08-12)*. A person's page server-renders with JavaScript disabled (the adapter is
  **six lines**); create / edit / delete do too, **observed on a second device through a real
  relay** (9/9, `roundtrip`); and a **capability link decrypts in the browser** from a key the
  server is *observed* never to receive, with the hosted fallback a ten-line SSR route (13/13,
  `share`). **Zero files changed under `packages/`** throughout. Six carries, and the spike doc
  lists them: cold store + warm key won, so §9.2's warm-store trust claim is not forced;
  **Argon2id stalls the whole host**; the relay is an **append-only log with no compaction**,
  so cold store and incremental pull are mutually exclusive; `SyncEngine` should expose its
  push mark; the shared packages port with **no shim**, and both bundle for a browser; and the
  no-JS floor has a three-item `packages/ui` backlog.
- **Restore-from-backup, verified** *(2026-08-11)*. All four cases confirmed on a clean machine,
  and 04's last gate is gone: [`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up*
- **The account merge, all four increments, both clients** *(2026-08-08 → 08-11)*. A local-only
  account can **merge** into a synced one or **publish itself** to a relay, and a taken username
  forks to merge-or-rename. Design: [`encryption/model.md`](./encryption/model.md) §7.2.2.

## Next

1. **The web spike, Increment 5a** — sqlite-wasm in the browser, and the next stopping point.
   **Done when a browser page reports 12/12 from `runDriverContract` (`@leapsake/data/testing`)
   and `runMigrations` completes** — a couple of hours that says whether the browser data layer
   is possible before 5b-e are committed to — and cheaper than it was, since Increment 4 proved
   `@leapsake/crypto` and `@leapsake/ui` already compile to a browser target. Two files are the
   whole briefing: [`v0-1_web-spike.md`](./v0-1_web-spike.md) holds what is left, the decisions
   not to re-litigate, and the spike's open questions;
   [`apps/web-spike/README.md`](../apps/web-spike/README.md) holds how to run it and what 1-4
   found. **Keep the zero-`packages/`-edits constraint**, logging temptations in
   `apps/web-spike/WANTED-CHANGES.md`. Then 5b-e, then Increment 6 writes it up, runs three
   owed manual checks, and deletes the app.

2. Then **04 → 07** in [`v0-1.md`](./v0-1.md)'s order — the launch chain, which the spike runs
   beside rather than blocks. 04 starts the 14-day Play clock and makes store identity permanent;
   06 waits on 05, and on the open decision below.

## Open, waiting on the owner

**How much of the E2E catalog gates v0.1** — it plausibly sizes larger than all of distribution
combined, and it needs a decision rather than a quiet reinterpretation; it sizes 06. That plus
**whether v0.1 ships without merge-by-recovery-phrase** — the only open question that could add a
full flow on both clients — and three smaller ones: [`v0-1.md`](./v0-1.md) → *Open decisions*.

**Shipped, feature-complete, no doc left:** V1 desktop, V1.5 local CRM, V2 mobile, the UI/
view-model extraction, gifts, contact import, holidays. Read `git log` and the package READMEs.
