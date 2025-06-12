import Pool from './pool';

const pool = new Pool();

pool.query(`
	BEGIN;

	CREATE TABLE IF NOT EXISTS People(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		family_name TEXT,
		given_name TEXT,
		maiden_name TEXT,
		middle_name TEXT
	);

	CREATE TABLE IF NOT EXISTS Milestones(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		day TEXT,
		label TEXT,
		month TEXT,
		person_id UUID NOT NULL REFERENCES People(id) ON DELETE CASCADE,
		year TEXT
	);

	CREATE TABLE IF NOT EXISTS EmailAddresses(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		address TEXT,
		label TEXT,
		person_id UUID NOT NULL REFERENCES People(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS PhoneNumbers(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		label TEXT,
		number TEXT,
		person_id UUID NOT NULL REFERENCES People(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS Photos(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		alt TEXT,
		description TEXT,
		path TEXT
	);

	CREATE TABLE IF NOT EXISTS PhotoAlbums(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		description TEXT
	);

	CREATE TABLE IF NOT EXISTS PhotoAlbumItems(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		photo_id UUID NOT NULL REFERENCES Photos(id) ON DELETE CASCADE,
		photo_album_id UUID NOT NULL REFERENCES PhotoAlbums(id) ON DELETE CASCADE
	);

	-- Indexes
	CREATE INDEX idx_emailaddress_person_id ON EmailAddresses(person_id);
	CREATE INDEX idx_milestones_person_id ON Milestones(person_id);
	CREATE INDEX idx_phonenumbers_person_id ON PhoneNumbers(person_id);

	-- Triggers
	CREATE OR REPLACE FUNCTION update_person_timestamp()
	RETURNS TRIGGER AS $$
	BEGIN
		UPDATE People
		SET updated_at = CURRENT_TIMESTAMP
		WHERE id = COALESCE(NEW.person_id, OLD.person_id);

		RETURN COALESCE(NEW, OLD);
	END;
	$$ LANGUAGE plpgsql;

	CREATE TRIGGER update_person_on_email_change
		AFTER INSERT OR UPDATE OR DELETE ON EmailAddresses
		FOR EACH ROW
		EXECUTE FUNCTION update_person_timestamp();

	CREATE TRIGGER update_person_on_phone_change
		AFTER INSERT OR UPDATE OR DELETE ON PhoneNumbers
		FOR EACH ROW
		EXECUTE FUNCTION update_person_timestamp();

	CREATE TRIGGER update_person_on_milestone_change
		AFTER INSERT OR UPDATE OR DELETE ON Milestones
		FOR EACH ROW
		EXECUTE FUNCTION update_person_timestamp();

	COMMIT;
`);

pool.end();
