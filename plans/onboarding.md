# Leapsake — Onboarding (first-run nudges)

> **The plan for how a new user is invited into the things they should do early** — connect
> an existing account, tell us about themselves, import their contacts, and create an account,
> which is what turns encryption on and makes sync possible at all. Each is a standing nudge
> on Home, ordered so the time-sensitive ones lead, and each can be declined honestly.
>
> **Unbuilt work and the decisions that constrain it.** Increment 1 is built; how it *works* is
> in the code and its doc-comments (`packages/reminders/src/engine.ts` for the steps and dials,
> migration 28 for the two columns, `packages/schema/src/merge.ts` for the cross-device rule),
> and how it came to be is in `git log`. What stays here is what a later increment would
> otherwise re-decide.
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
| Merge across devices | **An untouched row never wins** *(owner, 2026-08-01)* | A mint must not overwrite a peer's dismissal or snooze. Built as an opt-in per-table `hasHistory` predicate; **field-level merge is the eventual aim**, and the seam is there to grow into it once a second consumer appears. `merge.ts` carries the rule and the order-independence invariant it must not break |

> **Superseded 2026-07-31.** The first draft specified an optional Day-1 flow plus a
> persistent `onboarding_decisions` table. Both are dropped. The reasoning is in §5; it is
> kept rather than deleted because this direction has been revisited twice.

## 2. What a later increment should not re-derive

**`hasAccount` needs no new plumbing.** `getSyncStatus({ driver }).hasAccount`
(`packages/key-custody/src/session.ts`) reads the account singleton *from inside the store* and
is already called one line away in core's onboarding port, for the stricter
`relayUrl !== undefined`. No `createCore` signature change, no roster access, no client
plumbing. Increment 2 needs exactly this.

> The field was called `enabled` until 2026-07-31, which read as "does this store sync"
> when it meant "does an account exist" — `relayUrl` is what answers the sync question.

**Where the account UI lives today:** inside Settings on both clients — desktop `/settings`,
mobile `/settings`, the latter a ~50KB file with two distinct sections, *Protect your
data* (local account) and *Sync across devices* (relay). Neither client has a create-account
route. That is why Increment 4 exists.

## 3. The constraint that shapes the nudges: the steps have unequal stakes

Skip semantics are per-step because a single global rule is wrong in both directions:

| Step | If the user skips | How many *not now*s it accepts before giving up |
|---|---|---|
| **Connect to an existing account** | They almost certainly don't have one. Re-asking is noise | **Two** — the floor; comes back once |
| **Create an account** | Their store stays plaintext, and every further day of typing widens a window that conversion cannot fully close | **Most** — this is the one that matters |
| **Tell us about yourself** | Mild; gifts and (later) kinship stay less useful | **Few** |
| **Import your contacts** | Mild; they can import any time | **Two** — the floor |

That last column *is* the **repetitions** dial (§4.1) — the stakes are the reasoning; the dial
is how it gets expressed. Which is why these are numbers to tune, not a design to settle.

> ⚠️ **Count *not nows accepted*, not times it comes back** — the two readings differ by one, and
> the column was written the second way until 2026-08-01, which is how every step but `pick-self`
> ended up at a value that retired it on the first click. **Two is the floor for every step**
> *(owner, 2026-08-01)*: at one, the first *not now* spends the whole budget and the next
> reconcile tombstones the row before its clock is read — so the gentle-looking option is the
> permanent one, and *don't ask again* is never offered at all, since §1 withholds it until a
> second sighting. A step may take more than two; none may take fewer.

The asymmetry is the whole argument: **wrongly nagging costs annoyance the user can dismiss;
wrongly silencing the account step costs confidentiality that no later action fully recovers,
with no signal that it happened.** Where a step's default is genuinely unclear, default to
re-prompting.

