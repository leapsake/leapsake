# @leapsake/sync

The client half of V3 convergence: the `SyncTransport` port and its two adapters, the
registry-driven `SyncEngine`, the scheduling layer above it, and the **account lifecycle over
a relay** (`account.ts`) — registering, joining, recovering, re-authenticating, running a
cycle, and the recovery-escrow round-trip. Depends on `data` for types plus `crypto`,
`schema`, and `key-custody` for the doors those flows open.

## Why it is its own package

Sync used to live in two places at once — the engine and transports inside
`@leapsake/data`, the scheduler inside `@leapsake/core` — so "how a row leaves and
re-enters this device" could not be read, or tested, as one thing. Neither half fit its
host: HTTPS transport and debounce policy are not persistence, and scheduling is not
composition.

Pulling them together also made a latent property structural: the blind relay
(`apps/server`) imports the **wire format** from here and no longer depends on
`@leapsake/data` in production at all. The relay cannot see the app's data layer because
it does not link against it.

## `account.ts` is dormant, deliberately

The relay half has **no caller today**: the clients' relay flows were deleted on 2026-09-17
and return in v0.2. It is kept, and kept tested (`apps/server/test/relay.test.ts` exercises it
against a live relay), so the rebuild starts from working code rather than from a diff.

**What syncs is not decided here.** `createAccountSyncEngine`, `runAccountSync` and
`reconcileOnJoin` take the allowlist as a `repos` argument; the allowlist itself is
`syncableRepos` in [`@leapsake/core`](../core/README.md), which is the composition root and
the one place that says which repositories may leave the device. A guard test pins that set.

## The four pieces

| Module              | What it is                                                         |
| ------------------- | ------------------------------------------------------------------ |
| `transport.ts`      | The `SyncTransport` port + `createInMemoryTransport` (tests)       |
| `http-transport.ts` | The authenticated HTTPS blind-relay adapter + the wire codec       |
| `engine.ts`         | Seal → push → pull → decrypt → apply, routed by table to each repo |
| `scheduler.ts`      | Debounced push kick, foreground pull trigger, interval backstop    |

The engine is **registry-driven**: it is handed a list of `SyncableRepo` and routes each
pulled record to the repo whose `table` it carries, so adding an entity to sync is one
more entry in that list — no engine change.

## What deliberately lives elsewhere

- **`defineSyncable` / `SyncableRepo`** stay in `@leapsake/data`. That is the primitive
  every repo is built on, not a sync concern; sync only consumes the type.
- **`SyncStateRepo`** stays in `@leapsake/data`. The watermarks live in an ordinary
  device-local `sync_state` table, and a repo belongs with the repos.
- **`syncableRepos()` and the account join/recover/register orchestration** stay in
  `@leapsake/core`. Deciding _what_ syncs means naming every repo, and the allowlist is
  the security-critical statement of which tables may leave the device — that is
  composition-root work. Importing it here would make this package depend on the entire
  entity surface it exists to stay independent of.

## The merge model, and the cost it accepts

**Whole-row last-writer-wins on `updatedAt`, with tombstones.** The relay is blind,
so it can neither merge nor order content — all reconciliation happens here, on the
client, over decrypted rows. The resolver is `resolveMerge` in
[`@leapsake/schema`](../schema/README.md) (`merge.ts`); this package only feeds it.

Why LWW rather than a CRDT: this is a **single-user, few-device personal CRM**, where
true concurrent edits to the same record are rare. At that workload row-level LWW is
usually indistinguishable from a CRDT in practice, adds **zero dependencies**, and needs
no columns the schema does not already carry. Automerge is the strongest escalation
candidate if that stops being true — but it is a *document* model, so adopting it means
encrypting Automerge updates as `EncryptedRecord` blobs and reconciling that with the
row/repository model. A real fork, worth taking only once justified.

