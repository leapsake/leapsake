# Wanted changes

Every moment the spike was tempted to edit a file under `packages/` (or
`apps/server/`), with what it did instead. The spike doc calls this list "a large
share of the findings' value": Increment 2's done-when is *zero files changed
under `packages/`*, and this is the record of what that cost.

One line each: **what was wanted → what happened instead**.

## Increment 1 — scaffold and seed

- **Relay: per-IP failed-login budget.** `/accounts/session` and
  `/accounts/bootstrap` share a 10-per-60s per-IP throttle. An SSR host logs in
  from one IP for every user, so the budget is structurally wrong for a web
  client. → Lifted with `RELAY_BOOTSTRAP_RATE_LIMIT_MAX` / `RELAY_RATE_LIMIT_MAX`
  env vars for the spike run. **Not patched.** This one is a real relay change,
  and it is already listed in the spike doc's *Known before starting*.

- **A non-blocking `deriveKeyMaterial`.** It is synchronous and CPU-bound, and it
  freezes the SSR host for ~355 ms per login (README finding 2). Wanted: an async
  or worker-hosted variant in `@leapsake/crypto`. → Nothing changed; the spike
  measures the stall and reports it. This is a real build item for a web client,
  but it is a *design* decision (worker pool vs. native binding) that the spike
  should inform, not pre-empt.

- **A `syncableRepos`-shaped bulk write path.** `core.people.create` runs a full
  `regenerateSystem()` reconcile per call, which is right for a UI and quadratic
  for a 10 000-row seed. → Used `createPeopleRepo(driver).create` directly for
  the filler rows and `core` for the one rich person. No package change wanted on
  reflection: the reconcile is correct behaviour and a seed script is not a user.

- **Nothing else.** The four-call bootstrap, the seed chain, the cold pull, and
  the `@leapsake/ui` SSR load all ran against the shared packages **unmodified**.

## Increment 2 — the no-JS SSR read path

**Zero files under `packages/` were changed, and — the part worth saying —
almost nothing was even tempting.** The read path is three providers, a six-line
adapter, and seven `core` calls. What follows is the whole list.

- **`GiftCaptureForm` renders a raw `<form>` with no `method`, no `action`, and
  not one `name` attribute** (`packages/ui/src/web/gifts/GiftCaptureForm.tsx`).
  It is the only `<form>` on a rendered person page and the only thing there that
  is *inert* rather than merely non-interactive without JavaScript: a browser
  submitting it would post nothing, nowhere. Wanted: route it through the
  adapter's `Form` and give the fields names. → Nothing changed. The rewrite is
  plausible (see the section inventory in the README) but it is **product work**
  — the form's occasion picker and multi-recipient list are genuinely stateful,
  and deciding what their no-JS shape is belongs to whoever builds the web
  client, not to a spike that would be deleted with the answer inside it.

- **`duplicates.findFor` is quadratic, and at 1 000 people it *is* the person
  page** — 122.9 ms of a 151.9 ms request; at 10 000 it is 11 781 ms of 12 078 ms.
  It scans every pair on every person-page load (`packages/core/src/index.ts` →
  `findDuplicateCandidates`, a full in-memory O(n²) pass, filtered afterwards).
  Wanted: an index, a cache, or a `count`-shaped query, since the page only needs
  `length`. → Nothing changed, because **this is not an SSR finding**: desktop
  makes the same call on the same screen and pays the same cost against its own
  store. It is recorded as a shared-app performance defect, and it distorted the
  spike's own numbers until it was measured out of them.

- **A per-call attribution seam.** Seven parallel `core` calls where one blocks
  the event loop make all seven report the same duration, which named no culprit
  for the 12-second page. Wanted: nothing in `packages/` — this turned out to be
  the spike's own measurement bug. → Added `WEB_SPIKE_LOADER=serial` to
  `src/routes/person.tsx`, which runs the loader serially purely to attribute.

- **Not wanted, worth recording as a near-miss:** `@leapsake/ui`'s three
  providers, `PersonScreen`'s prop contract, `views.entityList`, and the whole
  `CoreApi` surface ported without a single edit or wrapper. `UiFormProps`'s
  promise — that an adapter must render a real `<form>` with `method`/`action`
  intact — held: the no-JS adapter is the *degenerate* one, doing strictly less
  than desktop's.
