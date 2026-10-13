"use client";

import Link from "next/link";
import { useSession } from "@/components/SessionProvider";

const CAPABILITIES = [
  { title: "Catalogue projects", detail: "Published projects ship with a manifest, file list, runtime list and real static checks.", href: "/projects", state: "ok" },
  { title: "Independent mods", detail: "Creating a mod copies the files into your browser (IndexedDB). Original projects are never edited.", href: "/mods", state: "ok" },
  { title: "HTML/CSS/JS runtime", detail: "Sandboxed iframe preview (allow-scripts only) with console capture and viewport presets.", href: "/runtime", state: "ok" },
  { title: "Python runtime", detail: "Pyodide (CPython on WASM) runs standard-library code; native-only packages fail with their real error.", href: "/runtime", state: "partial" },
  { title: "Node.js / npm projects", detail: "No WebContainers runtime in this deployment, so Node projects are marked unsupported instead of faked.", href: "/runtime", state: "unsupported" },
  { title: "Local AI (WebGPU)", detail: "WebLLM models run fully in your browser with real download progress and a smoke test.", href: "/ai-center", state: "partial" },
  { title: "AI Project Intelligence", detail: "Deterministic indexing: symbols, imports, modules, relevance search and per-mod memory.", href: "/ai-center", state: "ok" },
  { title: "Admin panel", detail: "Owner-only: ZIP upload, safe extraction, versioning, GitHub publish, audit log.", href: "/admin", state: "ok" },
];

export default function HomePage() {
  const { session, loading } = useSession();

  return (
    <div className="mx-auto max-w-5xl">
      <section className="card mb-4 p-5">
        <p className="badge badge-accent mb-2">Web-only IDE</p>
        <h1 className="text-2xl font-semibold sm:text-3xl">Vex Studio</h1>
        <p className="muted mt-2 max-w-2xl text-sm">
          Open a catalogue project, fork it into an independent mod, edit it in the browser, run it in a sandboxed preview or Pyodide, and get help from a local
          WebGPU model. Nothing is uploaded: mods and models live in your browser.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/projects" className="btn btn-primary">
            Browse projects
          </Link>
          <Link href="/workspace" className="btn">
            Open workspace
          </Link>
          <Link href="/ai-center" className="btn">
            AI Center
          </Link>
          {!loading && !session?.authenticated ? (
            <Link href="/login" className="btn">
              Sign in with GitHub (optional)
            </Link>
          ) : null}
          {session?.role === "owner" ? (
            <Link href="/admin" className="btn btn-primary">
              Admin Panel
            </Link>
          ) : null}
        </div>
        {loading ? <p className="muted mt-3 text-xs">Checking session…</p> : null}
        {!loading && session?.authenticated ? (
          <p className="muted mt-3 text-xs">
            Signed in as {session.user?.login} · role <strong>{session.role}</strong>
            {session.role !== "owner" ? " (admin tools are hidden and every admin API rejects this account server-side)" : ""}
          </p>
        ) : null}
        {!loading && !session?.authenticated ? (
          <p className="muted mt-3 text-xs">
            Guest mode: catalogue, mods, editor, previews and local AI all work without an account. Sign-in only adds the owner role check and optional mod sync.
          </p>
        ) : null}
        {session && !session.deployment.ownerConfigured ? (
          <p className="badge badge-warn mt-3 block whitespace-normal text-left">
            OWNER_GITHUB_ID is not configured on this deployment, so nobody holds admin rights. Set the environment variable (or use the one-time setup secret) to
            enable the admin panel.
          </p>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {CAPABILITIES.map((item) => (
          <Link key={item.title} href={item.href} className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{item.title}</h2>
              <span className={`badge ${item.state === "ok" ? "badge-ok" : item.state === "partial" ? "badge-warn" : "badge-danger"}`}>
                {item.state === "ok" ? "supported" : item.state === "partial" ? "partially supported" : "not supported"}
              </span>
            </div>
            <p className="muted mt-1 text-xs">{item.detail}</p>
          </Link>
        ))}
      </section>

      <section className="card mt-4 p-4 text-xs">
        <h2 className="text-sm font-semibold">Honest limitations</h2>
        <ul className="muted mt-2 list-disc space-y-1 pl-5">
          <li>Mods are stored in IndexedDB in this browser profile. Clearing site data removes them — export a ZIP or enable sync in Settings.</li>
          <li>Folder mirroring uses the File System Access API (Chromium desktop only; usually unavailable on Android).</li>
          <li>Local models need WebGPU. On unsupported browsers every model is marked incompatible and no download is started.</li>
          <li>Downloaded model weights stay in the browser Cache API; a page reload requires loading the model again (weights are cached).</li>
        </ul>
      </section>
    </div>
  );
}
