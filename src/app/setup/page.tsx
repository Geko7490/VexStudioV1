"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type SetupStatus = {
  ok: boolean;
  ownerConfigured: boolean;
  ownerSource: "env" | "database" | "none";
  ownerLogin: string | null;
  adminDisabled: boolean;
  setupSecretConfigured: boolean;
  setupCompletedAt: string | null;
};

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [form, setForm] = useState({ setupToken: "", ownerGithubId: "", ownerLogin: "" });
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/setup", { cache: "no-store" });
    setStatus((await res.json()) as SetupStatus);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupToken: form.setupToken, ownerGithubId: Number(form.ownerGithubId), ownerLogin: form.ownerLogin || null }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; ownerGithubId?: number };
      if (!res.ok) throw new Error(data.error ?? "Setup failed");
      setResult(`Owner configured for GitHub id ${data.ownerGithubId}. Sign in with that account to get the owner role.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }, [form, load]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">Secure first-time setup</h1>
      <p className="muted mt-1 text-sm">
        This page provisions the project owner using the one-time <span className="mono">ADMIN_SETUP_TOKEN</span> server secret. It is never exposed to the browser
        and every attempt is rate limited. The first sign-in alone can never claim the owner role.
      </p>

      {status ? (
        <div className="card mt-3 p-4 text-xs">
          <ul className="muted space-y-0.5">
            <li>Owner configured: {status.ownerConfigured ? `yes (${status.ownerSource})` : "no"}</li>
            <li>Owner login label: {status.ownerLogin ?? "—"}</li>
            <li>Admin privileges: {status.adminDisabled ? "disabled" : "enabled"}</li>
            <li>Setup secret present on server: {status.setupSecretConfigured ? "yes" : "no"}</li>
            <li>Setup completed at: {status.setupCompletedAt ?? "—"}</li>
          </ul>
        </div>
      ) : (
        <p className="muted mt-3 text-sm">Loading status…</p>
      )}

      <div className="card mt-3 p-4 text-sm">
        <div className="grid gap-2">
          <div>
            <label className="label" htmlFor="setup-token">
              ADMIN_SETUP_TOKEN
            </label>
            <input id="setup-token" className="input" type="password" value={form.setupToken} onChange={(event) => setForm({ ...form, setupToken: event.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="owner-id">
              Owner GitHub numeric id
            </label>
            <input id="owner-id" className="input" inputMode="numeric" value={form.ownerGithubId} onChange={(event) => setForm({ ...form, ownerGithubId: event.target.value })} placeholder="e.g. 1234567" />
            <p className="muted mt-1 text-xs">Use the numeric id, not the username — usernames can change. Find it at https://api.github.com/users/&lt;login&gt;.</p>
          </div>
          <div>
            <label className="label" htmlFor="owner-login">
              Owner login (display only)
            </label>
            <input id="owner-login" className="input" value={form.ownerLogin} onChange={(event) => setForm({ ...form, ownerLogin: event.target.value })} />
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void submit()}>
            {busy ? "Provisioning…" : "Provision owner"}
          </button>
        </div>
        {result ? <p className="badge badge-ok mt-3 block whitespace-normal text-left">{result}</p> : null}
        {error ? <p className="badge badge-danger mt-3 block whitespace-normal text-left">{error}</p> : null}
        <p className="muted mt-3 text-xs">
          If OWNER_GITHUB_ID is already set as an environment variable it always wins and this page refuses to change it. To disable the owner role without losing
          the configuration, an operator can set the <span className="mono">admin_disabled</span> key in the system configuration table.
        </p>
      </div>

      <Link href="/" className="btn btn-sm mt-3">
        Back to home
      </Link>
    </div>
  );
}
