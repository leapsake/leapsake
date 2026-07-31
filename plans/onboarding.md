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
| Memory | **Two nullable columns on `reminders`**, not a decision table *(owner, 2026-07-31)* | §4 — nearly all of the state is derivable; only the defer clock and count are not |
| "Later" | **Reminder snooze *is* onboarding defer** *(owner, 2026-07-31)* | One mechanism, built once, generic to every reminder |
| Re-prompt policy | **Duration and repetitions are separate dials, held as data** | The numbers are cheap to change later — §4.1 is what makes that true |
| Copy | Drop "It's free" from `launch.md`'s draft | Nothing is paid yet; it reads as an upsell tease |

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
| **Deferred until** | No | new |
| **How many times deferred** | No | new |

So the persistence is **two nullable columns on `reminders`** — `snoozed_until` and
`defer_count` — and no new table, no repo, no sync registration.

**Not now** sets `snoozed_until` and increments `defer_count` on the **live** row; the row
stays in the desired set, so `reconcile` never prunes it (§2.5), and `partitionReminders`
hides it until the clock passes. **Don't ask again** soft-deletes, exactly as today. When
`defer_count` reaches the step's repetitions limit, the engine retires the row for good
instead of re-showing it.

`snoozed_until` is generic to every reminder, so this delivers **reminder snooze** — long on
the wish list — as the same work. `defer_count` is the one impurity: onboarding-flavoured
state on a general table. Accepted deliberately; a table for one integer is the worse trade.

> **User association:** one store is one user today, so no owner column is added. The product
> model anticipates multi-user-per-client (`product-truths.md`), so leave the seam explicit in
> the migration's doc-comment — adding a nullable owner column later is a cheap migration, and
> guessing its shape now is not.

### 4.1 Store what happened, never what to do next

**Record facts — when it was deferred and how many times. Never a computed next-prompt date.**

This is the whole of what makes the re-prompt policy cheap to change. If a row says *"deferred
at T, count 2"*, the schedule is re-derived on every reconcile — so changing 3 days to 5, or
two repetitions to three, takes effect immediately for everyone, including users who deferred
last week. If a row says *"show again on 15 August"*, today's policy is baked into rows you can
no longer reach, and every future change needs a data migration to match.

> ⚠️ `snoozed_until` is a stored date, and therefore the one place this rule can be broken by
> accident. It is legitimate **only** because it is generic snooze — a user-chosen "hide until
> Tuesday" is a fact about what the user did. The onboarding *policy* must stay derived: the
> engine computes the snooze target from the step's `duration` at defer time, and re-derives
> the give-up decision from `defer_count` against the step's `repetitions` on every reconcile.
> Never persist "this step's next prompt is on 15 August" as policy.

The policy itself lives **as data on the step definitions** — the shape `ONBOARDING_STEPS`
already uses (`engine.ts:291`), and the same declarative-table-of-plain-objects pattern as
`actionDefs` and `kindDefs`. Two independent dials per step:

- **duration** — how long before it comes back;
- **repetitions** — how many times it is willing to come back before giving up.

Changing either is editing a literal, not touching logic. That is what "easy to change later"
has to mean concretely, or it means nothing.

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

- Migration: `snoozed_until` and `defer_count` on `reminders` (§4). Note the derived-policy
  rule (§4.1) in its doc-comment; it is the one thing a later change can quietly break.
- The hide rule in `partitionReminders` — the first time that function considers anything
  beyond `completedAt` (§2.3).
- Generalize the CTA seam from one call-to-action to a **list of actions**: `reminderCtaOf` →
  an action list in `@leapsake/view-models`, with the engine's step definitions declaring which
  actions they offer. Clients keep ownership of the labels (they already do, deliberately — the
  copy is user-visible and the two routers differ). Mind the name collision (§2.4).
- `duration` + `repetitions` on the step definitions, and the engine retiring a step whose
  `defer_count` has reached its limit.
- Wire *Not now* / *Don't ask again* onto the **existing three nudges**, with "don't ask again"
  appearing only on a step's second encounter (§1).

**Acceptance:** a nudge dismissed with *Not now* disappears and returns on schedule; one
dismissed with *Don't ask again* never returns; both hold across a restart and across sync to a
second device; both clients. A step that exhausts its repetitions stops returning. The existing
three nudges still retire on their own derived signals as before. A snoozed **user** reminder
hides and returns too — the generic half.

> If this proves large in practice, the clean split is snooze (migration + hide rule + both
> clients) as 1a and the dismiss actions as 1b. Kept as one increment because the second is
> nearly free once the first lands.

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
  existing local account to a relay is unbuilt on both clients (`status.md` → *Open questions*
  → *Username collision*). Retire `sync-devices` on `hasAccount` too, or reword it.

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
