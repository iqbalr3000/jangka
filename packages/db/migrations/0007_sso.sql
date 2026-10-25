CREATE TABLE "auth_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" text NOT NULL,
	"secret_last4" text NOT NULL,
	"allowed_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"auto_provision" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_providers_kind" CHECK ("auth_providers"."kind" in ('google', 'oidc'))
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "user_identities_provider_subject" UNIQUE("provider_id","subject")
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "password_login_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "default_group_id" uuid;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_provider_id_auth_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."auth_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_identities_user_id_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_default_group_id_groups_id_fk" FOREIGN KEY ("default_group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;