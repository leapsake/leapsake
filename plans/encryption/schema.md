# Leapsake — Encryption Schema (wrapped-key & per-item-key tables)

> **Reference doc — the key tables.** This is the concrete schema behind
> [`model.md`](./model.md) and [`custody-sequence.md`](./custody-sequence.md). For
> *what is built vs. design* and *which table group ships in which stage*, see
> [`status.md`](../status.md) — this doc no longer restates build status. It turns the
> custody sequence's per-phase **Key ledger** into tables.
>
> **Approach 1 (schema-first, sync-deferred).** All table groups are drafted now,
> modeled against the sync-safe primitives (`AGENTS.md`; UUID PKs, epoch-ms
> timestamps, `deleted_at` soft delete, `deleted_at IS NULL` partial unique indexes).
> The *one* genuinely-open decision — the per-item **merge model** (CRDT vs. LWW vs.
> log) — is isolated to §3 and marked **TODO**; it touches only the per-item tables and
> reshapes none of the key-custody ones. That decision now lives in
> [`sync.md`](./sync.md).

## 1. Principles inherited (and one new one)

- **Reuse §4.2 wholesale.** Every table below has a `TEXT` UUID PK, `created_at` /
  `updated_at` / `deleted_at` epoch-ms columns, and soft-delete semantics. Value
  constraints (enums, formats) live in **Zod (`packages/schema`), not the DB** (§4.5),
  so the same portable SQL runs on `node:sqlite` and expo-sqlite.
- **The envelope is rows, not codepaths** (`model.md` §3). "Wrap this key for
  that principal" is a single table — `key_wrap` — used identically for the master
  key, the account private key, and every per-item content key. The "wrapped-MK store"
  and the "per-item wrapped-key bag" are the *same* table filtered differently.
- **New, load-bearing observation: key material is append/revoke, never edited.** You
  never *mutate* a wrapped key — you **add** a wrapping (grant) or **soft-delete** one
  (revoke). Wrap rows are immutable-once-written events. This is what makes the merge
  question (§3) tractable: for the key tables, "merge" is just union-of-grants minus
  union-of-revokes, which is order-insensitive and conflict-free.

## 2. The tables

Five groups, mapping straight off the custody ledger. Plaintext keys are **never**
stored — a key exists in the DB only as the set of its wrappings.

> **Stage-1 core vs. later ([`status.md`](../status.md)).** The **Stage-1 zero-knowledge
> core** needs only: `content_key`; `key_wrap` with `principal_kind ∈ {enclave,
> passphrase, recovery, master}`; `share` with `kind = 'capability'`; `account` *minus*
> its `public_key` (just `kdf_salt` + `auth_verifier`); and `device`. Everything else
> is **additive — it only adds rows or enum values, never alters these tables** (the §1
> append/revoke property): `account.public_key` + the `server_principal` table +
> `principal_kind ∈ {recipient, server_principal}` + `share.kind ∈ {authenticated,
> hosted}` are **Stage 3**; `principal_kind = 'session'` is **Stage 4**. So the schema
> can be created in full now without committing to those stages — they light up as the
> values start being written.

### 2.1 `account` — identity *(custody Phase 1)*
One row per account. Holds only the *public* and *derivable-but-blind* material.

```sql
CREATE TABLE account (
  id            TEXT PRIMARY KEY,         -- UUID
  public_key    BLOB,                    -- account public key, published to the directory (Stage 3; NULL until then)
  kdf_salt      BLOB NOT NULL,           -- Argon2id salt (public)
  auth_verifier BLOB NOT NULL,           -- §9.3 — authenticates login; reveals nothing about the KEK
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
```

The account **private key** is not a column — it is a `key_wrap` row
(`wrapped_kind = 'account_private'`, `principal_kind = 'master'`), keeping the envelope
uniform.

### 2.2 `device` — registration *(custody Phase 2)*

```sql
CREATE TABLE device (
  id         TEXT PRIMARY KEY,           -- UUID
  account_id TEXT NOT NULL REFERENCES account(id),
  label      TEXT,                       -- "Josh's iPhone"
  platform   TEXT,                       -- 'desktop' | 'mobile' | ...
  public_key BLOB,                       -- device keypair, for QR/device-linking (§13)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,           -- doubles as last-seen
  deleted_at INTEGER                     -- soft-delete = revoke the device
);
```

Each device's **enclave wrapping of the master key** is a `key_wrap` row keyed by this
`device.id` (`principal_kind = 'enclave'`, `principal_ref = device.id`). Revoking a
device = soft-delete here **and** soft-delete its enclave wrap.

### 2.3 `content_key` — per-item key registry *(custody Phase 3)*
One row per shareable unit (`model.md` §3). The content key itself is never here —
only the fact that the item *has* one, and which item it protects.

```sql
CREATE TABLE content_key (
  id          TEXT PRIMARY KEY,          -- UUID; the CK's identity, not its bytes
  entity_type TEXT NOT NULL,             -- 'person' | 'pet' | 'photo_album' | 'share_bundle' | ...
  entity_id   TEXT NOT NULL,             -- the protected item's UUID
  blob_ref    TEXT,                      -- object-storage pointer for large binaries (photos); NULL for in-DB items
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE UNIQUE INDEX content_key_entity_active
  ON content_key(entity_type, entity_id) WHERE deleted_at IS NULL;
```

Every `content_key` has **at least** one `key_wrap` row — `wrap(CK, MK)` — so the owner
can always read it.

### 2.4 `key_wrap` — the universal envelope *(custody Phases 0–4)*
The heart of the schema. "The server stores ciphertext plus a small bag of *wrapped*
keys per item" (`model.md` §3) **is** this table. The "wrapped-MK store" is just
`WHERE wrapped_kind = 'master'`.

