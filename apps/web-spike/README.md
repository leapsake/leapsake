# `apps/web-spike` — throwaway

**This app is deleted at the end of the spike.** Its deliverable is the *answers*,
which get folded into [`plans/v0-1_web-spike.md`](../../plans/v0-1_web-spike.md)
at Increment 6. Nothing here is production code; nothing should import from it.

Read the plan doc first — it holds every decision already made, so none of them
need re-litigating here.

## Don't read this file top to bottom

It is over 800 lines, and most of them are an **archive**: the per-increment findings
exist so Increment 6 can write the summary without re-deriving anything, not so
the next increment can read them all. What each part is for:

| If you are… | Read | Skip |
| ----------- | ---- | ---- |
| **picking up the next increment** | *Run it* below, then the plan doc's *What 1-5e settled* — one line per result | every `## Increment N — findings` section |
| **writing Increment 6** | all of it, plus `WANTED-CHANGES.md` — this is the source material | nothing |
| **chasing one file** | *What is here* at the bottom, then the file's own docblock | the rest |
| **re-checking a number** | the findings section for the increment that measured it | the others |

The per-increment sections are append-only and never rewritten, so an older one
is what was true *then*. Where a later increment changed the answer it says so;
the plan doc's settled list is always the current reading.

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

# 8. Increment 5a's done-when. No script — it is a page, because the whole
#    question is whether the data layer works *in a browser*. Needs no relay,
#    no account and no key: open it and read the banner.
open http://localhost:5180/driver-contract

# 9. Increment 5b's done-when, also a page: log in, pull and decrypt in the tab.
#    Needs the relay of step 1 and the account of step 2 — the form is prefilled
#    with them. Click the button and read the stage table.
#    Keep the window in front: the KDF measures ~1.9x slower in a hidden tab,
#    and the page labels which one it was.
open http://localhost:5180/client

# 10. Increment 5c's done-when: the same login with the data layer in a Worker
#     and the database in OPFS. Click the button, then *reload and click again*
#     — the second run is the half that persistence exists for. Keep the window
#     in front here too, and for a stronger reason than on /client: a hidden
#     tab's KDF readings vary three-fold, and its frame meter reads zero.
#     Only one tab at a time — OPFS access handles are exclusive.
open http://localhost:5180/client-worker

# 11. Increment 5e's done-when: log in once, then *reload* and press
#     "Resume — no password". The second start unwraps the master key from
#     IndexedDB, opens the OPFS store, decrypts a record the relay sent, and
#     renders the person — with fetch disabled for the duration. Same
#     one-tab-at-a-time rule as step 10, and it contends with that page for
#     the same OPFS pool.
open http://localhost:5180/client-key
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

## Increment 5a — findings

**Done-when met, and — a first for this spike — met in a real browser.**
`http://localhost:5180/driver-contract` reports **12/12** from
`runDriverContract` (`@leapsake/data/testing`) against
`@sqlite.org/sqlite-wasm`, and `runMigrations` completes: 28 migrations →
`user_version` 28, 26 tables, 32 indexes. Chrome 1555×888, sqlite 3.53.0,
`:memory:`, main thread. **Zero files changed under `packages/`**, a fifth time.

```
PASS — 12/12 contract, migrations OK
sqlite 3.53.0 via @sqlite.org/sqlite-wasm, :memory: on the main thread
  — module init 57.3 ms, run 254.4 ms
  ✓ round-trips a row through run + get
  ✓ returns undefined (not null) from get on a miss
  ✓ returns every matching row from all, and [] when none match
  ✓ honors ORDER BY in all()
  ✓ binds positional params left-to-right
  ✓ round-trips a BLOB as bytes
  ✓ applies every statement in a multi-statement exec
  ✓ persists writes made inside a committed transaction
  ✓ rolls back all writes and rethrows when the transaction body throws
  ✓ returns the transaction body's resolved value
  ✓ round-trips a SQL NULL as JS null
  ✓ closes the connection, and use after close rejects
  ✓ runMigrations completes
    28 migrations → user_version 28, 26 tables, 32 indexes, 140.6 ms
```

So **the browser data layer is possible**, and 5b-e are plumbing on a proven
base rather than bets. Green on the first run, which is the part worth reading:
nothing about the port needed rethinking for a third engine.

### 0. A real browser was driven, which retires the spike's standing caveat

Increments 2, 3 and 4 each ended with the same footnote — *no headless browser
will launch in this dev shell* — and each substituted `fetch`, a DOM stub, or a
markup parse. **Chrome is drivable after all, through the Claude-in-Chrome
extension**: the same browser the user has open, navigated and read by the agent
rather than launched by it. Headless Chrome still hangs from this shell (a bare
`--dump-dom data:text/html,<h1>hi</h1>` times out), so nothing about the earlier
increments' reasoning was wrong; the constraint was *launching* a browser, and
this route does not launch one.

That is worth more than this increment. **The three manual checks owed before the
teardown are now cheap and automatable-ish** — the Firefox `javascript.enabled=
false` walk-through, opening a capability link in a real browser and watching the
network panel for the missing `#`, and viewing a hosted share with no JS. All
three are "drive a browser and look", and there is now a way to do exactly that.

### 1. The driver is 40 lines, and three things differ from `node:sqlite`

