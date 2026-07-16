# Leapsake Reminders — the home-screen surface (why & invariants)

> **Stable "why" doc.** Reminders are the **home screen** (the landing surface on both clients)
> and the intended first-run **onboarding** hub (account setup etc. can later be surfaced *as*
> reminders). This doc pins what Reminders are and the decisions behind them. Live
> status/sequencing lives in [`status.md`](./status.md); how each increment was built lives in
> `git log`; the product model in [`product-truths.md`](./product-truths.md).

## What a Reminder is

A first-class, syncable entity: a freeform `title` and/or `body` (at least one required), a
reversible `completed_at` toggle, an optional `due_date`, and a `source` enum (`user` | `system`).
Inline `#tags` and `@mentions` are typed into the text. It is the landing / Home screen on both
clients (People & Pets live at `/people`), populated both by user CRUD and by an automated
birthday/milestone engine (`@leapsake/reminders`).

## The decisions (pinned)

1. **Plaintext syncable rows — not per-item content keys.** Reminders aren't a share target and
   are already protected by whole-DB-at-rest + master-key-sealed sync. Milestones prove a
   plaintext→content-key retrofit is additive if that ever changes
   (`packages/data/src/milestones-repo.ts`).

2. **`#tags` are inline; the text is the single source of truth.** Core re-parses `#tags` out of
   `title`+`body` on every write (`parseHashtags`) and applies them via the **shared** `taggings`
   table under **bearer type `"reminder"`** — so browsing `#family` shows reminders alongside
   people/pets. No separate tags field.

3. **`#tag` ≠ `@mention` — different relationships.** A tag points at a reusable, deduped `Tag`
   label; a mention points at a specific Person/Pet identity (its own page/merges). Mentions are a
   **separate relationship** (the `mentions` table referencing entity ids), not a tagging — a
   sibling inline-reference feature, built end-to-end (substrate, rendering, two-way backlinks,
   merge/delete re-point/tombstone, and the `@`-picker authoring surface).

4. **`source` enum (`user` | `system`), default `user`.** `system` reminders are engine-owned
   (birthdays / per-milestone schedules): their text is re-derived every reconcile, so it's
   **non-editable** (completing/deleting stay open). The enum meant automation needed no schema
   change. Reconcile is idempotent and tombstone-respecting (a dismissed reminder is never
   resurrected) and repairs a live reminder in place when its milestone drifts.

5. **Standalone screen first, then Home.** Shipped narrow to prove the entity, then promoted to
   the landing / Home screen. The surface is done; the *content* that makes Home valuable is what
   remains.

## What remains (additive)

- **Onboarding-as-reminders** — surface first-run setup *as* reminders (e.g. "Already using
  Leapsake on another device?" as the sync entry point), filling the empty Home a brand-new user
  with no contacts still sees.
- **Reminder search.**
- **Broader automation** — holidays and Leapsake-defined tasks extend the same engine (same
  dedup / regeneration keyed off `source` + trigger identity).
