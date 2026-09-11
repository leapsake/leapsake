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
 *
 * **Versions 26 and 34 are absent, deliberately.** They created
 * `gift_suggestions`/`gifts` and `gift_idea_occasions`; the gift model collapsed
 * to two tables when occasions and dates left v0.1 scope, and under the pre-v0.1
 * latitude in AGENTS.md they were rewritten in place rather than migrated away
 * from — the version numbers were not reused, so a stale profile fails loudly on
 * a missing table rather than quietly on a renumbered one. The runner filters and
 * sorts by version, so gaps cost nothing. **Delete the dev profile and relaunch**
 * if yours predates this. The rule above resumes at v0.1.
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
      // generic table, since each fits its own shape.
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
      // Encryption Stage 1, the two key-custody tables. Plaintext keys are
      // NEVER stored: a key exists in the DB only as the set of its wrappings.
      // `content_key` registers that an entity has a content key (not its
      // bytes); `key_wrap` is the universal envelope — "wrap this key for that
      // principal" as immutable, append/revoke-only rows, used identically for
      // the master key, the account private key, and every per-item content
      // key. The envelope model is plans/encryption/model.md §3.
      //
      // Value constraints (the wrapped_kind/principal_kind enums) live in Zod
      // (packages/schema/src/key-wrap.ts), not the DB, to stay portable across
      // node:sqlite and expo-sqlite. The wrapping algorithm is recorded per-row
      // in `alg` so the crypto primitive can change later without reshaping
      // data. Partial unique indexes scoped to `deleted_at IS NULL` enforce
      // "one active row per key" while letting soft-deleted history coexist
      // (see AGENTS.md).
      //
      // Two absences are deliberate. The **whole-DB at-rest key** is not here
      // and cannot be: it is supplied at open time by the device enclave and
      // protects the file these tables live in (model.md §8). And a
      // **capability link stores no `key_wrap` row at all** — it carries the
      // content key in a URL `#fragment` that never reaches the server (§11),
      // which is exactly what makes it zero-knowledge; revocation there acts on
      // the share, not on a key.
      //
      // Both tables are created in every store but are **empty until an account
      // exists** — under "encryption follows custody" (@leapsake/key-custody) a fresh
      // install mints no keys. Code reading them must treat "no rows" as a
      // normal state, not a corrupt one.
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
      // @leapsake/key-custody). `account` is the identity established
      // when the user creates one: it stores only public/blind material — the
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
      // @leapsake/key-custody). `username` is the unique handle
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
      // (orientation) and contact-method "owner". See packages/key-custody/README.md.
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
      // Reminders — user-generated freeform notes/tasks, the
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
      // Reminders gain an optional due date (automated
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
  {
    version: 22,
    async up(driver) {
      // Holidays (`@leapsake/holidays` README) — three tables that together
      // extend the automated-reminder engine to a second family of recurring
      // dated facts about people. All plaintext rows, all synced.
      //
      // `holidays` holds BOTH the shipped catalog and user-authored entries,
      // told apart by `origin`; catalog rows are read-only, and a user "forks"
      // one by hiding it and creating their own (§2.6). A catalog row's `id` is
      // derived from its `slug` (schema/holiday.ts), so every device mints the
      // same uuid and seeded rows converge even without syncing. `recurrence`
      // is deliberately opaque TEXT — the canonical JSON of a rule union owned
      // by @leapsake/holidays — so a device whose *code* predates a rule type
      // in its *data* still stores and relays the row instead of rejecting it.
      //
      // `observances` is who observes what. It is the reminder rule's bearer,
      // not the holiday, which is what makes per-person schedules ("gift Alice
      // 30 days before Christmas" vs "just call Grandma day-of") fall out of
      // the existing polymorphic bearer pair with no schema change (§1). One
      // table with a polarity flag rather than the relationships/dismissals
      // pair, because the payload is thin and symmetric: no row = the implicit
      // answer, observes=1 = explicit yes, observes=0 = explicit override (§2.1).
      // A row exists only where it DIVERGES from the implicit answer (§2.2).
      //
      // `hidden_holidays` is the negative assertion that suppresses a catalog
      // holiday entirely — its own table rather than a column, because writing
      // a column would be an edit to a catalog row and would fight the next
      // catalog update (§2.6). It syncs: hiding suppresses generated reminders,
      // and an input to the reminder engine must sit on the same side of the
      // sync boundary as the reminders it generates, or one device's prune
      // tombstones a row the other keeps regenerating.
      //
      // Both join tables use the partial-unique-active idiom (migration 20) so
      // one key has at most one live row while soft-delete history is kept, and
      // both derive their ids from that key so two offline devices asserting
      // the same thing converge on one row instead of colliding on the index.
      await driver.exec(`
        CREATE TABLE holidays (
          id                TEXT    PRIMARY KEY,
          slug              TEXT    NOT NULL,
          name              TEXT    NOT NULL,
          greeting          TEXT    NOT NULL,
          recurrence        TEXT    NOT NULL,
          duration_days     INTEGER,
          family_id         TEXT,
          implied_by_locale INTEGER NOT NULL,
          origin            TEXT    NOT NULL,
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL,
          deleted_at        INTEGER
        );
        CREATE UNIQUE INDEX ux_holidays_slug_active
          ON holidays(slug) WHERE deleted_at IS NULL;

        CREATE TABLE observances (
          id          TEXT    PRIMARY KEY,
          holiday_id  TEXT    NOT NULL,
          bearer_type TEXT    NOT NULL,
          bearer_id   TEXT    NOT NULL,
          observes    INTEGER NOT NULL,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          deleted_at  INTEGER
        );
        CREATE UNIQUE INDEX ux_observances_active
          ON observances(holiday_id, bearer_type, bearer_id)
          WHERE deleted_at IS NULL;
        CREATE INDEX ix_observances_bearer
          ON observances(bearer_type, bearer_id) WHERE deleted_at IS NULL;
        CREATE INDEX ix_observances_holiday
          ON observances(holiday_id) WHERE deleted_at IS NULL;

        CREATE TABLE hidden_holidays (
          id         TEXT    PRIMARY KEY,
          holiday_id TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
        CREATE UNIQUE INDEX ux_hidden_holidays_active
          ON hidden_holidays(holiday_id) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 23,
    async up(driver) {
      // The self-person — a synced singleton pointing
      // at the Person that is "you". Gifts are the first feature to need a self
      // concept (who gave / received); it is also the future kinship ego anchor
      // and the "me" of vCard export.
      //
      // A **fixed-PK singleton**, deliberately not `account.self_id` and not
      // `people.is_self` + a partial-unique-index. A local-only user has no
      // `account` row and `account` is off the sync allowlist (zero-knowledge),
      // so `self_id` would have nowhere to live and couldn't ride the people
      // channel. And two devices each marking a *different* person as self via a
      // `people.is_self` unique index would collide on merge — a hard, manual-
      // only sync failure. Here both devices write the *same* primary key (the
      // constant SELF_PERSON_ID), so whole-row LWW resolves it like everything
      // else: one row, last writer wins, no error.
      //
      // Plaintext synced row (no per-item content key), like reminders: a self
      // pointer is not a share target and rides whole-DB-at-rest + the master-key
      // sync seal. No FK on `person_id` — it points into the synced people rows
      // and resolves at read, never enforced at write (sync rows carry no FKs).
      await driver.exec(`
        CREATE TABLE self_person (
          id         TEXT    PRIMARY KEY,
          person_id  TEXT    NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
      `);
    },
  },
  {
    version: 24,
    async up(driver) {
      // Gift ideas — "a thing in the world", reusable
      // and person-agnostic: `title` (required) plus optional `url` and `notes`.
      // The first of the two gift tables; `gift_recipients` pairs an idea with a
      // person or pet, but an idea alone is a standalone
      // shopping/idea list. Plaintext synced row (no per-item content key), like
      // reminders — not a share target, protected by whole-DB-at-rest + the
      // master-key sync seal. Near-duplicate titles are tolerated by design (the
      // reconciliation substrate is the eventual de-dup, not a unique index here).
      await driver.exec(`
        CREATE TABLE gift_ideas (
          id         TEXT    PRIMARY KEY,
          title      TEXT    NOT NULL,
          url        TEXT,
          notes      TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );
      `);
    },
  },
  {
    version: 25,
    async up(driver) {
      // Gift recipients — one gift idea paired with one person or pet, and
      // whether it has been given to them ("Ralphie would like a BB gun", and
      // later, "…and now he has one").
      //
      // This replaces what were two tables: `gift_suggestions` (a candidate) and
      // `gifts` (a *dated* giving, with a giver and an occasion). That split was
      // load-bearing only while a giving carried a date — it is what made the
      // cardinalities differ, one suggestion to N givings. With dates and
      // occasions out of v0.1 scope, "given twice" is unrepresentable and the
      // query over the second table returns a boolean, so the two rows are one
      // row with a stamp. See `gift-recipient.ts`; `git log` at `41ee888` has the
      // model that had both.
      //
      // `given_at` is NULLABLE and records **when the box was ticked**, not when
      // the gift changed hands — an audit stamp in the `created_at` family. Every
      // read treats it as a boolean; nothing formats it. A real gift date, if it
      // ever comes back, is a different column.
      //
      // `recipient_*` is polymorphic (person | pet), reserving `relationship` for
      // later with no schema change. No unique index on
      // `(gift_idea_id, recipient_*)`: two devices can each mint a row for the
      // same pair, and the rest of the sync model dedupes on read rather than at
      // the constraint. Plaintext synced row, no FKs — recipient and idea resolve
      // at read.
      await driver.exec(`
        CREATE TABLE gift_recipients (
          id             TEXT    PRIMARY KEY,
          gift_idea_id   TEXT    NOT NULL,
          recipient_type TEXT    NOT NULL,
          recipient_id   TEXT    NOT NULL,
          given_at       INTEGER,
          created_at     INTEGER NOT NULL,
          updated_at     INTEGER NOT NULL,
          deleted_at     INTEGER
        );
        CREATE INDEX ix_gift_recipients_recipient
          ON gift_recipients(recipient_type, recipient_id) WHERE deleted_at IS NULL;
        CREATE INDEX ix_gift_recipients_idea
          ON gift_recipients(gift_idea_id) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 27,
    async up(driver) {
      // Retire `milestone.note` as a per-item-content-key consumer (encryption
      // `model.md` §2.1), reverting migration 12. Under *encryption follows
      // custody* (§7.2) layer 3 bought a domain field nothing: an **Unauthenticated** store
      // has no key to seal with, and a **Authenticated** store is already whole-file
      // ciphertext at rest. `note` is a plain TEXT column again.
      //
      // **This drops any note that was stored as ciphertext.** Migrations run
      // *before* the key session exists — that is why migration 12 could only
      // leave legacy rows to upgrade lazily — so this step cannot decrypt what it
      // is removing, and the plaintext `note` of such a row is NULL. Accepted
      // deliberately: pre-v0.1 there are no real users, and the only affected
      // installs are dev profiles with an unlocked key, which are cheaper to
      // recreate than a two-phase post-key migration is to write and maintain.
      //
      // Layer 3 itself stays — `content_key`, `key_wrap`, and
      // `createContentCipher` are untouched, because photos are its real
      // consumer (`plans/v0-2.md`). Existing `content_key` rows for milestones
      // are left as harmless orphans; the ciphertext they protected is gone, and
      // key GC is a tracked sync-era concern.
      await driver.exec(`ALTER TABLE milestones DROP COLUMN note_ciphertext;`);
    },
  },
  {
    version: 28,
    async up(driver) {
      // Snooze — “put this off, ask me later” on any reminder. Two facts, and
      // deliberately **not** onboarding-flavoured: `snoozed_until` is when the row
      // becomes visible again, `snooze_count` is how many times it has been put off
      // — equally true of a dentist reminder someone has dodged four times. The
      // onboarding nudges (`packages/reminders/README.md`) are simply the first consumer;
      // `source` already separates *the product asked and the user declined*
      // (`system`) from *someone hiding their own reminder* (`user`), so neither
      // case needs storage of its own.
      //
      // `snooze_count` is NOT NULL DEFAULT 0 because a count has an obvious zero:
      // every existing row backfills for free, with no data step.
      //
      // ⚠️ **Store what happened, never what to do next** (`packages/reminders/README.md`). `snoozed_until` is a stored date and therefore the one place that
      // rule can be broken by accident. It is legitimate only as *generic* snooze —
      // a user-chosen “hide until Tuesday” is a fact about what the user did. The
      // re-prompt **policy** must stay derived: a step's `duration` is applied by a
      // pure function at the moment the user snoozes, and the give-up decision is
      // re-derived from `snooze_count` against the step's `repetitions` on every
      // reconcile. Never persist “this step's next prompt is on 15 August” — doing
      // so bakes today's policy into rows you can no longer reach, and every future
      // tweak then needs a data migration to match.
      //
      // **No owner column.** One store is one user today. The product model
      // anticipates multi-user-per-client (`plans/v0-2.md`), and the seam
      // is left explicit here on purpose: adding a nullable owner column later is a
      // cheap migration, and guessing its shape now is not.
      await driver.exec(`
        ALTER TABLE reminders ADD COLUMN snoozed_until INTEGER;
        ALTER TABLE reminders ADD COLUMN snooze_count INTEGER NOT NULL DEFAULT 0;
      `);
    },
  },
  {
    version: 29,
    async up(driver) {
      // Local-notification policy (`plans/v0-1_08_local-notifications.md`) — a
      // synced, one-row-per-device settings table. **`id` holds the device id**,
      // not a freshly minted row id: like `self_person`'s fixed PK, this rides
      // the standard EntityRepo/defineSyncable machinery (which hardcodes
      // `WHERE id = ?`) by making the device id *be* the primary key, rather than
      // fighting that machinery with a custom `device_id` column + codec.
      //
      // Per-device, but **editable from any device** — set the phone's policy
      // from the laptop, and vice versa. That single requirement is why this
      // isn't device-local `AsyncStorage`: every device may write any row, and
      // two devices racing the same row is plain last-writer-wins, correct for
      // a preference.
      //
      // `label`/`platform` are denormalized here rather than joined from
      // `device`, because `device` deliberately does not sync (migration 14's
      // zero-knowledge boundary) — the cross-device settings UI still needs to
      // name the devices it lists.
      //
      // `permission_state` is a fact ("what did the OS last say"), not a plan —
      // it exists so a device editing a *peer's* policy doesn't lie about
      // whether that peer can actually receive it, and it is written only by
      // the owning device.
      //
      // No pending-notification data lives here — that set is derived fresh
      // from reminder rows on every reconcile (`plans/v0-1_08_local-notifications.md`
      // → "store what happened, never what to do next", migration 28's rule).
      await driver.exec(`
        CREATE TABLE notification_settings (
          id                TEXT    PRIMARY KEY,
          label             TEXT,
          platform          TEXT,
          mode              TEXT    NOT NULL DEFAULT 'off',
          delivery_minute   INTEGER NOT NULL DEFAULT 540,
          permission_state  TEXT,
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL,
          deleted_at        INTEGER
        );
      `);
    },
  },
  {
    version: 30,
    async up(driver) {
      // A person needs *some* name, not a first one and a last one. `personSchema`
      // now takes any one of the three parts and rejects only a person with none
      // (`hasAnyName`); this is the storage half of that, dropping `NOT NULL`
      // from the two columns that were enforcing the old pair of requirements.
      //
      // Two features wanted it independently, which is what settled it: a person
      // known only as somebody's relation ("Jen", with no surname to give), and
      // contact import, whose vCard reader deliberately parses a mononym or an
      // organisation-only card with an empty `lastName` rather than inventing
      // one — and whose ingest guard then had to refuse every such card.
      //
      // **SQLite cannot drop a NOT NULL in place**, so the table is rebuilt: the
      // 12-step ALTER TABLE procedure from the SQLite docs, minus the steps that
      // don't apply here (`people` carries no index, trigger, view or foreign
      // key, and nothing references it — the relationship and tagging tables
      // point at entities polymorphically, by `(type, id)` pair, with no FK).
      //
      // The column list is spelled out on both sides of the copy rather than
      // relying on `SELECT *` positional order, so the rebuild survives the
      // columns having been added over four separate migrations (1, 2, 13).
      await driver.exec(`
        CREATE TABLE people_new (
          id          TEXT    PRIMARY KEY,
          first_name  TEXT,
          middle_name TEXT,
          last_name   TEXT,
          gender      TEXT,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          deleted_at  INTEGER
        );
        INSERT INTO people_new
          (id, first_name, middle_name, last_name, gender,
           created_at, updated_at, deleted_at)
        SELECT
           id, first_name, middle_name, last_name, gender,
           created_at, updated_at, deleted_at
          FROM people;
        DROP TABLE people;
        ALTER TABLE people_new RENAME TO people;
      `);
    },
  },
  {
    version: 31,
    async up(driver) {
      // Where an entity stands in the user's catalog (`standingSchema`). The one
      // value in use besides the default is `unpublished`: someone who exists
      // only as a fact about a published person — a coworker's wife, recorded as
      // a name on the relationship — who is kept out of People & Pets, out of
      // every picker, and out of duplicate detection until they become more than
      // that. `draft` is reserved and nothing writes it yet.
      //
      // `NOT NULL DEFAULT 'published'` is what makes this a one-line ALTER
      // instead of another rebuild: every row that already exists is one of the
      // user's own people, which is exactly what the default says.
      //
      // Deliberately **no** index. Both tables are small (a personal address
      // book), the catalog read is a full scan either way, and an index on a
      // column with two values and a 99%-`published` distribution would earn
      // nothing while costing a write on every update.
      await driver.exec(`
        ALTER TABLE people ADD COLUMN standing TEXT NOT NULL DEFAULT 'published';
        ALTER TABLE pets   ADD COLUMN standing TEXT NOT NULL DEFAULT 'published';
      `);
    },
  },
  {
    version: 32,
    async up(driver) {
      // Which messaging platforms a number reaches (`@leapsake/contact-links`).
      // WhatsApp and Signal are addressed *by phone number*, so tapping through
      // to one needs no new contact method — only the one thing Leapsake cannot
      // work out for itself, which is whether this person is actually there. The
      // user ticks it once on the phone form and the action appears from then on.
      //
      // Stored as a JSON array of platform ids in one column rather than a
      // boolean column per platform, so that the *registry* stays the single
      // source of which platforms exist: the form renders a checkbox per
      // phone-keyed entry in `PHONE_PLATFORMS`, and adding Telegram-by-phone
      // later is an entry in that file rather than a migration and a new column.
      // Decoded by the `json` codec option (`syncable.ts`).
      //
      // Nullable with no backfill: a NULL decodes to `undefined`, which lets the
      // Zod field's own `[]` default mean "not yet asked" for every row that
      // already exists.
      await driver.exec(`
        ALTER TABLE phone_numbers ADD COLUMN reachable_on TEXT;
      `);
    },
  },
  {
    version: 33,
    async up(driver) {
      // The fourth contact method: someone's account on a messaging or social
      // platform. Same spine as the other three (polymorphic owner, free-text
      // label, sync-safe timestamps + soft delete), with a per-owner partial
      // index and a non-unique `normalized` index for lookup — dedupe stays
      // permissive here as it is everywhere else.
      //
      // `platform` holds a `@leapsake/contact-links` id as free text. The list
      // of known platforms deliberately does **not** reach the database: a
      // CHECK constraint would freeze it into stored data, so a row synced from
      // a device running a newer build would be rejected, and every new
      // platform would cost a migration. An unknown id is stored happily and
      // rendered from `url`.
      //
      // `platform_user_id` is null on almost every row. It exists because X,
      // Discord and their like key DMs on an opaque numeric id they do not
      // publish beside the handle, so without one a handle can only reach a
      // profile. `url` is the escape hatch a genuinely open platform list needs:
      // a pasted profile URL for something with no template.
      await driver.exec(`
        CREATE TABLE social_profiles (
          id               TEXT    PRIMARY KEY,
          owner_type       TEXT    NOT NULL,
          owner_id         TEXT    NOT NULL,
          label            TEXT    NOT NULL,
          platform         TEXT    NOT NULL,
          handle           TEXT    NOT NULL,
          normalized       TEXT    NOT NULL,
          platform_user_id TEXT,
          url              TEXT,
          created_at       INTEGER NOT NULL,
          updated_at       INTEGER NOT NULL,
          deleted_at       INTEGER
        );
        CREATE INDEX ix_social_profiles_owner
          ON social_profiles(owner_type, owner_id) WHERE deleted_at IS NULL;
        CREATE INDEX ix_social_profiles_normalized
          ON social_profiles(normalized) WHERE deleted_at IS NULL;
      `);
    },
  },
  {
    version: 34,
    async up(driver) {
      // **Sweep every generated reminder, tombstones included.** Reminder
      // windows just became a property of the action rather than one 30-day
      // constant, and `wish` — the only thing on by default — went from a
      // month-long run-up to day-of. Every already-materialized wish row is
      // therefore no longer wanted, and the engine's prune retires an unwanted
      // row by **soft-deleting** it.
      //
      // That is the problem. `reconcile` never resurrects a tombstone, and a
      // system reminder's id is keyed on the occurrence **year**, so a row
      // pruned today would stay dead until the birthday came round again — the
      // upgrade would silently cost the user this year's birthday, on the very
      // morning it mattered. A soft delete cannot be undone from inside the
      // engine, so it has to be undone from underneath it.
      //
      // Hard delete rather than a resurrection rule: the ids are deterministic,
      // so everything still wanted is re-minted unchanged on the next
      // reconcile, and nothing about identity changes. The cost is that a
      // genuine "dismiss this" on a system reminder is forgotten once —
      // acceptable pre-release (owner, 2026-09-04), and cheaper than teaching
      // the engine to tell a stale tombstone from a deliberate one.
      await driver.exec(`DELETE FROM reminders WHERE source = 'system'`);
    },
  },
  {
    version: 35,
    async up(driver) {
      // **Reminder actions became `verb:qualifier`.** The action string is a
      // reminder's identity, and a flat one could not tell buying a card from
      // posting it — two errands on two clocks that had to share a single `card`
      // action, and therefore a single derived id. Splitting the verb from an
      // open qualifier is what lets them be two reminders (schema's
      // `ReminderAction`).
      //
      // **Rewrite, don't drop.** These rows are the user's own configured
      // schedules, and — since rows-existing is how the `plan` prompt knows an
      // occasion has been answered — dropping them would also un-answer every
      // prompt anyone had answered. The rename is exact, so there is nothing to
      // reason about. It is not optional either: `reminderRuleSchema` parses on
      // every read, and a leftover `gift` would fail the read outright rather
      // than degrade.
      //
      // `text` becomes `message:sms` rather than `send:text`: `message` is the
      // verb that takes the platform qualifiers (`message:discord`), and SMS is
      // simply the first of them.
      await driver.exec(`
        UPDATE reminder_rules SET action = 'get:gift'    WHERE action = 'gift';
        UPDATE reminder_rules SET action = 'send:card'   WHERE action = 'card';
        UPDATE reminder_rules SET action = 'message:sms' WHERE action = 'text';
      `);

      // Then migration 34's sweep, for migration 34's reason. Three of those
      // actions just changed identity, so the rows minted under the old ids are
      // no longer wanted — and the engine retires an unwanted row by **soft
      // delete**, which it never resurrects. Since a system reminder's id is
      // keyed on the occurrence **year**, a row pruned today would stay dead
      // until the occasion came round again: the upgrade would silently cost the
      // user this year's birthday, on the morning it mattered. A soft delete
      // cannot be undone from inside the engine, so it is undone from
      // underneath it.
      //
      // Hard delete rather than a resurrection rule: the ids are deterministic,
      // so everything still wanted is re-minted on the next reconcile. The cost
      // is that a genuine "dismiss this" is forgotten once — acceptable
      // pre-release (owner, 2026-09-04).
      await driver.exec(`DELETE FROM reminders WHERE source = 'system'`);
    },
  },
  {
    version: 36,
    async up(driver) {
      // **Which phone contacts this device has already brought in**, so keeping
      // People in step with the address book can tell a contact it has never seen
      // from one it has. Without it the only way to tell is to compare names,
      // which is the duplicate detector's fuzzy job, not an identity.
      //
      // Device-local, like `sync_state`, and for the same reason: `contact_id`
      // is the address book's own record id, which means nothing in any other
      // address book — so it never replicates and is not a SyncableRepo.
      //
      // **A row outlives the person it made, on purpose.** It is never
      // tombstoned or cleared when that person is deleted or merged away; the
      // row still being here is exactly what stops the next sync bringing them
      // back. A NULL entity means "seen, and deliberately not imported" — a
      // card with no name at all, which is almost always a business — so it is
      // not refused again every time the app opens. A factory reset deletes the
      // store and these rows with it, which is what makes a reset start over.
      await driver.exec(`
        CREATE TABLE device_contact_links (
          contact_id  TEXT    PRIMARY KEY,
          entity_type TEXT,
          entity_id   TEXT,
          linked_at   INTEGER NOT NULL
        );
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
