-- A parent's custody period must end after it starts, and two periods in
-- the same family can never overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "custody_segments" ADD CONSTRAINT "custody_segments_valid_range" CHECK ("ends_at" > "starts_at");
--> statement-breakpoint
ALTER TABLE "custody_segments" ADD CONSTRAINT "custody_segments_no_overlap"
  EXCLUDE USING gist ("family_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&);
--> statement-breakpoint
ALTER TABLE "proposal_segments" ADD CONSTRAINT "proposal_segments_valid_range" CHECK ("ends_at" > "starts_at");
--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_valid_range" CHECK ("range_end" > "range_start");
