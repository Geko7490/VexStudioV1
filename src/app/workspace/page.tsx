import { Suspense } from "react";
import { WorkspaceApp } from "@/components/workspace/WorkspaceApp";

export const dynamic = "force-dynamic";

export default function WorkspacePage() {
  return (
    <Suspense fallback={<p className="muted text-sm">Loading workspace…</p>}>
      <WorkspaceApp />
    </Suspense>
  );
}
