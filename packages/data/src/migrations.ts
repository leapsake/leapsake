import type { SqliteDriver } from "./driver.js";

/** A single ordered, forward-only schema change. */
export interface Migration {
  version: number;
  up(driver: SqliteDriver): Promise<void>;
}

/** The ordered, append-only migration list, in portable SQL. Versions 26 and 34
 *  are absent on purpose: never reuse a number (README, "Migrations"). */
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
      // Tags and a polymorphic join, so any entity type can be tagged. Partial
      // unique indexes keep one active row per key beside soft-deleted history.
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
      // One row per directed edge, with polymorphic endpoints. No unique index
      // on the pair: two entities may relate in more than one way.
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
      // Pets, joining the polymorphic taggings and relationships tables as they
      // are.
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
      // Optional explicit gender (null = unset); unset may still be derived
      // from gendered roles at read time.
      await driver.exec(`ALTER TABLE people ADD COLUMN gender TEXT;`);
      await driver.exec(`ALTER TABLE pets ADD COLUMN gender TEXT;`);
    },
  },
  {
    version: 7,
    async up(driver) {
      // Rejected derived relationships, kept gone without a competing explicit
      // fact. A NULL `role` dismisses any derived edge to that pair.
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
      // Milestones: partial dates on a polymorphic bearer. Precision comes from
      // which parts are present; Zod checks that a day implies a month.
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
      // Contact methods: three typed tables on a polymorphic owner. The
      // `normalized` indexes are non-unique: duplicates warn, never block.
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
      // Labels became free text, so `label_note` goes; phones gain
      // `sms_capable`, defaulting to textable.
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
      // The key-custody tables: a key exists here only as its wrappings. Empty
      // until an account exists, so "no rows" is a normal state.
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
      // `milestone.note` encrypted at rest under a content key; legacy
      // plaintext rows upgrade to ciphertext on their next write.
      await driver.exec(
        `ALTER TABLE milestones ADD COLUMN note_ciphertext BLOB;`,
      );
    },
  },
  {
    version: 13,
    async up(driver) {
      // Device-local sync watermarks, key/value. No sync substrate: this table
      // never replicates.
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
      // The account (public or blind material only) and its devices. Both carry
      // the sync substrate but never replicate; MK wraps are `key_wrap` rows.
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
      // Login coordinates, NULL on a local-only store. Username uniqueness is a
      // partial index, so the NULLs never collide.
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
      // "Not a duplicate" memory, synced so no device re-asks. Pairs are stored
      // canonicalized, `lower_id` < `higher_id`.
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
      // Rename the polymorphic attachment columns to the **bearer** vocabulary.
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
      // Reminders: freeform notes and tasks. `completed_at` is a reversible
      // toggle; `source` is "user" or "system".
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
      // An optional due date, stored as epoch-ms UTC midnight of the civil day.
      await driver.exec(`ALTER TABLE reminders ADD COLUMN due_date INTEGER;`);
    },
  },
  {
    version: 20,
    async up(driver) {
      // Mentions: an indexed backlink materialized from tokens in the bearer's
      // text, which stays the source of truth. Row ids are deterministic.
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
      // Per-bearer reminder rules. A bearer with no rows rides its kind's
      // defaults; rows exist only once customised.
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
      // Holidays (catalog and user rows), who observes what, and hidden
      // catalog holidays. Ids derive from their keys, so devices converge.
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
      // The self-person: a singleton under a fixed primary key, so two devices
      // setting it resolve by last-writer-wins instead of colliding.
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
      // Gift ideas: reusable and person-agnostic. Near-duplicate titles are
      // tolerated; no unique index.
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
      // Gift recipients: an idea paired with a person or pet. `given_at` stamps
      // when the box was ticked, not when the gift changed hands.
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
      // `milestone.note` is plain TEXT again. A note stored as ciphertext is
      // lost: migrations run before the key exists.
      await driver.exec(`ALTER TABLE milestones DROP COLUMN note_ciphertext;`);
    },
  },
  {
    version: 28,
    async up(driver) {
      // Snooze on any reminder: `snoozed_until` is a user-chosen fact.
      // Re-prompt policy stays derived, never stored.
      await driver.exec(`
        ALTER TABLE reminders ADD COLUMN snoozed_until INTEGER;
        ALTER TABLE reminders ADD COLUMN snooze_count INTEGER NOT NULL DEFAULT 0;
      `);
    },
  },
  {
    version: 29,
    async up(driver) {
      // Per-device notification policy, editable from any device. `id` is the
      // device id; `label`/`platform` are copied, since `device` never syncs.
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
      // Rebuild `people` so first and last name are nullable: SQLite cannot
      // drop NOT NULL in place. Columns are listed explicitly on both sides.
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
      // Where an entity stands in the catalog. Existing rows are the user's
      // own, so `published`. No index: two values, small tables.
      await driver.exec(`
        ALTER TABLE people ADD COLUMN standing TEXT NOT NULL DEFAULT 'published';
        ALTER TABLE pets   ADD COLUMN standing TEXT NOT NULL DEFAULT 'published';
      `);
    },
  },
  {
    version: 32,
    async up(driver) {
      // Messaging platforms a phone number reaches, as a JSON array of platform
      // ids; NULL decodes to "not yet asked".
      await driver.exec(`
        ALTER TABLE phone_numbers ADD COLUMN reachable_on TEXT;
      `);
    },
  },
  {
    version: 33,
    async up(driver) {
      // Social and messaging accounts, the fourth contact method. `platform` is
      // free text, so an unknown platform id syncs and renders from `url`.
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
      // Hard-delete system reminders, tombstones too: a soft-pruned row stays
      // dead until next year. Deterministic ids re-mint what is still wanted.
      await driver.exec(`DELETE FROM reminders WHERE source = 'system'`);
    },
  },
  {
    version: 35,
    async up(driver) {
      // Actions become `verb:qualifier`. Rewritten, not dropped: these are the
      // user's schedules, and their existence answers the `plan` prompt.
      await driver.exec(`
        UPDATE reminder_rules SET action = 'get:gift'    WHERE action = 'gift';
        UPDATE reminder_rules SET action = 'send:card'   WHERE action = 'card';
        UPDATE reminder_rules SET action = 'message:sms' WHERE action = 'text';
      `);

      // The same sweep as migration 34, since three actions changed identity.
      await driver.exec(`DELETE FROM reminders WHERE source = 'system'`);
    },
  },
  {
    version: 36,
    async up(driver) {
      // Device-local links from address-book contacts to what they imported.
      // A row outlives its person, so the next sync does not re-import them.
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
  {
    version: 37,
    async up(driver) {
      // Drop `snooze_count`, and floor `snoozed_until` to a civil day encoded
      // like `due_date`.
      await driver.exec(`
        ALTER TABLE reminders DROP COLUMN snooze_count;
        UPDATE reminders
           SET snoozed_until = snoozed_until - (snoozed_until % 86400000)
         WHERE snoozed_until IS NOT NULL;
      `);
    },
  },
  {
    version: 38,
    async up(driver) {
      // The `anniversary` kind folds into `wedding`. Reminder ids hang off the
      // milestone id, so no system reminder needs re-minting.
      await driver.exec(
        `UPDATE milestones SET kind = 'wedding' WHERE kind = 'anniversary'`,
      );
    },
  },
];

/** Apply every migration newer than `user_version`, each in a transaction,
 *  bumping `user_version` as it goes. */
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
