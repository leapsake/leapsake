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

# 6. Increment 3's done-when, automated: C/U/D on the no-JS web client, each one
#    observed arriving on a second device that joined the same relay account.
pnpm --filter @leapsake/web-spike roundtrip \
  --relay http://localhost:4001 --host http://localhost:5180 \
  --username ada --password 'hunter2 hunter2'

# 7. Increment 4's done-when, automated: both sharing flavors made and viewed,
#    including a Vite browser build of the client half that is then executed.
pnpm --filter @leapsake/web-spike share \
  --host http://localhost:5180 --username ada --password 'hunter2 hunter2'
```

Four environment variables steer the host, and each one exists to produce a
number rather than to configure anything:

| variable | values | what it changes |
| -------- | ------ | --------------- |
| `WEB_SPIKE_STORE` | `cold` (default), `warm` | where the decrypted store lives — the §9.2 measurement |
| `WEB_SPIKE_LOADER` | `parallel` (default), `serial` | attribute the loader's cost per call, when one of them blocks |
| `WEB_SPIKE_PUSH_MARK` | `pull` (default), `session` | where a write's push starts from — Increment 3 finding 3 |
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

As the spike doc predicted before a line was written. `/accounts/session` and
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

## Increment 3 — findings

**Done-when met, and automated.** `pnpm --filter @leapsake/web-spike roundtrip`
creates, edits and deletes a person on the JavaScript-disabled web client and
watches all three arrive on a **second device** — one that ran the real
`joinAccount` against the same relay account and syncs with `runAccountSync`,
i.e. `createAccountSyncEngine` with durable `sync_state` watermarks, the call
desktop's IPC handler makes. **9/9 checks, still with zero files changed under
`packages/`.**

```
C — create, with JavaScript disabled
  ✓ web 303s to the new person
  ✓ peer sees the create — every field, tags included
U — edit, with JavaScript disabled
  ✓ web 303s back to the person
  ✓ the web page shows the new name
  ✓ peer merges the rename over its own row
D — delete, with JavaScript disabled
  ✓ web 303s to the list
  ✓ the person is off the web list
  ✓ peer applies the tombstone
  ✓ peer is back to its baseline count
