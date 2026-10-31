CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"document_id" uuid,
	"provider_kind" text NOT NULL,
	"model" text NOT NULL,
	"operation" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_usage_operation" CHECK ("llm_usage"."operation" in ('chat', 'coverage', 'draft', 'check', 'revise', 'propose', 'diagram_fix'))
);
--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_usage_created_at_idx" ON "llm_usage" USING btree ("created_at");--> statement-breakpoint
-- Backfill from assistant messages that recorded tokens. The author is the thread's latest user
-- message before the reply; structured calls (coverage, checks, diagram fixes) weren't recorded then.
INSERT INTO "llm_usage" ("id", "user_id", "document_id", "provider_kind", "model", "operation", "input_tokens", "output_tokens", "created_at")
SELECT
  uuidv7(),
  (
    SELECT u."created_by" FROM "chat_messages" u
    WHERE u."thread_id" = m."thread_id" AND u."role" = 'user' AND u."created_at" <= m."created_at"
    ORDER BY u."created_at" DESC, u."id" DESC
    LIMIT 1
  ),
  t."document_id",
  m."provider_kind",
  m."model",
  CASE
    WHEN m."kind" = 'revise' AND m."content" LIKE 'Proposed updates to %' THEN 'propose'
    ELSE m."kind"
  END,
  m."input_tokens",
  COALESCE(m."output_tokens", 0),
  m."created_at"
FROM "chat_messages" m
JOIN "chat_threads" t ON t."id" = m."thread_id"
WHERE m."role" = 'assistant'
  AND m."input_tokens" IS NOT NULL
  AND m."provider_kind" IS NOT NULL
  AND m."model" IS NOT NULL;
