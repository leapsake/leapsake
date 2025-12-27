-- Initial schema for people management
-- Following AGENTS.md conventions:
-- - Table names: plural snake_case
-- - Primary keys: UUIDs as TEXT
-- - Timestamps: INTEGER (Unix epoch milliseconds)
-- - Dates: TEXT (ISO 8601)

-- People table (core entity)
CREATE TABLE people (
    id TEXT PRIMARY KEY,
    given_name TEXT,
    middle_name TEXT,
    family_name TEXT,
    birthday TEXT,
    anniversary TEXT,
    photo TEXT,
    organization TEXT,
    title TEXT,
    url TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Email addresses (one-to-many relationship)
CREATE TABLE email_addresses (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    label TEXT,
    position INTEGER NOT NULL,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE INDEX idx_email_addresses_person_id ON email_addresses(person_id);
CREATE INDEX idx_email_addresses_email ON email_addresses(email);

-- Phone numbers (one-to-many relationship)
CREATE TABLE phone_numbers (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    label TEXT,
    features_json TEXT,
    position INTEGER NOT NULL,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE INDEX idx_phone_numbers_person_id ON phone_numbers(person_id);

-- Addresses (one-to-many relationship)
CREATE TABLE addresses (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    street TEXT NOT NULL,
    locality TEXT,
    region TEXT,
    postcode TEXT,
    country TEXT,
    label TEXT,
    position INTEGER NOT NULL,
    FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
);

CREATE INDEX idx_addresses_person_id ON addresses(person_id);

-- Full-text search virtual table for people
-- Note: FTS5 requires integer rowids, but we use TEXT UUIDs as primary keys
-- So we create FTS without content table and manually sync
CREATE VIRTUAL TABLE people_fts USING fts5(
    id UNINDEXED,
    given_name,
    middle_name,
    family_name,
    organization,
    note
);

-- Triggers to keep FTS index in sync with people table
CREATE TRIGGER people_fts_insert AFTER INSERT ON people BEGIN
    INSERT INTO people_fts(id, given_name, middle_name, family_name, organization, note)
    VALUES (new.id, new.given_name, new.middle_name, new.family_name, new.organization, new.note);
END;

CREATE TRIGGER people_fts_delete AFTER DELETE ON people BEGIN
    DELETE FROM people_fts WHERE id = old.id;
END;

CREATE TRIGGER people_fts_update AFTER UPDATE ON people BEGIN
    UPDATE people_fts
    SET given_name = new.given_name,
        middle_name = new.middle_name,
        family_name = new.family_name,
        organization = new.organization,
        note = new.note
    WHERE id = new.id;
END;