The port held for a third unrelated engine with no change to `SqliteDriver` and
no shim: `exec`/`run`/`all`/`get`/`transaction`/`close` map onto oo1's
`exec`/`selectObjects`/`selectObject` one for one. The differences, all three read
out of oo1's source *before* the first run rather than found by a red test:

- **An empty `bind` throws.** `db.exec({ sql, bind: [] })` on a parameterless
  statement raises "This statement has no bindable parameters" — oo1 distinguishes
  *absent* bindings from *empty* ones, where `db.prepare(sql).run(...[])` does
  not. The port's signature is `params?: unknown[]` and callers pass `[]` freely,
  so a driver that forwards it verbatim breaks on `runMigrations`'s own first
  statement, `PRAGMA user_version`. Two `length === 0` branches.
- **`selectObject` returns `undefined` on a miss**, so the contract's
  "undefined, not null" case is satisfied by the engine rather than by a wrapper.
- **`close()` is a documented no-op once closed**, so this factory needs neither
  desktop's `if (db.open)` guard nor mobile's swallowed throw.

Everything else — positional binds, `Uint8Array` in and out of a BLOB, SQL `NULL`
as JS `null`, multi-statement `exec`, `BEGIN`/`COMMIT`/`ROLLBACK` — is the Node
driver's code unchanged, and oo1 agrees with it.

The plan doc's async-factory gotcha was real and is a two-line answer:
`sqlite3InitModule()` is awaited **once at the top level of the page module**, so
the synchronous `DriverFactory` the contract requires does nothing but
`new sqlite3.oo1.DB(":memory:")` — the same trick the mobile factory plays with
`openDatabaseSync`.

### 2. What the browser costs before any data arrives

| step | cold load | second load |
| ---- | --------- | ----------- |
| `sqlite3InitModule()` — fetch + compile 864 KiB of `.wasm` | 57.3 ms | 52.7 ms |
| `runMigrations` — 28 migrations, 26 tables, 32 indexes | **140.6 ms** | **40 ms** |
| the whole page (12 cases, each opening and closing a DB, + migrations) | 254.4 ms | 108.7 ms |

Two things to carry into 5b-d. **Module init is stable at ~55 ms** and is a
per-tab cost that no amount of persistence removes — it is the price of the
engine, not of the data. **Schema creation is 40 ms warm and 140 ms cold**, where
`node:sqlite` runs the same migrations in 7.9 ms (Increment 2 finding 3), so it is
5-18× the server's number; Increment 2's `serialize()`/`deserialize()` trick has
no obvious wasm equivalent, but OPFS should make the question moot by running the
migrations **once, ever** — which is now one of the things 5c/5d is worth doing.

And the comparison that matters is the one Increment 1 set up: **all of this
together is under 300 ms cold, against ~355 ms for a single Argon2id.** Just as on
the server, the database is not the expensive part of a cold start; the KDF is.
5b measures Argon2id in a browser, and that is the number to watch.

### 3. `optimizeDeps: { exclude }` is load-bearing, and its failure is a runtime abort

