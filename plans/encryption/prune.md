# Leapsake — Relay Retention & Pruning

> **Status: exploratory. Nothing here is decided, and nothing here is built.**
> This is a **pre-v0.1 design discussion**, recorded so the reasoning survives — not a
> decision record like its four siblings in this folder. Where [`model.md`](./model.md)
> and [`sync.md`](./sync.md) say *"decided, do not relitigate"*, this doc says *"here is
> the shape of the problem and what a good answer probably looks like."* Treat every
> recommendation below as a proposal awaiting an owner decision (see **§8**).
>
> **Why it exists.** [`sync.md`](./sync.md) §2 designs the relay to be **disposable** —
> "losing `relay.db` costs at most one re-join per device." That is true of the *design*
> and false of the *build*: nothing ever deletes from the relay's append log. This doc is
> about closing that gap, and about what "as stateless as possible" can actually mean for
> a host that is also meant to become a backup conduit.
>
> **Scope.** Server-side retention only. It does not touch the envelope
> ([`model.md`](./model.md) §3), the merge model ([`sync.md`](./sync.md) §4), or custody
> ([`model.md`](./model.md) §7) — but it is constrained by all three, and §3 below shows
> the merge model doing most of the work.
>
> For what is built and what is next, see the single status oracle
> [`../status.md`](../status.md). This doc deliberately records no status.

---

## 1. The problem: the log is doing three jobs

`relay_record` ([`apps/server/src/store.ts`](../../apps/server/src/store.ts)) is an
append-only log. `append` only ever inserts; there is no prune, no TTL, and no retention
policy anywhere in [`apps/server/src`](../../apps/server/src). In practice it accumulates
every version of every row ever written, for the life of the account.

That single table is silently serving three different purposes:

| Job | What it needs | Lifetime it wants |
|---|---|---|
| **Delivery spool** — get a change from device A to device B | the newest change, until every device has it | days |
| **Bootstrap seed** — let a device joining via `/accounts/bootstrap` rebuild the DB | one copy of every live row, forever | permanent |
| **Backup** — survive the loss of every device | one copy of every live row, durably | permanent |

Three jobs, one table, one retention policy — and because the strictest of the three is
"permanent," the whole thing is permanent. This is the root cause of both the unbounded
storage growth *and* the mismatch with
[`packages/sync/src/relay-capabilities.ts`](../../packages/sync/src/relay-capabilities.ts),
which honestly reports `durableBackup: false` while the relay is, in fact, holding a
complete durable copy of the account.

**The first move in any prune design is separating those three jobs.** Cursor bookkeeping
is the second move at best, and §2 shows why it cannot be the first.

---

## 2. The trap: minimum-cursor pruning silently corrupts joining devices

The obvious design — track each device's pull cursor, delete everything below the
minimum — is wrong here, and it fails quietly rather than loudly. Recorded so nobody
implements it by reflex.

A device joining through `GET /accounts/bootstrap` receives the wrapped master key and a
session, then starts from **cursor 0** and reconstructs the entire database by pulling the
log from the beginning ([`packages/sync/src/engine.ts`](../../packages/sync/src/engine.ts),
`pull`). The log *is* its only source of state.

Existing devices cannot repair a gap. `push` sends rows changed after the persisted
push high-water mark (`sync_state`, via
[`packages/data/src/sync-state-repo.ts`](../../packages/data/src/sync-state-repo.ts)), and
that mark is already past any old row. So:

> Delete a record from the log, and the row it carried does not exist for **any future
> device** until someone happens to edit that row again.

No error, no warning — the joining device just ends up with a smaller database than every
other device, and stays that way indefinitely. Any prune that can remove the last copy of
a live row has this failure mode, regardless of how carefully the cursors are tracked.

**The constraint this establishes:** a prune is only safe if, for every live row, at least
one copy of the winning version survives *somewhere the relay can serve to a device
starting at cursor 0*.

---

## 3. Tier 1 — supersede-on-push compaction (no device knowledge required)

The question that motivated this doc was *"how does the relay learn device cursors without
learning about devices?"* For the dominant source of growth, the answer is that **it does
not have to.**

### 3.1 Why the merge model licenses this

Merge is whole-row LWW ([`sync.md`](./sync.md) §4,
[`packages/schema/src/merge.ts`](../../packages/schema/src/merge.ts)). For a given row,
only the highest-`updatedAt` copy can ever affect the converged state. Every older copy in
the log is dead weight: a device that pulls all of them folds them through `resolveMerge`
and lands on exactly the same result as a device that pulls only the newest one.

So the relay can delete superseded copies **without knowing who has pulled what**. Storage
goes from *O(every edit ever made)* to *O(rows that currently exist)*. For a personal CRM
where a contact is touched dozens of times over a couple of years, that is dozens of
records collapsing to one, and it satisfies §2's constraint by construction — the winning
version of every live row always survives.

### 3.2 The predicate must be `updatedAt`, not `seq`

The tempting rule is "keep the highest `seq` per row." It is wrong, and it *causes* data
divergence rather than merely failing to prevent it:

