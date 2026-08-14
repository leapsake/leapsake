# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **The web spike, Increment 5a — the browser data layer works** *(2026-08-13)*, after 1-4
  answered read, write and sharing yes *(08-12; the spike doc lists what they settled)*. A real
  browser reports **12/12** from `runDriverContract` against `@sqlite.org/sqlite-wasm`, and
  `runMigrations` completes — from a **40-line** driver, `SqliteDriver` unwidened for a third
  engine, **zero `packages/` edits** a fifth time. Engine init ~55 ms, schema 40-140 ms, both
  under one Argon2id. Two carries: the spike **can drive a real browser** after all (the Chrome
  extension, not a headless launch), retiring the "no browser was driven" caveat; and mobile's
  collecting test runner was needed **byte for byte**, so it belongs in `@leapsake/data/testing`.
- **Restore-from-backup, verified** *(2026-08-11)*. Four cases on a clean machine; 04's last gate
  is gone: [`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up*
- **The account merge, all four increments, both clients** *(2026-08-08 → 08-11)*. Local-only
  **merges** into synced or **publishes itself**; a taken username forks to merge-or-rename;
  design in [`encryption/model.md`](./encryption/model.md) §7.2.2.

## Next

1. **The web spike, Increment 5b** — client-side login, pull and decrypt on the browser's main
   thread with `:memory:`, rendering `PersonScreen` through the *same* adapter the SSR host
   uses. **Done when the tab renders a person from a client-side pull, with Argon2id measured
   in-browser** — the number that decides whether the zero-knowledge client path is viable. 5a's
   green leaves no stopping points, so 5c (Worker + OPFS), 5d (PWA) and 5e (browser key custody)
   are each droppable on their own merits. Two files brief the whole thing:
   [`v0-1_web-spike.md`](./v0-1_web-spike.md) (what is left, what not to re-litigate) and
   [`apps/web-spike/README.md`](../apps/web-spike/README.md) (how to run it, what 1-5a found).
   **Keep the zero-`packages/`-edits constraint**, logging temptations in `WANTED-CHANGES.md`.

2. Then **04 → 07** in [`v0-1.md`](./v0-1.md)'s order — the launch chain, which the spike runs
   beside rather than blocks. 04 starts the 14-day Play clock and fixes store identity; 06 waits
   on 05 and on the open decision below.

## Open, waiting on the owner

**How much of the E2E catalog gates v0.1** — it plausibly sizes larger than all of distribution
combined, and needs a decision rather than a quiet reinterpretation; it sizes 06. That plus
**whether v0.1 ships without merge-by-recovery-phrase** — the only open one that could add a full
flow on both clients — and three smaller: [`v0-1.md`](./v0-1.md) → *Open decisions*.

**Shipped, feature-complete, no doc left:** V1 desktop, V1.5 local CRM, V2 mobile, the UI/
view-model extraction, gifts, contact import, holidays. Read `git log` and the package READMEs.
