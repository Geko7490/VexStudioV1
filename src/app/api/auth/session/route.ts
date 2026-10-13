import { getSessionView } from "@/lib/auth";
import { isGithubPublishConfigured, isSetupSecretConfigured } from "@/lib/config";
import { toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const view = await getSessionView();
    return Response.json({
      ok: true,
      ...view,
      deployment: {
        ...view.deployment,
        githubPublishConfigured: isGithubPublishConfigured(),
        setupSecretConfigured: isSetupSecretConfigured(),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
