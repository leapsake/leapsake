-- Function to update person timestamp when related entities change
CREATE OR REPLACE FUNCTION update_person_timestamp()
RETURNS TRIGGER AS $$
BEGIN
	UPDATE "People"
	SET "updated_at" = CURRENT_TIMESTAMP
	WHERE "id" = COALESCE(NEW."person_id", OLD."person_id");

	RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Triggers to automatically update person timestamps
CREATE OR REPLACE TRIGGER update_person_on_email_change
	AFTER INSERT OR UPDATE OR DELETE ON "EmailAddresses"
	FOR EACH ROW
	EXECUTE FUNCTION update_person_timestamp();

CREATE OR REPLACE TRIGGER update_person_on_phone_change
	AFTER INSERT OR UPDATE OR DELETE ON "PhoneNumbers"
	FOR EACH ROW
	EXECUTE FUNCTION update_person_timestamp();

CREATE OR REPLACE TRIGGER update_person_on_milestone_change
	AFTER INSERT OR UPDATE OR DELETE ON "Milestones"
	FOR EACH ROW
	EXECUTE FUNCTION update_person_timestamp();