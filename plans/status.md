# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **The web spike, Increments 1 and 2 — the primary question, answered yes** *(2026-08-12)*. A
  person's page server-renders with **JavaScript disabled and zero files changed under
  `packages/`**; the adapter a no-JS client owes the shared UI is **six lines**, and the desktop
  loader ported call-for-call. **Cold store + warm key wins** (6.6 ms p50 at 100 people, 36.8 ms
  at 1 000, against a 150 ms rule), so the SSR host never holds a standing decrypted database and
  §9.2's warm-store trust claim is not forced. Three things to carry: §9.2 should say the
  `authVerifier` is wrapped under the session key; **Argon2id stalls the whole event loop**, so
  an SSR host needs a worker pool or a native binding; and **`duplicates.findFor` is O(n²) on
  every person page** (11.8 s of a 12.1 s request at 10 000 people) — desktop's problem too, not
  SSR's. Findings: [`apps/web-spike/README.md`](../apps/web-spike/README.md).
- **Restore-from-backup, verified** *(2026-08-11)*. All four cases confirmed on a clean machine,
  and 04's last gate is gone: [`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up*
- **The account merge, all four increments, both clients** *(2026-08-08 → 08-11)*. A local-only
  account can **merge** into a synced one or **publish itself** to a relay, and a taken username
  forks to merge-or-rename. Design: [`encryption/model.md`](./encryption/model.md) §7.2.2.

## Next

1. **The web spike, Increments 3 → 5. The owner call is made: continue** *(owner, 2026-08-12)*.
   The stopping point after Increment 2 was reached and deliberately **not taken**, and the goal
   is now stated: prove that **every CRUD path a web client needs works on this architecture**,
   not just the read that Increment 2 answered. **Start at Increment 3** — create, edit, and
   delete a person with JavaScript disabled, ending in a **desktop app seeing the write through a
   real relay** — then 4 (sharing) and 5 (the browser JS path; its 5a is the next stopping point).
   Two files are the whole briefing: [`v0-1_web-spike.md`](./v0-1_web-spike.md) holds the
   increments, their done-whens, and the decisions not to re-litigate;
   [`apps/web-spike/README.md`](../apps/web-spike/README.md) holds how to run it and what 1-2
   found. **Keep the constraint that made Increment 2 worth having: zero files changed under
   `packages/`**, with every temptation logged in `apps/web-spike/WANTED-CHANGES.md` instead.

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
