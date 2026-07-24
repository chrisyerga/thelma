import { spawn } from "node:child_process";

export function runFfmpeg(
  args: string[],
  cwd?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export function runFfprobeJson(filePath: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch (e) {
        reject(e);
      }
    });
  });
}

export type MediaProbe = {
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  videoCodec?: string;
  formatName?: string;
};

export async function probeMedia(filePath: string): Promise<MediaProbe> {
  const data = await runFfprobeJson(filePath);
  const format = data.format as
    | { duration?: string; format_name?: string }
    | undefined;
  const streams = (data.streams as Array<Record<string, unknown>>) ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  let fps: number | undefined;
  if (video?.r_frame_rate && typeof video.r_frame_rate === "string") {
    const [num, den] = video.r_frame_rate.split("/").map(Number);
    if (num && den) fps = num / den;
  }

  return {
    durationSec: format?.duration ? Number(format.duration) : 0,
    width: typeof video?.width === "number" ? video.width : undefined,
    height: typeof video?.height === "number" ? video.height : undefined,
    fps,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
    videoCodec:
      typeof video?.codec_name === "string" ? video.codec_name : undefined,
    formatName: format?.format_name,
  };
}

/**
 * Encode a source segment to a normalized H.264 (+ optional AAC) part.
 * Handles still images (-loop) and audio-only (black video + audio).
 */
export async function encodeTimelinePart(opts: {
  src: string;
  outPath: string;
  srcIn: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  mediaKind?: "video" | "audio" | "image";
  hasAudio?: boolean;
  cwd?: string;
  /** Extra video filter chain segment(s), appended after scale/pad/fps/format */
  vfExtra?: string;
}): Promise<void> {
  const {
    src,
    outPath,
    srcIn,
    durationSec,
    width,
    height,
    fps,
    mediaKind = "video",
    hasAudio,
    cwd,
    vfExtra,
  } = opts;

  const scalePad = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p`;
  const vf = vfExtra ? `${scalePad},${vfExtra}` : scalePad;

  if (mediaKind === "image") {
    await runFfmpeg(
      [
        "-y",
        "-loop",
        "1",
        "-framerate",
        String(fps),
        "-i",
        src,
        "-t",
        String(durationSec),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-an",
        outPath,
      ],
      cwd,
    );
    return;
  }

  if (mediaKind === "audio") {
    const videoVf = vfExtra
      ? `fps=${fps},format=yuv420p,${vfExtra}`
      : `fps=${fps},format=yuv420p`;
    await runFfmpeg(
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=${width}x${height}:r=${fps}`,
        "-ss",
        String(srcIn),
        "-i",
        src,
        "-t",
        String(durationSec),
        "-vf",
        videoVf,
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
        "-shortest",
        outPath,
      ],
      cwd,
    );
    return;
  }

  // video
  const args = [
    "-y",
    "-ss",
    String(srcIn),
    "-i",
    src,
    "-t",
    String(durationSec),
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
  ];
  if (hasAudio !== false) {
    args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
  } else {
    args.push("-an");
  }
  args.push(outPath);
  await runFfmpeg(args, cwd);
}
