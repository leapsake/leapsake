CREATE TABLE "AlbumItems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"photo_id" uuid NOT NULL,
	"album_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"description" text
);
--> statement-breakpoint
CREATE TABLE "EmailAddresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"address" text,
	"label" text,
	"person_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "People" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"family_name" text,
	"given_name" text,
	"maiden_name" text,
	"middle_name" text
);
--> statement-breakpoint
CREATE TABLE "Milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"day" text,
	"label" text,
	"month" text,
	"person_id" uuid NOT NULL,
	"year" text
);
--> statement-breakpoint
CREATE TABLE "PhoneNumbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"label" text,
	"number" text,
	"person_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"alt" text,
	"description" text,
	"path" text
);
--> statement-breakpoint
ALTER TABLE "AlbumItems" ADD CONSTRAINT "AlbumItems_photo_id_Photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."Photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "AlbumItems" ADD CONSTRAINT "AlbumItems_album_id_Albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."Albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EmailAddresses" ADD CONSTRAINT "EmailAddresses_person_id_People_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."People"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Milestones" ADD CONSTRAINT "Milestones_person_id_People_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."People"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PhoneNumbers" ADD CONSTRAINT "PhoneNumbers_person_id_People_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."People"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_emailaddress_person_id" ON "EmailAddresses" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "idx_milestones_person_id" ON "Milestones" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "idx_phonenumbers_person_id" ON "PhoneNumbers" USING btree ("person_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION update_person_timestamp()
RETURNS TRIGGER AS $$
BEGIN
	UPDATE "People"
	SET "updated_at" = CURRENT_TIMESTAMP
	WHERE "id" = COALESCE(NEW."person_id", OLD."person_id");

	RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE TRIGGER update_person_on_email_change
	AFTER INSERT OR UPDATE OR DELETE ON "EmailAddresses"
	FOR EACH ROW
	EXECUTE FUNCTION update_person_timestamp();--> statement-breakpoint
CREATE OR REPLACE TRIGGER update_person_on_phone_change
	AFTER INSERT OR UPDATE OR DELETE ON "PhoneNumbers"
	FOR EACH ROW
	EXECUTE FUNCTION update_person_timestamp();--> statement-breakpoint
CREATE OR REPLACE TRIGGER update_person_on_milestone_change
	AFTER INSERT OR UPDATE OR DELETE ON "Milestones"
	FOR EACH ROW
	EXECUTE FUNCTION update_person_timestamp();