The plan doc predicted this; it is now observed rather than prescribed, by running
a second host on port 5181 with the exclusion removed (and its own `cacheDir`, so
the real one's was untouched). Vite pre-bundles the package to
`node_modules/.vite/deps/@sqlite__org_sqlite-wasm.js`, the loader's
`new URL("sqlite3.wasm", import.meta.url)` then resolves next to the *bundle*,
and the binary is not there:

```
wasm streaming compile failed: TypeError: … HTTP status code is not ok
failed to asynchronously prepare wasm: both async and sync fetching of the wasm failed
Exception loading sqlite3 module: RuntimeError: Aborted(…)
```

Worth recording because of *when* it fails: the build is clean, the module graph
is clean, and the page loads — then emscripten aborts at init with a message that
names neither Vite nor the missing file. Any bundler that relocates the module
relative to its asset can reproduce it, and the symptom will not point at the
cause — the package shipping a separate demo per bundler (Vite, Webpack, Parcel,
rsbuild) suggests it is the usual place people get stuck. Excluded, the module is
served from its own directory, `.wasm` and all, with
`Content-Type: application/wasm`.

### 4. Smaller things worth keeping

- **The collecting test runner is a byte-identical copy of mobile's.**
  `src/client/test-api.ts` is `apps/mobile/test/test-api.ts`, `diff`-clean —
  *zero* edits, not even an import path, because it depends only on
  `@leapsake/data/testing`'s `TestApi`. That is the second non-Vitest host to want
  it, which is the argument for it living in `packages/data` beside the contract it
  serves. Logged in `WANTED-CHANGES.md`.
- **The contract earned its "framework-agnostic" claim a second time.** It was
  written for Vitest, ported once to a simulator, and ran here with no
  registration shim, no environment flag and no `beforeEach` — because each case
  provisions its own driver. The single design choice that made this increment two
  hours instead of two days.
- **`node_modules` is hoisted, so the `.wasm` is served from `/@fs/…`.** The
  workspace uses `nodeLinker: hoisted`, so the package resolves outside the
  spike's Vite root and its binary comes back through `/@fs/`. Vite serves it
  correctly, but a production build will need the asset copied deliberately
  rather than relying on a dev-server path.
- **Migrations are portable, now on three engines rather than two.** The claim in
  the plan doc ("plain DDL, no extensions or `RETURNING`, the only exotic
  statement is `PRAGMA user_version`") held exactly, and `PRAGMA user_version` is
  the one statement that needed the empty-bind branch above.

## Increment 5b — findings

**Done-when met, in a real browser.** `http://localhost:5180/client` takes a
username and password, derives the master key **in the tab**, pulls 446 records
from the relay, decrypts and applies them into a `sqlite-wasm` `:memory:` store,
and renders `PersonScreen` through **the same `src/ui-adapter.tsx` the SSR host
renders with**. The server holds no session, no key and no store for it: it
serves the module and forwards `/relay/*`. **Zero files changed under
`packages/`**, a sixth time.

```
sqlite3InitModule          27 ms    sqlite 3.53.0, 864 KiB of .wasm — per tab, not per login
deriving the key…                   Argon2id, on this thread — the tab freezes
Argon2id + bootstrap    847.5 ms    main thread stalled 797.7 ms — 19 MiB, t=2, tab hidden
runMigrations            20.7 ms    :memory:, so this is paid per tab until OPFS (5c)
pull(0) + decrypt + apply 89.7 ms   446 applied / 446 records / 112.8 KiB
                                    — transport 38.1 ms, decrypt + apply 51.6 ms
createCore + entityList   7.6 ms
total, click to first render      982.1 ms
```

Then the screen: Ada Lovelace, 100 people in the picker, loader 10.1 ms for the
seven calls. So **the client-side zero-knowledge path works**, and what decides
whether it is *viable* is the first row, not the third.

### 1. The two hosts, side by side, on the same 446 records

The comparison Increment 5 was for. Same account, same relay, same laptop, minutes
apart — `pnpm --filter @leapsake/web-spike pull` for the Node column, the page
above for the browser one.

| | Node 24 (SSR host) | browser, main thread |
| --- | --- | --- |
| Argon2id | **386.1 ms** | **847.5 ms** *(832–1 106 hidden, 449.4 visible — see below)* |
| …of which the host/tab is frozen | 336.6 ms | 797.7 ms |
| `runMigrations` (28 migrations) | 5.4 ms | 20.7–42.6 ms |
| transport, 112.8 KiB | 6.6 ms | 33.1–38.1 ms *(through the proxy)* |
| decrypt + apply, 446 records | 22.9 ms | 42.0–52.7 ms |
| **cold total** | **421 ms** | **982–1014 ms** |

Two readings, and they point opposite ways:

- **The data half is fine.** Decrypt + apply is ~2× Node's and still under 55 ms
  for a whole account; the store is not what makes a browser client expensive.
  (`transport` is inflated by the extra proxy hop and is a localhost floor
  either way.)
- **The KDF is the whole cost, more so than on the server.** 847 ms of a 982 ms
  cold start is Argon2id, and unlike the server's stall — which freezes *other
  people's* requests — this one freezes the user's own tab, which is the version
  a person can see.

### 2. Argon2id costs ~1.9× more in a backgrounded tab

Five runs driven with the tab hidden reported **832.4 / 838.6 / 847.5 / 863.6 /
1 106.3 ms**; the one run made with it visible reported **449.4 ms**. Same code,
same parameters, same machine. A hidden tab's renderer is de-prioritized — the
same reason `requestAnimationFrame` stops firing in one (finding 6) — and 19 MiB
of Argon2id is exactly the kind of work that shows it. (The hidden runs are also
the noisier ones, which fits: a de-prioritized renderer is the one that loses to
whatever else the machine is doing.)

It is labelled in the page (`tab hidden` / `tab visible`) rather than left to be
compared by accident, because **an unlabelled KDF number cannot be compared to
another one**. Worth re-clicking with the window in front: the visible-tab figure
is one sample, and it is the one a real user would pay.

Either way the conclusion for 5c holds: at ~450 ms best case the KDF is 3–4× the
entire rest of the cold start, and it runs where the UI lives. **A worker is not
a performance nicety for a browser client, it is the difference between a login
that shows progress and one that shows a frozen tab.** Note what a worker does
*not* fix: the cost itself, and therefore the case for a native-speed KDF or a
persisted key (5e) stands separately.

### 3. A browser cannot reach the relay at all — so this is the increment where CORS stopped being theoretical

Predicted since the plan doc; here it is load-bearing rather than noted. The
relay sends no `Access-Control-Allow-*` and handles no `OPTIONS`, and the
transport's `Authorization` header is not CORS-safelisted, so a cross-origin
`fetch` is preflighted into a 404 before any request is made.

`src/relay-proxy.ts` forwards `/relay/*` from the spike's own origin, and **the
transport needed nothing**: `baseUrl: "/relay"` works because `http-transport.ts`
builds every URL by string concatenation and never `new URL(base)`, so a
relative base resolves against the page. Same-origin also means no preflight.

The caveat belongs beside the result rather than in a footnote: **the proxy sees
`Authorization: Bearer <accountId>.<b64(authVerifier)>`.** The verifier is an
independent HKDF branch, so it reveals nothing about the KEK and confidentiality
genuinely survives — but the proxy could impersonate the account to read and
write ciphertext. That is an availability and integrity dependency production
must not have, which is *why* the answer is CORS (~6 lines behind a
`RELAY_CORS_ORIGINS` env var) and not a permanent forwarder.

### 4. The client is where the no-JS floor's inert sections come alive

The SSR gift ports (`src/gifts-ports-ssr.ts`) throw from every method, and their
docblock names the limit of that assertion: `renderToString` never runs effects,
so a section that loads through `useEffect` is invisible to it. **In a browser
those effects run**, and the throwing ports would take the page down — so the
client needs real ones, and they are
`apps/desktop/src/renderer/src/lib/gifts-ports.ts` **with `window.api` replaced
by `core`**, nine lines, nothing else changed (`src/client/gifts-ports-client.ts`).

That closes the loop on Increment 2's section inventory from the other side.
Rendered here, `HolidaysSection`'s `MultiAddCombobox` is a live combobox and
`GiftCaptureForm` is a working form — the two rows the inventory marked ⚠️ and ❌
— with no change to either component. **The no-JS gaps are gaps in the *floor*,
not in the components**, and a client with JavaScript gets the whole screen from
the same code the SSR host renders as HTML.

Same story for the two callbacks: `onSetObserves` and `onChanged` were no-ops
with an apology in a comment on the SSR route, and here they are desktop's
`PersonView` exactly — a `core` call and a re-run of the loader, which is what
`useRevalidator` does with none of the machinery.

### 5. The degenerate adapter is not a *client-side* adapter, and the difference is the whole navigation story

`ui-adapter.tsx` is imported and used unchanged, which is the reuse claim. But
every `href` it renders is a real `<a>` doing a real document navigation, and in
a client-side app that means **throwing away the tab's decrypted store and its
master key** — a click on "Edit" is a re-login.

That is not a defect in the adapter; it is what the degenerate adapter *is*, and
it is exactly the gap desktop's adapter fills by mapping `href` onto react-router's
`to`. What it says about the framework question, which the spike keeps open: the
one thing a web client cannot hand-roll as cheaply as routing-by-`switch` is the
*client* half, because a JS host with no router either re-derives the key on
every navigation or does not navigate. **The SSR host and the JS client want
different adapters over the same screens**, and both already exist in the repo.

### 6. Smaller things worth keeping

- **`@vitejs/plugin-react` needs its Refresh preamble in the document**, and
  without it the first React import throws *"can't detect preamble"* — pointing
  at `packages/ui`, which is innocent. Vite normally injects it through
  `transformIndexHtml`, which this spike cannot use: that would put
  `/@vite/client` into **every** page, and "this page contains no `<script>`" is
  a property Increments 2–4 check on the wire. So it is opt-in per page
  (`renderPage({ react: true })`) and exactly one page opts in. Increment 4's
  browser bundles never hit this because `vite build` does not use Refresh.
- **`requestAnimationFrame` never fires in a hidden tab** — not "fires slowly",
  never — so the pipeline's yield-so-the-page-can-paint hung indefinitely under
  an agent-driven browser. Raced against a 50 ms timeout now. Worth knowing
  before the three checks still owed before teardown, which are all "drive a tab
  the user is not looking at".
- **A main-thread KDF cannot even announce itself without a deliberate yield.**
  The "deriving the key…" row is appended, then the thread blocks for the better
  part of a second — so without an explicit `await paint()` the browser never
  renders it, and the page appears to do nothing and then jump to the answer.
- **`bootstrap.ts` runs in a browser unmodified.** The four-call login the SSR
  host uses is imported by the client as-is: `@leapsake/crypto` and
  `@leapsake/sync` needed no browser variant, and neither did the spike's own
  module. Its `measure.ts` event-loop probe works too — `setInterval` measures a
  frozen main thread identically in either host.
- **Warm numbers for 5a's two costs**, now that a second page pays them:
  `sqlite3InitModule` is 23–36 ms warm against 5a's 52.7–57.3 ms, and
  `runMigrations` is 20.7–42.6 ms against 40–140 ms. Both are per *tab*, and both
  are what OPFS should turn into a once-ever cost in 5c.
- **The client is read-only, deliberately.** 5b pulls and does not push, so the
  gift and holiday writes its ports enable land in the tab's `:memory:` store and
  die with it. Wiring the push would need the same high-water mark Increment 3
  had to reconstruct by hand (`WANTED-CHANGES.md`), and it answers no question 5b
  asked.

## Increment 5c — findings

**Both done-whens met, in a real browser.**
`http://localhost:5180/client-worker` runs the entire data layer — sqlite-wasm,
Argon2id, the master key, `createSyncEngine`, `createCore` — in a **Worker**,
against an **OPFS SAHPool** database, and talks to it over a 40-line
`postMessage` proxy. The page stays interactive throughout (worst main-thread
task latency **8.4 ms** while the worker was stalled for **1 057 ms**), and a
reload logs in against the store it already has: `pull(446)` → **0 applied, 0
records**, with `runMigrations` reporting *schema already at 28, nothing to do*.
**Zero files changed under `packages/`**, a seventh time.

```
worker ready              61.9 ms   sqlite 3.53.0 (49 ms) + leapsake-spike (12.9 ms) — OPFS holds: empty
Argon2id + bootstrap    1106.7 ms   worker thread stalled 1057.4 ms — 19 MiB, t=2, in JavaScript
open OPFS + runMigrations 102.7 ms  /spike-<accountId>.db — new file, migrated 0 → 28
pull(0) + decrypt + apply 241.9 ms  446 applied / 446 records / 112.8 KiB → cursor 446
createCore + entityList     2.3 ms
total, click to first render      1474.5 ms
main thread during the login: worst task latency 8.4 ms over 639 791 message
round trips, 0 of them over one 60 Hz frame
```

The second half of the increment is one line of the *reload*, and it is the
line the persistence was for:

```
open OPFS + runMigrations  18.8 ms  schema already at 28, nothing to do
pull(446) + decrypt + apply 34.8 ms 0 applied / 0 records / 0.0 KiB → cursor 446
```

### 1. The stall did not shrink. It moved — and that is the entire point

The worker does not make Argon2id cheaper and was never going to. What it
changes is **which thread pays**, and the two probes are meant to be read as a
pair: the worker's own event-loop probe (`measure.ts`, the same function 5b ran
on the main thread) reports it stalled for the whole KDF, while the page's probe
reports a main thread that was never blocked.

| | 5b, main thread | 5c, worker |
| --- | --- | --- |
| thread running Argon2id | the tab's | the worker's |
| that thread's stall | 797.7 ms | 1 057–3 369 ms |
| **the page's own worst unavailability** | **the same 797.7 ms** | **8.4 ms** |
| frames drawn during the login | none — the tab is frozen | uninterrupted |
| what the page could show meanwhile | nothing, without an explicit `await paint()` | every stage row, as it happened |

The disappearance of the yields is the developer-visible half. 5b needed four
`await paint()` calls to get a row on screen before the next synchronous block,
and had to *subtract* the time they cost from its own total (a bug it hit first:
four yields once turned a 530 ms login into a reported 12 423 ms). None of that
exists here. The stage rows stream from the worker onto a thread that is doing
nothing, so the wall clock is the number, with nothing subtracted from it.

### 2. Measuring that needed a third instrument, because a hidden tab breaks the other two

Worth its own finding, because it applies to **every browser check this spike
still owes** — they are all "drive a tab the user is not looking at".

In a backgrounded tab, `requestAnimationFrame` does not fire at all and
`setInterval` is clamped to ~1 s. So on a main thread that was provably free,
the frame meter read **0 frames drawn** and `measure.ts`'s event-loop probe —
the one that ported unchanged from Node to a browser in 5b — read **724–950 ms
of "stall"**. Both are throttling, and neither can tell throttling from
blocking.

What does work is a **`MessageChannel` posting to itself in a loop**, measuring
the gap between consecutive deliveries: message tasks are not on the timer
throttle. It runs at ~300–600 k round trips per second, which is enough
allocation to earn the occasional GC pause of its own — so it reports a
distribution rather than a single worst case, and the count of gaps over one
60 Hz frame is the number to read. On the cold run: **0 of 639 791**.

### 3. What persistence costs, and what it buys

Same account, same 446 records, same laptop, hidden tab. The KDF row is
deliberately absent from this table — see finding 5.

| stage | 5b, `:memory:` main thread | 5c cold, OPFS | 5c reload, OPFS |
| --- | --- | --- | --- |
| `sqlite3InitModule` | 23–36 ms, **on the login path** | 41–49 ms, **before the click** | 19–45 ms, before the click |
| install the SAHPool VFS | — | 12.9 ms | 6.6–16.9 ms |
| open the db + `runMigrations` | 20.7–42.6 ms, **every tab** | 99.8–102.7 ms | **5.1–29.1 ms, nothing to do** |
| pull + decrypt + apply | 89.7 ms (446 applied) | 241.9–408.6 ms (446 applied) | **8–41.1 ms (0 applied)** |
| `createCore` + `entityList` | 7.6 ms | 2.3–2.9 ms | 4.7–35.3 ms |

Three readings:

- **The reload is the whole win, and it is bigger than the schema line.**
  5a and 5b both flagged `runMigrations` as a per-tab cost OPFS should turn into
  a once-ever one, and it did — but the pull is the larger prize: a browser
  client that keeps its store pulls **nothing** on a reload where a cold one
  re-pulls the account's entire history. That is the same asymmetry Increment 3
  found from the other side, where the *cold* SSR host was the client that could
  never pull incrementally.
- **Writing 446 rows into OPFS costs 4–7× what writing them into `:memory:`
  did** (224–387 ms against 42–53 ms). Persistence is not free on the cold path;
  it is simply paid once instead of per tab.
- **Engine init moved off the login path entirely**, because the worker starts
  with the page and installs its VFS while the user is still typing. It is the
  one cost the split removed rather than relocated, and it cost nothing to get.

### 4. `CoreApi` crossed a thread boundary behind a `Proxy`, and the screen never noticed

The lever the plan doc predicted — *the desktop main/renderer split is
isomorphic to the browser main-thread/Worker split* — held exactly.
`core-proxy.ts` is one recursive `Proxy`: property access accumulates a path,
calling it posts `{ path, args }`, the reply resolves the promise. No method
table, no batching layer, no change to any package.

The claim is structural rather than asserted. **`src/client/person-app.tsx` is
one file with two callers** — 5b's page hands it a real `core`, this one hands
it a proxy — and the loader, the screen and the provider stack are byte-identical
between them. `gifts-ports-client.ts` is reused across the boundary untouched,
which means the gift and holiday sections drive `core` calls *through the worker*
with no port of their own.

The seven-call person loader crosses as seven separate messages, in one
`Promise.all`, and costs **6.6–10.9 ms** against 5b's **10.1 ms** in-thread. So
the RPC is free at this granularity, and deliberately un-optimized: a batching
API would have hidden whether one was needed.

One real hazard, worth the line it costs: **the proxy must not answer to
`then`.** An accidental `await core.views` would otherwise see a truthy `then`,
treat the namespace as a thenable, and hang forever waiting on a
`core.views.then` call the worker cannot resolve.

### 5. OPFS SAHPool is one tab at a time, and the KDF number is unusable in a hidden one

Two limits of the browser rather than of the code, both found by driving it:

- **A second tab cannot open the database.** The pool takes exclusive
  `createSyncAccessHandle` locks, so a second tab of the same page fails at
  install with `NoModificationAllowedError: Access Handles cannot be created if
  there is another open Access Handle`. That is not a spike artifact — **opening
  a second tab is something users do**, and a real web client has to answer it
  (a shared worker, a leader election, or a graceful read-only fallback). It also
  lands on 5d: a PWA is precisely the thing someone opens twice. The page detects
  the failure and says so rather than looking broken.
- **The KDF cannot be measured in a hidden tab, and a worker is *worse* than a
  main thread there.** Five hidden-tab runs read 1 083 / 1 107 / 1 120 / 3 229 /
  3 417 ms against 5b's hidden main thread at 832–1 106 ms and its one visible
  run at 449 ms. A backgrounded renderer's workers are de-prioritized at least as
  hard as its main thread, and the variance is three-fold, so **none of these
  numbers belongs in a comparison** — the page labels the tab's visibility for
  exactly this reason. What the increment does establish is the shape: the KDF is
  still the whole cost, and it is now the *only* thing a reload has to redo,
  which is what makes 5e the increment that matters — and, after this increment,
  the one that comes *next*, ahead of 5d. The visible-tab run is deferred rather
  than dropped: it is **check 4 of the four owed before the teardown** (plan doc
  → *Increment 6*), collected cheaply during either, since both end at a human
  reloading a real browser anyway.

### 6. Smaller things worth keeping

- **The database is named after the account** (`/spike-<accountId>.db`), decided
  after `lookup(username)` and before the store is opened. A persistent store
  plus a login form is otherwise a mismatch waiting to happen: logging in as a
  second account against the first one's store would merge two accounts into one
  file, silently. A real client has one account per install and answers this with
  custody instead — but the hazard is created by persistence, so it appears here
  first.
- **`bootstrap.ts` now runs unmodified in a third host** — Node, a browser main
  thread, and a Worker. Its `measure.ts` event-loop probe works in all three too,
  which is what let the worker report its own stall in the same units.
- **`vite build` would need `worker: { format: "es" }`**, recorded in
  `vite.config.ts` though the spike only ever runs dev: the default IIFE worker
  build survives neither the top-level `await` the VFS install needs nor the
  `@leapsake/*` imports.
- **Nothing was needed to make the worker load `.wasm`.** 5a's
  `optimizeDeps.exclude` is what makes `new URL("sqlite3.wasm", import.meta.url)`
  resolve, and it holds identically inside a module worker.
- **Driving a hidden tab is flaky in a way worth knowing before the teardown
  checks.** Synthesized clicks on this page landed about half the time; a
  `requestSubmit()` through the page's own handler was reliable. The three checks
  the spike still owes are all browser-driving, and two of them are click-based.

## Increment 5e — findings

**Done-when met, in a real browser, and it is the cheapest increment here.**
`http://localhost:5180/client-key` logs in with a password once and mints a
**non-extractable `AES-GCM` `CryptoKey` in IndexedDB** wrapping the master key.
A reload then starts the same client from that wrap: **91.3 ms**, no password,
`fetch` removed from the worker for the duration, and the person on screen.
**Zero files changed under `packages/`**, an eighth time — and this time the
notable part is *which* package did not change.

```
storage bucket                      best-effort (evictable) storage — persist() was refused,
                                    0.7 MiB used of 10.0 GiB — requested from the page, not the worker
worker ready               69.5 ms  sqlite 3.53.0 + leapsake-spike — OPFS holds: /spike-<accountId>.db
unwrap the master key       8.6 ms  IndexedDB → non-extractable CryptoKey → AES-GCM
                                    → 32-byte master key and 32-byte relay verifier;
                                    exportKey refused (InvalidAccessError) — extractable: false
open OPFS + runMigrations  23.6 ms  schema already at 28, nothing to do
createCore + entityList    52.5 ms
open a relay record with it         230 B of ciphertext from people → “Ada Lovelace”,
                                    the same row the OPFS store holds
total, click to first render       91.3 ms   no password, no Argon2id, 0 network calls
```

### 1. The browser's `KeyStore` is `@leapsake/crypto`'s `KeyStore`, unchanged

The increment was framed as "probe the closest analogue to an enclave", and the
answer arrived in a shape nobody had to design: `createBrowserKeyStore()` in
`src/client/key-custody.ts` **implements the `KeyStore` port as written** —
`getSecret` / `setSecret` / `deleteSecret`, bytes in and bytes out, async — over
IndexedDB, with each secret stored under its own freshly generated
non-extractable `CryptoKey`. No port change, no widening, no browser-shaped
method. That is the same result the driver contract gave in 5a and `CoreApi`
gave in 5c, a third time: **the ports were never desktop-shaped.**

Per-secret wrapping keys rather than one shared key, because generation is
sub-millisecond and it makes `deleteSecret` complete: dropping the record drops
the only reference to the handle, so there is no "the wrapping key is still
around somewhere" left to reason about. The two ids this client keeps are
`master-key` and `auth-verifier`.

So §13's PWA row can be answered rather than deferred, in two halves:

- **What custody *is*** — a `KeyStore` adapter, ~60 lines, no new dependency.
- **What custody is *worth*** — see finding 3. The port cannot express the
  difference, which is exactly why the spike had to look.

### 2. Two things a demo like this could fake, and neither is faked

The done-when is "a reload unwraps it and decrypts a row, with no password and
no relay", and both halves of that are easy to *appear* to satisfy:

- **"No relay" can mean "nothing happened to need one."** So the worker
  **removes `fetch`** for the duration of a resume (`withNoNetwork`), and any
  reach for it throws. The instrument then tests itself before it is trusted —
  one deliberate probe fetch, which must be blocked — because *0 calls made* and
  *no counter installed* look identical from outside. Both numbers are in the
  page's verdict.
- **"It decrypted a row" can mean it opened something it sealed itself**, which
  proves only that AES-GCM is symmetric. So the cold login keeps one
  `EncryptedRecord` **exactly as the relay sent it** and the resume opens *that*:
  230 B of ciphertext this browser did not produce, yielding "Ada Lovelace" —
  a row the OPFS store independently holds. That is what makes the claim "custody
  returned **the account's** master key" rather than "a key round-tripped".

### 3. What non-extractable buys, and what it does not

`exportKey("raw", …)` on the wrapping key raises `InvalidAccessError` on every
run, and the page reports the refusal rather than asserting it. So the key is a
**handle**, not a value: an attacker who reads IndexedDB — XSS, another script on
the origin — gets a wrap they cannot open anywhere else, and cannot exfiltrate
the key to open it later.

What it does not buy is protection from **same-origin script**, because using the
key is the entire point of storing it. A payload running on this origin can call
`decrypt` exactly as this client does. Nor does it keep the master key out of JS
memory once unwrapped: `@leapsake/crypto` seals and opens with `Uint8Array`s and
the port itself is defined in bytes, which is also why the wrap is AES-GCM over
raw bytes rather than `AES-KW` — `AES-KW`'s whole selling point is that the
wrapped key never materializes, and no caller of this port can have that.

**So §13's "passkey PRF is the right answer" survives this increment intact.**
What changed is the floor, not the ceiling: the cheap thing works, costs nothing,
and is a strict improvement over re-deriving the key from a password on every
load. Passkey PRF adds *user presence* — a per-unlock gesture that a background
XSS cannot supply — and remains untested.

### 4. The cost of a warm start is 65× smaller, and the last cold cost is a KDF

Same account, 129 records, same laptop, hidden tab, one cold login and one reload
each way. The KDF row is a hidden-tab reading and is **not comparable to
anything** (5c, finding 5) — it is here to show what the resume skips, not how
long Argon2id takes.

| stage | cold login | resume |
| --- | --- | --- |
| Argon2id + bootstrap | 3 894–4 947 ms *(hidden tab)* | **not run** |
| open OPFS + `runMigrations` | 280–375 ms, new file | 17–29 ms, nothing to do |
| `pull(0)` + decrypt + apply | 676–870 ms (129 records) | **not run** |
| unwrap the master key | — | **8.6–10.2 ms** |
| `createCore` + `entityList` | 11–16 ms | 49–61 ms |
| mint custody | 6.4–18.8 ms | — |
| **total** | **4 884–6 277 ms** | **62.7–96.4 ms** |

Three readings:

- **The KDF was the only thing left, and now it is optional.** 5c made the store,
  the schema and the cursor survive a reload; this makes the key survive, and the
  whole cold path collapses to a 32-byte AES-GCM decrypt.
- **Minting got 3× more expensive when the port arrived** (6.4 ms → 18.8 ms):
  two `setSecret` calls means two key generations and two IndexedDB
  transactions where the first cut wrote one record. It is paid once per login,
  on the far side of an Argon2id, so it is not worth optimizing — but it is worth
  knowing that per-secret keys are not free.
- **`createCore` + `entityList` is slower warm than cold** (49–61 ms against
  11–16 ms), which reads backwards until you notice the cold number is measured
  moments after 129 rows were written through the same pages. Warm, the first
  query pays a real read from OPFS. It is the reload's largest line, and it is
  the store, not the key.

### 5. The thread that owns the data is not allowed to protect it

`navigator.storage.persist()` is **`[Exposed=Window]`**. The worker — which owns
the OPFS database *and* the IndexedDB wrap — gets `persisted()` and `estimate()`
and no way to ask for durability. Found by calling it there and reading
`navigator.storage.persist is unavailable` back; the request now lives on the
page and the worker only reports what it got.

And what it got is the part 5d needs to plan for: **`persist()` was refused**,
leaving both the store and the key on best-effort storage that the browser may
evict under pressure (Safari's 7-day cap on unused origins does it on a timer).
Chrome grants durability to *installed* or highly-engaged origins — which an
installed PWA is, and `localhost` in an agent-driven tab is not — so this is one
more thing 5d changes rather than a wall. The failure mode is mild and should be
designed for anyway: eviction costs one Argon2id and a full re-pull, not an
account, because the relay still holds everything.

### 6. Smaller things worth keeping

- **`forget` and `wipe` are different buttons, and the difference is the
  finding.** Forgetting the wrap keeps the store — logout, custody-shaped, and
  the thing a shared computer needs. Wiping the store must *also* drop the wrap,
  because a key without a store is a warm start into an empty database: it opens,
  migrates a fresh schema, and renders nobody.
- **A resume needs the relay credential as much as the master key**, so the
  `authVerifier` is in custody too. This is §9.2's session-store point in a
  different host: a client that can read its local store but can never sync again
  is not a client. It is unwrapped on every resume and deliberately unused there
  — the offline claim has to stand on its own — but it is what lets a resumed
  session sync the moment it wants to.
- **The account id is stored in the clear, and it has to be.** The OPFS filename
  is `/spike-<accountId>.db`, which is needed *before* anything is unwrapped.
  It is also what the relay uses to address the account, so it is not a secret —
  but it is the one field that says which account this browser belongs to, and it
  sits beside the wrap rather than inside it.
- **`peekCustody` is the splash-screen call**, and a real client needs one: it
  reads whether a wrap exists without opening it, which is how the page decides
  between showing a password field and showing the app. Same decision an
  installed PWA makes on every cold launch.
- **The IndexedDB schema needed a version bump mid-increment** (one record
  holding everything → a `secrets` store plus an `account` store), and doing that
  correctly means creating stores conditionally inside `onupgradeneeded`, because
  a browser that ran the earlier code already has the old database. Trivial here;
  a real client's custody store will need migrations exactly like its SQL one.
- **The OPFS pool is still one tab at a time, and this page proved it the
  annoying way**: the first run failed at VFS install with
  `NoModificationAllowedError` because a `/client-worker` tab from 5c was still
  open. Two *different* pages of the same origin contend just as two copies of
  one page do — worth knowing before 5d, where the answer is a `SharedWorker` or
  a leader election rather than more pages.

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
| `src/wasm-sqlite-driver.ts` | the same seam over `@sqlite.org/sqlite-wasm` — the browser's driver, and Increment 5a's subject |
| `src/routes/driver-contract.tsx` | a shell and a `<script>`; the second and last page here that ships one |
| `src/client/driver-contract.ts` | Increment 5a's done-when, **as a page**: `runDriverContract` + `runMigrations` in the browser, verdict in the `<h2>` and the tab title |
| `src/client/test-api.ts` | byte-identical copy of `apps/mobile/test/test-api.ts` — a collecting `describe`/`it`/`expect` for a host with no test runner |
| `src/relay-proxy.ts` | `/relay/*` → `RELAY_URL/*`, because the relay sends no CORS headers; the docblock is emphatic that this is a spike affordance, not an answer |
| `src/routes/client.tsx` | Increment 5b's shell: a login form the server renders and then has nothing more to do with |
| `src/client/client-app.tsx` | **Increment 5b's done-when**: login, `pull(0)`, decrypt and `PersonScreen` — all in the tab, all measured |
| `src/client/person-app.tsx` | the loader, the screen and the providers — **one file, rendered by 5b against a real `core` and by 5c against a proxied one** |
| `src/routes/client-worker.tsx` | Increment 5c's shell: the login form, plus the frame meter and text field that make "still interactive" watchable |
| `src/client/client-worker-app.tsx` | **Increment 5c's done-when**, main-thread half: three probes, the stage table, and React over a `core` that lives elsewhere |
| `src/client/core-worker.ts` | the other half: sqlite-wasm, OPFS, Argon2id, the master key, the sync engine and `core`, none of which the page can reach directly — and, since 5e, the `resume` that reaches the same `core` with none of the first three |
| `src/client/core-proxy.ts` | `CoreApi` over `postMessage` in one recursive `Proxy` — the ~40 lines the plan doc predicted |
| `src/client/worker-protocol.ts` | the three message shapes between them, which is the whole contract of the thread boundary |
| `src/client/gifts-ports-client.ts` | desktop's gift ports with `window.api` → `core`; the SSR ports throw, and in a browser the effects that call them actually run |
| `src/client/key-custody.ts` | **Increment 5e**: `@leapsake/crypto`'s `KeyStore` port over IndexedDB + a non-extractable `CryptoKey`, plus the account record and the relay canary that prove a warm start got the *right* key |
| `src/routes/client-key.tsx` | 5e's shell: one page with two ways in — a password login that mints a wrap, and a resume that uses one |
| `src/client/client-key-app.tsx` | **Increment 5e's done-when**: reload → unwrap → open OPFS → decrypt a relay record → render, with the network guard's verdict |
| `scripts/seed.ts` | account + rows on a real relay; the fixture is an *account*, since the renderer is stateless |
| `scripts/pull.ts` | Increment 1's done-when, runnable: the SSR request path minus the rendering |
| `scripts/bench.ts` | the cold-vs-warm p50 the decision rule is stated on |
| `WANTED-CHANGES.md` | every temptation to edit `packages/` — the running list Increment 2 is scored against |
