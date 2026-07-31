# Leapsake — Onboarding (the optional Day-1 flow and the nudges around it)

> **The plan for how a new user is invited into the things they should do early** — connect
> an existing account, tell us about themselves, import their contacts, and create an account
> so they never lose access. It replaces the scattered first-run nudges with one optional
> flow plus one reminder, and gives the reminder surface the persistent memory it needs to
> stop asking the same person the same question.
>
> **This is a plan, not a status board.** As increments land, record them in
> [`status.md`](./status.md) and keep this stable.
>
> Everything here assumes *encryption follows custody* (`encryption/model.md` §7.2): a fresh
> install is **Open** (plaintext, no keys), and creating an account is the single act that
> turns encryption on. The account step below is that act — read §7.2.1 for the copy
> constraint before writing any of it.
>
> Supersedes [`launch.md`](./launch.md) Increment 2, which scoped this as a single nudge.
> Increment 2 below is that nudge, kept narrow *on purpose* so it can clear `launch.md`'s
> gate without the rest of this plan blocking the Play clock.

## 1. The decisions this plan encodes (settled 2026-07-30)

| Decision | Choice | Consequence |
|---|---|---|
| Shape | **One optional Day-1 flow + one flow-level reminder**, not N scattered nudges | The three existing first-run nudges collapse into the flow; `add-first-person` survives as the empty state |
| Per-step outcomes | **do it · skip · skip + remind me later · skip + don't ask again** | Each step carries its own outcome; the flow completes regardless |
| Skip semantics | **Per-step, declared by the step** — not one global rule | The steps have unequal stakes; see §3 |
| "Don't ask again" | **Not offered on first encounter** — appears only when a step returns | First run stays a binary choice (layperson principle, `product-truths.md`) |
| Memory | **A persistent decision table**, an ordinary synced row | A user answers once, on any device, forever |
| Flow-level suppression | **Must not suppress the account step** | The one step whose absence risks data loss is exempt (§3) |
| Action mechanism | **Engine + view-model, via the id-convention** | No schema field for the actions themselves, no migration, no sync change |
| Copy | Drop "It's free" from `launch.md`'s draft | Nothing is paid yet; it reads as an upsell tease |

## 2. What the code already does (do not re-derive this)

Five findings from reading the engine and both clients. Each one changed the design; a fresh
reader who skips them will rebuild something that already exists or design against a
constraint that isn't there.

1. **`hasAccount` needs no new plumbing.** `getSyncStatus({ driver }).enabled`
   (`packages/key-custody/src/session.ts:254`) reads the account singleton *from inside the
   store* and is already called one line away in core's onboarding port
   (`packages/core/src/index.ts:737`, for the stricter `relayUrl !== undefined`). No
   `createCore` signature change, no roster access, no client plumbing.
   > ⚠️ The name is pre-custody residue: `getSyncStatus().enabled` means **"has an account"**,
   > not "syncs" — a local-only account sets it with no relay. Worth renaming someday; not here.

2. **Deleting a system reminder already means "never ask again."** Prune is a `softDelete`
   tombstone and reconcile never resurrects a tombstoned id
   (`packages/reminders/src/engine.ts:711`). Today the UI presents that as an ordinary
   delete, so a user who means *hide* gets *never*. Increment 1 makes the existing semantic
   honest rather than inventing a new one.

3. **There is no snooze anywhere in the product.** `partitionReminders`
   (`packages/view-models/src/reminders.ts:22`) filters on `completedAt` alone — **every open
   reminder renders regardless of due date**. Setting a future `dueDate` changes sort
   position and nothing else. "Remind me later" is a new concept, which is why it needs the
   decision table rather than a date field. A real `snoozedUntil` for *ordinary* reminders is
   a separate, larger feature (§6).

4. **`ReminderAction` is taken.** `packages/schema/src/reminder-rule.ts:23` already owns that
   name for the gift/wish/card milestone enum. The new per-row action type needs a different
   one (`ReminderRowAction` / `ReminderChoice`).

5. **The engine tombstones anything it doesn't desire.** `reconcile` soft-deletes every active
   `system` row absent from the desired set (`engine.ts:731`). Any new family must always
   supply its port — an omitted port silently and permanently kills the rows it minted. This
   is why `holidays` and `duplicates` are documented as "always supplied, never conditionally."

**Where the account UI lives today:** inside Settings on both clients — desktop `/settings`,
mobile `/(tabs)/settings`, the latter a ~50KB file with two distinct sections, *Protect your
data* (local account) and *Sync across devices* (relay). Neither client has a create-account
route. That is why Increment 3 exists.

## 3. The constraint that shapes the flow: the steps have unequal stakes

Skip semantics are per-step because a single global rule is wrong in both directions:

