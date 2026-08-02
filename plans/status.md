# Leapsake — Status (immediate work only)

> **What this file is:** what just landed, and what is being worked on next. Nothing else.
> It is deliberately short — if it grows past ~100 lines, something in it belongs elsewhere.

| Question | Where the answer lives |
|---|---|
| What has been **done**, and how? | `git log`, plus the doc-comments in the code it touched |
| What **could** be done next? | the workstream docs in [`plans/`](./README.md) — each holds only *unbuilt* work |
| What is being done **right now**? | this file |
| How does the code **work**? | the code, its tests, and the README beside it — [`../AGENTS.md`](../AGENTS.md) maps them |
| What is **decided** (product posture, user model)? | [`product-truths.md`](./product-truths.md) |

**A doc in `plans/` lives exactly as long as it has unbuilt work in it.** It shrinks as
increments land — delivered detail moves to `git log` and to the code's own doc-comments — and
it is **deleted when empty**. Leftovers are never parked here; they stay with their workstream
until they are built or dropped.

## Just landed

- **Local custody**, both clients *(2026-07-26 → 07-30)*. Leapsake encrypts once the user holds
  a secret that opens it, and not before: a fresh install mints no keys and writes a plaintext
  store, creating an account turns encryption on, and a lost keychain is answered by the
  password. Design: [`encryption/model.md`](./encryption/model.md) §7. Code map:
  [`@leapsake/key-custody`](../packages/key-custody/README.md).
- **Relay hardening through H3** — session tokens + both TLS paths, plus H2, M3, proxy-aware IP
  and the recovery throttle.
- **Onboarding design reshaped** *(2026-07-31)* — the Day-1 flow and its decision table dropped
  in favour of standing nudges plus reminder snooze. One verb, one write method
  ([`onboarding.md`](./onboarding.md) §4.2).
- **[`onboarding.md`](./onboarding.md) Increment 1 — reminder snooze + honest dismiss actions**
  *(2026-07-31 → 08-01, 9 slices)*. Every acceptance clause now holds on desktop, watched rather
  than inferred: on one device (slice 8) and across two (slice 9). The last defect was the merge —
  every device mints the nudges under the same deterministic id, so a device that minted before it
  pulled out-ranked a peer's dismissal on `updated_at` and undid it. **An untouched row never wins
  a merge** now, via an opt-in per-table `hasHistory` predicate the sync substrate grew for it.
  Mobile is **unverified** — its row logic has a unit tier, but nothing on either simulator has
  been observed, which belongs to the blocked E2E tier ([`testing/`](./testing/)), not here.
  The dial that went with it is settled too *(owner, 2026-08-01)*: a step accepts **two** *not
  now*s, never one, so no nudge retires on the first click and *don't ask again* is always
  reachable. One cosmetic leftover stays with the workstream and is deprioritized — nudge display
  order only holds within a single reconcile ([`onboarding.md`](./onboarding.md) → *Left open by
  slice 8*, finding 3).

## In progress

Nothing. Next is [`onboarding.md`](./onboarding.md) Increment 2 — see below.

## Next, in order

1. **[`onboarding.md`](./onboarding.md) Increment 2** — the account invitation, now unblocked.
   It is what [`launch.md`](./launch.md) Increment 4's *"don't put a build in real testers' hands
   first"* rule requires, so it gates the Play 14-day clock. Increments 3–4 there do **not** —
   they can land at any pace.
2. **[`launch.md`](./launch.md), in its own numbered order.** Increment 2 is superseded by the
   above; Increment 1 is down to one owner decision, **deliberately deferred** *(owner,
   2026-07-31)*: everything stays `0.0.0` until it is needed, which is Increment 4's first
   store upload, not the v0.1 cut.
3. **Everything else** — genuinely interleavable, no dependencies between them. See the table
   below.

## Where the rest of the work lives

Not a queue. Each doc holds its own backlog and its own open questions.

| Workstream | Doc | Shape of what remains |
|---|---|---|
| **Onboarding** (first run) | [`onboarding.md`](./onboarding.md) | Increment 1 built; 2 is the rest of the v0.1 line |
| **Distribution / launch** | [`launch.md`](./launch.md) | 11 increments; signing, stores, the release gate |
| **Encryption + sync** | [`encryption/`](./encryption/) | the relay/sync backlog + every post-launch stage |
| **Reconciliation** (dedup & merge) | [`reconciliation.md`](./reconciliation.md) | 4 quality items; pre- or post-launch |
| **Client / UX** | [`client-ux.md`](./client-ux.md) | reminder search, styling, i18n, one mobile bug |
| **Holidays** | [`holidays.md`](./holidays.md) | doors deliberately left open; none blocking |
| **Files / media** (photos, v0.2) | [`files.md`](./files.md) | nothing built; invariants pinned |
| **Testing** | [`testing/`](./testing/) | E2E is the one blocked tier, pending owner sign-off |
| **Native SQLite ABI** | [`sqlite-abi-napi.md`](./sqlite-abi-napi.md) | watch-item, blocked on the fork |

**Shipped and feature-complete, with no doc left:** V1 desktop, V1.5 local CRM, V2 mobile, the
UI/view-model extraction, gifts, contact import. Read `git log` and the package READMEs.