- Device A edits row X at `updatedAt = 100`, pushes → `seq 20`.
- Device B, offline, had edited row X at `updatedAt = 90`; it reconnects and pushes → `seq 21`.
- A max-`seq` compaction keeps `seq 21` (`updatedAt 90`) and deletes `seq 20` (`updatedAt 100`).

The relay has now discarded the true LWW winner. Device A still holds `updatedAt 100`
locally and will never re-push it (its push mark is past it). Every device that joins from
here converges on `updatedAt 90`. The fleet is permanently split, and the relay caused it.

`seq` orders **delivery**; `updatedAt` orders **content**. Compaction is a content
decision, so it must use the content clock — which is the same distinction
[`sync.md`](./sync.md) §3 invariant 2 already draws for a different reason.

### 3.3 The rule

Delete only records for the same row with a **strictly lower** `updatedAt`:

```sql
DELETE FROM relay_record
 WHERE account_id = ? AND row_key = ? AND updated_at < ?
```

**Strictness is load-bearing.** On an `updatedAt` tie, clients break the tie by canonical
serialization of the decrypted row (`resolveMerge`) — an ordering the relay cannot compute,
because it cannot decrypt. If the relay picked a tie winner it could pick the opposite one
from the clients and reintroduce §3.2's divergence. Keeping *both* sides of a tie is always
safe: the clients still receive the pair and still agree. Ties are rare
(same-millisecond writes to one row), so the redundancy costs nothing.

With that rule, the surviving set always contains the record the clients would have chosen,
so **compaction is invisible to convergence**. That is the property to assert in tests.

### 3.4 Implementation shape

Run it **inside `append`**, in the same transaction as the insert — one `DELETE` per pushed
record. No background sweep, no new endpoint, no scheduler, no operational surface.

- Needs one new index, `(account_id, row_key)`. The existing
  `relay_record_account_seq (account_id, seq)` stays as-is for `pull`.
- **Cursors are unaffected.** `seq` is never reused or lowered, so a device whose persisted
  cursor points at a now-deleted `seq` still evaluates `seq > since` correctly. Holes in the
  sequence are harmless, and `pull`'s `cursor = rows[last].seq ?? since` still advances.
- **A stale push is self-correcting.** If an arriving record is *older* than what is stored,
  the `DELETE` matches nothing and both rows coexist until the next push for that row. Always
  correct, occasionally redundant. Suppressing the insert instead is a possible optimization,
  not a requirement.
- **Tombstones survive on their own merits.** A soft delete bumps `updatedAt`, so the
  tombstone *is* the newest copy of its row and compaction keeps it. No special case.

---

## 4. The metadata trade compaction forces

Compaction is not free of metadata consequences, and the trade cuts both ways.

The relay currently receives five cleartext fields per record (`wireRecordSchema`,
[`apps/server/src/relay.ts`](../../apps/server/src/relay.ts)): `id`, `table`, `updatedAt`,
`deletedAt`, `ciphertext`. Of these it **uses none** — ordering is `seq` alone, and `append`
does not dedupe. On the client, `engine.ts` reads only `table` (to route a pulled record to
its repo) and `ciphertext`. So four fields are, today, pure metadata leak with no function
on either side.

Compaction changes that calculus by *needing* two of them — but a blinded row key recovers
most of the ground:

| Field | Under compaction | Proposal |
|---|---|---|
| `id` + `table` | needed, to know which records supersede each other | replace with an opaque **`row_key` = `HMAC(MK, table ‖ id)`**. Deterministic under the shared master key, so every device agrees; the relay can group by equality without learning the table, the row, or the entity type. Routing stays client-side after decrypt. |
| `updatedAt` | **needed** — it is the comparison the prune depends on (§3.2) | stays cleartext. This is the real cost of server-side compaction and should be stated plainly rather than glossed. |
| `deletedAt` | not needed — a tombstone is just the newest copy of its row | move inside the envelope. |

**Net posture after Tier 1:** the relay sees an account's current row count and the
last-modified time of each (unidentifiable) row. It loses edit *history*, edit *frequency*,
table names, and row identity entirely. A meaningful reduction, not a total one — and the
residual (`updatedAt`) is the price of the relay doing any content-aware retention at all.
A relay that must stay blind to *when* would have to push compaction to the clients, which
is a different and much larger design.

**Wire compatibility.** `row_key` changes `EncryptedRecord`
([`packages/sync/src/transport.ts`](../../packages/sync/src/transport.ts)), the relay
schema, and both clients together. Per the standing pre-v0.1 posture, a clean break beats a
migration or a compatibility shim here.

---

## 5. What Tier 1 buys, and what it does not

**Buys**

- Storage bounded by the dataset instead of by its history — the actual cost problem.
- Zero device tracking: no new identifiers, no presence metadata, no eviction policy, no
  stale-device edge cases.