```

Two caveats, both the same shape as Increment 2's Firefox one. The peer is not
Electron — no renderer, and `node:sqlite` against a plain file rather than the
at-rest encrypted driver. Neither touches sync semantics (the envelope is layer
2, applied by the engine; the at-rest cipher is layer 1, under the driver), but
"a real desktop build converged" is still owed as a manual check. And the web
half is driven by `fetch` posting `application/x-www-form-urlencoded`, which is
byte-for-byte what a no-JS browser sends, but again is not a browser.

### 1. The actions ported as mechanically as the loader did

Increment 2's finding was that `personLoader` moved across because it depended
on `CoreApi`, not on Electron. The write half is the same story twice over.

- **The three actions are the desktop router's, call for call** — `people.create`
  + `createRelationships` + the `duplicates.findFor` redirect, `people.update`,
  `people.softDelete`. Nothing was reshaped.
- **The field readers ported *verbatim*, one edit each: the parameter type.**
  `readGender`, `readPersonInput`, `readTags`, `readRelationships` take
  `FormData` on desktop and `URLSearchParams` here, and the bodies are
  identical, because the two classes agree exactly on the surface the readers
  use (`get` → `string | null`, `getAll` → array). The desktop write path was
  never Electron-shaped either; it was **`FormData`-shaped**, and a no-JS host
  gets that for free from the raw body.

`PersonForm` is the same component on both routes, given a `person` or given
`candidates`, exactly as desktop shares it between `PersonCreate` and
`PersonEdit`. That is the part usually assumed lost without JavaScript, because
a form's identity is normally "the thing the JS submits" — here it is the URL
the form sits on, since `FormShell` emits `<form method="post">` with no
`action`. Verified on the wire: the create and edit pages carry **zero
`<script>` elements**, the edit form comes back prefilled (`value="Ada"`,
`value="#math"`, `<option value="female" selected>`), and `ConfirmDelete`
renders `<form method="post">` with a submit and a Cancel `<a href>`.

`ConfirmDelete`'s `hiddenFields` prop — the second data point the plan wanted —
is **not exercised** by a person delete, whose whole identity is in the path.
The case that needs it is the inferred-relationship dismiss, which has no stored
id.

### 2. A cold store makes the round trip impossible to fake

Desktop's actions end at the `core` call, because a background sync loop carries
the row away afterwards. A stateless SSR host has no loop and no next tick it
owns, so the push happens **inside the request, before the 303**.

Under a cold store that is forced rather than chosen, and the forcing is the
useful part: the GET after the 303 throws the database away and rebuilds it from
the relay, so a write that was not pushed is not merely invisible to peers — it
is invisible to the page that just made it. There is no "it worked locally"
state to mistake for success.

This also confirms the prediction the plan doc flagged as inverting its own
earlier text: **staleness is a property of the warm arm only.** Every request
re-pulls, so a second session sees a write on its next request with no
revalidator equivalent needed.

### 3. `pushHwm = 0` is wrong, and it compounds — the increment's real finding

The plan doc prescribed `session.pushHwm = await engine.push(session.pushHwm)`,
starting at 0 because a cold host has no durable `sync_state` row to keep a mark
in. That is correct in the sense that nothing is lost, and **wrong in a way that
does not stay small.**

`push(hwm)` re-seals and re-pushes every row with `updated_at > hwm`, so a
session's *first* write re-pushes the entire store. The relay is an
**append-only log with no compaction** (`apps/server/src/store.ts` → `append` is
a plain `INSERT`; `pull` is `WHERE seq > ? ORDER BY seq`, no dedup by row id),
so those ~130 duplicate versions are permanent. And a cold host **must**
`pull(0)` — a delta pull into an empty database yields an empty database — so
every later request of every later session re-pulls and re-decrypts them.
Cold-store and incremental-pull are mutually exclusive, which makes the SSR host
the one client that pays for the whole history on every request.

Five logins with one create each, from an identical 128-record account:

| push mark | relay records | wire | list page, warmed |
| --------- | ------------- | ---- | ----------------- |
| *(before, both arms)* | 128 | 32.6 KiB | 5.6 ms |
| `session` — the plan doc's | **793** | 201.8 KiB | **24.2 ms** |
| `pull` — the fix, now default | **135** | 34.3 KiB | **5.0 ms** |

6.2× the log and 4.3× the page, from five logins, permanently. For contrast,
**25 writes inside one session** added 157 records and no measurable time — the
cost is per *login*, not per write, which is exactly backwards from what anyone
would guess.

The fix needs no durable state, because a cold store has a property desktop's
does not: everything in it arrived from the relay moments ago, in this very
request. So the boundary between "pulled" and "written by this request" is the
store's own high-water mark, read straight back out of it after the pull.

**And the obvious spelling of that fix is silently broken**, which is the part
worth carrying forward. Taking the mark as `Date.now()` after the pull looks
equivalent and is not: `listChangedSince` is `updated_at > ?`, *strictly*, at
millisecond resolution, and a create landing in the mark's own millisecond
compares equal and is skipped. Measured before it was caught: **four writes out
of five pushed zero records while still returning a happy 303** — the person
appeared on the page it redirected to, then vanished on the next request.
Reading `MAX(updated_at)` out of the store instead is the same quantity the
engine itself would compute, so it cannot disagree with it. `SyncEngine` should
expose this rather than leaving each client to reconstruct it —
`WANTED-CHANGES.md`.

### 4. What a write costs, per letter

Same 100-person account, warm key, cold store, default push mark. `write` is the
`core` call; `push` is seal + wire.

| | write | push | records up | what the push carries |
| --- | ----- | ---- | ---------- | --------------------- |
| **C** create | 3.6–6.6 ms | 0.9–2.9 ms | 1–3 | the person, its taggings |
| **U** edit | 2.7–4.1 ms | 0.9–1.6 ms | 2–3 | the person, changed taggings |
| **D** delete | 2.4–2.7 ms | 0.9–1.5 ms | 5–7 | the tombstone plus the cascade |

The delete pushes the most because `people.softDelete` cascades across
milestones, taggings, relationships, contact methods and observances — every one
of which is a row that has to reach the peer for it to agree the person is gone.

Two things fold into `write` that are worth naming separately. `people.create`
and `people.update` each run `regenerateSystem()`, and the create additionally
runs **`duplicates.findFor` to pick its redirect** — the quadratic call
Increment 2 measured. At 100 people it is ~2 ms and invisible inside a 4 ms
write; at 10 000 it would be the 11.8 s Increment 2 recorded, paid on **create**
as well as on every person-page view. Ported deliberately and not fixed here: it
is the same shared-app defect, not an SSR one.

That redirect fired for real during the first run, which is worth recording
because it was an accident rather than a fixture: re-running the round trip with
a fixed name created a same-named person, `duplicates.findFor` matched it, and
the create 303'd to `/duplicates?for=<id>` instead of the person. **The
detection-driven redirect works end to end with JavaScript disabled**, and the
round-trip script now uses a fresh surname per run so the deterministic arm is
the one being asserted.

### 5. Relationships on create are inert without JavaScript — a fifth section for the inventory

`readRelationships` and `createRelationships` are ported, and with JavaScript
disabled they can never fire. `RelationshipFields` starts a Person form with
**zero rows** and grows them from an `onClick`, and each row's hidden
`relationships` input only appears once React has resolved the typed name and
role against the candidate list. Confirmed on the wire: the create page's only
named fields are `firstName`, `middleName`, `lastName`, `gender`, `tags`, and
its only two `<button>`s are `type="button"` (add row, remove row).

So Increment 2's section inventory gains a row, and it is a *form* rather than a
screen section:

| form section | no-JS today | verdict |
| ------------ | ----------- | ------- |
| Person fields + Gender | ✅ works | plain `<input>`/`<select>` with names |
| Tags (`ChipTextField`) | ✅ works | the tags grammar keeps `name` on the visible field, so typing and submitting work; only the chip picker is lost |
| Relationships (create only) | ❌ inert | needs a no-JS shape: a fixed `<select>` pair per row, or a second screen after create |

The Tags row is the pleasant surprise. `ChipTextField` is the most JavaScript-
heavy field in the shared UI, and in `grammar="tags"` mode the visible input
*is* the stored value and carries `name` itself — so it degrades to a plain text
field that submits exactly what the write path parses. In `grammar="prose"` it
would not: there the `name` is on a hidden input the component maintains.

### 6. Smaller things worth keeping

- **The framework question's cost went up, mildly and visibly.** Increment 2's
  routing was one regex; the write routes need a literal (`/people/new`) ordered
  *above* the `:id` pattern it would otherwise match, and a GET/POST pair per
  screen that a framework would pair for you. It is a `switch` on
  `` `${method} ${verb}` `` and it is ten lines — still not an argument for any
  particular framework, but no longer free.
- **`/duplicates` is a throwaway route**, written for the same reason
  `people.tsx` is: there is no shared duplicates screen, desktop's leans on
  `useFetcher`, and promoting one into `@leapsake/ui` is product work wearing a
  spike's clothes. It exists so the ported create redirect lands somewhere real
  instead of on a 404 that would read as the write path failing.
- **303 was the right status and it never had to be debugged**, which is worth a
  line only because getting it wrong is invisible until a refresh resubmits.

## Increment 4 — findings

**Done-when met, and automated.** `pnpm --filter @leapsake/web-spike share`
makes both flavors of §11 public link, views each one, and checks the three
things the flavors are supposed to differ on. **13/13, and still zero files
changed under `packages/`.**

```
capability link — the key stays in the browser
  ✓ the server's request line carries no fragment
  ✓ the served page contains ciphertext and no plaintext
  ✓ and it decrypts with the key from the fragment
  ✓ without JavaScript it says so, rather than appearing broken
