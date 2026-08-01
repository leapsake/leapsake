# Leapsake — Onboarding (first-run nudges)

> **The plan for how a new user is invited into the things they should do early** — connect
> an existing account, tell us about themselves, import their contacts, and create an account
> so they never lose access. Each is a standing nudge on Home, ordered so the time-sensitive
> ones lead, and each can be declined honestly.
>
> **This is a plan, not a status board.** As increments land, record them in
> [`status.md`](./status.md) and keep this stable.
>
> Everything here assumes *encryption follows custody* (`encryption/model.md` §7.2): a fresh
> install is **Unauthenticated** (plaintext, no keys), and creating an account is the single act that
> turns encryption on. The account step below is that act — read §7.2.1 for the copy
> constraint before writing any of it.
>
> Supersedes [`launch.md`](./launch.md) Increment 2, which scoped this as a single nudge.
> Increment 2 below is that nudge, kept narrow *on purpose* so it can clear `launch.md`'s
> gate without the rest of this plan blocking the Play clock.

## 1. The decisions this plan encodes

Settled 2026-07-30 unless noted.

| Decision | Choice | Consequence |
|---|---|---|
| Shape | **N standing nudges on Home**, no separate flow *(owner, 2026-07-31)* | Onboarding happens in the surface the user keeps; §5 records why the flow was dropped |
| Sequencing | **Display order**, not a wizard *(owner, 2026-07-31)* | `ONBOARDING_STEPS` array order already encodes it, for exactly this reason (§3.1) |
| Per-step outcomes | **do it · not now · don't ask again** — three | *Do it* is derived, never stored (§4) |
| Skip semantics | **Per-step, declared by the step** — not one global rule | The steps have unequal stakes; see §3 |
| "Don't ask again" | **Not offered on first encounter** — appears only when a step returns | First run stays a binary choice (layperson principle, `product-truths.md`) |
| Memory | **Two new columns on `reminders`**, not a decision table *(owner, 2026-07-31)* | §4 — nearly all of the state is derivable; only the snooze clock and count are not |
| "Later" | **One verb: snooze** *(owner, 2026-07-31)* | Onboarding defer *is* reminder snooze — one mechanism, one vocabulary, one write method (§4.2), generic to every reminder |
| Re-prompt policy | **Duration and repetitions are separate dials, held as data** | The numbers are cheap to change later — §4.1 is what makes that true |
| Copy | Drop "It's free" from `launch.md`'s draft | Nothing is paid yet; it reads as an upsell tease |
| Merge across devices | **An untouched row never wins** *(owner, 2026-08-01)* | A mint must not overwrite a peer's dismissal or snooze; field-level merge is the eventual aim, not this slice — §6 Increment 1 → *Left open by slice 8* |

> **Superseded 2026-07-31.** The first draft specified an optional Day-1 flow plus a
> persistent `onboarding_decisions` table. Both are dropped. The reasoning is in §5; it is
> kept rather than deleted because this direction has been revisited twice.

## 2. What the code already does (do not re-derive this)

Findings from reading the engine and both clients. A fresh reader who skips these will rebuild
something that exists, or design against a constraint that isn't there.

1. **`hasAccount` needs no new plumbing.** `getSyncStatus({ driver }).hasAccount`
   (`packages/key-custody/src/session.ts`) reads the account singleton *from inside the
   store* and is already called one line away in core's onboarding port
   (`packages/core/src/index.ts:737`, for the stricter `relayUrl !== undefined`). No
   `createCore` signature change, no roster access, no client plumbing.
   > The field was called `enabled` until 2026-07-31, which read as "does this store sync"
   > when it meant "does an account exist" — `relayUrl` is what answers the sync question.

2. **Deleting a system reminder already means "never ask again."** Prune is a `softDelete`
   tombstone and reconcile never resurrects a tombstoned id
   (`packages/reminders/src/engine.ts:711`). That is the right mechanism for *don't ask
   again* and it is **kept**. The defect is only that the UI presents it as an ordinary
   delete, so a user who means *hide* gets *never*. Increment 1 makes the existing semantic
   honest rather than inventing a new one.

3. **There is no snooze anywhere in the product.** `partitionReminders`
   (`packages/view-models/src/reminders.ts:22`) filters on `completedAt` alone — **every open
   reminder renders regardless of due date**. Setting a future `dueDate` changes sort position
   and nothing else. So "remind me later" is a new concept, and a display-level hide is the
   whole of it (§4).

