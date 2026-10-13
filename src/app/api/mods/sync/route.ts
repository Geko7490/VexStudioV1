import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { modBackups } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { HttpError, enforceRateLimit, readJson, toErrorResponse } from "@/lib/http";
import { audit } from "@/lib/log";

export const dynamic = "force-dynamic";

type SyncPayload = {
  mods: {
    modId: string;
    name: string;
    sourceProjectId?: string;
    sourceVersion?: string;
    localVersion?: number;
    files: { path: string; content: string }[];
  }[];
};

/** Optional cloud mirror for signed-in users. Guests never need this endpoint. */
export async function GET() {
  try {
    const session = await getSessionUser();
    if (!session) throw new HttpError(401, "unauthenticated", "Sign in to use mod sync.");
    const rows = await db
      .select({
        modId: modBackups.modId,
        name: modBackups.name,
        localVersion: modBackups.localVersion,
        updatedAt: modBackups.updatedAt,
        sourceProjectId: modBackups.sourceProjectId,
      })
      .from(modBackups)
      .where(eq(modBackups.userId, session.user.id));
    return Response.json({
      ok: true,
      backups: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    enforceRateLimit("mods-sync", 40, 60_000);
    const session = await getSessionUser();
    if (!session) throw new HttpError(401, "unauthenticated", "Sign in to use mod sync.");

    const provided = req.headers.get("x-csrf-token");
    if (!provided || provided !== session.csrfToken) {
      throw new HttpError(403, "csrf_failed", "CSRF token missing or invalid.");
    }

    const body = await readJson<SyncPayload>(req, 8 * 1024 * 1024);
    if (!Array.isArray(body.mods) || body.mods.length > 25) {
      throw new HttpError(400, "bad_request", "Send at most 25 mods per sync request.");
    }

    const saved: string[] = [];
    for (const mod of body.mods) {
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(mod.modId)) throw new HttpError(400, "bad_mod_id", "Invalid mod id.");
      if (!mod.name || typeof mod.name !== "string") throw new HttpError(400, "bad_mod_name", "Invalid mod name.");
      const files = (mod.files ?? []).filter((f) => typeof f.path === "string" && typeof f.content === "string");
      if (files.length > 600) throw new HttpError(400, "too_many_files", "A mod may contain at most 600 files.");

      await db
        .insert(modBackups)
        .values({
          userId: session.user.id,
          modId: mod.modId,
          name: mod.name,
          sourceProjectId: mod.sourceProjectId ?? "",
          sourceVersion: mod.sourceVersion ?? "",
          localVersion: Number.isInteger(mod.localVersion) ? Number(mod.localVersion) : 1,
          files,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [modBackups.userId, modBackups.modId],
          set: {
            name: mod.name,
            sourceProjectId: mod.sourceProjectId ?? "",
            sourceVersion: mod.sourceVersion ?? "",
            localVersion: Number.isInteger(mod.localVersion) ? Number(mod.localVersion) : 1,
            files,
            updatedAt: new Date(),
          },
        });
      saved.push(mod.modId);
    }

    await audit({
      actorUserId: session.user.id,
      actorLogin: session.user.login,
      action: "mods.sync",
      details: { count: saved.length },
    });

    return Response.json({ ok: true, saved });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getSessionUser();
    if (!session) throw new HttpError(401, "unauthenticated", "Sign in to use mod sync.");
    const provided = req.headers.get("x-csrf-token");
    if (!provided || provided !== session.csrfToken) throw new HttpError(403, "csrf_failed", "CSRF token missing or invalid.");
    const modId = new URL(req.url).searchParams.get("modId");
    if (!modId) throw new HttpError(400, "bad_request", "modId is required.");
    await db.delete(modBackups).where(and(eq(modBackups.userId, session.user.id), eq(modBackups.modId, modId)));
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
