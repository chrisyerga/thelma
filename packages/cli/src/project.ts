import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  EditSchema,
  ProjectSchema,
  type Edit,
  type Project,
} from "@thelma/shared";
import {
  editPath,
  projectPaths,
} from "@thelma/pipeline";

export async function loadProject(projectRootPath: string): Promise<Project> {
  const p = projectPaths(projectRootPath).projectJson;
  if (!existsSync(p)) {
    throw new Error(`Not a thelma project (missing project.json): ${projectRootPath}`);
  }
  return ProjectSchema.parse(JSON.parse(await readFile(p, "utf8")));
}

export async function saveProject(
  projectRootPath: string,
  project: Project,
): Promise<void> {
  const p = projectPaths(projectRootPath).projectJson;
  await writeFile(p, JSON.stringify(project, null, 2) + "\n");
}

export async function loadEditFile(
  projectRootPath: string,
  editId: string,
): Promise<Edit> {
  const p = editPath(projectRootPath, editId);
  if (!existsSync(p)) throw new Error(`Edit not found: ${p}`);
  return EditSchema.parse(JSON.parse(await readFile(p, "utf8")));
}

/** Edit ids from `edits/*.json` (filename sans extension). */
export async function listEditIds(projectRootPath: string): Promise<string[]> {
  const dir = projectPaths(projectRootPath).edits;
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.slice(0, -".json".length))
    .sort();
}

export async function resolveEditId(
  projectRootPath: string,
  editIdFlag?: string,
): Promise<string> {
  if (editIdFlag) return editIdFlag;
  const project = await loadProject(projectRootPath);
  if (project.activeEditId) return project.activeEditId;
  const available = await listEditIds(projectRootPath);
  const hint =
    available.length > 0
      ? `Available edits:\n${available.map((id) => `  - ${id}`).join("\n")}`
      : "No edits found under edits/.";
  throw new Error(
    `No --edit specified and project.activeEditId is null. Pass --edit <id>.\n${hint}`,
  );
}

export function requireProjectFlag(slug?: string): string {
  if (!slug) throw new Error("Missing --project <slug>");
  return slug;
}
