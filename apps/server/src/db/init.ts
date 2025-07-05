import Pool from './pool.js';

const pool = new Pool();

export async function initDB() {
	pool.query(`
		BEGIN;

		CREATE TABLE IF NOT EXISTS People(
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			family_name TEXT,
			given_name TEXT,
			maiden_name TEXT,
			middle_name TEXT
		);

		CREATE TABLE IF NOT EXISTS Milestones(
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			day TEXT,
			label TEXT,
			month TEXT,
			person_id UUID NOT NULL REFERENCES People(id) ON DELETE CASCADE,
			year TEXT
		);

		CREATE TABLE IF NOT EXISTS EmailAddresses(
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			address TEXT,
			label TEXT,
			person_id UUID NOT NULL REFERENCES People(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS PhoneNumbers(
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			label TEXT,
			number TEXT,
			person_id UUID NOT NULL REFERENCES People(id) ON DELETE CASCADE
		);

		CREATE TABLE IF NOT EXISTS Photos(
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			alt TEXT,
			description TEXT,
			path TEXT
		);

		CREATE TABLE IF NOT EXISTS Albums(
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			description TEXT
		);

		CREATE TABLE IF NOT EXISTS AlbumItems(
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			photo_id UUID NOT NULL REFERENCES Photos(id) ON DELETE CASCADE,
			album_id UUID NOT NULL REFERENCES Albums(id) ON DELETE CASCADE
		);

		-- Indexes
		CREATE INDEX IF NOT EXISTS idx_emailaddress_person_id ON EmailAddresses(person_id);
		CREATE INDEX IF NOT EXISTS idx_milestones_person_id ON Milestones(person_id);
		CREATE INDEX IF NOT EXISTS idx_phonenumbers_person_id ON PhoneNumbers(person_id);

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

		CREATE OR REPLACE TRIGGER update_person_on_email_change
			AFTER INSERT OR UPDATE OR DELETE ON EmailAddresses
			FOR EACH ROW
			EXECUTE FUNCTION update_person_timestamp();

		CREATE OR REPLACE TRIGGER update_person_on_phone_change
			AFTER INSERT OR UPDATE OR DELETE ON PhoneNumbers
			FOR EACH ROW
			EXECUTE FUNCTION update_person_timestamp();

		CREATE OR REPLACE TRIGGER update_person_on_milestone_change
			AFTER INSERT OR UPDATE OR DELETE ON Milestones
			FOR EACH ROW
			EXECUTE FUNCTION update_person_timestamp();

		COMMIT;
	`);

	pool.end();
}