> ⚠️ **Corrected 2026-08-02. An accountless user is not at risk of losing their data, and
> this plan said three times that they were.** The claim was that an accountless store "has
> no access-recovery path"; the truth is the opposite. An Unauthenticated store is a plaintext
> file with no keys anywhere, so there is no lock to be locked out of — `model.md` §7.2's
> custody table says a wiped keychain loses **nothing** in that state, and `launch.md` §2 says
> an accountless user has nothing to lose on the org move. Creating an account is what
> *introduces* a lock; the password and recovery phrase are the two doors back through it.
>
> **What an account actually buys**, and what the copy and the dials must be justified by:
> encryption at rest, an identity, and — the big one — the master key that sync and sharing
> have nothing to seal under until it exists. **An account does not protect against a lost or
> broken device**; only sync or a file backup does, exactly as `model.md` §7.2.1 already says.
>
> **The stakes argument survives on different ground.** The cost of *delay* is real, silent,
> and one-way: data typed before the account exists is written to disk in the clear, and
> §7.2.1's *honest limit of converting late* is that conversion deletes the plaintext original
> but cannot reliably erase it from SSD free space. So converting on day 1 is materially
> better than day 30, the user is given no signal of this, and they cannot undo it afterwards.
> That is why this step still takes the most repetitions — not a data-loss path that does not
> exist.

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
unnecessary: `ONBOARDING_STEPS` array order *is* display priority (sync leads, so a returning
user reconnects before re-adding anyone by hand), and every step carries `applies(signals)`, so
a step does not exist until it is relevant and retires itself once satisfied.

What ordering does **not** catch is a user who scrolls past the top row and starts typing.
That residual duplicate risk is accepted: `reconcileOnJoin` plus the duplicate-review surface
are built for precisely this case. See §5 for the revisit trigger.

## 4. Where the state lives

The nudges are a **derived surface**: the engine recomputes the desired set on every reconcile
from live signals. So the first question is not *what table* but *what is genuinely not
derivable* — the question any **new step** should be put through too. Almost everything is:

| Fact | Derivable? | From |
|---|---|---|
| *Did it* | **Yes** | `applies(signals)`, live. **Never store it** — a stored copy is what lets a step be marked "deferred" on one device and satisfied on another, disagreeing forever |
| *Don't ask again* | **Yes, already built** | the tombstone on the deterministic id, which syncs like any row |
| Which nudges exist now | **Yes** | the engine's desired-set computation, unchanged |
| **Snoozed until** | No | the `snoozed_until` column |
| **How many times snoozed** | No | the `snooze_count` column |

So the persistence is **two columns on `reminders`** and no new table, no repo, no sync
registration. **Neither is onboarding-flavoured**, which is what lets both be generic:
`snooze_count` is equally true of a dentist reminder someone has dodged four times, and
`source` already separates *the product asked and the user declined* from *someone hiding their
own reminder*. What is onboarding-specific is only the engine comparing the count to the step's
`repetitions`. **Migration 28's doc-comment is the authority** on all of this, including the
deliberate absence of an owner column.

### 4.1 Store what happened, never what to do next

**Record facts — when it was snoozed and how many times. Never a computed next-prompt date.**
If a row says *"snoozed at T, count 2"*, changing 3 days to 5 takes effect immediately for
everyone, including users who snoozed last week. If it says *"show again on 15 August"*,
today's policy is baked into rows you can no longer reach.

⚠️ `snoozed_until` is a stored date and therefore the one place this rule can be broken by
accident — it is legitimate **only** as generic snooze, a fact about what the user did. **The
full statement of the rule, and how a later change can quietly break it, is in migration 28's
doc-comment**; this section exists so the plan's own dials are read in its light.

### 4.2 One verb, one write method

*Decided 2026-07-31.* An earlier draft split the write in two — a generic `snooze(id, until)`
for user reminders and a policy-driven `defer(id)` for nudges. **Rejected:** the two differ only
in *who computes the date*, and "defer" as a second verb would fork the vocabulary across the
schema, the engine, core, the IPC surface and both clients for no gain.

So there is **one** method, `snooze(id, until)`, and the policy is a pure function beside the
step definitions it reads — the same evaluation answering both *is snooze offered* and *until
when*, so the offered action carries its own date and no client re-derives a schedule. Any new
step inherits this; do not add a second write path for it.

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

