import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  parseMetaAnalysis,
  VisionAnalysisSchema,
  type MetaCue,
  type VisionEvent,
} from "@thelma/shared";
import { DEFAULT_IMAGE_DURATION_SEC, type MediaKind } from "@thelma/shared";
import { runFfmpeg, probeMedia, encodeTimelinePart } from "./ffmpeg";
import { classifyMediaKind } from "./mediaKind";
import { metaPath, visionPath } from "./paths";

export type ReviewSegment = {
  assetId: string;
  mediaPath: string;
  durationSec: number;
  reviewStart: number;
  reviewEnd: number;
};

export type ReviewResult = {
  outPath: string;
  indexPath: string;
  durationSec: number;
  segments: ReviewSegment[];
};

function assEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function formatAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const whole = Math.floor(s % 60);
  const cs = Math.min(99, Math.round((s - Math.floor(s)) * 100));
  return `${h}:${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function formatSrcClock(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}:${rem.toFixed(2).padStart(5, "0")}`;
}

function kindLabel(kind: string): string {
  return kind === "bad_take" ? "BAD_TAKE" : kind;
}

function activeCues(cues: MetaCue[], t: number): MetaCue[] {
  return cues.filter((c) => t >= c.start && t < c.end);
}

function activeVision(events: VisionEvent[], t: number): string[] {
  const types = new Set<string>();
  for (const e of events) {
    if (e.type === "face_bbox") continue;
    if (t >= e.start && t < e.end) types.add(e.type);
  }
  return [...types].sort();
}

/** Build ASS for one asset (times are source-local, part starts at 0). */
export function buildAssetReviewAss(
  assetId: string,
  durationSec: number,
  cues: MetaCue[],
  events: VisionEvent[],
  opts?: { width?: number; height?: number; sampleFps?: number },
): string {
  const width = opts?.width ?? 1080;
  const height = opts?.height ?? 1920;
  const sampleFps = opts?.sampleFps ?? 4;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Top,Menlo,42,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,8,40,40,48,1
Style: BadTake,Menlo,42,&H00FFFFFF,&H000000FF,&H00000000,&H80002878,-1,0,0,0,100,100,0,0,1,3,0,8,40,40,48,1
Style: Bottom,Menlo,36,&H00AAFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,40,40,56,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const step = 1 / sampleFps;
  const lines: string[] = [];
  let prevKey = "";
  let runStart = 0;
  let runTop = "";
  let runBottom = "";
  let runBad = false;

  const flush = (end: number) => {
    if (!runTop && !runBottom) return;
    if (end <= runStart) return;
    if (runTop) {
      const style = runBad ? "BadTake" : "Top";
      lines.push(
        `Dialogue: 0,${formatAssTime(runStart)},${formatAssTime(end)},${style},,0,0,0,,${assEscape(runTop)}`,
      );
    }
    if (runBottom) {
      lines.push(
        `Dialogue: 0,${formatAssTime(runStart)},${formatAssTime(end)},Bottom,,0,0,0,,${assEscape(runBottom)}`,
      );
    }
  };

  const overlayAt = (t: number) => {
    const cuesHere = activeCues(cues, t);
    let top: string;
    let key: string;
    let bad = false;
    // Include floor(t) so source clock updates ~1/s (cheap in ASS).
    if (cuesHere.length === 0) {
      key = `${assetId}|—|${Math.floor(t)}`;
      top = `${assetId} | — | t=${formatSrcClock(t)}`;
    } else {
      const primary =
        cuesHere.find((c) => c.kind === "bad_take") ??
        cuesHere.find((c) => c.kind !== "content") ??
        cuesHere[0]!;
      bad = primary.kind === "bad_take";
      key = `${assetId}|${primary.id}|${primary.kind}|${Math.floor(t)}`;
      top = `${assetId} | ${primary.id} | ${kindLabel(primary.kind)} | t=${formatSrcClock(t)}`;
    }
    const vision = activeVision(events, t);
    const bottom = vision.length ? vision.join(", ") : "";
    key += `|${bottom}`;
    return { top, bottom, key, bad };
  };

  for (let t = 0; t < durationSec; t += step) {
    const { top, bottom, key, bad } = overlayAt(t);
    if (t === 0) {
      runStart = 0;
      runTop = top;
      runBottom = bottom;
      runBad = bad;
      prevKey = key;
      continue;
    }
    if (key !== prevKey) {
      flush(t);
      runStart = t;
      runTop = top;
      runBottom = bottom;
      runBad = bad;
      prevKey = key;
    }
  }
  flush(durationSec);

  return header + lines.join("\n") + "\n";
}

