import path from "node:path";

export type ProjectPaths = {
  root: string;
  projectJson: string;
  assetsRaw: string;
  assetsDerived: string;
  analysis: string;
  analysisIndex: string;
  story: string;
  edits: string;
  build: string;
  studio: string;
};

export function projectPaths(projectRoot: string): ProjectPaths {
  return {
    root: projectRoot,
    projectJson: path.join(projectRoot, "project.json"),
    assetsRaw: path.join(projectRoot, "assets", "raw"),
    assetsDerived: path.join(projectRoot, "assets", "derived"),
    analysis: path.join(projectRoot, "analysis"),
    analysisIndex: path.join(projectRoot, "analysis", "index.json"),
    story: path.join(projectRoot, "story"),
    edits: path.join(projectRoot, "edits"),
    build: path.join(projectRoot, "build"),
    studio: path.join(projectRoot, "studio"),
  };
}

export function editPath(projectRoot: string, editId: string): string {
  return path.join(projectRoot, "edits", `${editId}.json`);
}

export function buildDir(projectRoot: string, editId: string): string {
  return path.join(projectRoot, "build", editId);
}

export function transcriptPath(projectRoot: string, assetId: string): string {
  return path.join(projectRoot, "analysis", `${assetId}.transcript.json`);
}

export function visionPath(projectRoot: string, assetId: string): string {
  return path.join(projectRoot, "analysis", `${assetId}.vision.json`);
}

export function metaPath(projectRoot: string, assetId: string): string {
  return path.join(projectRoot, "analysis", `${assetId}.meta.json`);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