### Increment 1 — Snooze + honest dismiss actions ✅ **built** *(2026-07-31 → 08-01)*

Today's silent, permanent dismiss became an explicit choice, and every reminder gained snooze.
Ten slices; `git log` carries the sequence and the reasoning, and every acceptance clause was
watched running on desktop rather than inferred — on one device, and across two.

Two things it left, neither of them build work:

- **Display order only holds within a single reconcile.** `ONBOARDING_STEPS` order is realized
  as a `createdAt` back-off applied at insert time, so a step minted in a *later* pass outranks
  one minted earlier whatever its rank: `pick-self` sits above `sync-devices` on Home, because
  it is minted only once a person exists. Cosmetic, nothing is lost, and **deprioritized**
  *(owner, 2026-08-01)*. The fix is to move rank out of `createdAt` and into the view-model
  sort — `@leapsake/view-models` plus both clients, and nothing to do with the merge.
- **Mobile is unverified.** Its row logic has a unit tier
  (`apps/mobile/lib/reminder-row.test.ts`), but no on-screen behaviour has been observed on
  either simulator. That belongs to the blocked E2E tier ([`testing/`](./testing/)), not to
  this increment.

### Increment 2 — The account invitation

> The gate-clearer for [`launch.md`](./launch.md) Increment 4.

**Value:** gets users from Unauthenticated to Authenticated — the state that turns encryption on
and is the precondition for sync and sharing, neither of which has a key to seal under until an
account exists. Read the ⚠️ note in §3 before writing any copy for it: this is **not** a
data-loss fix, and saying so was this plan's own mistake for two drafts.

- A fourth step on the existing rails: `hasAccount` from §2, a `create-account` route, both
  client CTA tables (`apps/desktop/src/renderer/src/lib/reminder-row.ts:32` `ctaLinkFor`,
  `apps/mobile/lib/reminder-row.ts:62` `ctaOffer`).
- **`applies: (s) => s.hasEntities && !s.hasAccount`** — the invitation waits for something worth
  protecting *(owner, 2026-08-02)*. `hasEntities` already exists as a signal, so this needs no
  new plumbing, and it puts the step below `add-first-person` in the §3.1 sense without a second
  mechanism. Meanwhile `sync-devices` is minted at first launch and stands from day 1, which is
  what makes the pair read as *"already have one?"* before *"make one"*.
  > **Not a wall-clock delay, deliberately.** "Day 2 or 3" is the *expected* effect of gating on
  > data, not a second condition. A user who imports 200 contacts on day 1 has reached the
  > moment the account matters **most** (Increment 3 says as much), and an elapsed-time floor
  > would mute the invitation exactly then, widening §7.2.1's window in the highest-stakes case.
  > If a floor is ever wanted anyway, it needs no new column: `sync-devices` is minted at the
  > first reconcile, so its `createdAt` **is** the install date — derived, per §4.
- Copy promises **access, not safety** (`encryption/model.md` §7.2.1) — an account protects
  access; a backup protects against losing the device. **The old draft violated exactly that
  rule** ("*so you never lose access to your data*") and is withdrawn; §8 carries the
  replacement as an open decision. The reminder row has both a title and a body, and the body
  is the natural home for the honesty clause rather than a footnote nobody reads. Working draft:
  > 🔐 **Set up your login to protect the data on this device.**
  > It stays on this device. A login encrypts it and is what lets you sync later.
- Titles stay free of `#`/`@` tokens so the core insert-wrapper materializes no tags or mentions.
- It is the step §3 says must never be wrongly silenced, so it takes **more repetitions than the
  floor** — the one step expected to.
- Resolve the **collision with `sync-devices`**: both nudges currently deep-link to the same
  Settings screen, and `sync-devices` only retires on `relayUrl`, so a user who creates a
  **local-only** account keeps a nudge pointing at a flow that cannot satisfy it — binding an
  existing local account to a relay is unbuilt on both clients (`encryption/README.md` →
  *Open questions* → *Username collision*). Retire `sync-devices` on `hasAccount` too, or reword it.