export async function buildReviewPlate(opts: {
  projectRoot: string;
  assets: Array<{
    id: string;
    path: string;
    durationSec?: number;
    mediaKind?: MediaKind;
  }>;
  width: number;
  height: number;
  fps: number;
  outPath: string;
}): Promise<ReviewResult> {
  const { projectRoot, assets, width, height, fps, outPath } = opts;
  if (assets.length === 0) {
    throw new Error("No assets to review. Import + scan first.");
  }

  const workDir = path.join(path.dirname(outPath), ".review-work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.dirname(outPath), { recursive: true });

  const partPaths: string[] = [];
  const segments: ReviewSegment[] = [];
  let cursor = 0;

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]!;
    const mediaPath = path.isAbsolute(asset.path)
      ? asset.path
      : path.resolve(projectRoot, asset.path);
    if (!existsSync(mediaPath)) {
      throw new Error(`Missing media for ${asset.id}: ${mediaPath}`);
    }

    const probe = await probeMedia(mediaPath);
    const mediaKind =
      asset.mediaKind ?? classifyMediaKind(probe, mediaPath);
    let durationSec = asset.durationSec ?? probe.durationSec;
    if (mediaKind === "image" && !(durationSec > 0.5)) {
      durationSec = DEFAULT_IMAGE_DURATION_SEC;
    }
    if (!(durationSec > 0)) {
      throw new Error(`Invalid duration for ${asset.id}`);
    }

    let cues: MetaCue[] = [];
    const mp = metaPath(projectRoot, asset.id);
    if (existsSync(mp)) {
      try {
        cues = parseMetaAnalysis(JSON.parse(await readFile(mp, "utf8"))).cues;
      } catch {
        cues = [];
      }
    }

    let events: VisionEvent[] = [];
    const vp = visionPath(projectRoot, asset.id);
    if (existsSync(vp)) {
      try {
        events = VisionAnalysisSchema.parse(
          JSON.parse(await readFile(vp, "utf8")),
        ).events;
      } catch {
        events = [];
      }
    }

    const partName = `${String(i).padStart(3, "0")}_${asset.id}.mp4`;
    const assName = `${String(i).padStart(3, "0")}_${asset.id}.ass`;
    const assPath = path.join(workDir, assName);
    await writeFile(
      assPath,
      buildAssetReviewAss(asset.id, durationSec, cues, events, {
        width,
        height,
      }),
    );

    const partPath = path.join(workDir, partName);
    // Relative ASS filename + cwd=workDir avoids filtergraph path/quoting bugs.
    await encodeTimelinePart({
      src: mediaPath,
      outPath: partName,
      srcIn: 0,
      durationSec,
      width,
      height,
      fps,
      mediaKind,
      hasAudio: probe.hasAudio,
      cwd: workDir,
      vfExtra: `ass=${assName}`,
    });

    partPaths.push(partPath);
    segments.push({
      assetId: asset.id,
      mediaPath,
      durationSec,
      reviewStart: cursor,
      reviewEnd: cursor + durationSec,
    });
    cursor += durationSec;
    console.log(
      `  ${asset.id}: ${durationSec.toFixed(1)}s (review ${segments[i]!.reviewStart.toFixed(1)}–${segments[i]!.reviewEnd.toFixed(1)})`,
    );
  }

  const outAbs = path.resolve(outPath);
  if (partPaths.length === 1) {
    await runFfmpeg(["-y", "-i", partPaths[0]!, "-c", "copy", outAbs]);
  } else {
    const listPath = path.join(workDir, "concat.txt");
    await writeFile(
      listPath,
      partPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
    );
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      outAbs,
    ]);
  }

  const indexPath = path.join(path.dirname(outPath), "review.json");
  await writeFile(
    indexPath,
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        outPath,
        durationSec: cursor,
        segments: segments.map((s) => ({
          assetId: s.assetId,
          durationSec: s.durationSec,
          reviewStart: s.reviewStart,
          reviewEnd: s.reviewEnd,
        })),
      },
      null,
      2,
    ) + "\n",
  );

  return { outPath, indexPath, durationSec: cursor, segments };
}
