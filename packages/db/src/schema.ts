import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);
const tz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => tz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: integer("id").primaryKey().default(1),
    orgName: text("org_name"),
    setupCompletedAt: tz("setup_completed_at"),
    setupTokenHash: text("setup_token_hash"),
    defaultLlmProviderId: uuid("default_llm_provider_id").references(() => llmProviders.id, {
      onDelete: "set null",
    }),
    defaultModel: text("default_model"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("instance_settings_singleton", sql`${t.id} = 1`)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: tz("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("users_email_lowercase", sql`${t.email} = lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: tz("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    // Also marks the last rolling extension.
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const groups = pgTable("groups", {
  id: id(),
  name: text("name").notNull().unique(),
  systemKey: text("system_key", { enum: ["admins", "all_users"] }).unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const invites = pgTable(
  "invites",
  {
    id: id(),
    kind: text("kind", { enum: ["invite", "password_reset"] }).notNull(),
    email: text("email").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: tz("expires_at").notNull(),
    usedAt: tz("used_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("invites_kind", sql`${t.kind} in ('invite', 'password_reset')`),
    check("invites_reset_has_user", sql`${t.kind} = 'invite' or ${t.userId} is not null`),
  ],
);

export const collections = pgTable(
  "collections",
  {
    id: id(),
    parentId: uuid("parent_id").references((): AnyPgColumn => collections.id),
    name: text("name").notNull(),
    personalOwnerId: uuid("personal_owner_id")
      .unique()
      .references(() => users.id),
    archivedAt: tz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("collections_parent_id_idx").on(t.parentId),
    check(
      "collections_personal_top_level",
      sql`${t.personalOwnerId} is null or ${t.parentId} is null`,
    ),
  ],
);

export const collectionGrants = pgTable(
  "collection_grants",
  {
    id: id(),
    // null = the root ("Our documents").
    collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    level: text("level", { enum: ["none", "view", "edit"] }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("collection_grants_collection_group").on(t.collectionId, t.groupId).nullsNotDistinct(),
    check("collection_grants_level", sql`${t.level} in ('none', 'view', 'edit')`),
  ],
);

export const llmProviders = pgTable(
  "llm_providers",
  {
    id: id(),
    kind: text("kind", { enum: ["anthropic", "openai", "gemini", "openrouter", "fake"] }).notNull(),
    label: text("label").notNull(),
    // Null only for the fake provider. Encrypted with MASTER_KEY (packages/shared/crypto).
    apiKeyEnc: text("api_key_enc"),
    keyLast4: text("key_last4"),
    baseUrl: text("base_url"),
    enabled: boolean("enabled").notNull().default(true),
    lastTestedAt: tz("last_tested_at"),
    lastTestError: text("last_test_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "llm_providers_kind",
      sql`${t.kind} in ('anthropic', 'openai', 'gemini', 'openrouter', 'fake')`,
    ),
  ],
);