```sql
CREATE TABLE key_wrap (
  id             TEXT PRIMARY KEY,        -- UUID
  wrapped_kind   TEXT NOT NULL,           -- 'master' | 'account_private' | 'content'
  content_key_id TEXT REFERENCES content_key(id),  -- set iff wrapped_kind = 'content'
  principal_kind TEXT NOT NULL,           -- who can unwrap (see below)
  principal_ref  TEXT,                    -- device.id | account.id | server_principal.id; NULL for singletons
  ciphertext     BLOB NOT NULL,           -- the wrapped key bytes
  alg            TEXT NOT NULL,           -- wrap-algorithm id (primitive choice deferred — see status.md)
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER                  -- soft-delete = revoke this grant
);

CREATE UNIQUE INDEX key_wrap_active
  ON key_wrap(wrapped_kind, content_key_id, principal_kind, principal_ref)
  WHERE deleted_at IS NULL;
```

`principal_kind` enumerates exactly the custody ledger's unlock paths and recipients:

| `principal_kind` | `principal_ref` | Used for | Phase |
|---|---|---|---|
| `enclave` | `device.id` | a device's local unlock of MK | 0, 2 |
| `recovery` | — | the recovery-key unlock of MK | 1 |
| `passphrase` | — | the KEK unlock of MK | 1 |
| `master` | — | anything wrapped under MK (account private key; owner's copy of every CK) | 1, 3 |
| `recipient` | `account.id` | authenticated share to another user's public key | 3b |
| `server_principal` | `server_principal.id` | constrained reader (Alexa / CardDAV / hosted link) | 4a |
| `session` | session id | transient SSR `wrap(MK, session key)` | 4b |

> **Capability links store no row here.** The default public link (`model.md`
> §11) carries the CK in the URL `#fragment`, which is *never sent to the server* —
> there is deliberately **no** `key_wrap` for it. That absence is what makes it
> zero-knowledge; revocation acts on the `share`/blob, not on a key.

A `server_principal` table (id, label, public_key, created/deleted) registers each
constrained reader; omitted here for brevity but structurally a sibling of `account`.

### 2.5 `share` — access policy *(custody Phases 3–4)*
The **server-trusted** layer (`model.md` §12): the server honestly refusing to
serve. Separate from the cryptographic `key_wrap` because it is a different trust kind.

```sql
CREATE TABLE share (
  id             TEXT PRIMARY KEY,        -- UUID; <id> in app/share/<id>
  content_key_id TEXT NOT NULL REFERENCES content_key(id),
  kind           TEXT NOT NULL,           -- 'capability' | 'hosted' | 'authenticated'
  expires_at     INTEGER,                 -- policy: time limit
  max_visits     INTEGER,                 -- policy: visit limit
  visit_count    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER                  -- soft-delete = revoke; server stops serving the blob
);

-- allowed_account_ids (authenticated/limited shares) as a child table:
CREATE TABLE share_grant (
  id         TEXT PRIMARY KEY,
  share_id   TEXT NOT NULL REFERENCES share(id),
  account_id TEXT NOT NULL REFERENCES account(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
```

`kind` selects the key story: `capability` → no `key_wrap` (fragment); `hosted` →
`key_wrap` to a `server_principal`; `authenticated` → `key_wrap` to each `recipient`.

### 2.6 What is deliberately **absent**
- **The whole-DB at-rest key** (`model.md` §8). It is supplied at *open* time by
  the device enclave and protects the file these tables live in — it cannot live inside
  them. Orthogonal to this schema (and to the at-rest-engine open question).
- **Any plaintext key.** MK, KEK, CKs, the account private key — all exist only as
  `key_wrap` ciphertext or as user-/enclave-held secrets off-DB.

## 3. The one deferred decision: per-item merge model **(TODO → [`sync.md`](./sync.md))**

The full decision — CRDT (Automerge/Yjs) vs. LWW-on-`updated_at` vs. op-log — now lives
in **[`sync.md`](./sync.md)**, alongside the transport seam it is coupled to. This
section records only what it means *for these tables*:

Settled (so the tables can exist now):
- The §4.2 sync-safe substrate — UUIDs, epoch-ms `updated_at` ordering, `deleted_at`
  tombstones — is on every table above.
- **Merge happens client-side on decrypted data** (`model.md` §9.1); the server is a
  blind blob store and never merges. This is also what keeps true P2P possible
  ([`sync.md`](./sync.md)).
- **The key tables are conflict-free regardless of the answer** (§1's append/revoke
  observation): wraps and grants merge as union-of-adds minus union-of-soft-deletes.

The open part reshapes only the *domain* per-item rows (e.g. `person`), not the key
tables. **Marker:** if the answer turns out to need vector clocks / Lamport clocks, it
is an *additive* column on the domain tables — not a change to `content_key` /
`key_wrap` / `share`. See [`sync.md`](./sync.md) for the decision itself.

## 4. Placement & handoff

- **`packages/schema`** — Zod schemas for the five table groups → inferred types
  (validate IPC now; sync payloads + server later, §4.3).
- **`packages/data`** — repositories over the `SqliteDriver` port, and migrations
  **11+** appended to the forward-only runner (§4.5). The key tables are owner-account
  scoped; multi-account is out of scope (single account per local store).
- **`packages/crypto`** (§4 of `model.md`) — owns the actual wrap/unwrap, Argon2id,
  AEAD, X25519/Ed25519. The schema stores *its* outputs (`ciphertext`, `alg`); it does
  not encode primitive choices, which stay deferred to the security review (see
  [`status.md`](../status.md)).

The `packages/crypto` surface and the **`KeyStore` port** + per-platform adapters
(`model.md` §13) are now built; [`status.md`](../status.md) tracks what remains.
