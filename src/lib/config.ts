import { db } from "@/db";
import { systemConfig } from "@/db/schema";
import { eq } from "drizzle-orm";

export const CONFIG_KEYS = {
  owner: "owner",
  setup: "setup",
  adminDisabled: "admin_disabled",
} as const;

export type OwnerConfig = {
  /** Immutable GitHub account id of the project owner. Never trust logins. */
  githubId: number | null;
  login: string | null;
  /** Configured through env (deployment) or through the one-time setup secret. */
  source: "env" | "database" | "none";
};

export type AppConfig = {
  owner: OwnerConfig;
  /** Kill switch: disables owner privileges without deleting the configuration. */
  adminDisabled: boolean;
  setupCompletedAt: string | null;
};

function envOwnerGithubId(): number | null {
  const raw = process.env.OWNER_GITHUB_ID?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function isGithubOAuthConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

export function isGithubPublishConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}

export function githubPublishTarget(): { repo: string; branch: string } | null {
  const repo = process.env.GITHUB_REPO?.trim();
  if (!repo) return null;
  return { repo, branch: process.env.GITHUB_BRANCH?.trim() || "main" };
}

export function isSetupSecretConfigured(): boolean {
  return Boolean(process.env.ADMIN_SETUP_TOKEN?.trim());
}

/**
 * Loads trusted configuration. Environment always wins so a compromised DB row
 * cannot grant ownership to an attacker-chosen account.
 */
export async function getAppConfig(): Promise<AppConfig> {
  const rows = await db.select().from(systemConfig);
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const envId = envOwnerGithubId();
  const dbOwner = map.get(CONFIG_KEYS.owner) as
    | { githubId?: number | string; login?: string }
    | undefined;
  const dbId = Number(dbOwner?.githubId);

  const owner: OwnerConfig = envId
    ? { githubId: envId, login: (dbOwner?.login as string) ?? null, source: "env" }
    : dbOwner && Number.isInteger(dbId) && dbId > 0
      ? { githubId: dbId, login: (dbOwner.login as string) ?? null, source: "database" }
      : { githubId: null, login: null, source: "none" };

  const setup = map.get(CONFIG_KEYS.setup) as { completedAt?: string } | undefined;
  const adminDisabled = Boolean(map.get(CONFIG_KEYS.adminDisabled)?.enabled);

  return {
    owner,
    adminDisabled: adminDisabled && owner.source !== "none",
    setupCompletedAt: setup?.completedAt ?? null,
  };
}

export async function setConfigValue(key: string, value: Record<string, unknown>) {
  await db
    .insert(systemConfig)
    .values({ key, value })
    .onConflictDoUpdate({ target: systemConfig.key, set: { value, updatedAt: new Date() } });
}

export async function deleteConfigValue(key: string) {
  await db.delete(systemConfig).where(eq(systemConfig.key, key));
}

/** True when the deployment is missing the owner id: admin must never default to "on". */
export async function isAdminConfigured(): Promise<boolean> {
  const cfg = await getAppConfig();
  return cfg.owner.githubId !== null && !cfg.adminDisabled;
}
