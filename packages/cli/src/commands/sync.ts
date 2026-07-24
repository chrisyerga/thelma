import { copyFile, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  EditSchema,
  type ResolvedCue,
} from "@thelma/shared";
import {
  buildDir,
  projectPaths,
} from "@thelma/pipeline";
import { projectRoot, repoRoot } from "../root.js";
import { loadProject, resolveEditId } from "../project.js";

/**
 * Copy active edit build artifacts into Remotion public/ and project studio/.
 */
export async function cmdSync(
  slug: string,
  editIdFlag?: string,
): Promise<void> {
  const root = projectRoot(slug);
  await loadProject(root);
  const editId = await resolveEditId(root, editIdFlag);
  const outDir = buildDir(root, editId);

  const required = [
    "base.mp4",
    "subtitles.json",
    "cut-meta.json",
    "edit.json",
    "resolved-cues.json",
  ];
  for (const f of required) {
    if (!existsSync(path.join(outDir, f))) {
      throw new Error(`Missing ${f}. Run \`thelma cut --project ${slug} --edit ${editId}\` first.`);
    }
  }

  const videoPublic = path.join(repoRoot(), "packages", "video", "public");
  const mediaPublic = path.join(videoPublic, "media");
  await mkdir(videoPublic, { recursive: true });
  await mkdir(mediaPublic, { recursive: true });

  for (const f of required) {
    await copyFile(path.join(outDir, f), path.join(videoPublic, f));
  }

  // Studio folder in project for reference
  const studio = projectPaths(root).studio;
  await mkdir(studio, { recursive: true });
  for (const f of required) {
    await copyFile(path.join(outDir, f), path.join(studio, f));
  }

  await syncCueMedia(root, outDir, mediaPublic);

  // Manifest for Remotion default props
  const cutMeta = JSON.parse(
    await readFile(path.join(outDir, "cut-meta.json"), "utf8"),
  ) as { probedDurationSec: number; fps: number };

  await writeFile(
    path.join(videoPublic, "studio-manifest.json"),
    JSON.stringify(
      {
        project: slug,
        editId,
        durationSec: cutMeta.probedDurationSec,
        fps: cutMeta.fps,
        syncedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`Synced edit ${editId} → packages/video/public + projects/${slug}/studio`);
}

async function syncCueMedia(
  projectRootPath: string,
  outDir: string,
  mediaPublic: string,
): Promise<void> {
  const edit = EditSchema.parse(
    JSON.parse(await readFile(path.join(outDir, "edit.json"), "utf8")),
  );
  let cues: ResolvedCue[] = [];
  try {
    cues = JSON.parse(
      await readFile(path.join(outDir, "resolved-cues.json"), "utf8"),
    ) as ResolvedCue[];
  } catch {
    cues = [];
  }

  const catalogPath = path.join(
    repoRoot(),
    "packages",
    "media-lib",
    "catalog.json",
  );
  let catalogItems: Array<{ id: string; path: string }> = [];
  if (existsSync(catalogPath)) {
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
      items?: Array<{ id: string; path: string }>;
    };
    catalogItems = catalog.items ?? [];
  }

  const mediaLibRoot = path.join(repoRoot(), "packages", "media-lib");

  for (const cue of [...edit.cues, ...cues]) {
    if (!cue.mediaRef && typeof cue.params?.path !== "string") continue;

    if (typeof cue.params?.path === "string") {
      const abs = path.resolve(projectRootPath, cue.params.path);
      if (existsSync(abs)) {
        await copyFile(abs, path.join(mediaPublic, path.basename(abs)));
      }
    }

    if (cue.mediaRef) {
      const item = catalogItems.find((i) => i.id === cue.mediaRef);
      if (item) {
        const abs = path.join(mediaLibRoot, item.path);
        if (existsSync(abs)) {
          await copyFile(abs, path.join(mediaPublic, path.basename(abs)));
          // also alias by mediaRef for CueLayer lookup
          await copyFile(abs, path.join(mediaPublic, cue.mediaRef));
        }
      } else {
        // Project asset id → copy raw media for still/audio overlays
        const asset = edit.assets.find((a) => a.id === cue.mediaRef);
        if (asset) {
          const abs = path.isAbsolute(asset.path)
            ? asset.path
            : path.resolve(projectRootPath, asset.path);
          if (existsSync(abs)) {
            const base = path.basename(abs);
            await copyFile(abs, path.join(mediaPublic, base));
            await copyFile(abs, path.join(mediaPublic, cue.mediaRef));
          }
        }
      }
    }
  }

  // Copy derived narrations if present
  const derived = projectPaths(projectRootPath).assetsDerived;
  if (existsSync(derived)) {
    for (const name of await readdir(derived)) {
      if (/\.(mp3|wav|aac|m4a)$/i.test(name)) {
        await copyFile(path.join(derived, name), path.join(mediaPublic, name));
      }
    }
  }

  // Also sync image/audio assets that appear only via params.path on cues
  for (const asset of edit.assets) {
    if (asset.mediaKind !== "image" && asset.mediaKind !== "audio") continue;
    const abs = path.isAbsolute(asset.path)
      ? asset.path
      : path.resolve(projectRootPath, asset.path);
    if (!existsSync(abs)) continue;
    const base = path.basename(abs);
    await copyFile(abs, path.join(mediaPublic, base));
    await copyFile(abs, path.join(mediaPublic, asset.id));
  }
}
