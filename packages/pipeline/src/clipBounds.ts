import type { Edit, TimelineClip, TranscriptWord } from "@thelma/shared";

/** Whisper word ends are systematically early relative to audible speech. */
const WHISPER_END_BIAS_SEC = 0.12;
/** Whisper word starts are often a touch late. */
const WHISPER_START_BIAS_SEC = 0.06;
/** How far into a following pause we're willing to rest the out-point. */
const MAX_PAUSE_HOLD_SEC = 0.4;
/** Leave a little air before the next word so we don't eat its onset. */
const PAUSE_GUARD_SEC = 0.05;
/** Minimum pause before we treat it as a natural breath we can sit in. */
const BREATH_PAUSE_SEC = 0.2;

export type ClipBoundAdjustment = {
  clipId: string;
  srcIn: number;
  srcOut: number;
  prevIn: number;
  prevOut: number;
};

/**
 * Expand timeline clip bounds using transcript gaps so cuts don't chop
 * word tails. Prefers resting in a real pause after the last word; falls
 * back to a small Whisper end-bias when speech is continuous.
 *
 * Does not shorten clips — only extends into available silence / bias.
 */
export function refineEditClipBounds(
  edit: Edit,
  wordsByAsset: Record<string, TranscriptWord[]>,
): { edit: Edit; adjustments: ClipBoundAdjustment[] } {
  const adjustments: ClipBoundAdjustment[] = [];
  const timeline = edit.timeline.map((clip) => {
    const asset = edit.assets.find((a) => a.id === clip.assetId);
    const refined = refineClipBounds(
      clip,
      wordsByAsset[clip.assetId] ?? [],
      asset?.durationSec,
    );
    if (refined.srcIn !== clip.srcIn || refined.srcOut !== clip.srcOut) {
      adjustments.push({
        clipId: clip.id,
        prevIn: clip.srcIn,
        prevOut: clip.srcOut,
        srcIn: refined.srcIn,
        srcOut: refined.srcOut,
      });
    }
    return refined;
  });

  return {
    edit: { ...edit, timeline },
    adjustments,
  };
}

export function refineClipBounds(
  clip: TimelineClip,
  words: TranscriptWord[],
  assetDurationSec?: number,
): TimelineClip {
  if (words.length === 0) {
    // No transcript — still apply a tiny end pad within asset duration.
    const srcOut = clampOut(
      clip.srcOut + WHISPER_END_BIAS_SEC,
      clip.srcIn,
      assetDurationSec,
    );
    return { ...clip, srcOut };
  }

  const srcIn = refineSrcIn(clip.srcIn, words, clip.srcOut);
  const srcOut = refineSrcOut(clip.srcOut, words, assetDurationSec, srcIn);
  return { ...clip, srcIn, srcOut };
}

function refineSrcIn(
  srcIn: number,
  words: TranscriptWord[],
  srcOut: number,
): number {
  // If we start mid-word, snap back to that word's start.
  const mid = words.find((w) => w.start < srcIn && w.end > srcIn);
  let nextIn = mid ? mid.start : srcIn;

  // Prefer a touch of pre-roll from the preceding pause (helps word onsets).
  const prev = [...words].reverse().find((w) => w.end <= nextIn + 0.01);
  const first = words.find((w) => w.start >= nextIn - 0.01);
  if (prev && first && first.start - prev.end >= BREATH_PAUSE_SEC) {
    const pauseStart = prev.end + PAUSE_GUARD_SEC;
    const ideal = first.start - WHISPER_START_BIAS_SEC;
    nextIn = Math.max(pauseStart, Math.min(nextIn, ideal));
  } else {
    nextIn = Math.max(0, nextIn - WHISPER_START_BIAS_SEC);
  }

  // Never invert the clip.
  return Math.min(nextIn, srcOut - 0.05);
}

function refineSrcOut(
  srcOut: number,
  words: TranscriptWord[],
  assetDurationSec: number | undefined,
  srcIn: number,
): number {
  // Last word that has begun by the nominal out-point.
  const last = [...words].reverse().find((w) => w.start < srcOut);
  if (!last) {
    return clampOut(srcOut + WHISPER_END_BIAS_SEC, srcIn, assetDurationSec);
  }

  // Cover the full word Whisper associated with this out-point.
  let target = Math.max(srcOut, last.end);

  const next = words.find((w) => w.start >= last.end - 0.001 && w !== last);
  const pauseRoom = next ? next.start - last.end : Infinity;

  if (next && pauseRoom >= BREATH_PAUSE_SEC) {
    // Sit in the breath after the word — natural edit point, covers tails.
    const hold = Math.min(MAX_PAUSE_HOLD_SEC, pauseRoom * 0.65);
    target = last.end + hold;
    target = Math.min(target, next.start - PAUSE_GUARD_SEC);
  } else if (next) {
    // Continuous speech: small Whisper bias, stop at next word onset.
    target = Math.min(target + WHISPER_END_BIAS_SEC, next.start);
  } else {
    // End of transcript / clip — allow a short hang.
    target = target + Math.max(WHISPER_END_BIAS_SEC, 0.2);
  }

  return clampOut(Math.max(target, srcOut), srcIn, assetDurationSec);
}

function clampOut(
  srcOut: number,
  srcIn: number,
  assetDurationSec?: number,
): number {
  let out = Math.max(srcOut, srcIn + 0.05);
  if (assetDurationSec != null && Number.isFinite(assetDurationSec)) {
    out = Math.min(out, assetDurationSec);
  }
  return out;
}