- **Do not ship this increment without settling §6.1** — putting a *create* invitation on Home
  is what turns that latent trap into a mass-produced one.

#### 6.1 The two-account trap — the fork *(settled 2026-08-02)*

**The failure:** a returning user who already has a Leapsake account on another device sees
*"create an account"* on Home, takes it, and gets a **second, local-only** account. Their
existing data is on the other device and they now hold a store they cannot bind to it.

**Why it is not symmetric, which is the key to the fix.** The two possible mistakes cost
wildly different amounts:

| The user… | …when they should have… | Cost |
|---|---|---|
| signs in | created | **None.** `SyncSetup` (`Settings.tsx:695`) takes username + relay, calls `window.sync.lookup`, and branches to `LoginStep` or `SignupStep` on the answer. Guessing wrong self-corrects, and `reconcileOnJoin` keeps local data and surfaces overlaps for review |
| creates | signed in | **Potentially stranding.** `CreateAccount` runs no lookup — it cannot, it is deliberately relay-free — and **relay binding for an existing local account is unbuilt on both clients**. The only exit is *Forget account*, which destroys the local store |

So the guard belongs on the *create* path, not spread evenly across both.

**Why Increment 2 makes it worse rather than finding it.** Today a local-only account is one
tap away *inside Settings*, which a first-week user may never open — `encryption/README.md`
already flags this population as growing and its exit as unbuilt. This increment puts that same
tap on Home, in front of every user, including returning ones. **Closed testers are the
population most likely to be hit**: they are precisely the people installing on a second device.
That makes this a live interaction with `launch.md` Increment 4, not a v0.2 polish item.

**Ordering alone does not fix it.** §3.1 already puts `sync-devices` first for this reason, but
display order is a preference, not a gate: both rows are on Home simultaneously, and *"create
your account"* reads like the primary setup action while *"connect to sync"* reads like an
optional extra. A returning user can easily take the wrong one from the top of the list.

**Resolved *(owner, 2026-08-02)*: options 1 + 2 as the near-term shape, option 4 as the
invariant that makes the trap survivable.** The nudges become an explicit fork — *"Already have
Leapsake? Sign in"* stands from day 1, and *"Create your account"* only appears once there is
local data to protect — and underneath them sits a guarantee: **a local store, Unauthenticated
or Authenticated, must always be mergeable into an authenticated synced account.** A user who
takes the wrong branch loses time, never work. §6.2 is what that costs.

The options as they were weighed:

1. **Guard the destination.** The create screen opens by asking *"Do you already have a Leapsake
   account on another device?"* — Yes routes into the lookup flow, No into local create. Catches
   every route in, including Settings visited directly, and is the only option that does not
   depend on the user reading two Home rows correctly. Naturally Increment 4 work, pulled forward.
2. **Reword the pair as one fork.** *"Already have Leapsake? Sign in"* / *"New to Leapsake?
   Create your account."* Cheap, and `sync-devices`' current *"Connect to sync"* is our
   vocabulary rather than the user's — a returning user is looking for the word **sign in**.
3. **Sequence them:** withhold `create-account` until `sync-devices` is answered or exhausted.
   Genuinely prevents it, but costs a cross-step dependency the engine has no notion of (a
   step's `applies` reading another step's row state, cutting against §4's derive-don't-store),
   and delays the account invitation by the whole snooze budget for anyone who ignores rather
   than answers — which the §3 delay argument says is the wrong direction.
4. **Ship the *rename or join* half of relay binding first**, so the trap has an exit and the
   nudge stops being one-way. Largest scope; turns a UX guard into a real capability.

1 + 2 are complementary and cover the case without new engine concepts; 4 is the durable fix
whenever relay binding lands.

#### 6.2 The merge invariant → [`encryption/account-merge.md`](./encryption/account-merge.md)

