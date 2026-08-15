# @leapsake/sync

The client half of V3 convergence: the `SyncTransport` port and its two adapters, the
registry-driven `SyncEngine`, and the scheduling layer above it. Depends on `data` for
**types only** (`SyncableRepo`, `SyncStateRepo`) plus `crypto` and `schema`.

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
