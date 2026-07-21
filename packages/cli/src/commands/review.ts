import { readFile } from "node:fs/promises";
import path from "node:path";
import { AssetIndexSchema } from "@thelma/shared";
import { buildReviewPlate, projectPaths } from "@thelma/pipeline";
import { projectRoot } from "../root.js";
import { loadProject } from "../project.js";

/**
 * Concat all project assets into analysis/review.mp4 with burned-in
 * assetId / cue id / kind / source time (top) and vision events (bottom).
 */
export async function cmdReview(slug: string): Promise<void> {
  const root = projectRoot(slug);
  const project = await loadProject(root);
  const paths = projectPaths(root);

  const index = AssetIndexSchema.parse(
    JSON.parse(await readFile(paths.analysisIndex, "utf8")),
  );
  if (index.assets.length === 0) {
    throw new Error("No assets. Import + scan first.");
  }

  const outPath = path.join(paths.analysis, "review.mp4");
  console.log(`Building review plate (${index.assets.length} assets)…`);

  const result = await buildReviewPlate({
    projectRoot: root,
    assets: index.assets.map((a) => ({
      id: a.id,
      path: a.path,
      durationSec: a.durationSec,
    })),
    width: project.width,
    height: project.height,
    fps: project.fps,
    outPath,
  });

  console.log(`Wrote ${result.outPath} (${result.durationSec.toFixed(1)}s)`);
  console.log(`Index: ${result.indexPath}`);
  console.log(
    "Top burn-in: assetId | cue-N | kind | t=src   ·   Bottom: vision events",
  );
}
