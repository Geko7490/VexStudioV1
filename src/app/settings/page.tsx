"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { formatBytes } from "@/lib/ai/models";
import { exportAllModsZip, getGuestIdentity, storageEstimate } from "@/lib/local-store";

export default function SettingsPage() {
  const { session, refresh } = useSession();
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const [guest, setGuest] = useState<{ guestId: string; label: string; createdAt: string } | null>(null);
  const [theme, setTheme] = useState("dark");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    void storageEstimate().then(setStorage);
    void getGuestIdentity().then(setGuest);
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="card mt-3 p-4 text-sm">
        <h2 className="text-sm font-semibold">Appearance</h2>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              document.documentElement.dataset.theme = next;
              window.localStorage.setItem("vex-theme", next);
            }}
          >
            Switch to {theme === "dark" ? "light" : "dark"} theme
          </button>
          <span className="muted text-xs">Current: {theme}</span>
        </div>
      </section>

      <section className="card mt-3 p-4 text-sm">
        <h2 className="text-sm font-semibold">Account</h2>
        {session?.authenticated ? (
          <div className="mt-2 text-xs">
            <p>
              Signed in as <strong>{session.user?.login}</strong> · GitHub id {session.user?.githubId} · role <strong>{session.role}</strong>
            </p>
            <p className="muted mt-1">
              Roles are computed on the server from OWNER_GITHUB_ID (source: {session.deployment.ownerSource}). Changing a GitHub username does not change the role.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST", headers: { "x-csrf-token": session.csrfToken ?? "" }, body: "{}" });
                  await refresh();
                  setNotice("Signed out. Local mods stay in this browser.");
                }}
              >
                Sign out
              </button>
              {session.role === "owner" ? (
                <Link href="/admin" className="btn btn-sm btn-primary">
                  Admin Panel
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-xs">
            <p className="muted">
              Not signed in. Guest identity: <span className="mono">{guest?.guestId ?? "…"}</span> (created {guest ? new Date(guest.createdAt).toLocaleString() : ""}).
              This id only lives in your browser and grants no rights.
            </p>
            <Link href="/login" className="btn btn-sm mt-2">
              Sign in with GitHub
            </Link>
          </div>
        )}
      </section>

      <section className="card mt-3 p-4 text-sm">
        <h2 className="text-sm font-semibold">Local storage</h2>
        {storage ? (
          <p className="muted mt-1 text-xs">
            {formatBytes(storage.usage)} used of {formatBytes(storage.quota)} quota · {storage.persisted ? "persistent storage granted" : "best-effort storage"}
          </p>
        ) : (
          <p className="muted mt-1 text-xs">This browser does not report storage estimates.</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              const bytes = await exportAllModsZip();
              setNotice(`Backup ZIP downloaded (${formatBytes(bytes)}).`);
            }}
          >
            Download full backup (ZIP)
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              const granted = await navigator.storage?.persist?.().catch(() => false);
              setNotice(granted ? "Persistent storage granted." : "The browser declined persistent storage.");
              setStorage(await storageEstimate());
            }}
          >
            Request persistent storage
          </button>
          <Link href="/mods" className="btn btn-sm">
            Manage mods
          </Link>
        </div>
      </section>

      <section className="card mt-3 p-4 text-xs">
        <h2 className="text-sm font-semibold">Security notes</h2>
        <ul className="muted mt-1 list-disc space-y-1 pl-5">
          <li>Sessions use HttpOnly, SameSite=Lax cookies (Secure when served over HTTPS) and every mutating request needs a CSRF header.</li>
          <li>Admin APIs re-check the owner GitHub id on the server for every request; hiding UI links is not the security boundary.</li>
          <li>OAuth uses the Authorization Code flow with a single-use state cookie and read:user scope only. No GitHub token is stored or logged.</li>
          <li>ZIP uploads are validated for traversal, symlinks, size, entry count and compression ratio before anything is stored.</li>
        </ul>
      </section>

      {notice ? <p className="badge badge-ok mt-3 block whitespace-normal text-left">{notice}</p> : null}
    </div>
  );
}
