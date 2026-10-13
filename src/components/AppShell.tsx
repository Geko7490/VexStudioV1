"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { apiFetch, useSession } from "./SessionProvider";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/projects", label: "Projects" },
  { href: "/mods", label: "My Mods" },
  { href: "/workspace", label: "Workspace" },
  { href: "/ai-center", label: "AI Center" },
  { href: "/runtime", label: "Runtime Center" },
  { href: "/settings", label: "Settings" },
];

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem("vex-theme");
    const initial = stored === "light" ? "light" : "dark";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("vex-theme", next);
  };

  return { theme, toggle };
}

function ProfileMenu() {
  const { session, refresh } = useSession();
  const [open, setOpen] = useState(false);

  const logout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST", body: "{}", csrf: session?.csrfToken ?? null }).catch(() => null);
    await refresh();
    setOpen(false);
  };

  if (!session?.authenticated) {
    return (
      <Link className="btn btn-primary btn-sm" href="/login">
        Sign in with GitHub
      </Link>
    );
  }

  return (
    <div className="relative">
      <button type="button" className="btn btn-sm" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <span aria-hidden>◍</span>
        <span className="max-w-[9rem] truncate">{session.user?.login}</span>
        {session.role === "owner" ? <span className="badge badge-accent">owner</span> : null}
      </button>
      {open ? (
        <div role="menu" className="card absolute right-0 z-40 mt-2 w-64 p-3 text-sm shadow-xl">
          <p className="muted mb-2 text-xs">
            GitHub id {session.user?.githubId} · role {session.role}
          </p>
          {session.role === "owner" ? (
            <Link role="menuitem" className="btn btn-sm mb-2 w-full" href="/admin" onClick={() => setOpen(false)}>
              Admin Panel
            </Link>
          ) : null}
          <button role="menuitem" type="button" className="btn btn-sm w-full" onClick={logout}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const { session } = useSession();

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b" style={{ background: "color-mix(in srgb, var(--bg) 92%, transparent)", borderColor: "var(--border)", backdropFilter: "blur(8px)" }}>
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))", color: "#04101c" }}>
              V
            </span>
            <span className="hidden sm:inline">Vex Studio</span>
          </Link>

          <nav aria-label="Main navigation" className="ml-2 hidden flex-1 items-center gap-1 lg:flex">
            {NAV.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className="rounded-lg px-2.5 py-1.5 text-sm"
                  style={{
                    background: active ? "var(--panel-2)" : "transparent",
                    color: active ? "var(--text)" : "var(--muted)",
                    border: active ? "1px solid var(--border)" : "1px solid transparent",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              {theme === "dark" ? "☾" : "☀"}
            </button>
            <div className="hidden sm:block">
              <ProfileMenu />
            </div>
            <button type="button" className="btn btn-sm lg:hidden" aria-expanded={menuOpen} aria-controls="mobile-nav" onClick={() => setMenuOpen((v) => !v)}>
              ☰ Menu
            </button>
          </div>
        </div>

        {menuOpen ? (
          <div id="mobile-nav" className="border-t px-3 pb-3 lg:hidden" style={{ borderColor: "var(--border)" }}>
            <nav aria-label="Mobile navigation" className="grid grid-cols-2 gap-2 pt-3">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="btn btn-sm justify-start">
                  {item.label}
                </Link>
              ))}
              {session?.role === "owner" ? (
                <Link href="/admin" className="btn btn-sm justify-start">
                  Admin Panel
                </Link>
              ) : null}
              <div className="col-span-2 sm:hidden">
                <ProfileMenu />
              </div>
            </nav>
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-4">{children}</main>

      <footer className="border-t px-4 py-4 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span>Vex Studio — web-only IDE. Mods are stored in your browser (IndexedDB).</span>
          <span>Local AI runs in your browser via WebGPU. Nothing is uploaded unless you opt in to sync.</span>
        </div>
      </footer>
    </div>
  );
}