4. **`ReminderAction` is taken.** `packages/schema/src/reminder-rule.ts:23` already owns that
   name for the gift/wish/card milestone enum. The new per-row action type needs a different
   one (`ReminderRowAction` / `ReminderChoice`).

5. **The engine tombstones anything it doesn't desire.** `reconcile` soft-deletes every active
   `system` row absent from the desired set (`engine.ts:731`). Any new family must always
   supply its port — an omitted port silently and permanently kills the rows it minted. This
   is why `holidays` and `duplicates` are documented as "always supplied, never conditionally."
   > This is also why a deferred nudge must stay **desired**, and be hidden at display level
   > instead. A deferral implemented as "stop desiring the row" would tombstone it, and by
   > finding 2 that is permanent. See §4.

**Where the account UI lives today:** inside Settings on both clients — desktop `/settings`,
mobile `/(tabs)/settings`, the latter a ~50KB file with two distinct sections, *Protect your
data* (local account) and *Sync across devices* (relay). Neither client has a create-account
route. That is why Increment 4 exists.

## 3. The constraint that shapes the nudges: the steps have unequal stakes

Skip semantics are per-step because a single global rule is wrong in both directions:

| Step | If the user skips | How many *not now*s before it gives up |
|---|---|---|
| **Connect to an existing account** | They almost certainly don't have one. Re-asking is noise | **One** — ask once more, then never |
| **Create an account** | Their data has no access-recovery path at all | **Most** — this is the one that matters |
| **Tell us about yourself** | Mild; gifts and (later) kinship stay less useful | **Few** |
| **Import your contacts** | Mild; they can import any time | **One** |

That last column *is* the **repetitions** dial (§4.1) — the stakes are the reasoning; the dial
is how it gets expressed. Which is why these are numbers to tune, not a design to settle.

The asymmetry is the whole argument: **wrongly nagging costs annoyance the user can dismiss;
wrongly silencing the account step costs someone their data, with no signal that it
happened.** Where a step's default is genuinely unclear, default to re-prompting.

This is the onboarding-side restatement of `launch.md` §2: under *encryption follows custody*
an accountless user has nothing to lose on the org move, and an account holder has a password
to type. Both halves depend on account holders actually existing.

### 3.1 The steps disagree about *when* — display order is the answer

The steps want opposite timing:

- **Before any data** — *"already using Leapsake elsewhere?"* and *import*. Asked after the
  user has hand-entered five people, both are too late: they produce duplicates of records
  that were about to arrive anyway, and `reconcileOnJoin` then has to sort out a mess that
  need not have existed.
- **After data exists** — *create an account*. At a cold first launch it is a signup wall
  protecting an empty database, which forfeits the zero-setup first run that is the entire
  point of the Unauthenticated state (`encryption/model.md` §1).

**Both are already satisfied by the existing rails**, which is the finding that made the flow
unnecessary:

- **Order.** `ONBOARDING_STEPS` array order *is* display priority, and its doc-comment already
  gives this exact reason — *"Sync leads: a returning user already on another device should
  reconnect before re-adding anyone, so their existing data flows in rather than being
  re-entered by hand."* The connect question is the top row on Home at first launch.
- **Relevance.** Every step carries `applies(signals)` (`engine.ts:291`), so the account step
  simply does not exist until there is something to protect, and each step retires itself once
  satisfied.

What ordering does **not** catch is a user who scrolls past the top row and starts typing.
That residual duplicate risk is accepted: `reconcileOnJoin` plus the duplicate-review surface
are built for precisely this case. See §5 for the revisit trigger.

One consequence to hold onto: after connecting, the other nudges retire only as the synced
data actually lands, so the list can show a stale row for a few seconds. That is a wart, not a
correctness problem — the list self-corrects on the next reconcile.

## 4. Where the state lives

The nudges are a **derived surface**: the engine recomputes the desired set on every reconcile
from live signals. So the first question is not *what table* but *what is genuinely not
derivable*. Almost everything is:

| Fact | Derivable? | From |
|---|---|---|
| *Did it* | **Yes** | `applies(signals)`, live. **Never store it** — a stored copy is what lets a step be marked "deferred" on one device and satisfied on another, disagreeing forever |
| *Don't ask again* | **Yes, already built** | the tombstone on the deterministic id (§2.2), which syncs like any row |
| Which nudges exist now | **Yes** | the engine's desired-set computation, unchanged |
| **Snoozed until** | No | new |
| **How many times snoozed** | No | new |

