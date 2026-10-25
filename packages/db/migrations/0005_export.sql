CREATE TABLE "diagram_renders" (
	"source_hash" text PRIMARY KEY NOT NULL,
	"svg" text,
	"png" "bytea",
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagram_renders_result" CHECK (("diagram_renders"."svg" is not null and "diagram_renders"."png" is not null) <> ("diagram_renders"."error" is not null))
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"include_cover" boolean DEFAULT true NOT NULL,
	"file" "bytea",
	"file_name" text,
	"error" text,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "exports_format" CHECK ("exports"."format" in ('pdf', 'docx')),
	CONSTRAINT "exports_status" CHECK ("exports"."status" in ('queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exports_expires_at_idx" ON "exports" USING btree ("expires_at");