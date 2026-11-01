CREATE TABLE "document_reviewers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"verdict" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_reviewers_document_user" UNIQUE("document_id","user_id"),
	CONSTRAINT "document_reviewers_verdict" CHECK ("document_reviewers"."verdict" is null or "document_reviewers"."verdict" in ('approved', 'changes_requested'))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind";--> statement-breakpoint
ALTER TABLE "document_reviewers" ADD CONSTRAINT "document_reviewers_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviewers" ADD CONSTRAINT "document_reviewers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reviewers" ADD CONSTRAINT "document_reviewers_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_reviewers_user_id_idx" ON "document_reviewers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind" CHECK ("notifications"."kind" in ('mention', 'reply', 'resolved', 'status', 'review_requested', 'review_verdict'));