**The cost, accepted knowingly:** two devices that edit *different fields of the same
row* inside one sync gap keep only the higher-`updatedAt` row — the other field change
is lost. This is characterized and asserted in `merge.test.ts` rather than left to
discovery. Per-field LWW was considered and deferred: it needs a per-field clock store,
write-path stamping in every repo, and trickier resurrection rules, all to shrink an
already-rare window. It stays available as an *additive, per-entity* escalation, because
the whole-row `updatedAt` is a valid field-clock floor — a missing field clock falls
back to it and old rows keep working.

## How a second device gets the master key

Not through this package's sync log — every record in it is sealed under MK, which a
fresh device does not have. The key travels a **separate account-level channel on the
same relay** (`http-transport.ts`'s bootstrap calls, orchestrated by
[`@leapsake/key-custody`](../key-custody/README.md)): device 1 uploads
`wrap(MK, password-KEK)` keyed by a unique username, and a joining device looks the
account up (prelogin → public salt), derives the same KEK from the password, fetches the
wrapped MK and unwraps it locally. The relay holds only the public salt,
`sha256(verifier)` and ciphertext, so it stays blind throughout. The scheme's rationale
and its accepted costs are [`apps/server/README.md`](../../apps/server/README.md) →
*Why username + password*.

No new key material is minted on that path — the account, its password door and its
recovery key all exist before a relay is ever bound. A joining device **keeps** its local
data: the join pulls the account, detects the duplicates it introduced, and sends them to
review ([`@leapsake/core`](../core/README.md)).

## What must stay true for P2P to remain possible

True peer-to-peer is a deferred second adapter, not a closed door
([`plans/encryption/sync.md`](../../plans/encryption/sync.md)). Four invariants keep it
free to add, and code in this package is where three of them are won or lost:

1. **Encrypt before transport** — a peer is just another dumb pipe for the same
   ciphertext.
2. **Merge stays client-side and order-independent.** The thing that would quietly weld
   the door shut is depending on a **server-authoritative sequence number or clock** for
   ordering. `Cursor` is the transport's own *delivery* order and must never be read as
   a content clock.
3. **Everything goes through the `SyncTransport` port**, so a new transport is an
   adapter, not a rewrite.
4. **Identity is by keypair** — `device.public_key` can double as a P2P node identity,
   so no schema change is owed.

## What the relay may forget, and what it must not

Nothing prunes the relay's append log today: `append` only inserts, so the log holds every
version of every row ever pushed. Two invariants bind any retention design, and both follow
from the merge model above. The full exploration, including a spool/archive split, is in git
(`git log --all -- plans/encryption/prune.md`).

1. **Minimum-cursor pruning silently corrupts joining devices.** A device joining through
   bootstrap starts at cursor 0 and rebuilds its whole database from the log; existing devices
   cannot repair a gap, because their push mark is already past the old rows. Delete the last
   copy of a live row and that row no longer exists for **any future device** until someone
   happens to edit it again, with no error anywhere. A prune is safe only if, for every live
   row, one copy of the winning version survives somewhere a cursor-0 device can pull it.
2. **Compaction must compare `updatedAt`, never `seq`, and the comparison must be strict.**
   `seq` orders delivery; `updatedAt` orders content. Keeping the highest-`seq` copy discards
   the LWW winner whenever an offline device pushes an older edit later, and every device that
   joins from then on converges on the loser: the fleet is split permanently, by the relay. On
   an `updatedAt` tie keep **both** copies, because clients break ties by canonical
   serialization of the decrypted row, which the relay cannot compute.

Supersede-on-push compaction under those two rules (delete same-row records with a strictly
lower `updatedAt`, in the same transaction as the insert) is invisible to convergence and needs
no device tracking. Its price is metadata: the relay must see a row key and `updatedAt` in
cleartext. A blinded key, `HMAC(MK, table ‖ id)`, keeps the table and row identity hidden;
`updatedAt` stays visible, and that residue is the cost of any server-side retention at all.