So the persistence is **two new columns on `reminders`** — `snoozed_until` and
`snooze_count` — and no new table, no repo, no sync registration. (`snoozed_until` is
nullable; `snooze_count` is `NOT NULL DEFAULT 0`, which backfills existing rows for free —
a count has an obvious zero.)

**Not now** sets `snoozed_until` and increments `snooze_count` on the **live** row; the row
stays in the desired set, so `reconcile` never prunes it (§2.5), and `partitionReminders`
hides it until the clock passes. **Don't ask again** soft-deletes, exactly as today. When
`snooze_count` reaches the step's repetitions limit, the engine retires the row for good
instead of re-showing it.

**Neither column is onboarding-flavoured**, which is what lets both be generic. `snoozed_until`
obviously is not. `snooze_count` holds *how many times this reminder has been put off* — a fact
that is equally true of a dentist reminder someone has dodged four times, and one no reader
needs onboarding to understand. What is onboarding-specific is not the count but the engine
**comparing it to `repetitions` and retiring the row**, and that comparison lives in
`computeAndReconcile`, which iterates `ONBOARDING_STEPS` and never sees a user reminder. So this
delivers **reminder snooze** — long on the wish list — as the same work, with no impurity to
accept.

> The two cases stay distinguishable without a second column or a second method: `source`
> already separates them. `system` + a snooze is *the product asked and the user declined*;
> `user` + a snooze is *someone hiding their own reminder*. A distinction recoverable from data
> already stored does not need its own storage.

> **User association:** one store is one user today, so no owner column is added. The product
> model anticipates multi-user-per-client (`product-truths.md`), so leave the seam explicit in
> the migration's doc-comment — adding a nullable owner column later is a cheap migration, and
> guessing its shape now is not.

### 4.1 Store what happened, never what to do next

**Record facts — when it was snoozed and how many times. Never a computed next-prompt date.**

This is the whole of what makes the re-prompt policy cheap to change. If a row says *"snoozed
at T, count 2"*, the schedule is re-derived every time it is asked for — so changing 3 days to
5, or two repetitions to three, takes effect immediately for everyone, including users who
snoozed last week. If a row says *"show again on 15 August"*, today's policy is baked into rows
you can no longer reach, and every future change needs a data migration to match.

> ⚠️ `snoozed_until` is a stored date, and therefore the one place this rule can be broken by
> accident. It is legitimate **only** because it is generic snooze — a user-chosen "hide until
> Tuesday" is a fact about what the user did. The onboarding *policy* must stay derived: the
> step's `duration` is applied by a **pure function** (§4.2) at the moment the user snoozes,
> and the give-up decision is re-derived from `snooze_count` against the step's `repetitions`
> on every reconcile. Never persist "this step's next prompt is on 15 August" as policy.

The policy itself lives **as data on the step definitions** — the shape `ONBOARDING_STEPS`
already uses (`engine.ts:291`), and the same declarative-table-of-plain-objects pattern as
`actionDefs` and `kindDefs`. Two independent dials per step:

- **duration** — how long before it comes back;
- **repetitions** — how many times it is willing to come back before giving up.

Changing either is editing a literal, not touching logic. That is what "easy to change later"
has to mean concretely, or it means nothing.

### 4.2 One verb, one write method

*Decided 2026-07-31, while planning Increment 1.* An earlier draft of that plan split the write
in two — a generic `snooze(id, until)` for user reminders and a policy-driven `defer(id)` for
nudges. **Rejected.** The two differ only in *who computes the date*; the row write is
identical, and "defer" as a second verb would fork the vocabulary across the schema, the
engine, core, the IPC surface and both clients for no gain.

There is **one** method — `snooze(id, until)` — and the policy is a **pure function** in
`@leapsake/reminders`, beside the step definitions it reads:

