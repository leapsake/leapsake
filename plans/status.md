# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **The web spike, Increments 5a and 5b — a browser tab logs in, decrypts and renders**
  *(2026-08-13)*, after 1-4 answered read, write and sharing yes *(08-12)*. 5a: **12/12** from
  `runDriverContract` against `@sqlite.org/sqlite-wasm` from a 40-line driver. 5b: username +
  password → master key → `pull(0)` → `PersonScreen`, **all in the tab**, through the *same*
  adapter the SSR host uses, at **~1 s cold of which ~850 ms is Argon2id** — the number the
  increment existed for. **Zero `packages/` edits** a sixth time; `bootstrap.ts` ran in a
  browser unmodified. Three carries: **the relay's missing CORS now blocks a real client**
  (proxied, not patched); the KDF **freezes the user's own tab**, so 5c's worker is not a
  nicety; and a hidden tab runs it ~1.9× slower.
- **Restore-from-backup, verified** *(2026-08-11)*. Four cases on a clean machine; 04's last gate
  is gone: [`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up*
- **The account merge, all four increments, both clients** *(2026-08-08 → 08-11)*. Local-only
  **merges** into synced or **publishes itself**; a taken username forks to merge-or-rename;
  design in [`encryption/model.md`](./encryption/model.md) §7.2.2.

## Next

1. **The web spike, Increment 5c** — move sqlite-wasm, `createCore`, `createSyncEngine` and the
   KDF into a Worker, and swap `:memory:` for OPFS SAHPool. **Done when the page stays
   interactive through login and the whole pull, and a reload does not re-pull.** 5b priced
   both halves: ~800 ms of frozen tab per login, and a schema rebuilt per tab. A worker does
   not make Argon2id cheaper — 5e (browser key custody) is the increment that could remove it
   from a warm start. 5c, 5d (PWA) and 5e are each droppable on their own merits. Two files
   brief the whole thing: [`v0-1_web-spike.md`](./v0-1_web-spike.md) (what is left, what not to
   re-litigate) and [`apps/web-spike/README.md`](../apps/web-spike/README.md) (how to run it,
   what 1-5b found). **Keep the zero-`packages/`-edits constraint**, logging temptations in
   `WANTED-CHANGES.md`.

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
