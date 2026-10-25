import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

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

export const templates = pgTable(
  "templates",
  {
    id: id(),
    docType: text("doc_type", { enum: ["brd", "prd", "tsd"] }).notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    // TemplateDefinition (packages/templates); immutable once published.
    definition: jsonb("definition").notNull(),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("templates_doc_type_name_version").on(t.docType, t.name, t.version),
    check("templates_doc_type", sql`${t.docType} in ('brd', 'prd', 'tsd')`),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    // null = the root ("Our documents").
    collectionId: uuid("collection_id").references(() => collections.id),
    docType: text("doc_type", { enum: ["brd", "prd", "tsd"] }).notNull(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id),
    title: text("title").notNull(),
    status: text("status", { enum: ["draft", "in_review", "approved"] })
      .notNull()
      .default("draft"),
    createdBy: uuid("created_by").references(() => users.id),
    archivedAt: tz("archived_at"),
    sourceDocumentId: uuid("source_document_id").references((): AnyPgColumn => documents.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("documents_collection_id_idx").on(t.collectionId),
    check("documents_doc_type", sql`${t.docType} in ('brd', 'prd', 'tsd')`),
    check("documents_status", sql`${t.status} in ('draft', 'in_review', 'approved')`),
  ],
);

export const documentSections = pgTable(
  "document_sections",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    sectionKey: text("section_key").notNull(),
    position: integer("position").notNull(),
    // TipTap JSON (source of truth); content_md is derived from it.
    content: jsonb("content").notNull(),
    contentMd: text("content_md").notNull().default(""),
    completeness: text("completeness", { enum: ["empty", "partial", "complete"] })
      .notNull()
      .default("empty"),
    // Optimistic lock: every write must name the revision it was based on.
    revision: integer("revision").notNull().default(0),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("document_sections_document_key").on(t.documentId, t.sectionKey),
    check(
      "document_sections_completeness",
      sql`${t.completeness} in ('empty', 'partial', 'complete')`,
    ),
  ],
);

/** Append-only (hard rule #7); a trigger rejects UPDATE and DELETE. */
export const sectionVersions = pgTable(
  "section_versions",
  {
    id: id(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => documentSections.id),
    revision: integer("revision").notNull(),
    content: jsonb("content").notNull(),
    source: text("source", { enum: ["llm", "human"] }).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("section_versions_section_revision").on(t.sectionId, t.revision),
    check("section_versions_source", sql`${t.source} in ('llm', 'human')`),
  ],
);

/** One shared thread per document. */
export const chatThreads = pgTable("chat_threads", {
  id: id(),
  documentId: uuid("document_id")
    .notNull()
    .unique()
    .references(() => documents.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    kind: text("kind", { enum: ["chat", "draft", "revise"] }).notNull(),
    content: text("content").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    // Stopped by the user or cut off by a provider error; content is what arrived.
    interrupted: boolean("interrupted").notNull().default(false),
    providerKind: text("provider_kind"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: createdAt(),
  },
  (t) => [
    index("chat_messages_thread_id_idx").on(t.threadId),
    check("chat_messages_role", sql`${t.role} in ('user', 'assistant')`),
    check("chat_messages_kind", sql`${t.kind} in ('chat', 'draft', 'revise')`),
  ],
);

export const interviewStates = pgTable("interview_states", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),
  // InterviewState (packages/shared/assistant), normalized to every template section.
  state: jsonb("state").notNull(),
  updatedAt: updatedAt(),
});

/** Cache of authoritative Mermaid renders, keyed by `diagramHash` (packages/export). */
export const diagramRenders = pgTable(
  "diagram_renders",
  {
    sourceHash: text("source_hash").primaryKey(),
    svg: text("svg"),
    png: bytea("png"),
    // Mermaid's parse/render error; cached so a broken source isn't rendered again.
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "diagram_renders_result",
      sql`(${t.svg} is not null and ${t.png} is not null) <> (${t.error} is not null)`,
    ),
  ],
);

export const documentExports = pgTable(
  "exports",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    format: text("format", { enum: ["pdf", "docx"] }).notNull(),
    status: text("status", { enum: ["queued", "running", "done", "failed"] })
      .notNull()
      .default("queued"),
    includeCover: boolean("include_cover").notNull().default(true),
    file: bytea("file"),
    fileName: text("file_name"),
    error: text("error"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    expiresAt: tz("expires_at").notNull(),
  },
  (t) => [
    index("exports_expires_at_idx").on(t.expiresAt),
    check("exports_format", sql`${t.format} in ('pdf', 'docx')`),
    check("exports_status", sql`${t.status} in ('queued', 'running', 'done', 'failed')`),
  ],
);
