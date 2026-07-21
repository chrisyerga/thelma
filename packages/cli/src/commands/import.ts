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
import { projectRoot, resolveUserPath } from "../root.js";
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

  const byFilename = new Map(
    index.assets.map((a) => [a.filename, a] as const),
  );
  const existingIds = new Set(index.assets.map((a) => a.id));

  for (const file of files) {
    // Relative paths are from where the user ran npm (INIT_CWD), not packages/cli
    const abs = resolveUserPath(file);
    if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);

    const filename = path.basename(abs);
    const dest = path.join(paths.assetsRaw, filename);
    await copyFile(abs, dest);

    const probe = await probeMedia(dest);
    const existing = byFilename.get(filename);

    if (existing) {
      // Idempotent re-import: refresh probe metadata, keep stable id
      existing.path = path.relative(root, dest);
      existing.durationSec = probe.durationSec;
      existing.width = probe.width;
      existing.height = probe.height;
      existing.fps = probe.fps;
      existing.hasAudio = probe.hasAudio;
      existing.importedAt = new Date().toISOString();
      console.log(
        `Updated ${filename} → ${existing.id} (${probe.durationSec.toFixed(1)}s)`,
      );
      continue;
    }

    let id = assetIdFromFilename(filename);
    // Only collide if two *different* filenames slugify the same (rare)
    if (existingIds.has(id)) {
      id = `${id}-${Date.now().toString(36)}`;
    }

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
    byFilename.set(filename, entry);
    existingIds.add(id);
    console.log(`Imported ${filename} → ${id} (${probe.durationSec.toFixed(1)}s)`);
  }

  await writeFile(
    paths.analysisIndex,
    JSON.stringify(index, null, 2) + "\n",
  );
}