> **A local store — Unauthenticated *or* Authenticated — must always be mergeable into an
> authenticated synced account.** *(owner, 2026-08-02.)* This is the guarantee the fork in §6.1
> rests on: a wrong turn costs a detour, never data. It also outranks §6.1's UX guards — those
> reduce how often the mistake is made, this one decides what it costs.

**It ships before this increment** *(owner, 2026-08-07)*, so the exit is closed before the
create invitation advertises the trap. Everything about it — what is already built, the two
layers that refuse it today, the four increments, and the username collision — moved to
[`encryption/account-merge.md`](./encryption/account-merge.md), because it is custody plumbing
and was previously described in three places at once. **It is a hard prerequisite of this
increment; do not start Increment 2 before it lands.**

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

- **Reminder search** ([`client-ux.md`](./client-ux.md)) is untouched by this plan, but note any
  new dateless system rows join the same surface — and that snoozed rows need a deliberate
  answer there (hidden from Home, but findable by search?).
- **A general reminder-action framework.** The seam is a list of actions but implements only the
  ones these steps need. The id-convention earned its keep by being narrow; a framework built
  ahead of its second consumer gets built wrong.
- **Snooze UI for user reminders.** Increment 1 delivered the mechanism and uses it for nudges.
  Exposing "snooze until…" on an ordinary reminder is a small follow-on — a date picker and a
  menu item — but it is its own copy and its own affordance on two clients.
  > Decide then, not now: **should reopening a completed reminder clear a still-running
  > `snoozedUntil`?** Today it would re-hide the row, which is probably not what "reopen" means.
  > It is unreachable until this ships (completing a snoozed row needs a surface that shows the
  > `snoozed` bucket), so `snooze` deliberately leaves `completedAt` and `setCompleted`
  > deliberately leaves the snooze clock — one policy, not two. *(Raised 2026-07-31.)*

## 8. Open decisions for owner sign-off

**None outstanding.** This plan is decided end to end; what is left is building it, in the order
[`launch.md`](./launch.md) §3 carries.

Settled since first draft:

- **The §6.2 merge path ships *before* this increment** *(owner, 2026-08-07)* — not alongside it.
  It moves `launch.md` Increment 4 and the Play 14-day clock out by the length of that work,
  accepted knowingly: closed testers are the group likeliest to own a second device, so they are
  exactly the wrong population to leave holding a one-way local-only account. The work is
  [`encryption/account-merge.md`](./encryption/account-merge.md).

- **Shape** (§1, §5) — standing nudges, no Day-1 flow; ordering carries the sequencing.
- **Memory** (§4) — two columns on `reminders`, not a decision table; *did it* stays derived.
- **The two kinds of "later"** collapsed into one — onboarding defer *is* reminder snooze.
- **Does import get a nudge?** Yes — Increment 3.
- **The two dials** *(owner, 2026-08-01)* — 3 days, and **two** *not nows* for today's three
  steps. Tuning numbers, to be corrected when real usage disagrees. What is **not** tuning is
  the floor of two (§3).
- **Merge across devices** *(owner, 2026-08-01)* — an untouched row never wins (§1).
- **The create/sign-in fork** *(owner, 2026-08-02)* — §6.1 options 1 + 2. *"Already have
  Leapsake? Sign in"* stands from day 1; the create invitation waits for `hasEntities`.
- **The merge invariant** *(owner, 2026-08-02)* — §6.2. A local store, Unauthenticated or
  Authenticated, is always mergeable into a synced account. A wrong turn costs time, not work.
- **The old account copy is withdrawn** *(2026-08-02)* — it promised what §3's ⚠️ note says is
  false. The working draft in Increment 2 replaces it; wording is not blocking.

## 9. What this plan does *not* change

The custody build is finished and this plan touches none of it: no change to
`resolveActiveStore`, the boot path, the doors, or the converters. It only decides *when a
user is invited* to create an account — never how one is created. `launch.md`'s other
increments are unaffected; only its Increment 2 is superseded, and Increment 2 above is a
drop-in for its gate.
