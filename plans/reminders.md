# Leapsake Reminders — the home-screen surface (why & invariants)

> **Stable "why" doc.** Reminders are the intended heart of the future **home
> screen** and the first-run **onboarding** hub (account setup etc. can later be
> surfaced *as* reminders). This doc pins what Reminders are and the decisions
> behind them; live status/sequencing lives in [`status.md`](./status.md), the
> product model in [`product-truths.md`](./product-truths.md).

## What shipped (first increment — user-generated CRUD)

A first-class, syncable **Reminder** entity: freeform `title` and/or `body` (at
least one required), a `completed_at` toggle (reversible), and a `source` enum.
Standalone **Reminders** screen on desktop (nav link) and mobile (tab), with
create / edit / complete / delete. `#tags` are typed **inline** in the text.

- **Schema/data/core:** `packages/schema/src/reminder.ts` (+ `reminderLabel`,
  `parseHashtags` in `tag.ts`), migration **18** (`reminders` table),
  `packages/data/src/reminders-repo.ts` (plaintext `createEntityRepo` +
  `setCompleted`), the `core.reminders` group, and one line in `syncableRepos()`.
- **Clients:** desktop screens under `renderer/src/screens/Reminder*` + routes;
  mobile `app/(tabs)/reminders.tsx` + `app/reminders/**` + `components/ReminderForm`.

## The decisions (pinned)

1. **Plaintext syncable rows — not per-item content keys.** Reminders aren't a
   share target and are already protected by whole-DB-at-rest + master-key-sealed
   sync. Milestones prove a plaintext→content-key retrofit is additive if that ever
   changes (`packages/data/src/milestones-repo.ts`).
2. **`#tags` are inline; the text is the single source of truth.** Core re-parses
   `#tags` out of `title`+`body` on every create/update (`parseHashtags`, a
   `#`-anchored variant of `parseTagNames`) and applies them via the **shared**
   `taggings` table under **bearer type `"reminder"`** — so browsing `#family`
   shows reminders alongside people/pets. No separate tags field.
3. **`#tag` ≠ `@mention` — different relationships.** A tag points at a reusable
   **`Tag`** label (deduped); a mention points at a specific **Person/Pet**
   identity (its own page/merges). Mentions are therefore a **separate relationship**
   (a future `mentions` table referencing entity ids), *not* a tagging — presented
   as a sibling inline-reference feature in the UI. See `product-truths.md`.
4. **`source` enum (`user` | `system`), default `user`.** Everything today is
   `user`; `system` is reserved so the automated increment needs no schema change.
5. **Standalone screen now; "Home" later.** Kept deliberately narrow to ship.

## Deferred (all additive later)

- **`@mentions`** of People/Pets — a `mentions` relationship + its merge/delete
  re-point wiring (a person-merge must re-point mentions; a person-delete tombstones
  them). Nothing to wire today because reminders reference no entities yet.
- **`due_date`** — a nullable column + list ordering/《upcoming》grouping.
- **Automated / `system` reminders** — upcoming-birthday/holiday triggers and
  Leapsake-defined tasks generate reminders; needs dedup/regeneration keyed off
  `source` and the trigger identity.
- **Make Reminders the landing "Home" screen** + **onboarding-as-reminders**
  (e.g. "Already using Leapsake on another device?" as a first-run reminder).
- **Autocomplete** for tags/mentions (v2, reusing the `search` folded matcher) and
  **reminder search**.
