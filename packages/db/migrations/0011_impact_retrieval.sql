ALTER TABLE "chat_messages" ADD COLUMN "references" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "document_sections" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', content_md)) STORED;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "content_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "upstream_reviewed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "document_sections_search_idx" ON "document_sections" USING gin ("search");--> statement-breakpoint
-- Existing requirements: their last change is the best known content change.
UPDATE "requirements" SET "content_changed_at" = "updated_at";
