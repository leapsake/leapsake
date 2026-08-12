# `apps/web-spike` — throwaway

**This app is deleted at the end of the spike.** Its deliverable is the *answers*,
which get folded into [`plans/v0-1_web-spike.md`](../../plans/v0-1_web-spike.md)
at Increment 6. Nothing here is production code; nothing should import from it.

Read the plan doc first — it holds every decision already made, so none of them
need re-litigating here.

## Run it

```sh
# 1. A throwaway relay. The env vars are a finding, not a convenience — see below.
cd apps/server && PORT=4001 RELAY_DB=:memory: \
  RELAY_BOOTSTRAP_RATE_LIMIT_MAX=100000 RELAY_RATE_LIMIT_MAX=100000 \
  pnpm exec tsx src/index.ts

# 2. Seed an account and push it. --rows is 100 / 1000 / 10000.
pnpm --filter @leapsake/web-spike seed \
  --relay http://localhost:4001 --username ada --password 'hunter2 hunter2' --rows 100

# 3. The second process: username + password → a cold store, from nothing.
pnpm --filter @leapsake/web-spike pull \
  --relay http://localhost:4001 --username ada --password 'hunter2 hunter2'

# 4. The SSR host (Increment 2 onward).
pnpm --filter @leapsake/web-spike dev   # → http://localhost:5180/health, /probe
```

Note the spike **is never typechecked**: it deliberately defines no `typecheck`
script, so `pnpm -r typecheck` does not see it, and it is excluded from `oxlint`
via `.oxlintrc.json` → `ignorePatterns`. Verification here is manual and
in-browser.

## Increment 1 — findings

Done-when met: a second process, given only a username and password, pulls the
seeded account into a cold in-memory store and sees every row. Took well under
the two-hour box.

### 1. Argon2id dominates the cold path — the store size does not

| rows | wire | transport | decrypt+apply | ms/row | **cold total** |
| ---- | ---- | --------- | ------------- | ------ | -------------- |
| 100 | 32.6 KiB | 4.3 ms | 10.8 ms | 0.12 | **375 ms** |
| 1 000 | 234.7 KiB | 14.9 ms | 35.1 ms | 0.05 | **415 ms** |
| 10 000 | 2 265 KiB | 78.5 ms | 225.9 ms | 0.03 | **670 ms** |

*(Node 24, `:memory:` store, relay on localhost — so `transport` is a floor, not
a network number.)*

**Argon2id is ~355 ms at every size.** Pulling and decrypting a 10 000-row
account costs less than the login that precedes it, and per-row cost *falls* with
size (0.12 → 0.03 ms/row) as fixed costs amortize.

This reframes the spike doc's cold-vs-warm decision rule, which assumed the pull
was the expense. It is not, and the consequence is concrete:

- **Cold-per-request fails the ~150 ms rule at every store size, entirely because
  of the KDF.** Even 100 rows costs 375 ms.
- **But caching the derived key material — not a decrypted store — collapses it
  to ~20-80 ms**, which passes comfortably at 10k.
- So the §9.2 conflict may dissolve without a warm decrypted store at all: what
  needs to be warm is the *key*, and the split session key §9.2 already
  specifies (`sk` in an `httpOnly` cookie, `wrap(MK, sk)` server-side) is exactly
  a warm key with a cold store. That is the configuration to measure first in
  Increment 2, ahead of warm-per-session.

### 2. Argon2id stalls the whole process, not just its own request

**Worst event-loop stall spanning a login: ~310 ms** (probe resolution ±50 ms
against a 355 ms call — i.e. essentially the entire duration).

`deriveKeyMaterial` is synchronous and CPU-bound, so on a single-threaded SSR
host **every other in-flight request is frozen for the duration of anyone's
login**. Ten concurrent logins is a three-second stall for everybody. A real web
client therefore needs a worker pool or a native Argon2 binding, and **neither
exists in this repo** — this is a build item, not a tuning knob.

*(Getting this number required fixing the probe twice; a naive
`setInterval` + `clearInterval` reads **0 ms**, because a synchronous block
prevents the timer callback from ever running. See `src/measure.ts`.)*

### 3. The Vite pipeline loads the shared UI — with zero package edits

`GET /probe` server-renders an import of `PersonScreen` from `@leapsake/ui/web`,
which reaches the CSS-module `Combobox` via `HolidaysSection` →
`MultiAddCombobox`. It resolves:

```
@leapsake/ui loaded via SSR: PersonScreen
```

So `ssr.noExternal: [/^@leapsake\//]` does the job, both blockers that ruled out
the `apps/server` `tsx` pattern are handled, and **Increment 2 is plumbing rather
than a fight with the bundler.** This was the single riskiest assumption in the
plan; it is now observed rather than reasoned.

### 4. Relay: the per-IP failed-login budget is confirmed wrong for SSR

As predicted in *Known before starting*. `/accounts/session` and
`/accounts/bootstrap` share a 10-per-60s **per-IP** budget; an SSR host logs in
from one IP for every user, so ten users mistyping a password lock out the
eleventh. Lifted here with env vars, **not patched** — see `WANTED-CHANGES.md`.

### 5. Two smaller observations

- **The holiday catalog is 16 rows, not the bulk of a fresh account's log.** The
  plan doc's "leaving it out would make every pull measurement a lie" is right in
  principle but small in practice at today's catalog size: it is 12% of a 128-row
  account and 0.2% of a 10k one. Still seeded — the claim just should not be
  repeated as-is in the findings.
- **The relay's pull cursor is global across accounts, not per-account.** The
  second seeded account's `pull(0)` returned cursor 1156 for 1028 records,
  continuing the first account's sequence. Correctness is unaffected (records are
  account-scoped), but a client's cursor is a weak side channel on total relay
  activity, and it is worth knowing before anything is built on cursor values.

## What is here

| file | why |
| ---- | --- |
| `src/server.ts` | bare `node:http` + Vite middleware mode; a `switch` on method+pathname, deliberately no framework |
| `src/bootstrap.ts` | the four-call username+password → master key path (**not** `joinAccount`, and the docblock says why) |
| `src/measure.ts` | every measurement, in one file, so it is one file to delete |
| `src/probe.ts` | the `@leapsake/ui`-loads-through-SSR check behind `GET /probe` |
| `src/node-sqlite-driver.ts` | verbatim copy of `apps/server/test/node-sqlite-driver.ts` — `packages/data` ships no drivers by design |
| `scripts/seed.ts` | account + rows on a real relay; the fixture is an *account*, since the renderer is stateless |
| `scripts/pull.ts` | Increment 1's done-when, runnable: the SSR request path minus the rendering |
| `WANTED-CHANGES.md` | every temptation to edit `packages/` — the running list Increment 2 is scored against |
