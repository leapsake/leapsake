# Accounts and sync — what is unbuilt

Design lives in [`encryption/`](./encryption/); this is only the work. The relay half of the
clients is not in the build today.

## The user model, where the build has not caught up

The intended destination is recorded in [`@leapsake/key-custody`](../packages/key-custody/README.md)
→ _The product model this serves_. These are the parts the code does **not** yet do — conscious
deferrals, not surprises.

- **Multiple authenticated users per client, with per-user data isolation.** Today a client is
  implicitly single-user. Hosting several needs one store per account so data cannot bleed and can
  be purged independently. ⚠️ **The per-account _path_ is already built** — new
  code must not assume a single fixed database path
  ([`@leapsake/store-layout`](../packages/store-layout/README.md)). What remains is the
  multi-user surface on top of it: a login picker, switching, and per-user purge.
- **User-toggleable encryption beyond custody.** Opting _out_ while holding an account — trading
  end-to-end encryption for server-side features like server-side search — is a **trust-model
  fork, not a free dial**. This argues against per-field content-key encryption on new entities:
  encryption should trend toward a user-level **layer** choice. It is also the reason
  [`@leapsake/key-custody`](../packages/key-custody/README.md)'s custody vocabulary keeps the account axis and the file axis
  separate, even though they always agree today.
- **Finer sharing granularity** is [`web-and-sharing.md`](./web-and-sharing.md).

## Sync and the relay

**First, and before anything else in this section: rebuild the client half of sync.** The
platform-neutral half is all still here and tested — `@leapsake/sync`, `apps/server`,
`@leapsake/key-custody`, and the relay orchestration in core — but both clients' flows, settings
screens and relay tests were deleted on 2026-09-17. They are at the tag `relay-clients-final`,
and _how they should be built next time_ is the next paragraph. **Do that before building on
top of sync**; everything else in this section assumes it has happened.

**The rebuild.** The two clients at `relay-clients-final` implement the same 17-method surface
independently. The platform-specific part is small and already isolated by `key-custody`'s port
style: **where bytes land** (a sidecar file beside the store on desktop, a row in `doors.db` on
mobile), **how a store is copied under a new key** (`convert-store.ts` in each client), and **the
keystore**. Everything else — the state machine of signup → login → recover → merge, the 409 fork
in "start syncing", the store swap during a join, the reconcile-on-join dedup — is identical and
should be written once:

- A package `@leapsake/account-flows` (or a second entry point of `key-custody`) exporting
  `createAccountApi(ports)` where `ports` is `{ driver, keyStore, storeFiles, doorWriters,
  scheduler }`. Both clients bind ports and expose the result over IPC / context unchanged.
- The settings steps as headless state hooks in `@leapsake/ui/headless`, with a web and a native
  rendering each.
- Tests against the fake relay live once, in the package, not in `apps/desktop/test`.

**Compact tombstones once several devices sync.** Nothing is ever purged: every deleted row stays
as a tombstone, and a discarded draft adds its own while an account exists (with none, a draft is
removed outright, since nothing has left the device). A tombstone may go only once every device
has synced past it, which needs each device's sync progress. Tombstones on deterministic ids carry
meaning — a dismissed system reminder, a hidden holiday — and purging one brings back what it
suppressed, so those need a rule of their own before anything is removed.

**Kick pushes on observed writes, not method names.** `withSyncKick` decides what is a write from
a name list (`MUTATING_METHOD` in `@leapsake/sync`) that must grow by hand. The driver could raise
a dirty flag on `run`/`exec` instead, and kick when a wrapped call flips it, so there is no list
to keep. It needs a decision about writes that should _not_ push: migrations, and internal
reconciles such as `regenerateSystem` that ride their caller's kick.

**Merge by recovery phrase — decide with the rebuild.** `recoverAccount` refuses a device that
already holds an account exactly as `joinAccount` does, so merging by phrase needs the same
copy-first treatment and is a second full flow on both clients. The gap: a user who has the
account's **phrase** but not its password must recover on their _other_ device first, which is
fine unless that device is the one they lost. Leaning ship-without (password-plus-a-second-
device covers the realistic case, and the flow it would duplicate is the most delicate one we
have), but it is a real hole in the _cannot strand anyone_ promise. Moot until the relay
clients return, since there is no merge without them. **Flow 7a is decided with this, not separately.** Context:
[`@leapsake/key-custody`](../packages/key-custody/README.md) → _Not built: merge by recovery
phrase_.

**Flow 7a, the E2E flow sync adds** to the
[crucial-flow catalog](../apps/mobile/maestro/e2e/README.md): on a synced account, take the
phrase captured there to a **fresh** device, recover by phrase, and set a new password. Assert
the device reads the account's data, is forced to set a new password, and that a _wrong_ phrase
is rejected with a visible error before anything is written. It is the catalog's first
two-device flow, so two questions travel with it: whether the second instance is a second
emulator/simulator or a headless core, and which relay the run points at (an ephemeral local
`@leapsake/server` boot per run is the vendor-neutral default).

**Near-term, none of it blocking:**

- **Shared cross-process rate-limit counter.** Today's limiters _and_ the session store are
  in-memory and per-process; a multi-node relay collapses them.
