"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type SessionView = {
  authenticated: boolean;
  role: "guest" | "user" | "owner";
  user: { id: string; githubId: number; login: string; name: string | null; avatarUrl: string | null } | null;
  csrfToken: string | null;
  deployment: {
    oauthConfigured: boolean;
    ownerConfigured: boolean;
    adminDisabled: boolean;
    ownerLogin: string | null;
    ownerSource: "env" | "database" | "none";
    githubPublishConfigured?: boolean;
    setupSecretConfigured?: boolean;
  };
};

type SessionContextValue = {
  session: SessionView | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isOwner: boolean;
};

const SessionContext = createContext<SessionContextValue>({
  session: null,
  loading: true,
  error: null,
  refresh: async () => {},
  isOwner: false,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      const data = (await res.json()) as SessionView & { ok: boolean };
      setSession(data);
      setError(null);
    } catch {
      setError("Session unavailable: the API did not answer.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({ session, loading, error, refresh, isOwner: session?.role === "owner" }),
    [session, loading, error, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}

/** Adds the CSRF header and surfaces safe error messages. */
export async function apiFetch<T>(input: string, init: RequestInit & { csrf?: string | null } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init.csrf) headers.set("x-csrf-token", init.csrf);
  const res = await fetch(input, { ...init, headers, credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}
