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

## In progress

**[`onboarding.md`](./onboarding.md) Increment 1 — reminder snooze + honest dismiss actions.**
All 8 slices are built, and slice 8 drove the desktop dev app over CDP *(2026-08-01)* — the
first time any of it has been observed running. **On one device it all holds**: a *Not now*
hides the nudge, survives a restart, comes back when its clock passes and then offers *don't
ask again*; a step that spends its repetitions stops returning; a dismissal is permanent and
says so; all three nudges retire on their own derived signals; and a snoozed **user** reminder
hides and returns too.

**It is not finished.** Across sync, a device that mints a nudge before it pulls beats the
peer's tombstone under whole-row LWW, so *don't ask again* — and a snooze — can be undone by a
second device. That fails an acceptance clause and is its own slice, with a design choice to
make first; the two smaller findings beside it are an owner dial decision and a cosmetic
ordering wart. All three are written up in
[`onboarding.md`](./onboarding.md) → *Left open by slice 8*. Mobile stays **unverified** — its
row logic has a unit tier, but no client's on-screen behaviour has been observed there, and
that belongs to the blocked E2E tier. Increment 2 is unblocked on everything but the sync
defect.

## Next, in order

1. **[`onboarding.md`](./onboarding.md) Increments 1–2.** Increment 2 (the account invitation)
   is what [`launch.md`](./launch.md) Increment 4's *"don't put a build in real testers' hands
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
| **Onboarding** (first run) | [`onboarding.md`](./onboarding.md) | 4 increments; 1–2 are the v0.1 line |
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
