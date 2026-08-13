# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **The web spike, Increment 4 — both sharing flavors, contrasted** *(2026-08-12)*. A
  **capability link decrypts in the browser** from a key the server is *observed* never to
  receive (13/13, `pnpm --filter @leapsake/web-spike share`), and the **hosted** fallback
  renders the same payload through the same shared screen with **no `<script>` at all**.
  Carries: `@leapsake/crypto` bundles for a browser at **5.9 KiB gzip with no shim** (112 KiB
  with React + a screen, zod the second-largest piece); **a capability link can never be
  re-shown**, which is a product rule, not a bug; and shared screens have **no read-only
  mode** — rendered to a stranger, `RelationshipScreen` still offers Edit / Delete.
- **The web spike, Increments 1-3 — read, write, and the no-JS floor** *(2026-08-12)*. A
  person's page server-renders with JavaScript disabled (the adapter is **six lines**), and
  create / edit / delete do too, **observed on a second device through a real relay** (9/9,
  `roundtrip`). **Cold store + warm key wins**, so §9.2's warm-store trust claim is not
  forced. Carries: the relay is an **append-only log with no compaction** and a cold host
  must `pull(0)`, so **cold store and incremental pull are mutually exclusive**; `SyncEngine`
  should expose the push mark, because `Date.now()` **silently drops writes**; **Argon2id
  stalls the whole event loop**; **`duplicates.findFor` is O(n²) on every person page**.
- All four increments held the constraint: **zero files changed under `packages/`**.
- **Restore-from-backup, verified** *(2026-08-11)*. All four cases confirmed on a clean machine,
  and 04's last gate is gone: [`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up*
- **The account merge, all four increments, both clients** *(2026-08-08 → 08-11)*. A local-only
  account can **merge** into a synced one or **publish itself** to a relay, and a taken username
  forks to merge-or-rename. Design: [`encryption/model.md`](./encryption/model.md) §7.2.2.

## Next

1. **The web spike, Increment 5** — the browser JS path, and all that is left before the
   teardown. **5a (sqlite-wasm + the driver contract in the browser) is the next stopping
   point**, and cheaper than it was, since Increment 4 proved the browser *build* works. Two
   files are the whole briefing: [`v0-1_web-spike.md`](./v0-1_web-spike.md) holds the
   increments and the decisions not to re-litigate;
   [`apps/web-spike/README.md`](../apps/web-spike/README.md) holds how to run it and what 1-4
   found. **Keep the zero-`packages/`-edits constraint**, logging temptations in
   `apps/web-spike/WANTED-CHANGES.md` instead. Three cheap manual checks are owed before
   Increment 6 tears the spike down — a Firefox run with `javascript.enabled=false`, a
   capability link opened in a real browser, and one real desktop build converged against
   the spike's relay.

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
