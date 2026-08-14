# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **The web spike, Increments 5a-5c and 5e — a real browser client, in a Worker, on a store and
  a key that survive** *(2026-08-13)*, after 1-4 answered read, write and sharing yes *(08-12)*.
  5a: **12/12** on the driver contract against `sqlite-wasm`. 5b: username + password → master
  key → `pull(0)` → `PersonScreen`, in the tab. 5c moved the data layer, Argon2id and `core` into
  a **Worker** behind a **40-line `Proxy`**, database in **OPFS**: worst page unavailability
  **8.4 ms** against 5b's frozen **800**; a reload pulls **0 records**. 5e persisted the last
  thing that did not — a **non-extractable `CryptoKey` in IndexedDB** wrapping the master key,
  implementing **`@leapsake/crypto`'s `KeyStore` port unchanged**: a reload renders in **91 ms**,
  no password, `fetch` removed, opening a **relay-produced** record to prove the key is the
  account's. **Zero `packages/` edits** all eight times. Carries: **no CORS on the relay blocks
  any browser client**; **OPFS is single-tab**; **durable storage was refused**.
- **Restore-from-backup, verified** *(2026-08-11)*. Four cases on a clean machine; 04's last gate
  is gone: [`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up*
- **The account merge, all four increments, both clients** *(2026-08-08 → 08-11)*. Local-only
  **merges** into synced or **publishes itself**; a taken username forks to merge-or-rename;
  design in [`encryption/model.md`](./encryption/model.md) §7.2.2.

## Next

1. **The web spike, Increment 5d** — the last of it: a PWA (manifest + service worker caching
   shell, JS and `.wasm`). **Done when a DevTools-offline reload renders the person from the
   OPFS database.** 5c and 5e did the data and key halves, so what is left is the *asset* half
   plus two inherited questions: **single-tab** OPFS, which a PWA is exactly what gets opened
   twice, and **durable storage**, refused on `localhost` — installing may change that.
   It also collects the number 5c and 5e could not, **Argon2id on a worker in a visible tab**,
   since an agent-driven tab is always `hidden`. Droppable at the owner's call, not the
   agent's; then **Increment 6** (write up, tear
   down). Two files brief it: [`v0-1_web-spike.md`](./v0-1_web-spike.md) (what is left) and
   [`apps/web-spike/README.md`](../apps/web-spike/README.md) (how to run it, what 1-5e found).
   **Keep the zero-`packages/`-edits constraint**, logging temptations in `WANTED-CHANGES.md`.

2. Then **04 → 07** in [`v0-1.md`](./v0-1.md)'s order — the launch chain, which the spike runs
   beside rather than blocks. 04 starts the 14-day Play clock and fixes store identity; 06 waits
   on 05 and on the open decision below.

## Open, waiting on the owner

**How much of the E2E catalog gates v0.1** — it plausibly sizes larger than all of distribution
combined, and needs a decision rather than a quiet reinterpretation; it sizes 06. That plus
**whether v0.1 ships without merge-by-recovery-phrase** — the only open one that could add a
full flow on both clients — and three smaller: [`v0-1.md`](./v0-1.md) → *Open decisions*.

**Shipped, feature-complete, no doc left:** V1 desktop, V1.5 local CRM, V2 mobile, the UI/
view-model extraction, gifts, contact import, holidays. Read `git log` and the package READMEs.
