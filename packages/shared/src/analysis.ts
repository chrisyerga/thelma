import { z } from "zod";

export const TranscriptWordSchema = z.object({
  wordId: z.string(),
  word: z.string(),
  start: z.number(),
  end: z.number(),
  probability: z.number().optional(),
});

export const TranscriptSchema = z.object({
  assetId: z.string(),
  text: z.string(),
  language: z.string().optional(),
  words: z.array(TranscriptWordSchema),
  source: z.string().optional(),
});
export type Transcript = z.infer<typeof TranscriptSchema>;
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

export const VisionEventTypeSchema = z.enum([
  "hand_raised",
  "face_covered",
  "wink_hold",
  "no_face",
  "looking_away",
  "mouth_idle_with_audio",
  "pointing",
  "shrug",
  "face_bbox",
]);

export const VisionEventSchema = z.object({
  type: VisionEventTypeSchema,
  start: z.number(),
  end: z.number(),
  confidence: z.number().min(0).max(1).default(0.5),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export const VisionAnalysisSchema = z.object({
  assetId: z.string(),
  fpsSampled: z.number(),
  events: z.array(VisionEventSchema),
});
export type VisionEvent = z.infer<typeof VisionEventSchema>;
export type VisionAnalysis = z.infer<typeof VisionAnalysisSchema>;

export const MetaCueKindSchema = z.enum([
  "content",
  "guidance",
  "idea_other_video",
  "graphic_ask",
  "needs_pickup",
  "bad_take",
]);
export type MetaCueKind = z.infer<typeof MetaCueKindSchema>;

export const MetaCueSchema = z.object({
  id: z.string(),
  kind: MetaCueKindSchema,
  start: z.number(),
  end: z.number(),
  text: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  note: z.string().optional(),
  /** When false, story/guide must not use this span in timelines. */
  keepFootage: z.boolean().default(true),
});

export const MetaAnalysisSchema = z.object({
  assetId: z.string(),
  cues: z.array(MetaCueSchema),
});
export type MetaCue = z.infer<typeof MetaCueSchema>;
export type MetaAnalysis = z.infer<typeof MetaAnalysisSchema>;

/** Parse meta JSON, upgrading legacy cues that lack id / keepFootage. */
export function parseMetaAnalysis(raw: unknown): MetaAnalysis {
  const base = z
    .object({
      assetId: z.string(),
      cues: z.array(z.record(z.string(), z.unknown())).default([]),
    })
    .parse(raw);

  const cues = [...base.cues]
    .sort((a, b) => Number(a.start ?? 0) - Number(b.start ?? 0))
    .map((c, i) => {
      const kind = MetaCueKindSchema.catch("content").parse(c.kind);
      let keepFootage =
        typeof c.keepFootage === "boolean" ? c.keepFootage : kind !== "bad_take";
      if (kind === "bad_take") keepFootage = false;
      return MetaCueSchema.parse({
        id: typeof c.id === "string" && c.id ? c.id : `cue-${i + 1}`,
        kind,
        start: Number(c.start),
        end: Number(c.end),
        text: String(c.text ?? ""),
        confidence: typeof c.confidence === "number" ? c.confidence : 0.5,
        note: typeof c.note === "string" ? c.note : undefined,
        keepFootage,
      });
    });

  return { assetId: base.assetId, cues };
}

export const MediaKindSchema = z.enum(["video", "audio", "image"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/** Default hold length when importing a still (review / timeline). */
export const DEFAULT_IMAGE_DURATION_SEC = 3;

export const AssetIndexEntrySchema = z.object({
  id: z.string(),
  filename: z.string(),
  path: z.string(),
  /** video | audio | image — inferred on import from ffprobe + extension */
  mediaKind: MediaKindSchema.optional(),
  durationSec: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fps: z.number().optional(),
  hasAudio: z.boolean().optional(),
  importedAt: z.string(),
});

export const AssetIndexSchema = z.object({
  version: z.literal(1),
  assets: z.array(AssetIndexEntrySchema),
});
export type AssetIndex = z.infer<typeof AssetIndexSchema>;
export type AssetIndexEntry = z.infer<typeof AssetIndexEntrySchema>;
