# Gifts — Slice 0 implementation plan (the self-person)

> Implements **Slice 0** of [`gifts.md`](./gifts.md): a synced singleton pointing at the
> Person that is "you". This plan is the *how*; the *why* lives in `gifts.md §Slice 0`.
> It ships the data increment plus the four woven touch-points that give it a reason to
> exist before any gift table lands. **No commits are made as part of this plan** — every
> step below is a working-tree change for review; the user commits.

## What ships (from `gifts.md §What slice 0 actually ships`)

1. `self_person` table + repo + `getSelf()` / `setSelf(personId)` core surface — "it just exists."
2. On the sync allowlist, plaintext, fixed-PK singleton (converges by whole-row LWW).
3. Onboarding step to pick yourself (woven into the reminders onboarding CTA set).
4. Import prompt point (pick yourself after a vCard import when unset).
5. Self-aware birthday wish — the engine renders a self-directed wish, not "Wish @You…".
6. A "You" affordance on the desktop people list.

Mobile UI (steps 3–6 on mobile) rides sequencing item 6, not slice 0 — the shared
schema/data/core changes below give mobile the data for free.

---

## Step 1 — Schema (`packages/schema`)

**New file `src/self-person.ts`**, mirroring `person.ts`/`reminder.ts` conventions:

- Constant PK, one deterministic id identical on every device (`gifts.md`: "one CONSTANT
  deterministicUuid"). Follow the `mention.ts` precedent — namespace constant here, id
  derived from it:
  ```ts
  import { deterministicUuid } from "@leapsake/bytes";
  export const SELF_PERSON_NAMESPACE = "self_person";
  /** The one, constant primary key of the self-person singleton row. */
  export const SELF_PERSON_ID = deterministicUuid(SELF_PERSON_NAMESPACE, "singleton");
  ```
- `selfPersonSchema`: `id: z.literal(SELF_PERSON_ID)` (the PK is *the* constant, not a free
  uuid — enforce it), `personId: z.uuid()`, plus the standard sync trio `createdAt` /
  `updatedAt` / `deletedAt` (nullable). Non-polymorphic `personId` — you are always a
  Person, never a Pet (`gifts.md`).
- `setSelfInputSchema = z.object({ personId: z.uuid() })` and its `SetSelfInput` type. No
  create/update-input pair like other entities — the repo owns the singleton upsert.
- Export the schema, types, and both constants from `src/index.ts`.

**Test `src/self-person.test.ts`**: `SELF_PERSON_ID` is stable/deterministic; the schema
rejects a row whose `id` isn't the constant; accepts a valid singleton.

## Step 2 — Migration (`packages/data/src/migrations.ts`)

Append **version 23** (current head is 22). Plaintext synced row, same column shape as
`reminders` (migration 18) minus the domain columns:

```sql
CREATE TABLE self_person (
  id         TEXT PRIMARY KEY,   -- always SELF_PERSON_ID
  person_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
```

Comment cites `gifts.md`: singleton fixed-PK (not `account.self_id`, not
`people.is_self` + partial-unique-index) so two devices each picking a *different* self
converge under whole-row LWW instead of hard-failing the sync. No FK on `person_id`
(sync rows never carry FKs — it rides the people channel and resolves at read).

## Step 3 — Data repo (`packages/data/src/self-person-repo.ts`)

A `SyncableRepo` singleton over `createEntityRepo` (needed on the allowlist), exposing:

```ts
export interface SelfPersonRepo extends EntityRepo<SelfPerson> {
  getSelf(): Promise<SelfPerson | undefined>;      // the one active row, or undefined
  setSelf(personId: string): Promise<SelfPerson>;  // upsert the singleton
}
```

- `table: "self_person"`, `schema: selfPersonSchema`.
- `getSelf()` → `base.get(SELF_PERSON_ID)` (active-only; a soft-deleted self reads as
  "unset", which is correct).
- `setSelf(personId)`: parse via `setSelfInputSchema`; if `getIncludingDeleted(SELF_PERSON_ID)`
  exists, `base.update(SELF_PERSON_ID, { personId, deletedAt: null })` (re-activates if it
  had been cleared, bumps `updated_at` so the pick wins LWW); else `base.insert(...)` with
  `id: SELF_PERSON_ID` and now-stamps. Fixed PK means a concurrent pick on another device
  merges to one row, last-writer-wins.
- Consider a `clearSelf()` (`base.softDelete(SELF_PERSON_ID)`) — cheap, and "I picked the
  wrong person" wants it. Optional for slice 0; add if the UI needs it.
- Export from `src/index.ts`.

**Test `test/self-person-repo.test.ts`** (over the node:sqlite test driver): `getSelf`
undefined before any set; `setSelf` then `getSelf` round-trips; a *second* `setSelf` with a
different `personId` leaves exactly one row pointing at the new person (the convergence
guarantee); re-`setSelf` after `clearSelf`/softDelete re-activates the same PK.

## Step 4 — Sync allowlist (`packages/core/src/sync.ts`)

Add `createSelfPersonRepo(driver)` to the `syncableRepos([...])` array — plaintext, no
cipher (like reminders). Update the pinned guards:

- `apps/desktop/test/integration/sync-allowlist.test.ts` — add `"self_person"` to the
  expected sorted table list, and confirm it's *not* in the forbidden device-local set.
- If a data-layer mirror guard exists, update it too (the desktop test references a
  "data-layer guard"; grep `defineSyncable`/allowlist tests before finalizing).

## Step 5 — Core surface (`packages/core/src/index.ts`)

- Construct `const self = createSelfPersonRepo(driver);` alongside `people`, `reminders`.
- Add to the returned surface, matching the existing sub-object style:
  ```ts
  self: {
    get: () => self.getSelf(),
    set: (personId: string) => self.setSelf(personId),
  },
  ```
  (Add `clear` if step 3 includes it.) Clients derive `window.api.self` from this via the
  existing preload generation — no bespoke IPC channel, same as reminders.

## Step 6 — Self-aware birthday wish (`packages/reminders/src/engine.ts`)

The engine today builds every milestone reminder subject as `mentionToken(label, …)` and
the birthday body from the wish `actionDef` template — so it *would* emit "🎉 Wish @You a
happy birthday" for your own birthday. Per `gifts.md`: **one branch in the copy layer keyed
on `getSelf()`, not a filter** (you are not excluded).

- Widen `ReminderEngineDeps` with an **optional** port (mirroring `onboarding`/`holidays`),
  so engine unit tests can omit it:
  ```ts
  /** True when a milestone bearer is the self-person — flips wish copy to self-directed. */
  isSelf?(bearerType: MilestoneBearerType, bearerId: string): Promise<boolean>;
  ```
- In `computeAndReconcile`, when assembling the milestone reminder, if `deps.isSelf?.(…)`
  and the action is the birthday wish, render a self-directed title (e.g.
  `🎂 It's your birthday!`) with **no** mention token; otherwise the existing path.
  Keep it a single localized branch so third-party copy is untouched.
- Composition root (core, where `regenerateSystemReminders` deps are built) supplies
  `isSelf: async (t, id) => t === "person" && id === (await self.getSelf())?.personId`.
- **Test** (`packages/reminders/test/…`): a birthday milestone whose bearer is the self
  person yields the self-directed title and carries no `@` mention; a non-self birthday is
  unchanged (regression pin on the existing copy).

## Step 7 — Onboarding step: pick yourself (`packages/reminders/src/engine.ts`)

Weave into `ONBOARDING_STEPS` (not gated at first launch, not gift-dependent — `gifts.md`):

- New `OnboardingRoute` member `"pick-self"`.
- New `OnboardingSignals` field `hasSelf: boolean` and a step:
  ```ts
  { key: "pick-self",
    title: "🙋 Which of these is you? Pick yourself.",
    route: "pick-self",
    applies: (s) => s.hasEntities && !s.hasSelf },
  ```
  Ordered after `add-first-person` (you can't pick yourself from an empty list). Permanent
  retirement on satisfy is the existing correct semantic.
- Extend the core `onboarding` deps object with `hasSelf: async () => (await self.getSelf()) !== undefined`
  and thread `hasSelf` through `OnboardingSignals` where the two existing signals are read.
- Client CTA tables map `"pick-self"` to a route that opens the people list in
  "pick yourself" mode (desktop step 8; mobile deferred to sequencing item 6).
- **Test**: the step applies once a person exists and self is unset; retires after `setSelf`.

## Step 8 — Desktop UI

- **"You" affordance** in `apps/desktop/src/renderer/src/screens/EntityList.tsx`: fetch
  `window.api.self.get()`, badge the matching person row with a "You" tag. Read-only.
- **Pick-self flow**: the `pick-self` onboarding CTA and the import prompt both route into
  the people list in a "tap a person to set them as you" mode → `window.api.self.set(id)`,
  then refresh (self badge + reminder regeneration, same refresh path a milestone write
  kicks). Reuse the existing list; no new screen.
- **Import prompt point** (`apps/desktop/src/renderer/src/import/ImportReview.tsx` or the
  post-ingest step in `DropImportProvider.tsx`): after a vCard import completes, if
  `self.get()` is null, surface "pick you from the list, or tell us about yourself"
  (`gifts.md`) — a natural, dismissable nudge, not a gate.

## Suggested landing order (small, reviewable working-tree changes)

1. Schema + schema test (Step 1).
2. Migration + data repo + repo test (Steps 2–3).
3. Allowlist + guard updates + core surface (Steps 4–5).
4. Self-aware wish + engine test (Step 6).
5. Onboarding step + signal wiring + test (Step 7).
6. Desktop "You" badge, pick-self flow, import prompt (Step 8).

Each is independently reviewable; the data increment (1–3) is useful/mergeable before any
UI. **I will not commit any of these — they land in the working tree for the user to review
and commit.**

## Out of scope (deferred, per `gifts.md`)

- Kinship ego anchor / building out close relationships from the self-person (pre-v0.1).
- vCard-export "me" attribution and share attribution.
- Any gift table — those are Slices 1–6.
- Mobile pick-self UI / "You" badge / import prompt (sequencing item 6).
