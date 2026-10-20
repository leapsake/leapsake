# Files and media — encrypted blobs, photos first

Nothing built. **Photos are the first consumer, not a special case**: one blob pattern for every
file type (then video, documents, audio), the same privacy as rows (encrypted on-device, hosts
store only ciphertext, offline-first), SaaS-grade convenience (resumable background upload, fast
gallery, sharing — the encryption stays invisible), and **bulk export of originals** as a
first-class exit story. Crypto it rides on: [`encryption/model.md`](./encryption/model.md) §3
(envelope), §11 (sharing/blobs), §12 (limits).

Photos are also layer 3's real consumer, so the `createCore` cleanup in
[`accounts-and-sync.md`](./accounts-and-sync.md) waits on this.

### The invariants — pinned before code exists, on purpose

So the first consumer cannot weld photo-specific decisions into what must stay a generic file layer:

1. **Blobs never ride the row-sync channel.** Rows (`EncryptedRecord`) sync small sealed JSON;
   file bytes move over a **separate, content-addressed blob channel**, so a multi-GB payload
   cannot block or bloat row convergence.
2. **A `file` row references the blob; bytes live elsewhere.** The metadata row (id, blob ref,
   size, MIME, dimensions/duration, wrapped CK) is an ordinary syncable entity — one
   `defineSyncable`, LWW untouched. The reserved `wrappedKey` field on `EncryptedRecord`
   (`packages/sync/src/transport.ts`) is the hook: the row escalates to a per-item content key,
   and that same CK encrypts the blob.
3. **Chunked + resumable from day one.** Mobile background limits make non-resumable uploads fail
   at real library scale. Encrypt per-chunk with the chunk index bound into the AEAD's AAD (no
   silent reorder or drop), so a resume re-sends only missing chunks.
4. **All derived data is client-computed and encrypted.** Thumbnails, previews, waveforms,
   extracted text, embeddings, face clusters — a zero-knowledge host cannot generate them and
   **must never be able to** (a thumbnail or embedding leaks nearly as much as the original).
   Clients compute on-device and store them as encrypted blobs/rows, mirroring how search and
   kinship already run on in-memory plaintext.
5. **Storage lives behind a `BlobStore` port** — the same adapter-swap discipline as
   `SqliteDriver` / `KeyStore` / `SyncTransport`. Filesystem adapter first, S3-compatible for the
   hosted era, BYO bucket as the endgame. The relay or object store holds ciphertext chunks +
   access policy, **never keys**.
6. **Check the one-content-key-per-entity index before the file schema is written.**
   `content_key_entity_active` allows one key per entity, but a shared album is one sharing unit
   spanning many rows and blobs. Changing it is a migration, not a re-encryption.

**Falls out for free:** sharing, revocation/expiry/visit-limits, and P2P all reuse the row
mechanisms unchanged — wrap the blob CK for a recipient, a `#fragment`, or a server principal;
the host refuses to serve chunks; ciphertext over an untrusted pipe, and content addressing even
suits P2P swarming.

### Honest costs, accepted going in

- **Metadata leaks more.** Blob count, size, and timing say more than row counts. Still out of
  scope to hide; re-examine before scale claims (padding and bucketing are the tools).
- **Client-side compute.** Thumbnailing and ML run on-device — thumbnails are cheap, embeddings
  and face-grouping are optional and not launch-gating.
- **Hosting economics.** Ciphertext blobs cannot be cross-user deduped or compressed, so quotas
  and the registration-token seam become load-bearing in the paid-relay era.
- ⚠️ **The no-JS floor vs. media.** Serving decrypted media to a no-JS browser means the render
  server transiently holds _file_ keys, and whether media is exempt from that floor is
  **undecided**. The web spike's SSR measurements are the input to this decision.

### The sharing question that shapes the schema _(raised 2026-07-27)_

A shared album is **bytes plus rows** — timestamps, location, and "who is in this photo." Two
consequences are easy to foreclose by accident, so decide both **before** the `file` schema is
written:

- **CK scoping.** `content_key` currently enforces _one CK per entity_. An album is a sharing
  unit spanning many rows _and_ blobs, which wants one CK per **unit**. A migration, not a
  re-encryption — but check it first ([`encryption/model.md`](./encryption/model.md) §2.2, and
  the warning on `contentKeySchema` in `packages/schema/src/content-key.ts`).
- **People tags — unsolved, and a data-model question rather than a crypto one.** "Who is in this
  photo" points at a Person row the recipient may have no right to read. Sharing an album with
  tags either leaks a contact reference or needs a **projection**: share the name, not the person
  record. **Do not let the file schema assume a shared album can dereference the owner's People
  rows.**

### Open, decide at build time

- **Chunk format** — size, AEAD framing, an existing streaming format (age/STREAM) vs. an
  in-house seal with indexed AAD.
- **Content addressing vs. dedup** — address ciphertext (no cross-file dedup, no equality leak)
  vs. convergent plaintext hashing (dedup, but equality observable). **Lean: address ciphertext**,
  and dedup client-side via a local plaintext hash in the `file` row.
- **Where derived data is computed** — first device to hold the original? opportunistically? do
  embeddings sync or recompute per device?
- **Platform transfer machinery** — iOS `URLSession` / Android WorkManager vs. app-level chunk
  loops. Interacts with the sync scheduler.
- **Quotas and the policy surface** for the paid relay (per-account storage, max blob size).
- **Its E2E flow.** Photos are the first domain-field consumer of the per-item content key, so
  they earn a catalog flow ([`apps/mobile/maestro/e2e/README.md`](../apps/mobile/maestro/e2e/README.md));
  Flow 2's milestone note is a plaintext column and proves none of it.
