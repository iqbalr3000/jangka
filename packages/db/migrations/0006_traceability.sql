CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"priority" text,
	"upstream_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirements_document_code" UNIQUE("document_id","code"),
	CONSTRAINT "requirements_kind" CHECK ("requirements"."kind" in ('business', 'functional', 'non_functional', 'technical')),
	CONSTRAINT "requirements_priority" CHECK ("requirements"."priority" in ('must', 'should', 'could'))
);
--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "include_appendix" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_source_document_id_idx" ON "documents" USING btree ("source_document_id");