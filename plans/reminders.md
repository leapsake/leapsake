# Leapsake Reminders — the home-screen surface (why & invariants)

> **Stable "why" doc.** Reminders are the **home screen** (now the landing surface on both
> clients) and the intended first-run **onboarding** hub (account setup etc. can later be
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
  mobile `app/(tabs)/index.tsx` (the Reminders/Home tab) + `app/reminders/**` +
  `components/ReminderForm`.

## Since then (Home + inline tag links)

Reminders is now the **landing / Home screen** on both clients: desktop `/` redirects to
`/reminders` and the combined People & Pets list moved to `/people` (top-nav link + breadcrumb
root); mobile Reminders is the `(tabs)` group's **`index`** tab, and People & Pets became
`(tabs)/people`. Three UI follow-ups shipped with it:

- **Inline `#tags` are links to their tag page.** A platform-agnostic `splitHashtags(text)`
  (`tag.ts`, same `#`-anchored pattern as `parseHashtags`) segments the text; core reads
  (`reminders.list`/`get`) now return **`ReminderWithTags`** carrying the resolved tag rows, so
  a per-client `ReminderText` component links each `#tag` to `/tags/:id`.
- **The body shows as details under the title** in the lists (title leads; a body-only reminder
  isn't repeated).
- **A tag's page lists its reminders** alongside people/pets (`core.tags.remindersForTag`,
  realizing decision 2 below).

## Since then (automation · @mentions · due dates · non-editable system)

The three biggest deferred items are now shipped — Home is no longer empty for a user with contacts:

- **Automated `system` reminders — birthdays.** A standalone `@leapsake/reminders` engine (pure
  occurrence math + a deterministic, content-addressed reminder id keyed on `milestone:occYear:rule`)
  reconciles upcoming birthdays into `source: "system"` reminders. Core folds the reconcile into
  boot/focus **and** every milestone write, person/pet delete, and person merge — so an added /
  edited / deleted birthday (or a rename) reflects at once, not on relaunch. Idempotent and
  tombstone-respecting (a dismissed reminder is never resurrected); it also **updates a live
  reminder in place** when its milestone's date or subject drifts.
- **`@mentions` as a synced backlink** (realizing decision 3). An inline `@[Name](type:id)` token
  grammar (`schema/src/mention.ts`), a synced `mentions` join table re-derived from the reminder
  text on every write like `#tags` (`data/src/mentions-repo.ts`), **forward** links (a mention
  renders as a link to the person/pet via `ReminderText`), and the **reverse** "Mentioned in"
  section on each entity page (`core.reminders.mentioning`). Person-merge re-points a mention onto
  the survivor; person-delete tombstones it. Birthday reminders emit a mention token so the subject
  links to their page.
- **Due dates.** Nullable `due_date`, a countdown (`formatDueIn`) + soonest-first ordering
  (`compareReminderDue`, `reminder-schedule.ts`), and a date input in the composer.
- **System reminders are non-editable.** Their title/details are engine-owned (re-derived every
  reconcile), so the *content* edit is refused for `source: "system"` (`isReminderEditable`);
  completing / reopening and deleting stay open. A future sub-reminder attaches through its own path.

## Since then (mention *authoring* — the loop is closed)

A user can now **create** a mention, not just receive machine-generated ones. Until now the
`@mention` substrate was fully built but the composer only took free text + inline `#tags`, so
every mention in the system was birthday-engine output. An `@`-triggered People/Pets **picker** in
the reminder form now inserts the token for you — the last missing piece of decision 3.

- **Two pure helpers** carry the text logic (`schema/src/mention.ts`, unit-tested alongside the
  grammar): `activeMentionQuery(text, caret)` finds the active `@`-fragment at the caret (opens at
  string start / after whitespace, spans the spaces in a name, refuses to overlap an existing token),
  and `insertMention(text, caret, mention)` splices the `@[Name](type:id)` token in and returns the
  new text + caret. The `mentionToken` doc-comment had anticipated exactly this reuse.
- **Thin per-client pickers** wrap Title *and* Details: a controlled `MentionTextField`
  (`apps/desktop/.../components/MentionTextField.tsx`, `apps/mobile/components/MentionTextField.tsx`)
  tracks the caret, calls the helpers, queries **`core.search.query`** (desktop `window.api.search`)
  debounced, filters hits to **person/pet** (tag hits excluded — a mention only references a
  person/pet), and on pick splices the token + closes. The desktop form's Title/Details became
  **controlled** to allow the splice but keep their `name="title"/"body"` so the route action reads
  them from `FormData` unchanged; mobile was already controlled and nudges the caret past the token
  via a one-shot `selection`.
- **Purely a compose-surface affordance** — no schema / migration / sync / IPC / core-write change.
  The write path already re-derives mentions from the saved text, so the inserted token flows through
  the existing reconcile, forward links, and "Mentioned in" backlink untouched. The token shows as
  literal text in the field, exactly like an inline `#tag`.

## Since then (`#tag` autocomplete — the compose surface is complete)

The sibling affordance of the mention picker: typing `#` then a word in Title or Details now offers a
typeahead of **existing tags**, on both clients. It's the lighter twin decision 3 predicted — a
`#tag` needs no id resolution (the bare word *is* the tag), so it's purely a compose-surface helper
with **no** schema / migration / sync / IPC / core-write change; `parseHashtags` still re-derives the
taggings from the saved text on every write.

- **Two pure helpers** sit beside the mention ones in `schema/src/mention.ts` (they share the
  mention-token guard), unit-tested next to the tag grammar they mirror: `activeHashtagQuery(text,
  caret)` finds the active `#`-fragment — a *single* `[\p{L}\p{N}]` token, so unlike a mention it
  ends at the first non-alphanumeric char — and `insertHashtag(text, caret, tagName)` splices `#name`
  in (trailing space, caret past it). A `#` inside a mention token's display name is left alone.
- **Folded into the same `MentionTextField`** rather than a second overlapping field — a reminder
  wants both `@mentions` and `#tags` in the same fields. All the plumbing is shared; only four things
  branch on which trigger the caret sits in (resolved by *nearest* trigger, since a mention fragment
  spans spaces and can overlap a later `#`): which detector runs, how the query is derived, which hits
  are kept (person/pet vs **`tag`**), and which insert helper fires. Tag hits render with the `#`
  sigil, mirroring `SearchBar`.
- **Suggestions are existing tags only** (`core.search.query`, filtered to `entityType: "tag"`, which
  surfaces only tags with ≥1 bearer). A brand-new tag simply has no suggestion and is created on save
  exactly as before — the picker never blocks free typing.

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
   (the `mentions` table referencing entity ids), *not* a tagging — a sibling
   inline-reference feature. **Now built end-to-end** — substrate, rendering, backlinks, merge/delete,
   *and* authoring (see *Since then*). See `product-truths.md`.
4. **`source` enum (`user` | `system`), default `user`.** `system` is **now live**
   (birthday reminders, whose text is engine-owned); user reminders stay `user`. The
   enum meant the automated increment needed no schema change — as intended.
5. **Standalone screen first, then Home.** Shipped narrow — a standalone screen — to prove
   the entity, then promoted Reminders to the landing / Home screen once it was proven (see
   *Since then*). "Home" as the surface is done; the *content* that makes Home valuable
   (automation, onboarding-as-reminders) is what remains.

## Deferred / next (all additive)

- **Onboarding-as-reminders (the next step).** Surface first-run setup *as* reminders (e.g. "Already
  using Leapsake on another device?" as the first-run sync entry point). Fills the empty Home a
  brand-new user (no contacts, no upcoming birthdays) still sees. *(Reminders becoming "Home" itself
  is done; the compose surface — `@mention` + `#tag` authoring — is now complete, see *Since then*.)*
- **Reminder search.**
- **Broader automation** — holidays and Leapsake-defined tasks extend the birthday engine (same
  dedup / regeneration keyed off `source` + trigger identity).
