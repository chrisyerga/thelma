import { readFile, writeFile } from "node:fs/promises";
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

export async function resolveEditId(
  projectRootPath: string,
  editIdFlag?: string,
): Promise<string> {
  if (editIdFlag) return editIdFlag;
  const project = await loadProject(projectRootPath);
  if (project.activeEditId) return project.activeEditId;
  throw new Error(
    "No --edit specified and project.activeEditId is null. Pass --edit <id>.",
  );
}

export function requireProjectFlag(slug?: string): string {
  if (!slug) throw new Error("Missing --project <slug>");
  return slug;
}