- **Relay disposability and retention.** Losing `relay.db` must never lose user data: content
  already lives on devices, so close the gap by having devices **self-heal the account row +
  recovery escrow** on sync, and a relay wipe costs one re-join. The append log also never
  shrinks; the two invariants any prune must honour, and the compaction that satisfies them,
  are [`@leapsake/sync`](../packages/sync/README.md) → _What the relay may forget_. Compaction
  is also a prerequisite for a cold-per-request web host ([`web-and-sharing.md`](./web-and-sharing.md)).
- **CK revocation / GC on entity delete** — sync-era cleanup that stops orphaned keys.
- **True background-fetch sync**, plus a configurable sync-interval UI.
- **Cleanup:** `createCore(driver, keySession?)` no longer reads its key session. The parameter
  and the clients' "rebuild the core around the adopted MK" plumbing are inert. Left in place on
  purpose (photos are layer 3's real consumer), so **simplify it whenever layer 3 next gets
  attention.**
- **Relay backup capability** — the client half is built (`fetchRelayCapabilities` GETs
  `/capabilities` and falls back to "no"); the **server** side is undecided, so no relay serves it
  and every user sees the last-device deletion warning. That default is the safe one.

**Still-open security findings.** None gates the build today, because sync is self-host-only
and the operator is the user themselves:

- **Raise the Argon2id cost.** The interactive-login floor is doing duty as the _encryption_
  strength — the reasoning and the fact that `KDF_ALG` versioning makes a bump free are in
  [`../packages/crypto/README.md`](../packages/crypto/README.md) → _Pinned algorithms_. Needs one
  measurement of Hermes headroom, then a number.
- **Wipe the KEK and transient wrap keys after use.** The master key cannot be zeroized in a GC'd
  runtime and that is an accepted limit (`packages/key-custody/src/session.ts`), but the KEK is
  derived-then-used-once in `enableSync`/`unlock*` and is cheap to clear. Audit the log and
  error paths in the same pass, so no key-bearing object can be stringified into a crash report.
- **Local backpressure on recovery-phrase entry.** The relay throttles the recovery routes well;
  on-device `unlockWithRecoveryKey` and the phrase-entry UI gate the master key with no attempt
  limiting at all. Less urgent than the password path (the phrase is 256-bit), but the asymmetry
  is the point: passwords get a 12-char floor plus Argon2id, the phrase gets neither locally.
- **Per-device relay credentials and replay defense.** Revoking one device still means changing
  the password, because the credential is per-account. Sessions are also per-process in-memory,
  so a multi-node relay needs a shared session store — the same shape of fix as the rate-limit
  counter above. Sequence this with _Device management_ below.

**Automatic locking on idle, and the bounded session** _(owner, 2026-07-27)_. The
deliberate half (sign out) is built. A real session needs mid-session re-lock in the desktop main
process and in mobile's bootstrap, and it must not be theater, since the keychain still holds the
db-key. Not a one-way door — it sits on the same password door. Deferred with it: **session
lifetime and its dial**, **biometrics on mobile** as the everyday unlock with a true expiry still
demanding the password, and **auto-purge of an idle logged-in device**.

## Before any hosted relay, and after it

In dependency order:

1. **Hosted-relay gate** — before any official or paid relay stores other people's data: **OPAQUE**
   login, Tier-1 server-escrow recovery (email/password reset as an opt-in dial), quotas /
   registration-token enforcement, and the shared rate-limit counter above.

   **Why OPAQUE is a gate rather than a polish item.** Today the relay receives the raw auth
   verifier on every authenticated request and permanently stores `kdfSalt` and
   `wrap(MK, KEK)`. An operator — or anything at TLS termination, or an access log that captures
   headers — can therefore run, entirely offline and per candidate password:
   `guess → Argon2id → HKDF auth branch → compare to an observed verifier`, then on a hit
   `HKDF kek branch → unwrap wrap(MK, KEK) → decrypt the account`. So "zero-knowledge against
   the relay" currently reduces to _password strength stretched by one interactive-strength
   Argon2id pass_ — which is true enough when the operator is the user, and not true at all the
   moment it is us. Session tokens (built) shrink the observation window to once per login;
   OPAQUE is what makes the claim hold against the adversary the model actually names. The
   decision, the alternatives weighed, and the honest residual — a maximally malicious operator
   can still _actively_ grind with its own OPRF key — are in
   [`encryption/sync.md`](./encryption/sync.md) §2. A client-held
   Secret Key pepper would close it fully and was **declined as a default** (a second user-held
   secret breaks password-only join); at most an opt-in dial, after passkeys.

2. **Custody doors, in preference order** _(decided 2026-07-05)_: **passkeys (WebAuthn PRF)** as an
   additional unlock door — supported, _not_ the default. A 1Password-style Secret Key is
   deliberately **not** planned as a default. Also the high-entropy sync-code / QR-pairing door,
   and username reconciliation across relays.
3. **Device management** — per-device revocation and master-key rotation (the lost-phone story).
   **Grows in importance with photos ([`media.md`](./media.md)), so track it before then.** Carries one leftover from the
   account merge: **does a retired local account leave a tombstone?** Retiring it in the roster is
   enough for the device, but nothing yet decides whether the relay should learn that a local
   account id was folded into a synced one. Nothing depends on it today; it starts to matter as
   soon as a user can enumerate their devices.

_Open:_ **metadata minimization** (out of scope for V3 — revisit before privacy-first marketing
at scale, and again before photos).