the client half — built by Vite, then executed
  ✓ @leapsake/crypto compiles to a browser target
  ✓ the built bundle decrypts from location.hash and writes the DOM
  ✓ a wrong key fails closed
  ✓ no key at all explains itself
  ✓ @leapsake/ui + React compile to a browser target too
hosted link — the server holds the key, so no-JS works
  ✓ no fragment, so the whole link is what the server receives
  ✓ it renders the shared relationship through the shared screen
  ✓ identical with JavaScript on and off
  ✓ the two flavors differ by exactly one thing: who has the key
```

The caveat is the same shape as Increments 2 and 3's, and it lands on the same
missing thing: **no browser was driven.** The client half was built for a
browser target and then *executed* — against a hand-written DOM stub, with the
fragment a browser would have supplied — so what is unproven is the browser's
own URL handling rather than the code. See the two halves below.

### 1. The demonstration, which is a log line the server did not print

The done-when asks for the server's request log, so here it is, from a request
made with the complete link — key and all — on the end:

```
sent      /share/43282163-cc01-4830-8bc0-449beee09b92#vJjX-SJG…
received  /share/43282163-cc01-4830-8bc0-449beee09b92
share  GET /share/43282163-cc01-4830-8bc0-449beee09b92  → 840 B ciphertext, 0 B plaintext
```

`fetch` stands in for a browser here **deliberately, not for convenience**: both
implement the same rule from the same spec — the Fetch standard builds a request
from a URL whose fragment has already been excluded — so this exercises the rule
under test rather than working around a missing browser. The route echoes
`req.url` verbatim as `x-received-url` so the check reads the server's own input
rather than a reconstruction of it.

The complementary half is that the page carries **no plaintext to leak**: 1 564
bytes, of which 840 are base64 ciphertext, and none of the payload's own words
(`"Ada Lovelace & Charles Babbage"` and both partner labels, in raw *and*
HTML-escaped spelling) appear anywhere in it.

### 2. Capability links are structurally incompatible with the no-JS floor — confirmed, and it is cheap

Exactly as the plan doc predicted, and worth stating flatly because it is the
one place the accessibility floor cannot be reached by more work: **the key
never arrives, so no server can render the page.** The spike's answer is a
`<noscript>` that says so in those words rather than a page that looks broken.

The cost is real and small, and the hosted fallback really is a ten-line route
(`hosted-view.tsx`, of which `openHostedShare` is the only line that differs in
kind). The two viewers sit side by side and differ by exactly one thing:

| | capability | hosted |
| --- | --- | --- |
| where the key is | the URL fragment, client-side only | the server, `wrap(ck, hostKey)` |
| page contains | 840 B ciphertext, 0 B plaintext | the rendered relationship |
| `<script>` in the response | 1 | **0** |
| works with JS disabled | **no, and cannot** | yes |
| re-showable to the sharer | **no — see finding 4** | yes |
| server can read the content | no | **yes** |

### 3. `@leapsake/crypto` compiles to a browser target — and `@leapsake/ui` does too, at a price

The plan doc wanted this as a five-minute early warning on Increment 5's biggest
assumption. It is green, and the second build is the more interesting one:

| bundle | minified | gzip |
| ------ | -------- | ---- |
| `share.ts` — `@leapsake/crypto` + `@leapsake/bytes`, no framework | **13.8 KiB** | **5.9 KiB** |
| `share-screen.tsx` — the same plus React and `RelationshipScreen` | 475.3 KiB | **111.9 KiB** |

Neither output contains a `node:` import or a `require(`. The larger one breaks
down as **react-dom 548 KiB, zod 160 KiB, @noble/ciphers 52 KiB,
@leapsake/schema 32 KiB, react 20 KiB, @leapsake/ui 16 KiB** (pre-minify
rendered sizes), and two of those are worth carrying into Increment 5:

- **`zod` reaches the browser through `@leapsake/schema`**, which every shared
  package imports, so it is not optional — 160 KiB of validator to render a
  read-only screen. If the browser bundle ever matters, that is the first thing
  to look at, and it is a shared-package shape question rather than a web one.
- **The shared UI itself is 16 KiB.** The framework is the weight; the code the
  spike is trying to reuse is nearly free.

Smaller, and only visible because the bundle was read: **`@leapsake/crypto`'s
index does not tree-shake.** The capability client imports `open` and nothing
else, yet the bundle still contains the KDF's domain-label constants, because
they are top-level `utf8ToBytes(...)` calls the bundler cannot prove are pure.
It costs a few hundred bytes here; it would matter to a package that wanted a
minimal browser entry point.

### 4. A capability link cannot be re-shown, and that is a product rule

The create POST answers with a page rather than a 303, and unlike every other
write in the spike it has no choice: the key exists in the host process only for
the duration of that request, and a redirect target could only carry it in a
fragment the redirected-to server would never see. So **the create response is
the only place a capability key ever appears.** Lose the link and you re-share.

That is not an implementation detail to fix later — it is what "the server
cannot read it" *means*, seen from the sharer's side, and it belongs in whatever
UI eventually offers the choice ("copy this now" vs. a hosted link that can be
looked up again). What it costs the spike is a refresh hazard: re-posting mints
a second share. Left alone, because the alternative — a server-side flash
holding a plaintext key across requests — is precisely the thing the flavor
exists to avoid.

### 5. A shared screen is reusable unauthenticated, and it renders too much

The plan doc's optional quarter-hour, taken, and it paid. `RelationshipScreen`
was chosen because it has **zero callback props and renders no form**, and it
dropped into an unauthenticated page as one JSX element. The payload needed no
share format either: `views.relationship()` already returns exactly the screen's
props, so `shares.ts` seals the view model verbatim and it type-checks against
`@leapsake/ui`'s `RelationshipPartner` with no mapping. That is Increment 2's
finding a third time — the shared layer is portable because it was never
client-shaped.

What it renders, though, is the *owner's* screen:

```html
<a href="/relationships/4eb78f4b…/edit">Edit roles</a>
<a href="/relationships/4eb78f4b…/delete">Delete</a>
<a href="/relationships/4eb78f4b…/milestones/new">Add milestone</a>
```

Three affordances a viewer cannot use, plus the relationship's internal id and
the shape of the owner's routes. Nothing is damaged — with no JavaScript they
are plain links to routes this host does not serve — but a real share needs a
read-only mode, and the verdict matches Increments 2 and 3's two `packages/`
entries exactly: **plausible and small** (a `readOnly` prop, or a
viewer-capability the sections read), **and product work** about what a shared
view *is*. Logged in `WANTED-CHANGES.md`.

### 6. Smaller things worth keeping

- **Two submit buttons, one `<form>`, same `name` and different `value`** is the
  whole no-JS mechanism for offering two actions on one row — which is how the
  two flavors get contrasted at the point of choosing. It needed nothing from
  the shared UI, and it is the plain-HTML answer to what would otherwise be a
  radio group plus JavaScript.
- **`Host` builds the absolute link, and a real host must not do that.** The
  header is attacker-controlled, and a share link is exactly the value that must
  not be poisoned by it — a configured public origin is the real answer. Noted at
  the call site.
- **The hosted key is wrapped, and the claim is thinner than the session's.**
  `wrap(ck, hostKey)` mirrors §9.2 Scenario 2, but `hostKey` lives in the same
  process as the ciphertext it opens, where a session's wrapping key lives in a
  browser's cookie jar. Wrapping means a stolen *store* is not also a stolen
  *key*; it does not mean the server cannot read a hosted share, which is the
  whole point of the flavor.
- **The base64 alphabets are not interchangeable, and only one place needs the
  URL one.** The fragment key is base64url (`+`/`/`/`=` are wrong in a URL); the
  ciphertext in the page stays standard base64, because an HTML attribute has no
  opinion. Both conversions moved to `src/base64url.ts`, which the session cookie
  was already the only user of.

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
| `src/form-data.ts` | posted body → `URLSearchParams`, plus the field readers ported verbatim from the desktop router |
| `src/routes/person-new.tsx`, `person-edit.tsx`, `person-delete.tsx` | the C, U and D of Increment 3 — a GET that renders the shared form and a POST that runs the desktop action |
| `src/routes/duplicates.tsx` | a throwaway list, so the ported create redirect lands somewhere real |
| `scripts/roundtrip.ts` | Increment 3's done-when, runnable: C/U/D on the no-JS client, each observed on a second joined device |
| `src/shares.ts` | both §11 flavors from one mechanism — the only difference is what happens to the content key |
| `src/routes/share-new.tsx` | making a share, with the two flavors offered side by side; the POST that can only answer once |
| `src/routes/share-view.tsx` | the capability viewer: ciphertext, a `<script>`, and a `<noscript>` that says why |
| `src/client/share.ts` | the client half — the only JavaScript the spike ships, and the whole zero-knowledge claim |
| `src/client/share-screen.tsx` | **a build probe, not a route**: does `@leapsake/ui` compile to a browser target, and what does it weigh |
| `src/routes/hosted-view.tsx` | the hosted viewer: ten lines, SSR, no script — the same shared screen, unauthenticated |
| `src/base64url.ts` | standard base64 ↔ the URL alphabet, for the cookie and the fragment key |
| `scripts/share.ts` | Increment 4's done-when, runnable: both flavors, plus a Vite browser build of the client that is then executed |
| `src/bootstrap.ts` | the four-call username+password → master key path (**not** `joinAccount`, and the docblock says why) |
| `src/measure.ts` | every measurement, in one file, so it is one file to delete |
| `src/probe.ts` | the `@leapsake/ui`-loads-through-SSR check behind `GET /probe` |
| `src/node-sqlite-driver.ts` | verbatim copy of `apps/server/test/node-sqlite-driver.ts` — `packages/data` ships no drivers by design |
| `scripts/seed.ts` | account + rows on a real relay; the fixture is an *account*, since the renderer is stateless |
| `scripts/pull.ts` | Increment 1's done-when, runnable: the SSR request path minus the rendering |
| `scripts/bench.ts` | the cold-vs-warm p50 the decision rule is stated on |
| `WANTED-CHANGES.md` | every temptation to edit `packages/` — the running list Increment 2 is scored against |
