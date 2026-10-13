import { assertSafeProjectPath } from "./paths";

const GITHUB_API = "https://api.github.com";

function assertEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "vex-studio",
  };
}

async function githubFetch(path: string, init: RequestInit & { token: string }): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      ...init,
      headers: githubHeaders(init.token),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(`GitHub network error: ${error instanceof Error ? error.message : "unknown"}`);
  }
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = res.headers.get("x-ratelimit-reset");
    const at = reset ? new Date(Number(reset) * 1000).toISOString() : "later";
    throw new Error(`GitHub API rate limit exhausted. Resets at ${at}.`);
  }
  return res;
}

export type GithubIdentity = { id: number; login: string; name: string | null; avatarUrl: string | null };

/** Minimum scope: read:user. No repository scope is requested from end users. */
export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const clientId = assertEnv(process.env.GITHUB_CLIENT_ID, "GITHUB_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user",
    state,
    allow_signup: "true",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/** Validates the OAuth callback redirect target against the configured host. */
export function resolveRedirectUri(req: Request): string {
  const configured = process.env.GITHUB_REDIRECT_URI?.trim();
  if (configured) return configured;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host");
  if (!host) throw new Error("Unable to determine callback host");
  return `${proto}://${host}/api/auth/github/callback`;
}

export function assertValidCallbackUri(uri: string, expectedBase: string) {
  const parsed = new URL(uri);
  const base = new URL(expectedBase);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("bad protocol");
  if (parsed.host !== base.host || parsed.pathname !== base.pathname) throw new Error("callback host mismatch");
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const clientId = assertEnv(process.env.GITHUB_CLIENT_ID, "GITHUB_CLIENT_ID");
  const clientSecret = assertEnv(process.env.GITHUB_CLIENT_SECRET, "GITHUB_CLIENT_SECRET");
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "vex-studio" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const payload = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || payload.error || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `Token exchange failed (${res.status})`);
  }
  return payload.access_token;
}

export async function fetchGithubIdentity(accessToken: string): Promise<GithubIdentity> {
  const res = await githubFetch("/user", { token: accessToken });
  if (!res.ok) throw new Error(`Unable to read GitHub identity (${res.status})`);
  const data = (await res.json()) as { id: number; login: string; name: string | null; avatar_url: string | null };
  return { id: Number(data.id), login: data.login, name: data.name ?? null, avatarUrl: data.avatar_url ?? null };
}

export type PublishResult = {
  commitSha: string;
  treeSha: string;
  branch: string;
  verified: { path: string; ok: boolean }[];
  htmlUrl: string | null;
};

/** Publishes files with the Git Data API and verifies the resulting commit content. */
export async function publishFilesToGithub(input: {
  files: { path: string; content: string }[];
  message: string;
  deletePaths?: string[];
}): Promise<PublishResult> {
  const token = assertEnv(process.env.GITHUB_TOKEN, "GITHUB_TOKEN");
  const repo = assertEnv(process.env.GITHUB_REPO, "GITHUB_REPO");
  const branch = process.env.GITHUB_BRANCH?.trim() || "main";
  const prefix = (process.env.GITHUB_PROJECTS_PREFIX?.trim() || "projects").replace(/^\/|\/$/g, "");

  if (input.files.length === 0) throw new Error("No files to publish");

  const paths = input.files.map((f) => assertSafeProjectPath(f.path));
  for (const p of input.deletePaths ?? []) assertSafeProjectPath(p);

  const refRes = await githubFetch(`/repos/${repo}/git/ref/heads/${branch}`, { token });
  let baseCommitSha: string;
  if (refRes.ok) {
    baseCommitSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;
  } else if (refRes.status === 404) {
    const headRes = await githubFetch(`/repos/${repo}/git/refs/heads`, { token });
    if (!headRes.ok) throw new Error(`Unable to read repository branches (${headRes.status})`);
    const refs = (await headRes.json()) as { name: string; object: { sha: string } }[];
    const fallback = refs[0];
    if (!fallback) throw new Error("Repository has no branches to branch from");
    const createRes = await githubFetch(`/repos/${repo}/git/refs`, {
      token,
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fallback.object.sha }),
    });
    if (!createRes.ok) throw new Error(`Unable to create branch ${branch} (${createRes.status})`);
    baseCommitSha = fallback.object.sha;
  } else {
    throw new Error(`Unable to read ${branch} (${refRes.status})`);
  }

  const commitRes = await githubFetch(`/repos/${repo}/git/commits/${baseCommitSha}`, { token });
  if (!commitRes.ok) throw new Error(`Unable to read base commit (${commitRes.status})`);
  const baseTreeSha = ((await commitRes.json()) as { tree: { sha: string } }).tree.sha;

  const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
  const blobShas = new Map<string, string>();
  for (const file of input.files) {
    const path = assertSafeProjectPath(file.path);
    const blobRes = await githubFetch(`/repos/${repo}/git/blobs`, {
      token,
      method: "POST",
      body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
    });
    if (!blobRes.ok) throw new Error(`Blob creation failed for ${path} (${blobRes.status})`);
    const sha = ((await blobRes.json()) as { sha: string }).sha;
    blobShas.set(`${prefix}/${path}`, sha);
    tree.push({ path: `${prefix}/${path}`, mode: "100644", type: "blob", sha });
  }
  for (const p of input.deletePaths ?? []) {
    tree.push({ path: `${prefix}/${assertSafeProjectPath(p)}`, mode: "100644", type: "blob", sha: "" });
  }

  const treeRes = await githubFetch(`/repos/${repo}/git/trees`, {
    token,
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });
  if (!treeRes.ok) throw new Error(`Tree creation failed (${treeRes.status})`);
  const newTreeSha = ((await treeRes.json()) as { sha: string }).sha;

  const newCommitRes = await githubFetch(`/repos/${repo}/git/commits`, {
    token,
    method: "POST",
    body: JSON.stringify({ message: input.message, tree: newTreeSha, parents: [baseCommitSha] }),
  });
  if (!newCommitRes.ok) throw new Error(`Commit creation failed (${newCommitRes.status})`);
  const newCommitSha = ((await newCommitRes.json()) as { sha: string }).sha;

  const refPatch = await githubFetch(`/repos/${repo}/git/refs/heads/${branch}`, {
    token,
    method: "PATCH",
    body: JSON.stringify({ sha: newCommitSha, force: false }),
  });
  if (!refPatch.ok) throw new Error(`Branch update failed (${refPatch.status})`);

  // Verify that the remote tree really contains what we sent.
  const verified: { path: string; ok: boolean }[] = [];
  for (const [fullPath, sha] of blobShas) {
    const check = await githubFetch(`/repos/${repo}/contents/${fullPath}?ref=${newCommitSha}`, { token });
    const ok = check.ok && ((await check.json()) as { sha?: string }).sha === sha;
    verified.push({ path: fullPath, ok });
  }

  return {
    commitSha: newCommitSha,
    treeSha: newTreeSha,
    branch,
    verified,
    htmlUrl: `https://github.com/${repo}/commit/${newCommitSha}`,
  };
}
