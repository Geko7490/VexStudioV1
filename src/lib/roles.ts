/** Pure role logic shared by the server (and covered by unit tests). */
export type OwnerSource = "env" | "database" | "none";
export type Role = "guest" | "user" | "owner";

export type RoleConfig = {
  githubId: number | null;
  adminDisabled: boolean;
};

/**
 * The only source of admin rights is a trusted, immutable GitHub account id.
 * Missing configuration yields "user", never "owner" — the check fails closed.
 */
export function deriveRole(githubId: number, config: RoleConfig): Role {
  if (config.githubId === null || config.adminDisabled) return "user";
  if (!Number.isInteger(githubId) || githubId <= 0) return "user";
  return githubId === config.githubId ? "owner" : "user";
}
