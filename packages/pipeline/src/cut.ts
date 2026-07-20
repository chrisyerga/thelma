import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CutMetaSchema,
  EditSchema,
  TranscriptSchema,
  type CutMeta,
  type Edit,
  type TranscriptWord,
} from "@thelma/shared";
import { runFfmpeg, probeMedia } from "./ffmpeg";
import {
  buildOutputTimeline,
  hashEdit,
  resolveCues,
  totalDuration,
} from "./remap";
import { applyFlairToSubtitles, buildSubtitles } from "./subtitles";
import { buildDir, transcriptPath } from "./paths";

export async function loadEdit(editFile: string): Promise<Edit> {
  const raw = JSON.parse(await readFile(editFile, "utf8"));
  return EditSchema.parse(raw);
}

function resolveAssetPath(projectRoot: string, assetPath: string): string {
  return path.isAbsolute(assetPath)
    ? assetPath
    : path.resolve(projectRoot, assetPath);
}

async function loadWordsByAsset(
  projectRoot: string,
  edit: Edit,
): Promise<Record<string, TranscriptWord[]>> {
  const out: Record<string, TranscriptWord[]> = {};
  const assetIds = new Set(edit.timeline.map((c) => c.assetId));
  for (const assetId of assetIds) {
    const p = transcriptPath(projectRoot, assetId);
    try {
      const raw = JSON.parse(await readFile(p, "utf8"));
      const t = TranscriptSchema.parse(raw);
      out[assetId] = t.words;
    } catch {
      out[assetId] = [];
    }
  }
  return out;
}

export type CutResult = {
  basePath: string;
  cutMeta: CutMeta;
  subtitlesPath: string;
  resolvedCuesPath: string;
};

/**
 * Cut timeline → base.mp4, write cut-meta (probed duration),
 * remapped subtitles, and resolved cues.
 */
export async function cutProject(
  projectRoot: string,
  edit: Edit,
): Promise<CutResult> {
  const outDir = buildDir(projectRoot, edit.id);
  const partsDir = path.join(outDir, "parts");
  await mkdir(partsDir, { recursive: true });

  const segments = buildOutputTimeline(edit);
  const partPaths: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const asset = edit.assets.find((a) => a.id === seg.clip.assetId);
    if (!asset) throw new Error(`Unknown asset: ${seg.clip.assetId}`);
    const src = resolveAssetPath(projectRoot, asset.path);
    const partPath = path.join(
      partsDir,
      `${String(i).padStart(3, "0")}_${seg.clip.id}.mp4`,
    );
    partPaths.push(partPath);

    await runFfmpeg([
      "-y",
      "-ss",
      String(seg.clip.srcIn),
      "-to",
      String(seg.clip.srcOut),
      "-i",
      src,
      "-vf",
      `scale=${edit.width}:${edit.height}:force_original_aspect_ratio=decrease,pad=${edit.width}:${edit.height}:(ow-iw)/2:(oh-ih)/2,fps=${edit.fps},format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      partPath,
    ]);
  }

  const listPath = path.join(outDir, "concat.txt");
  const listBody = partPaths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n");
  await writeFile(listPath, listBody);

  const concatOut = path.join(outDir, "concat_raw.mp4");
  if (partPaths.length === 1) {
    await runFfmpeg(["-y", "-i", partPaths[0]!, "-c", "copy", concatOut]);
  } else {
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      concatOut,
    ]);
  }

  const basePath = path.join(outDir, "base.mp4");
  if (edit.audio.loudnorm) {
    await runFfmpeg([
      "-y",
      "-i",
      concatOut,
      "-af",
      `loudnorm=I=${edit.audio.targetLufs}:TP=-1.5:LRA=11`,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      basePath,
    ]);
  } else {
    await runFfmpeg(["-y", "-i", concatOut, "-c", "copy", basePath]);
  }

  const probe = await probeMedia(basePath);
  const theoretical = totalDuration(edit);
  const editHash = hashEdit(edit);

  const cutMeta: CutMeta = CutMetaSchema.parse({
    editId: edit.id,
    editHash,
    outPath: basePath,
    durationSec: theoretical,
    probedDurationSec: probe.durationSec,
    fps: edit.fps,
    width: edit.width,
    height: edit.height,
    segments: segments.map((s) => ({
      timelineId: s.clip.id,
      assetId: s.clip.assetId,
      srcIn: s.clip.srcIn,
      srcOut: s.clip.srcOut,
      outStart: s.outStart,
      outEnd: s.outEnd,
    })),
  });

  await writeFile(
    path.join(outDir, "cut-meta.json"),
    JSON.stringify(cutMeta, null, 2),
  );

  const wordsByAsset = await loadWordsByAsset(projectRoot, edit);
  let subs = buildSubtitles(edit, wordsByAsset);

  const flairByWordId: Record<string, string> = {};
  for (const cue of edit.cues) {
    if (cue.kind === "flair" && cue.anchor.type === "word" && cue.generator) {
      flairByWordId[cue.anchor.wordId] = cue.generator;
    }
  }
  subs = applyFlairToSubtitles(subs, flairByWordId);

  const subtitlesPath = path.join(outDir, "subtitles.json");
  await writeFile(subtitlesPath, JSON.stringify(subs, null, 2));

  const resolved = resolveCues(edit, wordsByAsset);
  const resolvedCuesPath = path.join(outDir, "resolved-cues.json");
  await writeFile(resolvedCuesPath, JSON.stringify(resolved, null, 2));

  // Stamp for Remotion
  const studioEdit = {
    ...edit,
    // Remotion uses resolved overlays; keep full edit for style
  };
  await writeFile(
    path.join(outDir, "edit.json"),
    JSON.stringify(studioEdit, null, 2),
  );

  return { basePath, cutMeta, subtitlesPath, resolvedCuesPath };
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
