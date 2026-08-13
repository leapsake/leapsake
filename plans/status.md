# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **The web spike, Increment 3 — CRUD works with JavaScript disabled** *(2026-08-12)*. Create,
  edit and delete on the no-JS client, each **observed arriving on a second device through a real
  relay** (9/9, `pnpm --filter @leapsake/web-spike roundtrip`), still **zero files changed under
  `packages/`**. Actions and all five field readers ported *verbatim* — the desktop write path
  was `FormData`-shaped, not Electron-shaped. Two new things to carry: the relay is an
  **append-only log with no compaction** and a cold host must `pull(0)`, so **cold store and
  incremental pull are mutually exclusive** (the naive push mark took a 128-record account to 793
  in five logins); and the obvious fix, `Date.now()`, **silently drops writes** —
  `listChangedSince` is strictly `>` at ms resolution. `SyncEngine` should expose the mark.
- **The web spike, Increments 1 and 2 — the primary question, answered yes** *(2026-08-12)*. A
  person's page server-renders with JavaScript disabled; the no-JS adapter is **six lines** and
  the desktop loader ported call-for-call. **Cold store + warm key wins** (6.6 ms p50 at 100
  people), so §9.2's warm-store trust claim is not forced. Carry: §9.2 should say the
  `authVerifier` is wrapped under the session key; **Argon2id stalls the whole event loop**; and
  **`duplicates.findFor` is O(n²) on every person page** — desktop's problem too, not SSR's.
- **Restore-from-backup, verified** *(2026-08-11)*. All four cases confirmed on a clean machine,
  and 04's last gate is gone: [`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up*
- **The account merge, all four increments, both clients** *(2026-08-08 → 08-11)*. A local-only
  account can **merge** into a synced one or **publish itself** to a relay, and a taken username
  forks to merge-or-rename. Design: [`encryption/model.md`](./encryption/model.md) §7.2.2.

## Next

1. **The web spike, Increments 4 → 5.** CRUD is answered, so what is left is **4 (sharing — the
   two flavors contrasted)** and **5 (the browser JS path; its 5a is the next stopping point)**.
   Two files are the whole briefing: [`v0-1_web-spike.md`](./v0-1_web-spike.md) holds the
   increments and the decisions not to re-litigate;
   [`apps/web-spike/README.md`](../apps/web-spike/README.md) holds how to run it and what 1-3
   found. **Keep the constraint that has held for three increments: zero files changed under
   `packages/`**, logging temptations in `apps/web-spike/WANTED-CHANGES.md` instead. Two cheap
   manual checks are owed before Increment 6 tears the spike down — a Firefox run with
   `javascript.enabled=false`, and one real desktop build converged against the spike's relay.

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
