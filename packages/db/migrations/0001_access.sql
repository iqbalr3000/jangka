CREATE TABLE "collection_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collection_id" uuid,
	"group_id" uuid NOT NULL,
	"level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_grants_collection_group" UNIQUE NULLS NOT DISTINCT("collection_id","group_id"),
	CONSTRAINT "collection_grants_level" CHECK ("collection_grants"."level" in ('none', 'view', 'edit'))
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"personal_owner_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_personal_owner_id_unique" UNIQUE("personal_owner_id"),
	CONSTRAINT "collections_personal_top_level" CHECK ("collections"."personal_owner_id" is null or "collections"."parent_id" is null)
);
--> statement-breakpoint
ALTER TABLE "collection_grants" ADD CONSTRAINT "collection_grants_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_grants" ADD CONSTRAINT "collection_grants_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_parent_id_collections_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_personal_owner_id_users_id_fk" FOREIGN KEY ("personal_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collections_parent_id_idx" ON "collections" USING btree ("parent_id");--> statement-breakpoint
-- Backfill: every existing user gets a personal collection (new users get one on creation).
INSERT INTO "collections" ("id", "name", "personal_owner_id")
SELECT uuidv7(), "name" || '''s personal collection', "id" FROM "users";
