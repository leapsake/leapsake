import type { SqliteDriver } from "./driver.js";

/** A single ordered, forward-only schema change. */
export interface Migration {
  version: number;
  up(driver: SqliteDriver): Promise<void>;
}

/**
 * The ordered migration list. Append new migrations with the next integer
 * version; never edit or reorder existing ones. Portable SQL only, so the same
 * migrations run on node:sqlite (desktop) and expo-sqlite (mobile).
 */
export const migrations: Migration[] = [
  {
    version: 1,
    async up(driver) {
      await driver.exec(`
        CREATE TABLE people (
          id         TEXT    PRIMARY KEY,
          first_name TEXT    NOT NULL,
          last_name  TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
      `);
    },
  },
  {
    version: 2,
    async up(driver) {
      await driver.exec(`ALTER TABLE people ADD COLUMN middle_name TEXT;`);
    },
  },
  {
    version: 3,
    async up(driver) {
      // Tags and a polymorphic join. `taggings.entity_type`/`entity_id` point at
      // any entity (just 'person' today), so new entity types tag in without a
      // schema change. Partial unique indexes scoped to `deleted_at IS NULL`
      // enforce "one active row per key" while letting soft-deleted history
      // coexist (see AGENTS.md — soft-delete + sync).
      await driver.exec(`
        CREATE TABLE tags (
          id         TEXT    PRIMARY KEY,
          name       TEXT    NOT NULL,
          normalized TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
        CREATE UNIQUE INDEX ux_tags_active_normalized
          ON tags(normalized) WHERE deleted_at IS NULL;

        CREATE TABLE taggings (
          id          TEXT    PRIMARY KEY,
          tag_id      TEXT    NOT NULL,
          entity_type TEXT    NOT NULL,
          entity_id   TEXT    NOT NULL,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          deleted_at  INTEGER
        );
        CREATE UNIQUE INDEX ux_taggings_active
          ON taggings(tag_id, entity_type, entity_id) WHERE deleted_at IS NULL;
        CREATE INDEX ix_taggings_entity
          ON taggings(entity_type, entity_id) WHERE deleted_at IS NULL;
        CREATE INDEX ix_taggings_tag
          ON taggings(tag_id) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 4,
    async up(driver) {
      // A relationship is one directed edge stored as a single row holding both
      // endpoints and both roles (schema/relationship.ts). Endpoints are
      // polymorphic `(type, id)` pairs like taggings, so Pets join later without
      // touching this table. Two partial indexes (one per side) cover the
      // "relationships touching entity X" reads. There is deliberately NO unique
      // index on the pair: the same two entities may relate in more than one way.
      await driver.exec(`
        CREATE TABLE relationships (
          id          TEXT    PRIMARY KEY,
          a_type      TEXT    NOT NULL,
          a_id        TEXT    NOT NULL,
          a_role      TEXT    NOT NULL,
          a_role_note TEXT,
          b_type      TEXT    NOT NULL,
          b_id        TEXT    NOT NULL,
          b_role      TEXT    NOT NULL,
          b_role_note TEXT,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          deleted_at  INTEGER
        );
        CREATE INDEX ix_relationships_a
          ON relationships(a_type, a_id) WHERE deleted_at IS NULL;
        CREATE INDEX ix_relationships_b
          ON relationships(b_type, b_id) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 5,
    async up(driver) {
      // Pet entity. A minimal row (just a name today) that plugs into the
      // existing polymorphic taggings and relationships tables — no schema
      // change needed there. Same sync-safe conventions as people.
      await driver.exec(`
        CREATE TABLE pets (
          id         TEXT    PRIMARY KEY,
          name       TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
      `);
    },
  },
  {
    version: 6,
    async up(driver) {
      // Optional explicit gender on both relationship-graph entities. Nullable
      // (null = unset); values are constrained to male|female|nonbinary by the
      // Zod schema, not the DB, to stay portable. An unset gender may still be
      // *derived* at read time from explicitly-gendered roles (kinship-service).
      await driver.exec(`ALTER TABLE people ADD COLUMN gender TEXT;`);
      await driver.exec(`ALTER TABLE pets ADD COLUMN gender TEXT;`);
    },
  },
  {
    version: 7,
    async up(driver) {
      // Suppression table for *derived* relationships the user has rejected. A
      // dismissal keeps a computed-on-read edge gone without writing a competing
      // explicit fact. `role` is the dismissed base role; NULL dismisses any
      // derived edge to that pair. Soft-delete + partial index follow the same
      // conventions as the other tables (see AGENTS.md).
      await driver.exec(`
        CREATE TABLE relationship_dismissals (
          id           TEXT    PRIMARY KEY,
          subject_type TEXT    NOT NULL,
          subject_id   TEXT    NOT NULL,
          other_type   TEXT    NOT NULL,
          other_id     TEXT    NOT NULL,
          role         TEXT,
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL,
          deleted_at   INTEGER
        );
        CREATE INDEX ix_dismissals_subject
          ON relationship_dismissals(subject_type, subject_id) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 8,
    async up(driver) {
      // Milestones: the dated facts of a subject's life (birthdays today; the
      // big dates generally). One generic table rather than a `people.birthday`
      // column so "all the dates in someone's life" and the future reminders
      // inbox never special-case it. The subject is a polymorphic, mutable
      // `(type, id)` pair like taggings/relationships, so relationship-subject
      // anniversaries (and later places/orgs) join without a schema change.
      //
      // The date is partial: year/month/day are individually nullable, with the
      // only rule — day ⇒ month — enforced in Zod (schema/milestone.ts), not the
      // DB, to stay portable. Precision is derived from which parts are present,
      // never stored. The nullable parts stay individually queryable so the
      // ix_milestones_recurring index can serve the future month/day inbox scan.
      await driver.exec(`
        CREATE TABLE milestones (
          id           TEXT    PRIMARY KEY,
          kind         TEXT    NOT NULL,
          subject_type TEXT    NOT NULL,
          subject_id   TEXT    NOT NULL,
          year         INTEGER,
          month        INTEGER,
          day          INTEGER,
          note         TEXT,
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL,
          deleted_at   INTEGER
        );
        CREATE INDEX ix_milestones_subject
          ON milestones(subject_type, subject_id) WHERE deleted_at IS NULL;
        -- Reserves the recurrence/inbox scan; cheap to add now.
        CREATE INDEX ix_milestones_recurring
          ON milestones(month, day) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 9,
    async up(driver) {
      // Contact methods: three typed tables (email/phone/postal) rather than one
      // generic table, since each fits its own shape (contact-methods-plan.md).
      // Every row shares a spine — a polymorphic `(owner_type, owner_id)` pair, a
      // per-table label + free-text `label_note` for the `other` escape hatch,
      // and the usual sync-safe id/timestamps/soft-delete (see AGENTS.md).
      // `owner_type` is 'person' today; the Zod enum reserves 'household' so a
      // future household entity owns a shared method with no migration.
      //
      // Each table gets a per-owner partial index for the by-owner read, plus a
      // **non-unique** `normalized` index (email/phone) for lookup and the
      // optional duplicate warning — dedupe is permissive, no hard uniqueness.
      // All value-field constraints live in Zod, not the DB, to stay portable
      // across node:sqlite and expo-sqlite.
      await driver.exec(`
        CREATE TABLE email_addresses (
          id         TEXT    PRIMARY KEY,
          owner_type TEXT    NOT NULL,
          owner_id   TEXT    NOT NULL,
          label      TEXT    NOT NULL,
          label_note TEXT,
          address    TEXT    NOT NULL,
          normalized TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
        CREATE INDEX ix_email_addresses_owner
          ON email_addresses(owner_type, owner_id) WHERE deleted_at IS NULL;
        CREATE INDEX ix_email_addresses_normalized
          ON email_addresses(normalized) WHERE deleted_at IS NULL;

        CREATE TABLE phone_numbers (
          id         TEXT    PRIMARY KEY,
          owner_type TEXT    NOT NULL,
          owner_id   TEXT    NOT NULL,
          label      TEXT    NOT NULL,
          label_note TEXT,
          number     TEXT    NOT NULL,
          normalized TEXT    NOT NULL,
          extension  TEXT,
          country    TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
        CREATE INDEX ix_phone_numbers_owner
          ON phone_numbers(owner_type, owner_id) WHERE deleted_at IS NULL;
        CREATE INDEX ix_phone_numbers_normalized
          ON phone_numbers(normalized) WHERE deleted_at IS NULL;

        CREATE TABLE postal_addresses (
          id          TEXT    PRIMARY KEY,
          owner_type  TEXT    NOT NULL,
          owner_id    TEXT    NOT NULL,
          label       TEXT    NOT NULL,
          label_note  TEXT,
          line1       TEXT    NOT NULL,
          line2       TEXT,
          locality    TEXT,
          region      TEXT,
          postal_code TEXT,
          country     TEXT,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          deleted_at  INTEGER
        );
        CREATE INDEX ix_postal_addresses_owner
          ON postal_addresses(owner_type, owner_id) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 10,
    async up(driver) {
      // Two contact-method tweaks. (1) The label became free text — the user
      // types anything, with per-kind suggestions that constrain nothing — so the
      // `other`-escape-hatch `label_note` column is dead weight and is dropped.
      // (2) Phones gained `sms_capable`: whether the number can receive texts,
      // the one thing the UI asks. It defaults to 1 (textable) — the common case,
      // so existing rows are assumed textable — and is set to 0 only for a
      // landline/fax. Still portable SQL across node:sqlite and expo-sqlite.
      await driver.exec(`
        ALTER TABLE phone_numbers ADD COLUMN sms_capable INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE email_addresses DROP COLUMN label_note;
        ALTER TABLE phone_numbers DROP COLUMN label_note;
        ALTER TABLE postal_addresses DROP COLUMN label_note;
      `);
    },
  },
  {
    version: 11,
    async up(driver) {
      // Encryption Stage 1, the two key-custody tables (encryption-schema.md
      // §2.3–§2.4). Plaintext keys are NEVER stored: a key exists in the DB only
      // as the set of its wrappings. `content_key` registers that an entity has
      // a content key (not its bytes); `key_wrap` is the universal envelope —
      // "wrap this key for that principal" as immutable, append/revoke-only rows
      // (the §1 property), used identically for the master key, the account
      // private key, and every per-item content key.
      //
      // Value constraints (the wrapped_kind/principal_kind enums) live in Zod
      // (packages/schema), not the DB, to stay portable across node:sqlite and
      // expo-sqlite. The wrapping algorithm is recorded per-row in `alg` so the
      // crypto primitive can change later (§15.3 review) without reshaping data.
      // Partial unique indexes scoped to `deleted_at IS NULL` enforce "one
      // active row per key" while letting soft-deleted history coexist
      // (see AGENTS.md).
      await driver.exec(`
        CREATE TABLE content_key (
          id          TEXT    PRIMARY KEY,
          entity_type TEXT    NOT NULL,
          entity_id   TEXT    NOT NULL,
          blob_ref    TEXT,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          deleted_at  INTEGER
        );
        CREATE UNIQUE INDEX content_key_entity_active
          ON content_key(entity_type, entity_id) WHERE deleted_at IS NULL;

        CREATE TABLE key_wrap (
          id             TEXT    PRIMARY KEY,
          wrapped_kind   TEXT    NOT NULL,
          content_key_id TEXT    REFERENCES content_key(id),
          principal_kind TEXT    NOT NULL,
          principal_ref  TEXT,
          ciphertext     BLOB    NOT NULL,
          alg            TEXT    NOT NULL,
          created_at     INTEGER NOT NULL,
          updated_at     INTEGER NOT NULL,
          deleted_at     INTEGER
        );
        CREATE UNIQUE INDEX key_wrap_active
          ON key_wrap(wrapped_kind, content_key_id, principal_kind, principal_ref)
          WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 12,
    async up(driver) {
      // Encryption Stage 1, first real-entity field: `milestone.note` is the
      // first domain field encrypted at rest under a per-item content key. The
      // sealed bytes live in `note_ciphertext` (BLOB) and the plaintext `note`
      // column is nulled when encrypted; the milestones repo decrypts on read
      // (the public Milestone type is unchanged). Migrations run before the key
      // exists, so legacy plaintext rows are left as-is and upgrade to ciphertext
      // on their next write.
      await driver.exec(
        `ALTER TABLE milestones ADD COLUMN note_ciphertext BLOB;`,
      );
    },
  },
  {
    version: 13,
    async up(driver) {
      // Sync watermark persistence (plans/encryption/sync.md). A device-local
      // key/value store for the sync engine's marks: 'push_hwm' (the epoch-ms
      // high-water of rows already pushed) and 'pull_cursor' (the transport's
      // opaque delivery cursor already consumed). It deliberately carries NONE of
      // the sync substrate (no id/created_at/updated_at/deleted_at): like
      // content_key/key_wrap, this table is device-local and must NEVER replicate
      // (model.md §3) — so it is not a SyncableRepo and never enters the engine's
      // opt-in allowlist. Key/value rather than fixed columns so a future
      // per-transport cursor is one more row, not a schema change.
      await driver.exec(`
        CREATE TABLE sync_state (
          key   TEXT    PRIMARY KEY,
          value INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 14,
    async up(driver) {
      // Encryption Stage 1, the password unlock door (custody Phases 1–2,
      // encryption-schema.md §2.1–§2.2). `account` is the identity established
      // when the user enables sync: it stores only public/blind material — the
      // Argon2id `kdf_salt` (public) and the `auth_verifier` the server uses to
      // authenticate login (§9.3, which reveals nothing about the KEK). The
      // account private key and every wrapped master key are NOT columns here —
      // they are `key_wrap` rows, keeping the envelope uniform. `public_key`
      // stays NULL until Stage 3 (the account keypair serves sharing to other
      // people, not sync). `device` registers each device on the account; its
      // enclave wrapping of MK is a `key_wrap` row keyed by `device.id`.
      //
      // Both tables carry the §4.2 sync-safe substrate, but — like
      // content_key/key_wrap/sync_state — they are device/account-identity, not
      // domain rows, and are NOT in the sync engine's opt-in allowlist (their
      // replication is designed with the relay later). Value constraints live in
      // Zod, not the DB, to stay portable across node:sqlite and expo-sqlite.
      await driver.exec(`
        CREATE TABLE account (
          id            TEXT    PRIMARY KEY,
          public_key    BLOB,
          kdf_salt      BLOB    NOT NULL,
          auth_verifier BLOB    NOT NULL,
          kdf_alg       TEXT    NOT NULL,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL,
          deleted_at    INTEGER
        );

        CREATE TABLE device (
          id         TEXT    PRIMARY KEY,
          account_id TEXT    NOT NULL REFERENCES account(id),
          label      TEXT,
          platform   TEXT,
          public_key BLOB,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
      `);
    },
  },
  {
    version: 15,
    async up(driver) {
      // Multi-device login coordinates (custody Phases 1–2,
      // plans/encryption/multi-device-login.md). `username` is the unique handle
      // a second device looks the account up by (prelogin → salt → fetch the
      // relay-stored wrap(MK, KEK)); `relay_url` is the relay this account syncs
      // through. Both are NULL for a local-only store and populated at
      // enable-sync (device 1) or after login (a joining device). They stay
      // device/account-identity — like the rest of `account`, NOT in the sync
      // allowlist. The partial unique index pins username uniqueness only when
      // present, so the many local-only NULLs never collide.
      await driver.exec(`
        ALTER TABLE account ADD COLUMN username TEXT;
        ALTER TABLE account ADD COLUMN relay_url TEXT;
        CREATE UNIQUE INDEX account_username
          ON account (username) WHERE username IS NOT NULL;
      `);
    },
  },
  {
    version: 16,
    async up(driver) {
      // Reconciliation "not a duplicate" memory (packages/core/README.md).
      // When the user reviews a proposed merge and says "these are not the same",
      // we remember the rejected pair so no device re-nags. The pair is stored
      // **canonicalized** — `lower_id` < `higher_id` — so (A,B) and (B,A) are one
      // row; people-only for v1 (no entity_type column yet). It carries the full
      // §4.2 sync-safe substrate and IS in the sync allowlist (a per-device memory
      // would re-nag on every other device — decided in status.md). The partial
      // unique index keeps a pair to a single active row.
      await driver.exec(`
        CREATE TABLE not_a_duplicate (
          id         TEXT    PRIMARY KEY,
          lower_id   TEXT    NOT NULL,
          higher_id  TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
        CREATE UNIQUE INDEX ix_not_a_duplicate_pair
          ON not_a_duplicate(lower_id, higher_id) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 17,
    async up(driver) {
      // Naming-consistency pass (pre-launch): the polymorphic "what this attaches
      // to" columns adopt the **bearer** vocabulary — an entity *bears* a
      // milestone/tag. Pure column rename, no data change; SQLite propagates the
      // rename to dependent indexes. Kept distinct from relationship "subject"
      // (orientation) and contact-method "owner". See plans/product-truths.md.
      await driver.exec(`
        ALTER TABLE milestones RENAME COLUMN subject_type TO bearer_type;
        ALTER TABLE milestones RENAME COLUMN subject_id TO bearer_id;
        ALTER TABLE taggings RENAME COLUMN entity_type TO bearer_type;
        ALTER TABLE taggings RENAME COLUMN entity_id TO bearer_id;
      `);
    },
  },
  {
    version: 18,
    async up(driver) {
      // Reminders — user-generated freeform notes/tasks (plans/reminders.md), the
      // seed of the future home screen. Plaintext row (no per-item content key);
      // `#tags` ride the shared `taggings` table under bearer type "reminder".
      // `completed_at` is null until marked done (a reversible toggle); `source`
      // is "user" today, reserving "system" for the future automated increment.
      await driver.exec(`
        CREATE TABLE reminders (
          id           TEXT    PRIMARY KEY,
          title        TEXT,
          body         TEXT,
          completed_at INTEGER,
          source       TEXT    NOT NULL,
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL,
          deleted_at   INTEGER
        );
      `);
    },
  },
  {
    version: 19,
    async up(driver) {
      // Reminders gain an optional due date (plans/reminders.md, automated
      // reminders). Stored as epoch-ms **UTC midnight of the civil due day** so it
      // sorts and merges like any other timestamp column, while the app treats it
      // as a whole calendar day (schema/reminder-schedule.ts). Nullable — an
      // undated reminder has no countdown and sinks below dated ones.
      await driver.exec(`ALTER TABLE reminders ADD COLUMN due_date INTEGER;`);
    },
  },
  {
    version: 20,
    async up(driver) {
      // Mentions — the synced, indexed backlink for inline `@mentions` embedded in
      // freeform text (plans reminder-mentions). A mention is derived from a token
      // in the bearer's text (the text is the source of truth), and materialized
      // here so "what mentions this person?" is an indexed lookup, not a scan.
      // Both axes are polymorphic: `bearer_*` is what holds the text (a reminder
      // today), `target_*` is the referenced entity (person/pet). Same partial-
      // unique + soft-delete convention as `taggings` (migration 3). Row ids are
      // deterministic (schema/mention.ts), so cross-device re-derivation converges.
      await driver.exec(`
        CREATE TABLE mentions (
          id          TEXT    PRIMARY KEY,
          bearer_type TEXT    NOT NULL,
          bearer_id   TEXT    NOT NULL,
          target_type TEXT    NOT NULL,
          target_id   TEXT    NOT NULL,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          deleted_at  INTEGER
        );
        CREATE UNIQUE INDEX ux_mentions_active
          ON mentions(bearer_type, bearer_id, target_type, target_id)
          WHERE deleted_at IS NULL;
        CREATE INDEX ix_mentions_target
          ON mentions(target_type, target_id) WHERE deleted_at IS NULL;
        CREATE INDEX ix_mentions_bearer
          ON mentions(bearer_type, bearer_id) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 21,
    async up(driver) {
      // Per-milestone reminder rules (plans per-milestone reminder settings) —
      // the staggered-reminder schedule a milestone offers: an action (get a
      // gift, send a card, give a call…) `offset_days` before the occurrence,
      // on or off. Plaintext row (no per-item content key), like reminders
      // themselves: reminder policy is scheduling metadata, not a share target,
      // and rides whole-DB-at-rest + the master-key sync seal. `bearer_*` is
      // polymorphic — "milestone" today, reserving "holiday" for the future
      // holidays increment with no schema change. `action` is free text in the
      // DB (constrained to the reminderActionSchema enum in Zod, portable across
      // node:sqlite and expo-sqlite); `label` carries the user's text for the
      // `other` action. A milestone with NO rows rides its kind's defaults
      // (schema resolveReminderSchedule); rows exist only once customised. This
      // increment stores/edits them — wiring them into the reminder engine is
      // the next increment.
      await driver.exec(`
        CREATE TABLE reminder_rules (
          id          TEXT    PRIMARY KEY,
          bearer_type TEXT    NOT NULL,
          bearer_id   TEXT    NOT NULL,
          action      TEXT    NOT NULL,
          label       TEXT,
          offset_days INTEGER NOT NULL,
          enabled     INTEGER NOT NULL,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          deleted_at  INTEGER
        );
        CREATE INDEX ix_reminder_rules_bearer
          ON reminder_rules(bearer_type, bearer_id) WHERE deleted_at IS NULL;
      `);
    },
  },
];

/**
 * Apply any migrations newer than the database's current `user_version`, each
 * inside a transaction, then bump `user_version`. Cheap hand-rolled runner in
 * place of a migration library (packages/data/README.md).
 */
export async function runMigrations(
  driver: SqliteDriver,
  steps: Migration[] = migrations,
): Promise<void> {
  const row = await driver.get<{ user_version: number }>("PRAGMA user_version");
  const current = row?.user_version ?? 0;

  const pending = [...steps]
    .filter((step) => step.version > current)
    .sort((a, b) => a.version - b.version);

  for (const step of pending) {
    await driver.transaction(async () => {
      await step.up(driver);
      // PRAGMA user_version does not accept bound parameters; the version is a
      // trusted integer from our own migration list, so interpolation is safe.
      await driver.exec(`PRAGMA user_version = ${step.version}`);
    });
  }
}
