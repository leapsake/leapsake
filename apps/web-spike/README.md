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

# 4. The SSR host. RELAY_URL must match the relay above.
RELAY_URL=http://localhost:4001 pnpm --filter @leapsake/web-spike dev
# → http://localhost:5180  — log in with the seeded username + password

# 5. The cold-vs-warm p50. Run it against a host started each way.
pnpm --filter @leapsake/web-spike bench \
  --username ada --password 'hunter2 hunter2' --n 30
```

Three environment variables steer the host, and each one exists to produce a
number rather than to configure anything:

| variable | values | what it changes |
| -------- | ------ | --------------- |
| `WEB_SPIKE_STORE` | `cold` (default), `warm` | where the decrypted store lives — the §9.2 measurement |
| `WEB_SPIKE_LOADER` | `parallel` (default), `serial` | attribute the loader's cost per call, when one of them blocks |
| `RELAY_URL` | URL | which relay to log in against |

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

## Increment 2 — findings

**Done-when met.** `curl /people/<id>` returns a person's name, contact methods,
relationships, timeline, tags, and mentioned-in reminders — **with zero files
changed under `packages/`** (`git status packages/` is empty; the record of what
that cost is `WANTED-CHANGES.md`).

On the JS-disabled half: the response contains **no `<script>` element and no
inline event attribute**, so the DOM a browser builds is identical either way —
the no-JS case is satisfied by construction rather than by luck. That is the
strong form of the claim, but it was verified by `curl` and by parsing the
markup, *not* by driving Firefox: headless browsers could not be launched from
this shell. Loading `http://localhost:5180` in Firefox with
`javascript.enabled=false` remains a thirty-second confirmation worth doing by
hand.

### 1. The adapter is six lines, and that is the answer

```tsx
Link: ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a>,
Form: ({ method, action, children }) => <form method={method} action={action}>{children}</form>,
```

The shared UI's navigation contract is written in HTML's own vocabulary, so the
no-JS host is the **degenerate** adapter — every prop passes through to the
element it was named after. Desktop's adapter does strictly more, mapping `href`
onto react-router's `to`. `UiFormProps`'s promise held exactly as written.

The loader ported as mechanically: `personLoader`'s seven parallel
`window.api.*` calls became the same seven on `core`, same names, same
arguments. Nothing was reshaped, because the desktop loader never depended on
being in Electron — it depended on `CoreApi`.

### 2. Warm key + cold store passes the decision rule. Take cold

p50 over 9-30 requests of the list page, which is hydrate + render with no
quadratic scan in it (see finding 4). One login precedes each run and its
Argon2id is **outside** the loop — that is the whole point of a warm key.

| people | cold store, warm key | warm store | what cold pays for |
| ------ | -------------------- | ---------- | ------------------ |
| 100 | **6.6 ms** | 3.7 ms | 128 records re-pulled |
| 1 000 | **36.8 ms** | 8.2 ms | 1 028 records |
| 10 000 | **352.1 ms** | 66.9 ms | 10 028 records, 2.2 MiB |

The spike doc's rule — *cold's p50 under ~150 ms at realistic store size ⇒ take
cold* — is met with two orders of magnitude to spare at 100 and 1 000 people,
and a personal CRM is not a 10 000-person store. **So take cold-per-request.**

That resolves the §9.2 conflict without anyone having to defend it. The
configuration is §9.2 as written: the *key* is warm (`wrap(MK, sk)` server-side,
`sk` in an `httpOnly` cookie), the *store* is memory-only, request-scoped, and
closed in a `finally`. **The SSR web app never holds a standing decrypted
database in server memory** — the product-visible trust claim the doc warned
might be forced is not forced.

What cold costs is a re-pull per request, and it is decrypt-bound rather than
network-bound: at 10 000 rows, 210 ms of the 275 ms hydrate is decrypt + apply
against 65 ms of localhost transport. If a store that size ever becomes real,
the fix is an incremental cursor rather than a warm store — `/sync/pull` already
takes a `since`.

*Deliberately not measured: peak RSS per warm session.* The spike doc lists it,
but it only decides anything if warm is forced, and it is not. If the owner
wants warm anyway, that number is still missing.

### 3. Two design points the split session key surfaced

Built for real (`src/session.ts`), not faked with a `Map<sessionId, masterKey>`,
and both things the map would have hidden showed up:

- **The `authVerifier` must be wrapped under the session key too.** Relay
  sessions are in-memory per process, so a restart forces a re-login and the host
  must re-authenticate without the password — which means the session store holds
  a standing relay credential. In the clear beside the wrapped master key it
  partly defeats the split: a store thief gets read/write access to all of the
  account's ciphertext. Wrapping it is one more line. **§9.2 does not currently
  spell this out and should.**
- **The boot-time schema template is worth ~8 ms per request.** `node:sqlite`
  exposes `serialize()`/`deserialize()`, so migrations run once at boot and each
  request deserializes: 7.9 ms → 0.1 ms. At the 100-row size that is more than
  the pull.