| Step | If the user skips | Default skip behaviour |
|---|---|---|
| **Connect to an existing account** | They almost certainly don't have one. Re-asking is noise | Quiet — don't re-prompt |
| **Create an account** | Their data has no access-recovery path at all | Re-prompt — this is the one that matters |
| **Tell us about yourself** | Mild; gifts and (later) kinship stay less useful | Re-prompt occasionally |
| **Import your contacts** | Mild; they can import any time | Quiet |

The asymmetry is the whole argument: **wrongly nagging costs annoyance the user can dismiss;
wrongly silencing the account step costs someone their data, with no signal that it
happened.** Where a step's default is genuinely unclear, default to re-prompting.

> **Corollary — flow-level "don't ask again" must not suppress the account step.** The flow is
> a convenience wrapper; one dismissive tap on a generic "set up Leapsake" row must not switch
> off the only thing inside it that protects the user. The account step re-surfaces on its own
> terms regardless of what happened to the flow reminder.

This is the onboarding-side restatement of `launch.md` §2: under *encryption follows custody*
an accountless user has nothing to lose on the org move, and an account holder has a password
to type. Both halves depend on account holders actually existing.

## 4. Why a decision table (and not another id trick)

The nudges are a **derived surface**: the engine recomputes the desired set on every reconcile
from live signals. The codebase already has the pattern for "a derived surface plus a
persistent user decision the engine must respect" — twice:

- `relationship_dismissals` — *"The inference engine recomputes derived edges on every read; a
  dismissal is the persistent 'no, not that one' so a rejected edge stays gone."*
  (`packages/data/src/dismissals-repo.ts:16`)
- `not_a_duplicate` — the same idea for the duplicate scorer.

The onboarding nudges are the third such surface, and the only one missing its decision table.

The alternative considered and rejected was encoding outcomes in deterministic ids and
tombstones (the `duplicatesReminderId` trick, `engine.ts:346`). It survives a *single* nudge
with a *single* global ladder, and collapses under per-step outcomes: "don't ask again" for a
step whose row was never minted has nothing to tombstone; per-step deferral multiplies the
missing time-anchor by the number of steps; and nothing distinguishes *skipped* from *not yet
reached*. Each is individually solvable and collectively a mess.

**The table pays for three things**, not one: per-step outcomes, the **install-date anchor**
that does not exist anywhere today, and a real "flow completed" fact instead of overloading
`completedAt`.

**It must be an ordinary synced row** (client UUID, epoch-ms stamps, nullable `deletedAt`,
whole-row LWW — the substrate in AGENTS.md), so a user answers once and every device honours
it. Note how that behaves across custody: decisions made while **Open** are local by
necessity, survive the plaintext→encrypted conversion with every other row, and merge by LWW
on join — which is the desired "don't re-ask the same human" behaviour without any special
casing.

> **User association:** one store is one user today, so the step key is sufficient and no
> owner column is added. The product model anticipates multi-user-per-client
> (`product-truths.md`), so leave the seam explicit in the schema doc-comment — adding a
> nullable owner column later is a cheap migration, and guessing its shape now is not.

## 5. The increments

Each is independently shippable: it lands, it has standalone value, and nothing is half-built
if the next one is deferred. **1 → 2 is the v0.1 line**; 3–6 can follow at any pace.

### Increment 1 — Persistent nudge decisions + honest dismiss actions

**Value:** today's silent, permanent dismiss becomes an explicit choice, and the substrate
every later increment needs exists. Standalone even if nothing else here is built.

- The decision table: schema + migration + repo + sync registration (§4). Records step key,
  outcome (`done` / `deferred` / `suppressed`), a deferral timestamp, and the store's first-run
  anchor.
- Generalize the CTA seam from one call-to-action to a **list of actions**:
  `reminderCtaOf` → an action list in `@leapsake/view-models`, with the engine's step
  definitions declaring which actions they offer. Clients keep ownership of the labels (they
  already do, deliberately — the copy is user-visible and the two routers differ).
  Mind the name collision (§2.4).
- Teach the engine to consult the table before desiring a row.
- Wire *Not now* / *Don't ask again* onto the **existing three nudges**, with "don't ask
  again" appearing only on a step's second encounter (§1).

**Acceptance:** a nudge dismissed with *Not now* returns; one dismissed with *Don't ask again*
never does; both hold across a restart and across sync to a second device; both clients. The
existing three nudges still retire on their own derived signals as before.

### Increment 2 — The account invitation

> The narrow gate-clearer for [`launch.md`](./launch.md) Increment 4 — deliberately *not* the
> full flow, so the Play 14-day clock isn't waiting on Increments 3–5.

**Value:** gets users from Open to Protected, which is what closes the data-loss path.

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

