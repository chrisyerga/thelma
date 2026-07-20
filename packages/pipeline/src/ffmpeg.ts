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
};

export async function probeMedia(filePath: string): Promise<MediaProbe> {
  const data = await runFfprobeJson(filePath);
  const format = data.format as { duration?: string } | undefined;
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
  };
}
