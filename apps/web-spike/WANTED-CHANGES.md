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
