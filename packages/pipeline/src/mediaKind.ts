import path from "node:path";
import type { MediaKind } from "@thelma/shared";
import { DEFAULT_IMAGE_DURATION_SEC } from "@thelma/shared";

const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
  ".avif",
]);

const AUDIO_EXTS = new Set([
  ".mp3",
  ".wav",
  ".aac",
  ".m4a",
  ".flac",
  ".ogg",
  ".opus",
  ".aiff",
  ".aif",
  ".wma",
]);

/** Codecs ffprobe reports for still / image2 inputs. */
const IMAGE_CODECS = new Set([
  "mjpeg",
  "jpeg",
  "png",
  "webp",
  "bmp",
  "tiff",
  "gif",
  "hevc", // some HEIC
  "av1",
  "pam",
  "pbm",
  "pgm",
  "ppm",
]);

export type ProbeStreams = {
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  videoCodec?: string;
  formatName?: string;
};

export function extensionHint(filePath: string): MediaKind | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return undefined;
}

/**
 * Classify imported media for scan / cut / review branching.
 * Prefer stream layout; fall back to extension for image2 / audio-only edge cases.
 */
export function classifyMediaKind(
  probe: ProbeStreams,
  filePath: string,
): MediaKind {
  const byExt = extensionHint(filePath);
  const format = (probe.formatName ?? "").toLowerCase();
  const codec = (probe.videoCodec ?? "").toLowerCase();
  // image2 / png_pipe = still containers. Codec alone is not enough (MJPEG video exists).
  const stillContainer =
    format.split(",").some((f) => f.trim() === "image2") ||
    format.includes("pipe");
  const shortStill =
    probe.durationSec > 0 &&
    probe.durationSec <= 0.15 &&
    IMAGE_CODECS.has(codec);

  if (probe.hasVideo && probe.hasAudio) {
    return "video";
  }

  if (!probe.hasVideo && probe.hasAudio) {
    return "audio";
  }

  if (probe.hasVideo && !probe.hasAudio) {
    if (byExt === "image" || stillContainer || shortStill) {
      return "image";
    }
    return "video";
  }

  // No streams classified — trust extension
  if (byExt) return byExt;
  return "video";
}

/** Duration to store for stills (probe often reports ~0.04s). */
export function durationForImport(
  kind: MediaKind,
  probedDurationSec: number,
  overrideSec?: number,
): number {
  if (overrideSec != null && overrideSec > 0) return overrideSec;
  if (kind === "image") {
    return probedDurationSec > 0.5
      ? probedDurationSec
      : DEFAULT_IMAGE_DURATION_SEC;
  }
  return probedDurationSec;
}

export { DEFAULT_IMAGE_DURATION_SEC };
