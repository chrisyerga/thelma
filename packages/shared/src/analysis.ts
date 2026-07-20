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
]);

export const MetaCueSchema = z.object({
  kind: MetaCueKindSchema,
  start: z.number(),
  end: z.number(),
  text: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  note: z.string().optional(),
});

export const MetaAnalysisSchema = z.object({
  assetId: z.string(),
  cues: z.array(MetaCueSchema),
});
export type MetaCue = z.infer<typeof MetaCueSchema>;
export type MetaAnalysis = z.infer<typeof MetaAnalysisSchema>;

export const AssetIndexEntrySchema = z.object({
  id: z.string(),
  filename: z.string(),
  path: z.string(),
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
