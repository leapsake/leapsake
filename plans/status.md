# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **Onboarding Increment 1 — reminder snooze + honest dismiss actions** *(2026-07-31 → 08-01)*.
  Every acceptance clause holds on desktop, on one device and across two. **Mobile is unverified**
  — its row logic has a unit tier, but nothing has been observed on a simulator, which belongs to
  the blocked E2E tier ([`v0-1_06`](./v0-1_06_e2e-and-release-gate.md)).
- **Local custody**, both clients *(2026-07-26 → 07-30)*. Leapsake encrypts once the user holds a
  secret that opens it, and not before. [`encryption/model.md`](./encryption/model.md) §7.
- **Relay hardening through H3** — session tokens + both TLS paths, plus H2, M3, proxy-aware IP
  and the recovery throttle.

## In progress

**[`01 — account merge`](./v0-1_01_account-merge.md), all four increments landed** *(2026-08-08)*,
both clients. A local-only account is no longer a one-way street in either direction: it can
**merge** into a synced one (`rekeyStore` → `mergeAccountOnThisDevice`, the relay half against a
copy so a failed login destroys nothing), or **publish itself** to a relay
(`bindRelayToAccount` — minting nothing, so the same password and phrase keep working). A taken
username forks to merge-or-rename rather than dead-ending. **Still to do: verify by hand against a
real relay** — both the merge's failure path and the collision fork stop at a stubbed relay. Then
the doc is deletable except its open questions.

## Next

1. **[`v0-1_02_account-invitation.md`](./v0-1_02_account-invitation.md)** — the create/sign-in fork
   on Home. Gates the mobile pipeline, and therefore the 14-day Play clock.
2. **[`v0-1_03_store-identity-and-restore.md`](./v0-1_03_store-identity-and-restore.md)** — then
   04 → 07 in [`v0-1.md`](./v0-1.md)'s order.

**Startable today, in parallel with any of the above:**

- **Developer account enrollment** — weeks of latency, zero effort, blocks 05 and 07.
- **[`v0-1_web-spike.md`](./v0-1_web-spike.md)** — independent of the chain; best done before 04,
  since two of its findings are relay changes.

## Open, waiting on the owner

**How much of the E2E catalog gates v0.1** — it plausibly sizes larger than all of distribution
combined, and it needs a decision rather than a quiet reinterpretation. Details and three smaller
questions: [`v0-1.md`](./v0-1.md) → *Open decisions*.

**Shipped, feature-complete, no doc left:** V1 desktop, V1.5 local CRM, V2 mobile, the UI/
view-model extraction, gifts, contact import, holidays. Read `git log` and the package READMEs.
