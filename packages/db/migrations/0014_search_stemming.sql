ALTER TABLE "document_sections" drop column "search";--> statement-breakpoint
ALTER TABLE "document_sections" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', content_md) || to_tsvector('english', content_md) || to_tsvector('indonesian', content_md)) STORED;--> statement-breakpoint
-- Dropping the column dropped its index; same definition as 0011.
CREATE INDEX "document_sections_search_idx" ON "document_sections" USING gin ("search");