### 4. `duplicates.findFor` is quadratic, and it is the person page

| people | `duplicates.findFor` | the other six loader calls, summed |
| ------ | -------------------- | ---------------------------------- |
| 100 | 2.1 ms | 2.0 ms |
| 1 000 | 122.9 ms | 0.9 ms |
| 10 000 | **11 781 ms** | 0.8 ms |

97.5% of a 12-second request. It is a full in-memory O(n²) pass over every pair,
run on every person-page load, and the page only uses `.length` of the result.

**This is not an SSR finding** — desktop makes the identical call on the same
screen. It is recorded here because the spike is what measured it, and because
it distorted every other number until it was measured out of them.

Two smaller notes ride along. It is **synchronous CPU work**, so it stalls the
whole host exactly as Argon2id does — and that is what made it hard to see:
seven parallel calls where one blocks the event loop all report the *same*
duration, naming no culprit. `WEB_SPIKE_LOADER=serial` exists to attribute that,
and the general lesson is that parallel timings cannot attribute blocking work.

### 5. The no-JS section inventory, with a verdict each

Every mutation on a person page is expressed as navigation to a `/new`, `/edit`,
or `/delete` route — **23 real `<a href>`s** in the rendered markup — so most of
the page works untouched. The exceptions, with the one-line verdicts the spike
doc asked for:

| section | no-JS today | verdict |
| ------- | ----------- | ------- |
| Contact methods | ✅ works | — |
| Milestones | ✅ works | — |
| Relationships | ✅ works | — |
| Tags | ✅ works | "Edit tags" is a link to `/edit` |
| Mentioned in | ✅ works | read-only |
| Holidays | ⚠️ renders, inert | **plausible**: the add-field is a `MultiAddCombobox`; the addable list is already loaded, so a `<form method="post">` with a `<select>` is a direct swap |
| Gifts | ❌ inert | **plausible but product work**: `GiftCaptureForm` emits a bare `<form>` with no `method`, no `action`, and **no `name` on any field** — a no-JS submit would post nothing, nowhere. Needs a `/gifts/new?for=` route and named fields |
| Gift idea recipients | n/a | not on the person page |

The whole page carries exactly **two `<button>`s**, both inside the gift capture
form. That is the concrete backlog a real web client works from.

### 6. Smaller things worth keeping

- **The framework question stayed open, and the cost of that is visible.** Path
  parameters are a regex, and the loader/action pairing is hand-written
  (`src/app.tsx`). Nothing about it argued for a particular framework.
- **One module graph, or the session store splits in two.** `server.ts` reaches
  the app only through `vite.ssrLoadModule` and imports no route directly — a
  module loaded once by `tsx` and once by Vite would give `session.ts` two
  instances with requests landing on whichever half. The developer-visible
  consequence: editing a file invalidates its graph, so open sessions are lost on
  HMR.
- **`Cache-Control: private, no-store` on everything**, set once in `server.ts`.
  `private` alone would still let the browser keep decrypted user data on disk.

## What is here

| file | why |
| ---- | --- |
| `src/server.ts` | the HTTP shell: `node:http` + Vite middleware mode, holding no state and importing no route |
| `src/app.tsx` | every route, as a `switch` on method+pathname; owns auth, the hydrate lifecycle, and the timings |
| `src/session.ts` | the split session key of §9.2 Scenario 1, built rather than faked |
| `src/hydrate.ts` | where the decrypted store lives — cold per request by default, `WEB_SPIKE_STORE=warm` for the other arm |
| `src/render.tsx` | one `renderToString` with the shared UI's three providers; emits no `<script>` |
| `src/ui-adapter.tsx` | the six lines a no-JS client owes `@leapsake/ui` |
| `src/gifts-ports-ssr.ts` | gift ports that **throw** — a stub returning `[]` would be a lie that renders |
| `src/routes/` | login, the people list, and the person page |
| `src/reply.ts` | routes return data, so `app.tsx` can own `no-store` and the zeroize |
| `src/form-data.ts` | posted body → `URLSearchParams`; Increment 3 grows the field readers here |
| `src/bootstrap.ts` | the four-call username+password → master key path (**not** `joinAccount`, and the docblock says why) |
| `src/measure.ts` | every measurement, in one file, so it is one file to delete |
| `src/probe.ts` | the `@leapsake/ui`-loads-through-SSR check behind `GET /probe` |
| `src/node-sqlite-driver.ts` | verbatim copy of `apps/server/test/node-sqlite-driver.ts` — `packages/data` ships no drivers by design |
| `scripts/seed.ts` | account + rows on a real relay; the fixture is an *account*, since the renderer is stateless |
| `scripts/pull.ts` | Increment 1's done-when, runnable: the SSR request path minus the rendering |
| `scripts/bench.ts` | the cold-vs-warm p50 the decision rule is stated on |
| `WANTED-CHANGES.md` | every temptation to edit `packages/` — the running list Increment 2 is scored against |