- The action seam already has to evaluate that policy for a different reason: it decides
  whether to *offer* snooze at all (`snooze_count` vs. the step's `repetitions`). Having the
  same evaluation return the target date means "is it offered" and "until when" come from one
  place instead of two.
- So the offered action **carries its own date** (`{ kind: "snooze", until }`), and the client
  passes it straight to the one write method. No mode flag, no overload, no duplicated policy.
- It lives in `@leapsake/reminders` because `ONBOARDING_STEPS` is module-private there;
  `@leapsake/view-models` already imports `onboardingRouteOf` across that seam, so this is the
  established route, not a new one.
- It must be applied at click time, not inside `reconcile` — a snooze takes effect when the
  user asks, and reconcile runs on a schedule.

A side benefit worth keeping: because the action carries its date, the copy can be honest —
*"Not now (ask me in 3 days)"* — with no second derivation.

One guard is bypassed deliberately: `isReminderEditable` blocks *content* edits to `system`
rows because the engine owns their text. Snoozing is not a content edit, so `snooze` routes
around it the way `setCompleted` already does.

## 5. Considered and deferred: the Day-1 flow

The first draft specified an optional wizard at first launch — connect → import → tell us
about yourself → create an account — with steps self-selecting on relevance. It was dropped on
2026-07-31. Recorded so it is not rebuilt by reflex.

**Why it was dropped:**

- **Ordering already delivers the sequencing** (§3.1). The connect question leads the list at
  first launch, for the reason the code comment already states.
- **A list is more ignorable than a modal.** The flow's stated goal was to avoid a wall of
  chores while preserving autonomy; a modal at first launch is a wall you must dismiss, a list
  is one you can scroll past. On its own criterion the flow was the more imposing option.
- **It was the only thing that needed the table.** "Declined a step whose nudge was never
  minted" and "skipped vs. not yet reached" are flow-only states. Without the flow, §4's
  derivation collapses the persistence to two columns.
- **The residual risk is already mitigated.** `reconcileOnJoin` and the duplicate-review
  surface exist and are built for the hand-entered-then-synced case.

**Revisit if** real usage shows people hand-entering people *before* connecting an existing
account, at a rate the duplicate-review surface makes painful. That is the one failure the
flow prevents and ordering does not. It is a usage observation, not a design argument — do not
reopen this without one.

## 6. The increments

Each is independently shippable: it lands, it has standalone value, and nothing is half-built
if the next one is deferred. **1 → 2 is the v0.1 line**; 3–4 can follow at any pace.

### Increment 1 — Snooze + honest dismiss actions

**Value:** today's silent, permanent dismiss becomes an explicit choice, and every reminder
gains snooze. Standalone even if nothing else here is built.

- Migration: `snoozed_until` and `snooze_count` on `reminders` (§4). Note the derived-policy
  rule (§4.1) in its doc-comment; it is the one thing a later change can quietly break.
- The hide rule in `partitionReminders` — the first time that function considers anything
  beyond `completedAt` (§2.3).
- Generalize the CTA seam from one call-to-action to a **list of actions**: `reminderCtaOf` →
  an action list in `@leapsake/view-models`, with the engine's step definitions declaring which
  actions they offer, and the snooze action carrying its own target date (§4.2). Clients keep
  ownership of the labels (they already do, deliberately — the copy is user-visible and the two
  routers differ). Mind the name collision (§2.4).
- `duration` + `repetitions` on the step definitions, the pure policy function that reads them
  (§4.2), and the engine retiring a step whose `snooze_count` has reached its limit.
- One write method, `core.reminders.snooze(id, until)` (§4.2) — plus its desktop IPC entry.
- Wire *Not now* / *Don't ask again* onto the **existing three nudges**, with "don't ask again"
  appearing only on a step's second encounter (§1).

#### Slices

Each is a coherent commit; they are ordered by dependency.

1. **Substrate.** Migration **28** (`snoozed_until INTEGER`, `snooze_count INTEGER NOT NULL
   DEFAULT 0`), the two fields on `reminderSchema`, `snoozedUntil` added to
   `updateReminderInputSchema` (but **not** `snoozeCount` — engine-owned), and
   `remindersRepo.create` stamping `null`/`0`. Tests: repo round-trip, and that the columns
   survive a sync encode/decode.
2. **The hide rule.** `partitionReminders(reminders, now = Date.now())` gains a third
   `snoozed` bucket; completion still wins over snooze. Clients ignore the third bucket for
   now — it exists so §7's "findable by search?" question stays answerable.
3. **Engine dials + retirement.** `duration` and `repetitions` on `OnboardingStep`; the pure
   `snoozePolicyOf(row, now)` of §4.2; and the onboarding loop in `computeAndReconcile`
   **ceasing to desire** a step whose `snoozeCount` has reached its limit, so the *existing*
   prune→tombstone path retires it. Test the §2.5 trap explicitly: a snoozed-but-not-exhausted
   step must stay desired and must never be pruned.
4. **The action list.** `reminderActionsOf` composing the existing `reminderCtaOf` (which
   keeps its return type and its doc-comment). The snooze action carries the `until` that
   `snoozePolicyOf` returned; dismiss appears only from `snoozeCount >= 1`.
5. **The write path.** `core.reminders.snooze(id, until)` plus its desktop IPC entry
   (`apps/desktop/src/main/index.ts`'s arg-validation table, and the preload surface).
6. **Desktop UI**, then **7. mobile UI** — the two actions on nudge rows; the existing
   `Remove` / `confirmDelete` becomes the honest permanent dismiss.
8. **Verification.** The unit tiers, then drive the desktop dev app over CDP
   ([`apps/desktop/README.md`](../apps/desktop/README.md) → *Driving the app without a
   harness*) to prove a *Not now* survives a restart and reaches a second device by sync.

**Three facts worth not re-deriving** (verified 2026-07-31):

- The next migration version is **28**.
- `defineSyncable`'s default codec is a pure camelCase↔snake_case rename driven by the Zod
  schema (`packages/data/src/syncable.ts`), so adding the fields to `reminderSchema` gets the
  columns **and** sync with no codec, no sync registration, and no relay change.
- The `Reminder`-literal blast radius is **3 sites in 3 files** — `remindersRepo.create`,
  the engine's `insert` in `computeAndReconcile`, and the untyped `base` fixture in
  `packages/schema/src/reminder.test.ts` (the one site a typecheck does *not* catch).
  Everything else is structural (`ReminderStanding`), a partial `as Reminder`, or a spread;
  the four `packages/reminders/test/*` harnesses store the row the engine hands them rather
  than building their own. *(Corrected 2026-07-31 while building slice 1; the earlier figure
  of "15 across 7 files" was wrong.)*

**Acceptance:** a nudge dismissed with *Not now* disappears and returns on schedule; one
dismissed with *Don't ask again* never returns; both hold across a restart and across sync to a
second device; both clients. A step that exhausts its repetitions stops returning. The existing
three nudges still retire on their own derived signals as before. A snoozed **user** reminder
hides and returns too — the generic half.

> If this proves large in practice, the clean split is snooze (migration + hide rule + both
> clients) as 1a and the dismiss actions as 1b. Kept as one increment because the second is
> nearly free once the first lands.

#### Left open by slice 8 (verification, 2026-08-01)

Everything above is built, and every acceptance clause holds on **one desktop device** —
observed on screen and against the store file. Three things it turned up are not built, and the
first is what keeps this increment from being finished.

1. **A tombstone loses to a fresh mint across sync — the acceptance clause fails.** §2.2's
   "deleting a system reminder means never ask again" is enforced by `reconcile`, which is a
   *local* rule. Sync has no counterpart: every device mints the same deterministic id
   independently, `upsertFromRemote` settles a conflict by whole-row LWW on `updatedAt`
   (`packages/schema/src/merge.ts`), and a device that mints a row **before** it pulls therefore
   carries a newer `updatedAt` than the peer's tombstone and wins. Reproduced end to end: device
   A dismissed the *pick yourself* nudge with *Don't ask again*; a device that had added a person
   locally before joining pushed its own live copy; A pulled it and the nudge was back on Home
   with `snoozed_until` null and `snooze_count` reset from 1 to **0**. The same path resurrected
   the two nudges A had already retired on their derived signals — including *"Already using
   Leapsake on another device?"* on a device that was, by then, syncing.
   > **Not the refresh path**, which was the suspicion going in and is innocent: a joined
   > device's boot `reconcile` left a peer's snooze byte-identical (it only writes on a
   > `title`/`dueDate` drift). The race is minting, not refreshing.

   **Decided 2026-08-01 (owner): an untouched row never wins a merge.** Where one side carries
   history — a snooze clock, a non-zero count, a tombstone — and the other is exactly as the
   engine minted it, the side with history wins whatever the clocks say. Both with history is
   unchanged LWW; both untouched are identical anyway.

   The reason it is the *right* rule rather than a patch: **derived data can always be
   recomputed and a user's decision cannot.** The engine rebuilds these rows from live signals on
   every launch, so losing a mint costs nothing — the next reconcile re-derives it. A dismissal
   exists once. When the two collide the irreplaceable one must win, which is §4's
   "store what happened, never what to do next" applied to the merge.

   Two things this rule has to get right, and both were nearly missed:

   - **It is not "user beats system."** Two of the three resurrections above were engine-vs-engine
     — one device retired a nudge on its derived signal, another minted it — with no user act on
     either side. The discriminator is whether the row has *history*, not who wrote it. A mint is
     not an edit; it is a device announcing it did not know the row existed, and it should never
     overwrite one that did.
   - **Order-independence is load-bearing** (`merge.ts` preamble, `sync.md` §3): the merge must
     stay a `max` over a *total order*, or devices stop converging. The rule keeps it — it sorts
     on `(has history, then updatedAt)` rather than on `updatedAt` — but only while "has history"
     is a property of a row **alone**, never of the pair being compared.

   Detecting "untouched" is the awkward part, because `updatedAt === createdAt` does **not** work
   today: the mint deliberately backdates `createdAt` by the row's display rank (finding 3), so a
   freshly minted nudge already looks edited. Either the predicate reads the domain fields — which
   makes it per-table knowledge the sync substrate does not have yet — or that ordering trick moves
   elsewhere, which would settle finding 3 in the same change. The per-table route is the better
   aim: it is also more precise, since an engine *title refresh* leaves a row with no user decision
   on it and should still lose to a peer's snooze, which a timestamp test cannot tell.

   > **Where this is heading** *(owner, 2026-08-01)*: eventually a **field-level merge** that
   > knows which fields a user owns and which the engine derives, rather than a whole-row winner.
   > That is the only version that is right by construction instead of by timing. It is not worth
   > buying for this alone — take the narrow rule now, and let the per-table seam it needs be the
   > thing that grows into it when a second consumer appears.

2. **A one-repetition step retires on the *first* "Not now"** — so for `sync-devices` and
   `add-first-person`, two of today's three nudges, *Not now* and *Don't ask again* are the same
   act. Observed: the click stored a clock three days out, and the next reconcile — a plain
   app restart, no user action — tombstoned the row, so that clock is never read. This is what
   `computeAndReconcile` and `onboarding.test.ts` both currently specify ("retires a
   one-repetition step after a single snooze"), so it is a **dial question for the owner**, not a
   defect: is §3's "one" the number of *not nows* the step will accept, or the number of times it
   will come **back**? §8's proposal ("back after 3 days, then stop") reads as the latter, which
   is `snoozeRepetitions: 2`. It matters beyond tuning because §1 withholds *don't ask again* on a
   first encounter precisely so a permanent choice is never a trap — and today the gentle-looking
   option is the permanent one.

3. **Display order only holds within a single reconcile.** `ONBOARDING_STEPS` order is realized
   as a `createdAt` back-off applied at insert time, so a step minted in a *later* pass outranks
   one minted earlier whatever its rank: `pick-self` sits above `sync-devices` on Home, because
   it is minted only once a person exists. Cosmetic, and only visible while more than one nudge
   is live.

Mobile is **unverified**: its row logic has a unit tier (`apps/mobile/lib/reminder-row.test.ts`),
but no on-screen behaviour has been observed on either simulator. That belongs to the blocked
E2E tier ([`testing/`](./testing/)), not to this increment.

### Increment 2 — The account invitation

> The gate-clearer for [`launch.md`](./launch.md) Increment 4.

**Value:** gets users from Unauthenticated to Authenticated, which is what closes the data-loss path.

- A fourth step on the existing rails: `hasAccount` from §2.1, a `create-account` route, both
  client CTA tables (`apps/desktop/.../ReminderList.tsx:17`, `apps/mobile/app/(tabs)/index.tsx:29`).
- Copy promises **access, not safety** (`encryption/model.md` §7.2.1) — an account protects
  access; a backup protects against losing the device. Draft, minus `launch.md`'s "It's free":
  > 🔐 **Create your account so you never lose access to your data.**
- Titles stay free of `#`/`@` tokens so the core insert-wrapper materializes no tags or mentions.
- Resolve the **collision with `sync-devices`**: both nudges currently deep-link to the same
  Settings screen, and `sync-devices` only retires on `relayUrl`, so a user who creates a
  **local-only** account keeps a nudge pointing at a flow that cannot satisfy it — binding an
  existing local account to a relay is unbuilt on both clients (`encryption/README.md` →
  *Open questions* → *Username collision*). Retire `sync-devices` on `hasAccount` too, or reword it.

> **Ships after Increment 1, deliberately.** This is the step §3 says must never be wrongly
> silenced, and until Increment 1 lands the only available dismiss is the permanent one.

**Acceptance:** a brand-new profile sees no custody UI until it has data; the invitation then
appears on Home; creating an account clears it permanently and leaves the store encrypted with
the plaintext original gone; *Not now* re-surfaces it on schedule; *Don't ask again* does not.
Both clients. Verify it disappears **immediately** on account creation, not at next launch —
desktop's store swap rebuilds core, mobile's `createAccountHere` path needs checking (a one-line
`regenerateSystem()` if not).

### Increment 3 — The import nudge

**Value:** matches the real usage curve. Adoption is not incremental — a user goes from 0 to
200 people via import, which is also the moment the account step's stakes jump.

`@leapsake/contact-import` already ships vCard drag-drop, so this is a step definition, copy and
a CTA route — not new import capability.

- `applies`: few or no people yet. It sits with the other before-you-type steps (§3.1), so it
  ranks high in `ONBOARDING_STEPS` order, below connect.
- Note the tail: importing 200 people will fire the duplicates nudge, so the import CTA and the
  duplicate-review surface will meet — sequence them so the user isn't handed two chores at once.
- `add-first-person` already covers the truly-empty case; decide whether both should ever be
  desired at the same time, or whether import supersedes it while it applies.

**Acceptance:** a fresh profile is offered import on Home; importing retires the nudge; *Not
now* and *Don't ask again* behave as Increment 1 defines. Both clients.

### Increment 4 — Settings decomposition + an Account screen

**Value:** the CTA destinations become real. Today both nudges land a first-week user at the
top of a ~50KB settings screen and hope they scroll.

- Split Settings into linked sub-screens; give the account flows their own route.
- Extract the account forms so the **same** components serve the Account screen and Settings —
  the latter being the post-onboarding way to edit what the nudge set up.

**Acceptance:** every onboarding CTA deep-links to a screen that does exactly one thing; the
account forms exist in one place with two callers.

## 7. Deferred / decide-before-committing

- **Reminder search** (`status.md`) is untouched by this plan, but note any new dateless system
  rows join the same surface — and that snoozed rows need a deliberate answer there (hidden
  from Home, but findable by search?).
- **A general reminder-action framework.** Increment 1 designs the seam as a list but should
  implement only the actions these steps need. The id-convention earned its keep by being
  narrow; a framework built ahead of its second consumer gets built wrong.
- **Snooze UI for user reminders.** Increment 1 delivers the mechanism and uses it for nudges.
  Exposing "snooze until…" on an ordinary reminder is a small follow-on — a date picker and a
  menu item — but it is its own copy and its own affordance on two clients.
  > Decide then, not now: **should reopening a completed reminder clear a still-running
  > `snoozedUntil`?** Today it would re-hide the row, which is probably not what "reopen" means.
  > It is unreachable until this ships (completing a snoozed row needs a surface that shows the
  > `snoozed` bucket), so `snooze` deliberately leaves `completedAt` and `setCompleted`
  > deliberately leaves the snooze clock — one policy, not two. *(Raised 2026-07-31 building
  > Increment 1 slice 5.)*

## 8. Open decisions for owner sign-off

1. **Starting numbers for the two dials** — *not an architecture question.* §4.1 makes both
   cheap to change, so this is tuning: pick something reasonable and correct it when real usage
   disagrees. The proposal is a **shared duration, per-step repetitions** — back after 3 days,
   then after 2 weeks, then stop; only the account step takes both rungs, everything else gives
   up after one, per §3's last column. Not yet confirmed.

*Settled since first draft:*

- **Shape** (§1, §5) — standing nudges, no Day-1 flow; ordering carries the sequencing.
- **Memory** (§4) — two columns on `reminders`, not a decision table; *did it* stays derived.
- **The two kinds of "later"** collapsed into one — onboarding defer *is* reminder snooze.
- **Does import get a nudge?** Yes — Increment 3.

## 9. What this plan does *not* change

The custody build is finished and this plan touches none of it: no change to
`resolveActiveStore`, the boot path, the doors, or the converters. It only decides *when a
user is invited* to create an account — never how one is created. `launch.md`'s other
increments are unaffected; only its Increment 2 is superseded, and Increment 2 above is a
drop-in for its gate.