- Joining devices keep working, unchanged — they still receive exactly one copy of every
  live row (§3.1 satisfies §2's constraint).
- Offline devices keep working and receive the correct final state.
- Edit history and edit timing stop accumulating on the relay.

**Does not buy**

- The relay still holds **one complete encrypted copy of current account data**,
  indefinitely. Compaction bounds *cost*; it barely moves *liability*.
- What it really does is convert an *accidental* backup into an **intentional, bounded**
  one. That is an improvement in honesty as much as in bytes — and it is what would let a
  backed-up relay finally answer `durableBackup: true` truthfully, closing the open protocol
  question that `relay-capabilities.ts` is already written against.

---

## 6. Tier 2 — the mailbox, and why it needs a partner

"The relay holds nothing once every device is current" is the end state that matches the
stateless instinct. It does require cursors — and cursors alone are still not enough.

**The proof:** row X was last written at `seq 5` and never touched again. Every live device
is at cursor 100. Pruning below the minimum cursor deletes `seq 5`. A device joining
tomorrow never learns row X exists — §2's failure, reintroduced. Minimum-cursor pruning
deletes rows precisely *because* they are settled, which is exactly when they are most load-
bearing for a future joiner.

So a mailbox relay is only coherent when paired with one of:

- **A snapshot** — a per-account compacted ciphertext blob, rewritten periodically by a
  device, which becomes the bootstrap source instead of the log. The spool then holds only
  undelivered deltas and can be pruned hard. Note that this *is* the backup product, so the
  prune design and the backup roadmap converge on one artifact.
- **Device-to-device pairing** — new devices are seeded by an existing device over QR/LAN
  rather than from the relay, so the relay never needs to hold a bootstrap seed at all. This
  is the maximally-stateless end state, and it is the deferred high-entropy-code / QR-pairing
  door from [`sync.md`](./sync.md) §4 meeting the deferred P2P transport from §3. It trades
  the "join from anywhere with just a password" property for it, which is a product decision,
  not a technical one.

**Tier 2's honest cost.** Per-device cursors mean a durable row per device, which hands the
relay device *count* per account and *last-sync times* — presence and behaviour signals not
leaked today. It also needs a staleness eviction TTL, since one dead device otherwise pins
the minimum forever. The one genuinely nice property: **Tier 1 makes eviction safe.** A
device evicted while offline and returning later simply receives the newest copy of every
row, which is where LWW would have put it regardless.

---

## 7. Proposed sequencing (not decided)

1. **Tier 1 first.** Small, provably convergence-neutral, no new concepts, and it removes the
   unbounded growth. It is also a strict prerequisite for Tier 2 — both for storage sanity and
   for making eviction safe.
2. **Decide what backup is** before Tier 2. The snapshot is the shared dependency; committing
   to it makes Tier 2 mostly bookkeeping, while committing to device pairing instead makes it
   a P2P story. Choosing Tier 2's shape before that decision is choosing the backup product by
   accident — which is exactly how the current situation arose.

---

## 8. Open questions

Every one of these is **open and pre-v0.1**. None blocks v0.1, since v0.1 sync is
self-host-only and the relay's growth is a self-hoster's own disk.

**Tier 1 (would need deciding before building it)**

- **Is `updatedAt` in cleartext an acceptable permanent cost?** §4 accepts it to buy
  server-side compaction. The alternative — a fully blind relay that cannot compact — pushes
  retention onto the clients or onto Tier 2. Owner decision.
- **Should `row_key` be `HMAC(MK, table ‖ id)`, or something with a rotation story?** It is
  stable for the life of the account, so it is a long-lived correlator for anyone who obtains
  the relay's store. Rotation would mean rewriting every record's key.
- **Does compaction change what a hostile relay can do?** It grants the relay a *sanctioned*
  reason to delete records. The convergence-neutrality argument (§3.3) holds for an honest
  relay; the adversarial case belongs with the existing M3-class analysis in
  [`security-findings.md`](./security-findings.md) and has not been done.
- **Tombstone garbage collection.** Tombstones are kept forever under §3.4. Dropping them
  after a long retention window would shrink the store further, but reopens the classic
  resurrection window for a device offline across the boundary. Not analysed here.
- **Should a tombstone's `ciphertext` be shrunk to empty on compaction?** The client currently
  decrypts every record to apply it, so this needs a client-side "tombstone without payload"
  path. Cheap bytes, non-trivial client change.

**Tier 2 (blocked on a product decision, not a technical one)**

- **Snapshot or pairing?** §6. This is the fork that decides everything downstream, and it is
  really the question *"what is Leapsake's backup product?"* in disguise.
- **If snapshot: who writes it, and how often?** Any device can, but concurrent rewrites need
  an ordering rule, and a device that is itself out of date must not be allowed to publish a
  regressive snapshot.
- **Is per-account device count an acceptable metadata leak?** §6. It is new information the
  relay does not have today, and it is the kind of thing the blind-relay posture exists to
  avoid.
- **What is the eviction TTL, and does the user ever see it?** "Your other device has been
  offline long enough that it will re-sync from scratch" may be a UX event, not just a
  server-side policy.

**Cross-cutting**

- **Does any of this change the `/capabilities` shape?** [`../status.md`](../status.md) →
  *Open questions* → Custody already carries the undecided server half of relay backup
  capability. Tier 1 makes `durableBackup: true` a truthful answer for a backed-up relay for
  the first time; Tier 2 makes it a *configurable* one. The two questions should probably be
  decided together.
