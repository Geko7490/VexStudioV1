import { createMod, type ModMeta } from "@/lib/local-store";
import { detectProject } from "@/lib/project-analyze";

export type CatalogProject = {
  id: string;
  name: string;
  latestVersion: string | null;
  latestCommitSha: string | null;
};

/** Copies the published files into a brand new, independent local mod. */
export async function createModFromCatalog(
  project: CatalogProject,
  files: { path: string; content: string }[],
): Promise<ModMeta> {
  const detected = detectProject(files);
  return createMod({
    name: project.name,
    description: `Mod of ${project.name}`,
    files,
    sourceProjectId: project.id,
    sourceProjectName: project.name,
    sourceVersion: project.latestVersion,
    sourceCommitSha: project.latestCommitSha,
    entryFile: detected.entryFile,
    kind: detected.kind,
    runtimes: detected.runtimes,
    dependencies: detected.dependencies,
  });
}
