ALTER TABLE "instance_settings" ADD COLUMN "default_templates" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Templates that existed before drafts were introduced are all published (before the
-- one-draft index, which they would otherwise violate).
UPDATE "templates" SET "published_at" = "created_at" WHERE "published_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_one_draft" ON "templates" USING btree ("doc_type","name") WHERE "templates"."published_at" is null;