**Acceptance:** a brand-new profile sees no custody UI until it has data; the invitation then
appears on Home; creating an account clears it permanently and leaves the store encrypted with
the plaintext original gone; *Not now* re-surfaces it; *Don't ask again* does not. Both clients.
Verify it disappears **immediately** on account creation, not at next launch — desktop's store
swap rebuilds core, mobile's `createAccountHere` path needs checking (a one-line
`regenerateSystem()` if not).

### Increment 3 — Settings decomposition + an Account screen

**Value:** the CTA destinations become real. Today both nudges land a first-week user at the
top of a ~50KB settings screen and hope they scroll.

- Split Settings into linked sub-screens; give the account flows their own route.
- Extract the account forms so the **same** components serve the Account screen and (in
  Increment 4) the flow — Settings being the post-onboarding way to edit what the flow set up.

**Acceptance:** every onboarding CTA deep-links to a screen that does exactly one thing; the
account forms exist in one place with two callers.

### Increment 4 — The Day-1 flow

**Value:** one coherent first-run experience instead of a list of nudges, and the frame for
everything a user should see on day one.

- An **optional, skippable** sequence: connect to an existing account → tell us about yourself
  → create an account. A nudge, never a wall — a forced setup at first run violates the
  layperson principle and forfeits the zero-setup first run that is the point of the Open state.
- One flow-level reminder replaces the `sync-devices` / `pick-self` / account nudges.
  `add-first-person` stays as the empty state for anyone who skips.
- Per-step outcomes (§1) recorded in the decision table; **completing the flow completes the
  flow reminder** regardless of what individual steps chose.
- **"Tell us about yourself" creating the self-person satisfies `hasEntities` and `hasSelf` at
  once** — one step retires two of today's nudges.

**Acceptance:** a fresh profile is offered the flow and can complete it, skip any step, or
dismiss it entirely; each outcome is recorded and honoured on the next launch and on a second
device; nothing about the flow is mandatory.

> **Migration note:** the existing nudges' tombstones do not transfer to new step keys.
> Pre-v0.1 that is fine (`product-truths.md` → *Pre-v0.1 latitude*) — worth stating so nobody
> builds a compatibility shim for it.

### Increment 5 — Deferred-step re-prompts

**Value:** "skip and remind me later" becomes true rather than a polite no.

Steps deferred in the flow re-surface as their own reminders on the schedule their definition
declares (Day 2 / 7 / 30, or per-step). The decision table already holds the anchor and the
outcome, so this is engine work plus copy — no new persistence.

**Acceptance:** a step skipped with *remind me later* returns on schedule and no other step
does; a step skipped with *don't ask again* never returns; the account step returns even when
the flow itself was dismissed (§3).

### Increment 6 — Import as a flow step

**Value:** matches the real usage curve. Adoption is not incremental — a user goes from 0 to
200 people via import, which is also the moment the account step's stakes jump.

`@leapsake/contact-import` already ships vCard drag-drop. This is placement and copy, not new
import capability. Note the tail: importing 200 people will fire the duplicates nudge, so the
flow's end and the duplicate-review surface will meet — sequence them so the user isn't handed
two chores at once.

## 6. Deferred / decide-before-committing

- **Real snooze for ordinary reminders** — a `snoozedUntil` field plus a visibility rule in
  `partitionReminders`. Users will want it for their own reminders eventually; it is a
  migration, a sync-surface change and both clients, and the decision table covers onboarding
  without it. Revisit when someone asks for it on a user-created reminder.
- **Reminder search** (`status.md`) is untouched by this plan, but note any new dateless
  system rows join the same surface.
- **A general reminder-action framework.** Increment 1 designs the seam as a list but should
  implement only the actions these steps need. The id-convention earned its keep by being
  narrow; a framework built ahead of its second consumer gets built wrong.

## 7. Open decisions for owner sign-off

1. **Deferral intervals.** Day 2 / 7 / 30 as a global ladder, or per-step schedules? §3's
   stakes table argues per-step (the account step deserves a shorter leash than
   "tell us about yourself"), but a global ladder is simpler to reason about and to test.
2. **Does the flow reminder appear before any data exists, or after the first entity?**
   `launch.md` argues the account invitation should fire at the first person added — the
   moment the exposed window opens. A *flow* might reasonably come earlier, at first launch.
3. **Confirm the §3 per-step defaults.** The stakes table is a proposal, not a decision.
4. **Increment 6's placement** — inside the Day-1 flow, or a separate prompt after it?

## 8. What this plan does *not* change

The custody build is finished and this plan touches none of it: no change to
`resolveActiveStore`, the boot path, the doors, or the converters. It only decides *when a
user is invited* to create an account — never how one is created. `launch.md`'s other
increments are unaffected; only its Increment 2 is superseded, and Increment 2 above is a
drop-in for its gate.
