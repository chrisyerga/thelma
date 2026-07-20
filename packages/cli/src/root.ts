import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (thelma/), walking up from this package. */
export function repoRoot(): string {
  if (process.env.THELMA_ROOT) {
    return path.resolve(process.env.THELMA_ROOT);
  }
  let dir = path.resolve(__dirname, "../../..");
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "packages"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, "../../..");
}

export function projectsDir(root = repoRoot()): string {
  return path.join(root, "projects");
}

export function projectRoot(slug: string, root = repoRoot()): string {
  return path.join(projectsDir(root), slug);
}

export function templatesDir(root = repoRoot()): string {
  return path.join(root, "templates");
}
