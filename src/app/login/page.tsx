"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useSession } from "@/components/SessionProvider";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured: "GitHub OAuth is not configured on this deployment. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, then restart the server.",
  access_denied: "You cancelled the GitHub authorisation request.",
  state_mismatch: "The OAuth state cookie did not match the callback parameter. The request was rejected to prevent CSRF.",
  missing_code_or_state: "GitHub did not return the expected code/state parameters.",
  github_rate_limited: "GitHub's API rate limit was hit while verifying your identity. Try again later.",
  github_unreachable: "GitHub could not be reached from the server. Check outbound network access.",
  oauth_failed: "The OAuth exchange failed. Verify the callback URL configured in your GitHub OAuth App.",
};

function LoginInner() {
  const params = useSearchParams();
  const { session, loading } = useSession();
  const errorCode = params.get("error");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">Sign in with GitHub</h1>
      <p className="muted mt-1 text-sm">Signing in is optional. Everything except the owner-only admin panel and account sync works without an account.</p>

      {errorCode ? (
        <p className="badge badge-danger mt-3 block whitespace-normal text-left">{ERROR_MESSAGES[errorCode] ?? `Sign-in failed: ${errorCode}`}</p>
      ) : null}

      <div className="card mt-3 p-4 text-sm">
        {loading ? (
          <p className="muted">Checking current session…</p>
        ) : session?.authenticated ? (
          <>
            <p>
              Signed in as <strong>{session.user?.login}</strong> (GitHub id {session.user?.githubId}) · role <strong>{session.role}</strong>
            </p>
            <div className="mt-3 flex gap-2">
              <Link href="/" className="btn btn-sm">
                Go home
              </Link>
              {session.role === "owner" ? (
                <Link href="/admin" className="btn btn-sm btn-primary">
                  Admin Panel
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <p className="muted text-xs">
              Vex Studio uses the GitHub Authorization Code flow with a single-use state cookie. The app requests only the <span className="mono">read:user</span> scope,
              receives the token once on the server to read your numeric account id, and never stores or logs the token.
            </p>
            {session && !session.deployment.oauthConfigured ? (
              <p className="badge badge-warn mt-3 block whitespace-normal text-left">
                This deployment has no GitHub OAuth credentials, so the button below will redirect back with an explicit error instead of pretending to sign you in.
              </p>
            ) : null}
            <a className="btn btn-primary mt-3" href="/api/auth/github/start">
              Continue with GitHub
            </a>
          </>
        )}
      </div>

      <div className="card mt-3 p-4 text-xs">
        <h2 className="text-sm font-semibold">How the owner account is recognised</h2>
        <ol className="muted mt-1 list-decimal space-y-1 pl-5">
          <li>The deployment sets OWNER_GITHUB_ID (the numeric GitHub account id) as a server-side environment variable.</li>
          <li>After the OAuth callback, the server reads the authenticated id from GitHub and compares it with that variable.</li>
          <li>On match the session role becomes owner; otherwise it stays user. The role is recomputed on every request.</li>
          <li>Usernames, client data, URL parameters and localStorage values are never used for authorisation.</li>
        </ol>
        {session && !session.deployment.ownerConfigured ? (
          <p className="muted mt-2">
            This deployment has no owner configured, so no account can be admin. If you control the server and hold ADMIN_SETUP_TOKEN, you can use the{" "}
            <Link className="underline" href="/setup">
              setup wizard
            </Link>
            .
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="muted text-sm">Loading…</p>}>
      <LoginInner />
    </Suspense>
  );
}
