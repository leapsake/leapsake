# `@leapsake/gifts`

Gift ideas and who each one is for. `createGiftsApi(deps)` over injected repo ports — no driver
of its own, no `@leapsake/core` dependency.

## Two tables, and why "given" is a column

An **idea** is a title plus an optional url, taggable like any other entity. A **recipient
link** pairs that idea with a person or a pet and carries whether the thing has been given.

That last part was once a separate dated row — a "giving" — and is now a boolean on the link.
The scope cut is recorded in `git log` (branch `gift-scope-cut`, 2026-08-20) and what was
removed with it is in [`plans/v0-2.md`](../../plans/v0-2.md). The consequence worth knowing
here: **`given` is a stamp, not a date.** Nothing records *when* something was given, so no
screen can offer a gift history over time without a migration.

## Three things that look like duplication and are not

- **`ideas.create` takes recipients, and `capture` exists anyway.** `create` is the form: one
  idea, its tags, and whatever links the user filled in. `capture` is the add surface — it can
  name an *existing* idea, so it resolves-or-mints once and updates a party already on that
  idea instead of doubling it. Ticking is one-way in `capture`: it says "and I gave them this",
  never "and I did not", which is the checkbox's job on a row that already exists.
- **`recipients.update` rather than a `setGiven`.** Ticking the box is the only edit a link
  has, but naming it `setGiven` would put it outside `withSyncKick`'s mutating-method
  predicate, and a ticked box would never kick a sync.
- **Two joined reads, `listForRecipient` and `listForIdea`.** Same table, opposite directions:
  one joins the idea's title for a person's page, the other the recipient's current label for
  an idea's page. Each drops rows whose other end is gone.

Attaching a gift to someone is a fact about them, so both write paths publish an unpublished
party through `EntityService.publishBearerIfUnpublished` — the same rule a milestone or a
contact method follows.
