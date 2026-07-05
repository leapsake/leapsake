# Leapsake Files — encrypted blobs (photos first, every file type eventually)

> **This is a *stable* "why" doc** — the design invariants for how Leapsake will handle
> binary content: photos (the v0.2 headline), then video, documents, audio, and anything
> else. Nothing here is built; the point of writing it now is the same as
> [`encryption/sync.md`](./encryption/sync.md)'s P2P section — **pin the invariants before
> any code exists so v0.2 can't accidentally weld photo-specific decisions into what must
> stay a generic file layer.** Build status and sequencing live in
> [`status.md`](./status.md); the crypto model this rides on is
> [`encryption/model.md`](./encryption/model.md) (§3 envelope, §11 sharing/blobs, §12 limits).

## 1. Goals

- **One pattern for all file types.** Photos are the first consumer, not a special case —
  the same blob layer must later serve video, documents, and audio without redesign.
- **The same privacy properties as rows.** Encrypted on-device before anything leaves it;
  any host stores only ciphertext; offline-first (a device's own files are always usable
  with no server).
- **SaaS-grade convenience.** Background upload that survives interruptions and app
  restarts, fast gallery browsing, and sharing — a layperson should never feel the
  encryption underneath.
- **Portability is non-negotiable.** Originals must always be exportable, in bulk, by the
  user — the exit story is a feature, not an afterthought.

## 2. The invariants (pin now, build at v0.2)

1. **Blobs never ride the row-sync channel.** The sync engine moves small sealed-JSON rows
   (`EncryptedRecord`); file bytes move over a **separate blob channel** — content-
   addressed, uploaded/downloaded independently of row sync. A multi-MB (or multi-GB)
   payload must never block or bloat row convergence.
2. **A `file` row references the blob; bytes live elsewhere.** The metadata row (id, blob
   reference, size, MIME type, dimensions/duration, the wrapped content key) is an ordinary
   syncable entity — one `defineSyncable` registration, LWW merge untouched. The
   already-reserved `wrappedKey` field on `EncryptedRecord`
   (`packages/data/src/sync-transport.ts`) is the designed hook: the row escalates to a
   per-item content key (`model.md` §3), and that same CK encrypts the blob.
3. **Chunked + resumable transfer from day one.** Mobile background-execution limits make
   non-resumable uploads fail routinely at real library scale (the classic failure mode of
   media-sync apps); large videos make it certain. Encrypt per-chunk (chunk index bound
   into the AEAD's associated data so chunks can't be reordered/dropped silently) so a
   resume re-uploads only missing chunks, never the whole file.
4. **All derived data is client-computed and encrypted.** Thumbnails, previews, waveforms,
   extracted text, ML embeddings, face clusters — a zero-knowledge host *cannot* generate
   them, and must never be given the ability to (a thumbnail or an embedding leaks nearly
   as much as the original). Clients compute derivatives on-device and store/sync them as
   encrypted blobs/rows like everything else. (This is the accepted cost of E2EE media:
   search-by-content and face grouping run on the user's devices, mirroring how
   search/kinship already run on in-memory plaintext today.)
5. **Storage lives behind a `BlobStore` port.** The same adapter-swap discipline as
   `SqliteDriver` / `KeyStore` / `SyncTransport`: a filesystem adapter on the self-hosted
   relay first, an S3-compatible adapter for the hosted era, "bring your own bucket" as the
   customizability endgame — all invisible above the port. The relay stays blind either
   way: it (or the object store) holds ciphertext chunks and access policy, never keys.

## 3. What falls out for free

- **Sharing** is the existing mechanism, unchanged: wrap the blob's content key for a
  recipient's public key, a URL `#fragment`, or a constrained server principal
  (`model.md` §11). A shared album is a share bundle of file CKs.
- **Revocation / expiry / visit limits** are the same server-enforced delivery policy as
  row shares (`model.md` §12) — the host refuses to serve chunks.
- **P2P later** works for blobs exactly as for rows: ciphertext over an untrusted pipe;
  content addressing even suits P2P swarming better than rows do.

## 4. Honest costs (accepted going in)

- **Metadata leaks more.** Blob count, sizes, and upload timing say more about a photo/video
  library than row counts say about contacts. Still out of scope to hide (per `model.md`
  §12), but it must be re-examined before privacy-first claims at scale — padding/bucketing
  are the eventual tools.
- **Client-side compute.** Thumbnailing and any ML happen on the user's devices; older
  phones will feel it. Budget it in v0.2 scoping (thumbnails are cheap; embeddings/face
  grouping are optional features, not launch requirements).
- **The no-JS SSR floor vs. media.** Serving decrypted media to a no-JS browser means the
  render server transiently holds *file* keys — a starker trade than person-card HTML.
  Whether media is exempt from the no-JS floor (JS required for gallery decryption, the
  Stage-4 progressive-enhancement model applying per-content-type) is an open question below.
- **Hosting economics.** Ciphertext blobs mean the host can't dedupe across users or
  compress; storage/bandwidth quotas and the registration-token seam become load-bearing in
  the paid-relay era.

## 5. Open questions (decide at build time, not before)

- **Chunk format** — chunk size, AEAD framing, whether to adopt an existing streaming
  format (age/STREAM-style) vs. the in-house seal with indexed AAD.
- **Content addressing vs. dedup** — addressing ciphertext (random per-encryption → no
  cross-file dedup, no equality leaks) vs. convergent-style plaintext hashing (dedup, but
  equality is observable). Default lean: address ciphertext; dedup only client-side via a
  local plaintext hash in the `file` row.
- **Where derived data is computed** — first device to hold the original? Any device
  opportunistically? Do embeddings sync or recompute per device?
- **Platform transfer machinery** — iOS `URLSession` background transfer / Android
  WorkManager vs. app-level chunk loops; interacts with the existing sync scheduler.
- **Quotas & policy surface** for the paid relay (per-account storage, max blob size).
