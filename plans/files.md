# Leapsake Files — encrypted blobs (photos first, every file type eventually)

> **Stable "why" doc** — the invariants for Leapsake's binary content (photos are the v0.2
> headline; then video, documents, audio). Nothing is built yet; the point is to pin these
> *before* code exists so v0.2 can't weld photo-specific decisions into what must stay a generic
> file layer. Status/sequencing: [`status.md`](./status.md). Crypto model it rides on:
> [`encryption/model.md`](./encryption/model.md) (§3 envelope, §11 sharing/blobs, §12 limits).

## Goals

One blob pattern for **all** file types (photos are the first consumer, not a special case); the
**same privacy as rows** (encrypted on-device, hosts store only ciphertext, offline-first);
SaaS-grade convenience (resumable background upload, fast gallery, sharing — the encryption stays
invisible); and **bulk export of originals** as a first-class exit story.

## The invariants (pin now, build at v0.2)

1. **Blobs never ride the row-sync channel.** Rows (`EncryptedRecord`) sync small sealed JSON;
   file bytes move over a **separate, content-addressed blob channel** so a multi-GB payload can't
   block or bloat row convergence.
2. **A `file` row references the blob; bytes live elsewhere.** The metadata row (id, blob ref,
   size, MIME, dimensions/duration, wrapped CK) is an ordinary syncable entity — one
   `defineSyncable`, LWW untouched. The reserved `wrappedKey` field on `EncryptedRecord`
   (`packages/data/src/sync-transport.ts`) is the hook: the row escalates to a per-item content
   key (`model.md` §3), and that same CK encrypts the blob.
3. **Chunked + resumable from day one.** Mobile background limits make non-resumable uploads fail
   at real library scale. Encrypt per-chunk with the chunk index bound into the AEAD's AAD (no
   silent reorder/drop), so a resume re-sends only missing chunks.
4. **All derived data is client-computed and encrypted.** Thumbnails, previews, waveforms,
   extracted text, embeddings, face clusters — a zero-knowledge host can't generate them and must
   never be able to (a thumbnail/embedding leaks nearly as much as the original). Clients compute
   on-device and store them as encrypted blobs/rows, mirroring how search/kinship already run on
   in-memory plaintext.
5. **Storage lives behind a `BlobStore` port.** Same adapter-swap discipline as `SqliteDriver` /
   `KeyStore` / `SyncTransport`: filesystem adapter first, S3-compatible for the hosted era, BYO
   bucket as the endgame. The relay/object store holds ciphertext chunks + access policy, never keys.

## Falls out for free

Sharing, revocation/expiry/visit-limits, and P2P all reuse the row mechanisms unchanged (wrap the
blob CK for a recipient / `#fragment` / server principal; host refuses to serve chunks; ciphertext
over an untrusted pipe — content addressing even suits P2P swarming). See `model.md` §11–12.

## Honest costs (accepted going in)

- **Metadata leaks more** — blob count/size/timing say more than row counts; still out of scope to
  hide (`model.md` §12), re-examine before scale claims (padding/bucketing are the tools).
- **Client-side compute** — thumbnailing/ML run on-device; budget it in v0.2 (thumbnails cheap,
  embeddings/face-grouping optional, not launch-gating).
- **No-JS SSR floor vs. media** — serving decrypted media to a no-JS browser means the render
  server transiently holds *file* keys; whether media is exempt from the no-JS floor is an open
  question below.
- **Hosting economics** — ciphertext blobs can't be cross-user deduped/compressed; quotas + the
  registration-token seam become load-bearing in the paid-relay era.

## Open questions (decide at build time)

- **Chunk format** — size, AEAD framing, existing streaming format (age/STREAM) vs. in-house seal
  with indexed AAD.
- **Content addressing vs. dedup** — address ciphertext (no cross-file dedup, no equality leak) vs.
  convergent plaintext hashing (dedup, but equality observable). Lean: address ciphertext; dedup
  client-side via a local plaintext hash in the `file` row.
- **Where derived data is computed** — first device to hold the original? opportunistically? do
  embeddings sync or recompute per device?
- **Platform transfer machinery** — iOS `URLSession` / Android WorkManager vs. app-level chunk
  loops; interacts with the sync scheduler.
- **Quotas & policy surface** for the paid relay (per-account storage, max blob size).
