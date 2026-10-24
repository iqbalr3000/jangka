CREATE TABLE "llm_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"api_key_enc" text,
	"key_last4" text,
	"base_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_providers_kind" CHECK ("llm_providers"."kind" in ('anthropic', 'openai', 'gemini', 'openrouter', 'fake'))
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "default_llm_provider_id" uuid;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "default_model" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_default_llm_provider_id_llm_providers_id_fk" FOREIGN KEY ("default_llm_provider_id") REFERENCES "public"."llm_providers"("id") ON DELETE set null ON UPDATE no action;