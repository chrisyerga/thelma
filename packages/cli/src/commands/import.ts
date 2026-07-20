import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  AssetIndexSchema,
  type AssetIndexEntry,
} from "@thelma/shared";
import {
  projectPaths,
  slugify,
} from "@thelma/pipeline";
import { probeMedia } from "@thelma/pipeline";
import { projectRoot } from "../root.js";
import { loadProject } from "../project.js";

function assetIdFromFilename(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return slugify(base) || `asset-${Date.now()}`;
}

export async function cmdImport(
  slug: string,
  files: string[],
): Promise<void> {
  if (files.length === 0) throw new Error("No files to import");

  const root = projectRoot(slug);
  await loadProject(root);
  const paths = projectPaths(root);
  await mkdir(paths.assetsRaw, { recursive: true });

  const index = existsSync(paths.analysisIndex)
    ? AssetIndexSchema.parse(
        JSON.parse(await readFile(paths.analysisIndex, "utf8")),
      )
    : { version: 1 as const, assets: [] as AssetIndexEntry[] };

  const existingIds = new Set(index.assets.map((a) => a.id));

  for (const file of files) {
    const abs = path.resolve(file);
    if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);

    const filename = path.basename(abs);
    let id = assetIdFromFilename(filename);
    if (existingIds.has(id)) {
      id = `${id}-${Date.now().toString(36)}`;
    }

    const dest = path.join(paths.assetsRaw, filename);
    await copyFile(abs, dest);

    const probe = await probeMedia(dest);
    const entry: AssetIndexEntry = {
      id,
      filename,
      path: path.relative(root, dest),
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      hasAudio: probe.hasAudio,
      importedAt: new Date().toISOString(),
    };

    index.assets.push(entry);
    existingIds.add(id);
    console.log(`Imported ${filename} → ${id} (${probe.durationSec.toFixed(1)}s)`);
  }

  await writeFile(
    paths.analysisIndex,
    JSON.stringify(index, null, 2) + "\n",
  );
}
