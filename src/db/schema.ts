import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** GitHub identities. Role is always re-derived from OWNER_GITHUB_ID on the server. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubId: bigint("github_id", { mode: "number" }).notNull(),
    login: text("login").notNull(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_github_id_uq").on(t.githubId)],
);

/** Server-side sessions. Only a SHA-256 hash of the token is persisted. */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfToken: text("csrf_token").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default("general"),
    /** web | python | node | cpp | unknown */
    kind: text("kind").notNull().default("unknown"),
    runtimes: jsonb("runtimes").$type<string[]>().notNull().default([]),
    dependencies: jsonb("dependencies").$type<string[]>().notNull().default([]),
    entryFile: text("entry_file"),
    manifest: jsonb("manifest").$type<Record<string, unknown>>(),
    testSummary: jsonb("test_summary").$type<Record<string, unknown>>(),
    docsUrl: text("docs_url"),
    /** path inside the publishing repository, e.g. projects/vex-pong */
    repositoryPath: text("repository_path"),
    /** published | archived */
    status: text("status").notNull().default("published"),
    latestVersion: text("latest_version"),
    latestCommitSha: text("latest_commit_sha"),
    latestVersionId: uuid("latest_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_status_idx").on(t.status)],
);

export const projectVersions = pgTable(
  "project_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id").notNull(),
    version: text("version").notNull(),
    commitSha: text("commit_sha"),
    changelog: text("changelog").notNull().default(""),
    fileCount: integer("file_count").notNull().default(0),
    totalBytes: integer("total_bytes").notNull().default(0),
    manifest: jsonb("manifest").$type<Record<string, unknown>>(),
    testSummary: jsonb("test_summary").$type<Record<string, unknown>>(),
    /** stored | github (github means the Git Data API confirmed the commit) */
    publishState: text("publish_state").notNull().default("stored"),
    publishError: text("publish_error"),
    githubVerified: boolean("github_verified").notNull().default(false),
    active: boolean("active").notNull().default(true),
    contentHash: text("content_hash").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (t) => [uniqueIndex("project_versions_uq").on(t.projectId, t.version)],
);

export const projectFiles = pgTable(
  "project_files",
  {
    id: serial("id").primaryKey(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => projectVersions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull(),
    size: integer("size").notNull().default(0),
  },
  (t) => [uniqueIndex("project_files_uq").on(t.versionId, t.path)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorUserId: uuid("actor_user_id"),
    actorLogin: text("actor_login"),
    action: text("action").notNull(),
    target: text("target").notNull().default(""),
    outcome: text("outcome").notNull().default("ok"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_created_idx").on(t.createdAt)],
);

export const serverLogs = pgTable(
  "server_logs",
  {
    id: serial("id").primaryKey(),
    level: text("level").notNull().default("info"),
    scope: text("scope").notNull().default("app"),
    message: text("message").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("server_logs_created_idx").on(t.createdAt)],
);

/** Trusted, server-only configuration (owner id, feature switches). */
export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Optional cloud mirror of a user's local mod (opt-in sync, never required). */
export const modBackups = pgTable(
  "mod_backups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    modId: text("mod_id").notNull(),
    name: text("name").notNull(),
    sourceProjectId: text("source_project_id").notNull().default(""),
    sourceVersion: text("source_version").notNull().default(""),
    localVersion: integer("local_version").notNull().default(1),
    files: jsonb("files").$type<{ path: string; content: string }[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mod_backups_uq").on(t.userId, t.modId)],
);

export type UserRow = typeof users.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ProjectVersionRow = typeof projectVersions.$inferSelect;
