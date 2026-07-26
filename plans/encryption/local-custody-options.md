# Local custody — should single-device use have a password?

> **Status: OPEN. This doc exists to be decided, then retired into
> [`model.md`](./model.md) §5–7 + [`../product-truths.md`](../product-truths.md).**
> It reopens a *locked* decision (model.md §7: "onboarding must not force
> account/passphrase setup"), deliberately and while it is still cheap — there are zero
> users, and [`../launch.md`](../launch.md) Increment 4 is the moment that stops being true.
>
> The trigger: launch.md Increment 2 proposes nudging users to save a 24-word recovery
> phrase. The nudge is a *consequence* of local usage having no password. If that premise
> changes, the nudge changes shape or stops being necessary — so the premise is worth
> settling first.

## 1. The question

Leapsake's north star is that it should **feel like a familiar centralized SaaS app while
being safer underneath** (`product-truths.md`). Today, single-device use has no account and
no password, and the only fallback when the OS keychain is lost is a 24-word recovery
phrase — a pattern most laypeople have never met.

So: does the phrase-only fallback serve the north star, or undercut it? And if it undercuts
it, is a local password the fix?

## 2. What is actually built (read this before weighing options)

The load-bearing detail that costs every option below: **there are two independent key
trees**, not one, and a local password would have to address the *outer* one.

### The outer door — at-rest, gates whether the file opens at all

- `db-key` (32 bytes, OS keychain) encrypts the whole SQLite file.
- Sidecar `<db>.recovery` on disk = `sealDbKeyForRecovery(dbKey, recoveryKey)`.
- `recovery-key` (OS keychain) is what the 24 words encode.

Boot resolves three cases identically on both clients — desktop
[`apps/desktop/src/main/db/open.ts`](../../apps/desktop/src/main/db/open.ts), mobile
[`apps/mobile/lib/core-context.tsx`](../../apps/mobile/lib/core-context.tsx) ~300–360:

1. keychain has `db-key` → open;
2. no key, no/plaintext file → mint and open;
3. **no key but an encrypted file + sidecar → `RecoveryGate`: the phrase is the only way in.**

Case 3 is the failure mode this whole discussion is about. Note it is reached *before the
database is open*, so nothing inside the DB can help — which is precisely why the sidecar
exists as a separate file.

### The inner tree — the account, gates sync and sharing

- `master key` (MK) wraps per-item content keys; persisted only as `key_wrap` rows **inside**
  the DB.
- MK has pluggable **doors** (`key_wrap.principal_kind`): `enclave` always; `password` and
  `recovery` minted at `enableSync`
  ([`packages/key-custody/src/session.ts:318`](../../packages/key-custody/src/session.ts)).

The KEK layer (`model.md` §4) means adding a door re-encrypts nothing. `deriveKeyMaterial`
(Argon2id → `{kek, authVerifier}`, `packages/crypto/src/kdf.ts`) is pure JS and already runs
on Node, Electron, and Hermes.

### The consequence for costing

> A local password **cannot** just be another MK door. MK lives inside a database you cannot
> open yet. A local password needs a **new password-wrapped sidecar for `db-key`** —
> `sealDbKeyForPassword(dbKey, kek)` alongside the recovery sidecar — consumed at boot in
> both clients' case-3 branch.

The crypto for this is ~free (reuse `deriveKeyMaterial` + `wrap`). The cost is that it lands
in the **pre-database boot path**, the most delicate code in the app, on two platforms, with
a data-loss failure mode. That is the honest price tag on Options B and C, and it is larger
than "the KEK layer makes doors cheap" suggests.

## 3. The forces in tension

1. **Familiarity** (the north star) — people know usernames and passwords. They do not know
   seed phrases; the pattern is borrowed from crypto wallets and carries that smell.
2. **The accessibility tiebreak** (`model.md` §1, decided 2026-07-05) — a safest-practice
   *default* that forces a layperson through a hoop should be re-evaluated and made opt-in.
   **This cuts against a mandatory first-run password just as hard as it cuts against a
   forced phrase-saving gate.** Both are hoops in front of "let me just try this app."
3. **The honest impossibility result** (`model.md` §5) — if the user holds no secret, only a
   server can hold the key. Local-only Leapsake has no server, so *something* the user holds
   must exist as the fallback. The only question is what shape it takes.

## 4. Two observations that should drive the decision

**(a) A credential you never type does not survive in memory.**

Under every option, the keychain auto-unlocks the normal launch — that is the whole point of
the enclave door, and none of these options change it. So a local password would be typed
approximately **once, at setup, and then never again** until the exact emergency where it is
needed, possibly years later. Unrehearsed passwords decay; that is why password managers
exist. A phrase, by contrast, is *inherently* something you must store externally, and the
UI can say so at the moment it is shown.

This substantially weakens the strongest argument for a local password. "More familiar" does
not imply "more likely to be available on the bad day." It may well invert: a password feels
memorable enough to skip writing down, and then isn't.

**(b) Familiarity without the safety net can be worse than unfamiliarity.**

The SaaS mental model does not stop at "there is a password." It includes **"and if I forget
it, I click Forgot password and get an email."** A local-only Leapsake has no server, so
there is no reset. Presenting a login-shaped door with no reset behind it borrows the user's
SaaS instincts *and then violates them* at the worst possible moment. A 24-word phrase is
unfamiliar, but it is honestly unfamiliar — it signals "this is not recoverable by
customer support," which is true.

This is the crux. The instinct to make custody familiar is right; the risk is making it
familiar in a way that mis-sets expectations about recoverability.

## 5. The options

| | First-run UX | Worst-day UX (keychain lost) | Cost | Reopens a locked decision? |
|---|---|---|---|---|
| **A** Status quo + nudge | Zero setup | Type 24 words, or data gone | **S** | No |
| **B** Optional password, opt-in | Zero setup; offered later | Password, else phrase, else gone | **M–L** | Partially (§7 stays intact) |
| **C** Password required at first run | One wall | Password, else phrase, else gone | **L** | Yes — model.md §7, §7.1, §1 |
| **D** Reframe the ritual, no custody change | Zero setup | Type 24 words, or restore a backup file | **S–M** | No |
| **E** Deferred local signup, risk-triggered | Zero setup; invited once data exists | Password, else phrase, else gone | **M–L** | No — §7 holds, §7.1 extends |

### Option A — keep enclave-only, ship the nudge (launch.md Increment 2 as written)

A dismissible Home nudge pointing at the existing reveal surface. Retires permanently once
the phrase has been revealed.

- **For:** cheapest; preserves the best-in-class zero-setup first run; changes no crypto and
  no boot path; matches every locked decision.
- **Against:** the phrase stays a novel ritual, and discoverability rests on a *dismissible*
  nudge. A user who swipes it away is exactly back to the current data-loss path. It is the
  most accessible design on day one and the least familiar on the worst day.

### Option B — optional local password, offered but never required

Keep first run at zero setup. Offer "protect this device with a password" as a visible dial
(Settings, plus a nudge). Setting it mints a password-wrapped `db-key` sidecar. `RecoveryGate`
then accepts **password or phrase**. The phrase demotes to the forgot-password backstop —
its familiar role.

- **For:** honors the accessibility tiebreak exactly as written (safe mechanism, opt-in
  hoop). Gives the phrase the role users' mental model already has for it. Aligns local and
  synced custody, so "enable sync later" stops being a different-shaped ritual.
- **Against:** two doors to explain instead of one. Observation (a) applies in full — an
  opt-in password is typed once and then never. And it does not remove the need to get the
  phrase into the user's hands, because the phrase is still the last resort; so **Increment 2
  survives more or less intact anyway.** That is the key strike against B as a way to avoid
  the nudge: it doesn't.

### Option C — password at first run, SaaS-shaped onboarding

Everyone sets a password (optionally with a username, even local-only). One custody model
everywhere. Phrase shown once at setup as the backstop.

- **For:** maximally consistent mental model; the local→sync upgrade becomes nearly free,
  since the password door already exists; sets up the multi-user-per-client future (§6).
- **Against:** it is a wall in front of an app whose pitch is "just start adding people," and
  it directly contradicts `model.md` §7 ("onboarding must **not** force account/passphrase
  setup"), §7.1's first-launch branch table, and §1's first goal. It also fully triggers
  observation (b): login-shaped, no reset behind it. Highest cost, highest UX risk.

### Option D — keep custody as-is; change what we ask the user to *do*

No crypto or boot-path change. Replace "reveal your recovery phrase" as the mental model
with **"back up Leapsake"** — a first-class flow producing an artifact a layperson
understands: a saved backup file (the DB + sidecar) *plus* the phrase, with guidance to put
it in iCloud Drive / Dropbox / a password manager. The Home nudge points at *that*.

- **For:** cheap; no locked decision reopened; no new failure mode in the pre-DB boot path.
  "Back up your data" is a genuinely universal pattern — far more so than either a seed
  phrase *or* a local password. It also **subsumes launch.md Increment 3** (verify + document
  restore-from-backup), which has to happen regardless, and turns that documentation
  obligation into a product feature.
- **Against:** does not make the phrase itself familiar; it wraps it in a familiar container.
  A backup file is a bigger secret to leave lying in a Dropbox folder than 24 words on paper
  (though it is exactly as sensitive as the phrase, which unlocks the same data). Needs a
  clear-eyed answer on where users are told to put it.

### Option E — deferred local signup, triggered by risk (owner's proposal, 2026-07-26)

B's mechanism with two changes that answer B's objections directly.

**The flow.** First run is untouched — zero setup, straight into the app. Once the user has
data to lose (`hasEntities && !accountExists`), a Home nudge invites them to create an
account. Signup is username + password and is **fully local**: no relay, nothing leaves the
device. If a relay *is* configured, the identical screen becomes sign-up-**or**-log-in. The
password gates the `db-key` sidecar (the new door, §2) and the MK `password` door (existing).
The recovery phrase is shown once at signup as the forgot-password backstop. **The password is
re-asked periodically** — the keychain still handles ordinary launches, but the credential
gets rehearsed instead of rotting.

- **For:**
  - **Periodic re-auth defeats observation (a).** A password typed occasionally survives; a
    password typed once does not. This is the 1Password / banking-app pattern — biometric
    daily, password periodically — and it is the reason E beats B rather than restating it.
  - **It does not violate the locked decision.** `model.md` §7 forbids onboarding that
    *forces* account setup. E never forces; it invites, after the fact, dismissibly. Only
    §7.1's branch table needs extending. This is the crucial difference from C.
  - **Timing matches investment.** The prompt lands when the user has something to protect
    and is bought in enough to act — not at the moment they are trying to evaluate the app.
  - **It converges local and synced custody into one model**, which pays off three times over
    in `product-truths.md`'s deltas: multi-user-per-client (#1) needs exactly this per-user
    local credential; "log out = purge" (#3) needs a login to be meaningful; and the web app
    needs constant auth anyway.
  - **Most of it is already built.** `enableSync` takes `username`/`relayUrl` as *optional*
    and documents local-before-relay account creation; `enableSync` vs `joinAccount` already
    is sign-up vs log-in on both clients; the nudge engine already computes the trigger signal.
- **Against:**
  - The `db-key` password sidecar still lands in the pre-database boot path on two platforms
    (§2). That is the whole cost, and it is not small.
  - It grows launch.md Increment 2 from **S** to **M–L**, on the critical path ahead of the
    Play 14-day clock.
  - Two secrets to explain, reversing `product-truths.md`'s "should not have to manage
    multiple passwords / recovery keys" for the single-device case (see §7's note).

#### The copy problem, and its fix

"Sign up so you don't lose your data" is the trap from observation (b): a local account does
**not** protect against a dead SSD, and users will hear that it does.

The fix is one word — **access**, not *data*:

> 🔐 **Create your account so you never lose access to your data. It's free.**

That is plain English, carries no jargon, and is *precisely* true: the password protects
against this device losing its security settings (OS reinstall, migration, keychain reset),
which is exactly the failure it covers. The signup screen then does the fuller honest work:

> **Create your account** — Free, and it works entirely on this device. No email, nothing
> sent anywhere.
>
> Right now, only this device can open your data. If it ever loses its security settings —
> after a reset, a repair, or a move to a new machine — your password is what gets you back in.
>
> *This protects your access, not your device.* To protect against a lost or broken device,
> set up sync or back up your data.

That last line keeps the promise keepable, and it is where **Option D survives**: the
device-loss gap is real, still needs the backup-and-restore answer, and now has a natural
place to be sold. It also sets up sync as the obvious next step rather than a separate pitch.

#### Weak passwords — decided (owner, 2026-07-26)

A user-chosen password on the sidecar is offline-crackable in a way today's high-entropy
phrase is not (§5, Option B/C discussion). **Accepted:** the local exposure requires an
attacker to already hold the file, and a user who picks a bad password owns that outcome.
Two riders, both cheap:

- Keep a **length floor** (the 12-char one from `security-findings.md` M1) and keep the
  existing passphrase steer — `Settings.tsx` already tells users that 3–4 random words beat a
  short complex password. The mechanism exists; it just needs to appear on the signup screen.
- The exposure **does** grow with the web app, where auth becomes constant. That is not a new
  problem: it is finding **H1**, and it already has a recorded answer — OPAQUE at the
  hosted-relay gate (`sync.md` §4). E does not change that answer; it makes shipping it more
  important, since more users will hold a password.

## 6. The one structural argument for deciding this now

`product-truths.md` "Deltas vs. the current build" #1 commits to **multiple authenticated
users per client, with separately-keyed per-user stores**. When that lands, a client must
unlock user A's store and not user B's — *without necessarily reaching a relay*. That is a
per-user local credential, which is Option B/C's machinery arriving through the back door.

So the password-at-the-local-layer question is plausibly **not** "if" but "when." That is the
strongest reason to decide the shape deliberately now rather than have multi-user force an
answer later — though note it argues for *designing* for it, not necessarily for shipping a
password in v0.1.

## 7. Recommendation

**E, with D folded in as its honesty clause. A is the escape hatch. B and C are subsumed.**

Revised from an earlier draft of this doc, which recommended D. E supersedes it: D solved
"make the phrase land somewhere durable," but E solves the better problem — give the user a
credential they actually rehearse, and let the phrase retreat to the role everyone already
understands (the forgot-password backstop).

- **E over B** — periodic re-auth is the difference. B's password rots unused, so the phrase
  stays the real fallback and the nudge has to exist anyway; E's password is exercised, so it
  is the real fallback.
- **E over C** — E gets the same one-model-everywhere payoff without forcing anything at first
  run, so `model.md` §7 holds as written and the accessibility tiebreak is satisfied rather
  than overridden.
- **E over A** — A leaves an unfamiliar ritual behind a dismissible nudge. E replaces the
  ritual rather than advertising it harder.
- **D is not discarded** — it becomes E's honesty clause and stays a real increment. The
  device-loss gap E's copy admits to is exactly what backup-and-restore answers, and
  launch.md Increment 3 must happen regardless.
- **A stays the escape hatch.** E's cost is concentrated in the pre-database boot path (§2).
  If that work looks risky against the launch calendar, shipping A and deferring E to v0.2 is
  a legitimate retreat — the nudge is small, and E remains additive afterward because the KEK
  layer re-encrypts nothing.

**The trade to accept with open eyes:** this grows launch.md Increment 2 from a small nudge to
a real feature, ahead of Increment 4's 14-day Play clock. It is the last cheap moment to make
this change — but it is not free, and the schedule cost is the reason to decide now rather
than drift.

**Consequential edits if E is adopted:**

- `model.md` §1 — "no account, no password" becomes "no account *required* to start."
- `model.md` §7.1 — the first-launch branch table gains the deferred-signup path.
- `model.md` §7 — the "single-device is first-class" bullet holds; annotate that an account is
  *invited* post-first-run.
- `product-truths.md` — the "should not have to manage multiple accounts / passwords /
  recovery keys" line needs the password-primary / phrase-as-backstop clarification. This is
  the standard model (Proton, Bitwarden), but it is a conscious reversal of `sync.md` §4's
  "declined: a second user-held secret," and should read as one.
- `launch.md` Increments 2 and 3 — reshaped per §8.

Net: launch.md Increment 2 survives, but **reframed** — the nudge says "back up your data,"
not "save your recovery phrase," and it lands on a backup flow rather than on a reveal button.
Increment 3 merges into it.

**What would change this recommendation:** if the multi-user-per-client delta (§6) moves into
v0.1 scope, B stops being deferrable and should be built *before* the clients ship, since
retrofitting per-user local credentials after users exist is exactly the expensive class of
change this doc exists to avoid.

## 8. Two sub-decisions inside E

### 8.1 Re-auth is a *session*, not a nag (owner's framing, 2026-07-26)

Better than "ask occasionally." A session with an explicit lifetime is a pattern users
already hold ("stay signed in for 30 days"), it is inspectable, and it generalizes: the web
app needs real sessions anyway, and `product-truths.md` delta #3 ("log out = purge") needs a
login for logout to mean anything.

- **Default 30 days**, user-configurable in Settings — the safe-default-plus-dial shape
  `product-truths.md` already mandates. ~12 rehearsals a year is enough to keep a password
  alive without becoming friction.
- **"Never" is allowed, with a soft warning** that names the actual consequence: *you may
  forget your password, and it is how you get back in if this device is ever reset.* Not a
  scare — the honest reason.

Three things to get right:

1. **Expiry must be a real lock, not theater.** The keychain still holds `db-key`, so
   "expired" has to actually drop the unlocked state and gate the UI — otherwise relaunching
   the app walks straight past it. That means supporting a mid-session re-lock (close/reopen
   or gate the driver) in the desktop main process and in mobile's `core-context` bootstrap.
   This is the real implementation cost of the session model and it is easy to under-scope.
2. **Expiry must never brick anyone.** At the lock screen: password → in. *Forgot password?*
   → recovery phrase → in, then **force setting a new password**. Standard, and it keeps the
   phrase load-bearing. Without this, a convenience feature becomes a brand-new data-loss
   path — the exact irony this whole doc exists to avoid.
3. **Biometrics are the everyday door on mobile, not a session extension.** Face ID / Touch
   ID for convenience unlock, but a true expiry must demand the *password* — otherwise the
   credential is never rehearsed and observation (a) returns intact. This is precisely what
   1Password does, and for this reason.

### 8.2 Does the recovery phrase survive? Yes — demoted, not deleted

**Keep it. Stop advertising it. Show it once, inside signup.**

- **It must keep existing mechanically regardless of the decision.** The recovery key seals
  the at-rest sidecar from first launch, before any account exists. Defer *minting* it to
  signup and a pre-signup user has **no fallback at all** — strictly worse than today. Mint
  at first launch under every option; only the *surfacing* moves.
- **Dropping it means accepting that "forgot password" = total loss** for local-only users.
  The only alternative is server-escrow recovery (Tier 1, `model.md` §5–6), and a local-only
  user has no server. So the phrase is not redundant with the password — it is the only thing
  behind it.
- **They are complements, not duplicates:** the password is chosen and guessable, the phrase
  is generated and is not. That asymmetry is the entire point of keeping both.
- **It is already built and verified on both clients.** Removing it is work, not savings.

What changes is its *role*: it stops being a ritual the user must be taught at first run, and
becomes the forgot-password backstop shown once during signup — the role Proton and Bitwarden
users already recognize. That is the real win of E. The Settings reveal stays for users who
have not signed up yet.

> **Consequence for E's trigger threshold:** a user with data but no account is still on
> phrase-only custody, so the exposed window is exactly "has data, hasn't signed up." Fire the
> invitation **early** (first person added), not after some larger milestone.

## 9. What this decision blocks

- [`../launch.md`](../launch.md) **Increment 2** — its shape, size, and copy. Under **E** it
  stops being "a nudge" and becomes "deferred local signup," S → M–L.
- [`../launch.md`](../launch.md) **Increment 3** — merges into Increment 2 under D; under **E**
  it stays separate but becomes *more* load-bearing, since the sidecar then has two doors and
  both need an end-to-end restore proof (plus the negative case on each).
- `model.md` §7.1's first-launch table — rewritten under C, unchanged under A/B/D.
- `RecoveryGate` copy on both clients, under every option (it currently explains a phrase to
  someone who has likely never seen one).
