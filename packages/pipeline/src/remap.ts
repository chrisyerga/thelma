import type {
  Anchor,
  Edit,
  ResolvedCue,
  TimelineClip,
  TranscriptWord,
} from "@thelma/shared";

export type OutputSegment = {
  clip: TimelineClip;
  outStart: number;
  outEnd: number;
  duration: number;
};

export function buildOutputTimeline(edit: Edit): OutputSegment[] {
  let cursor = 0;
  const segments: OutputSegment[] = [];

  for (const clip of edit.timeline) {
    if (clip.srcOut <= clip.srcIn) {
      throw new Error(
        `Clip ${clip.id}: srcOut (${clip.srcOut}) must be > srcIn (${clip.srcIn})`,
      );
    }
    const duration = clip.srcOut - clip.srcIn;
    segments.push({
      clip,
      outStart: cursor,
      outEnd: cursor + duration,
      duration,
    });
    cursor += duration;
  }

  return segments;
}

export function totalDuration(edit: Edit): number {
  const segs = buildOutputTimeline(edit);
  return segs.length === 0 ? 0 : segs[segs.length - 1]!.outEnd;
}

export function remapWord(
  word: TranscriptWord,
  assetId: string,
  segments: OutputSegment[],
): TranscriptWord | null {
  for (const seg of segments) {
    if (seg.clip.assetId !== assetId) continue;
    const { srcIn, srcOut } = seg.clip;
    if (word.end <= srcIn || word.start >= srcOut) continue;

    const clippedStart = Math.max(word.start, srcIn);
    const clippedEnd = Math.min(word.end, srcOut);

    return {
      ...word,
      start: seg.outStart + (clippedStart - srcIn),
      end: seg.outStart + (clippedEnd - srcIn),
    };
  }
  return null;
}

export function remapAllWords(
  wordsByAsset: Record<string, TranscriptWord[]>,
  edit: Edit,
): TranscriptWord[] {
  const segments = buildOutputTimeline(edit);
  const out: TranscriptWord[] = [];

  for (const [assetId, words] of Object.entries(wordsByAsset)) {
    for (const word of words) {
      const mapped = remapWord(word, assetId, segments);
      if (mapped) out.push(mapped);
    }
  }

  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/** Resolve a source-time or clip/word anchor into output seconds. */
export function resolveAnchor(
  anchor: Anchor,
  _edit: Edit,
  segments: OutputSegment[],
  wordsByAsset: Record<string, TranscriptWord[]>,
): number | null {
  if (anchor.type === "srcTime") {
    for (const seg of segments) {
      if (seg.clip.assetId !== anchor.assetId) continue;
      const { srcIn, srcOut } = seg.clip;
      if (anchor.t < srcIn || anchor.t >= srcOut) continue;
      return seg.outStart + (anchor.t - srcIn);
    }
    return null;
  }

  if (anchor.type === "clip") {
    const seg = segments.find((s) => s.clip.id === anchor.timelineId);
    if (!seg) return null;
    return seg.outStart + anchor.offsetSec;
  }

  // word
  const words = wordsByAsset[anchor.assetId] ?? [];
  const word = words.find((w) => w.wordId === anchor.wordId);
  if (!word) return null;
  const mapped = remapWord(word, anchor.assetId, segments);
  return mapped ? mapped.start : null;
}

export function resolveCues(
  edit: Edit,
  wordsByAsset: Record<string, TranscriptWord[]>,
): ResolvedCue[] {
  const segments = buildOutputTimeline(edit);
  const resolved: ResolvedCue[] = [];

  for (const cue of edit.cues) {
    const start = resolveAnchor(cue.anchor, edit, segments, wordsByAsset);
    if (start === null) {
      console.warn(`Skipping cue ${cue.id}: could not resolve start anchor`);
      continue;
    }

    let end: number;
    if (cue.endAnchor) {
      const endT = resolveAnchor(cue.endAnchor, edit, segments, wordsByAsset);
      end = endT ?? start + (cue.durationSec ?? 3);
    } else {
      end = start + (cue.durationSec ?? 3);
    }

    if (end <= start) end = start + 0.5;

    resolved.push({
      ...cue,
      start,
      end,
    });
  }

  return resolved.sort((a, b) => a.start - b.start);
}

export function hashEdit(edit: Edit): string {
  // Stable-ish content hash for stamp — not crypto-critical
  const payload = JSON.stringify({
    id: edit.id,
    timeline: edit.timeline,
    cues: edit.cues,
    subtitle: edit.subtitle,
    audio: edit.audio,
  });
  let h = 0;
  for (let i = 0; i < payload.length; i++) {
    h = (Math.imul(31, h) + payload.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
