# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **The web spike, Increment 5 complete — a browser client that needs no server**
  *(2026-08-14)*, after 5a-5c and 5e answered the data layer, the Worker, the persistent store
  and the key *(08-13)*. **5d installed it**: a manifest plus a service worker caching an
  **allowlisted** shell, and with the dev server *killed* — not DevTools pretending — a reload
  resumes from OPFS and IndexedDB and renders the person in **69.3 ms** with **0 bytes across
  the wire**, Chrome itself labelling the navigation `cache-storage`. A second tab now
  **queues** on a `Web Lock` and takes the store over in **21.5 ms** when the first closes,
  where 5c crashed. Both owed measurements collected: **Argon2id on a worker in a visible tab
  is ~435 ms**, the same as the main thread — so 5c's 1 083-3 417 ms was the *hidden tab*, not
  the worker — plus the device. **Zero `packages/` edits**, a ninth time. Carries: Cache
  Storage **ignores `no-store`**, so the app/user-data split is the worker's allowlist and
  nothing else; `persist()` is still refused until someone installs the app (one click).
- **Restore-from-backup, verified** *(2026-08-11)*. Four cases on a clean machine; 04's last gate
  is gone: [`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up*
- **The account merge, all four increments, both clients** *(2026-08-08 → 08-11)*. Local-only
  **merges** into synced or **publishes itself**; a taken username forks to merge-or-rename;
  design in [`encryption/model.md`](./encryption/model.md) §7.2.2.

## Next

1. **The web spike, Increment 6 — the write-up is done, the teardown is not.**
   [`v0-1_web-spike.md`](./v0-1_web-spike.md) is now the spike's *answers*: the three owner
   questions, the measurements, the relay and shared-package changes, three edits owed to
   `model.md`, and the open questions that survived. **Four checks are owed** before the
   delete (that doc → *Still owed*) — two need a human (a Firefox no-JS walk-through,
   installing `/client-pwa` for the durable-storage line), two do not (a capability link in a
   real browser, one real desktop build converging on the spike's account). Then tag
   `web-spike-final`, delete `apps/web-spike`, revert the `.oxlintrc.json` line. **No more
   measurement** *(owner, 08-14)* — so the phone row is a standing risk, not a task.

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
