import { z } from "zod";
import { PlatformIdSchema, SlotNameSchema } from "./platforms";

export const AssetSchema = z.object({
  id: z.string(),
  path: z.string(),
  durationSec: z.number().optional(),
});

export const TimelineClipSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  srcIn: z.number().nonnegative(),
  srcOut: z.number().positive(),
  note: z.string().optional(),
});

export const AnchorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("srcTime"),
    assetId: z.string(),
    t: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal("word"),
    assetId: z.string(),
    wordId: z.string(),
  }),
  z.object({
    type: z.literal("clip"),
    timelineId: z.string(),
    offsetSec: z.number().nonnegative().default(0),
  }),
]);

export const CueKindSchema = z.enum([
  "overlay",
  "fullscreen",
  "flair",
  "sfx",
  "greenscreen",
  "narration",
]);

export const CueSchema = z.object({
  id: z.string(),
  kind: CueKindSchema,
  anchor: AnchorSchema,
  durationSec: z.number().positive().optional(),
  endAnchor: AnchorSchema.optional(),
  generator: z.string().optional(),
  mediaRef: z.string().optional(),
  slot: SlotNameSchema.optional(),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const SubtitleStyleSchema = z.object({
  fontFamily: z.string().default("Montserrat"),
  fontWeight: z.number().default(800),
  fontSize: z.number().default(64),
  color: z.string().default("#FFFFFF"),
  highlightColor: z.string().default("#FFD400"),
  outlineColor: z.string().default("#000000"),
  outlineWidth: z.number().default(8),
  maxWordsPerChunk: z.number().default(4),
  slot: SlotNameSchema.default("captionBand"),
  censorList: z
    .array(z.string())
    .default([
      "fuck",
      "shit",
      "cunt",
      "bitch",
      "motherfucker",
      "mutherfucker",
    ]),
});

export const AudioSettingsSchema = z.object({
  loudnorm: z.boolean().default(true),
  targetLufs: z.number().default(-16),
});

export const EditSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  title: z.string(),
  fps: z.number().default(30),
  width: z.number().default(1080),
  height: z.number().default(1920),
  platforms: z.array(PlatformIdSchema).default(["universal"]),
  layoutPreset: PlatformIdSchema.default("universal"),
  assets: z.array(AssetSchema),
  timeline: z.array(TimelineClipSchema),
  cues: z.array(CueSchema).default([]),
  subtitle: SubtitleStyleSchema.default({
    fontFamily: "Montserrat",
    fontWeight: 800,
    fontSize: 64,
    color: "#FFFFFF",
    highlightColor: "#FFD400",
    outlineColor: "#000000",
    outlineWidth: 8,
    maxWordsPerChunk: 4,
    slot: "captionBand",
    censorList: [
      "fuck",
      "shit",
      "cunt",
      "bitch",
      "motherfucker",
      "mutherfucker",
    ],
  }),
  audio: AudioSettingsSchema.default({
    loudnorm: true,
    targetLufs: -16,
  }),
});

export type Asset = z.infer<typeof AssetSchema>;
export type TimelineClip = z.infer<typeof TimelineClipSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type Cue = z.infer<typeof CueSchema>;
export type CueKind = z.infer<typeof CueKindSchema>;
export type SubtitleStyle = z.infer<typeof SubtitleStyleSchema>;
export type Edit = z.infer<typeof EditSchema>;

export const SubtitleWordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  wordId: z.string().optional(),
  flair: z.string().optional(),
  censor: z.boolean().optional(),
});

export const SubtitleChunkSchema = z.object({
  start: z.number(),
  end: z.number(),
  words: z.array(SubtitleWordSchema),
});

export type SubtitleWord = z.infer<typeof SubtitleWordSchema>;
export type SubtitleChunk = z.infer<typeof SubtitleChunkSchema>;

/** Derived cue with resolved output times — Remotion only. */
export const ResolvedCueSchema = CueSchema.extend({
  start: z.number().nonnegative(),
  end: z.number().positive(),
});
export type ResolvedCue = z.infer<typeof ResolvedCueSchema>;

export const CutMetaSchema = z.object({
  editId: z.string(),
  editHash: z.string(),
  outPath: z.string(),
  durationSec: z.number(),
  probedDurationSec: z.number(),
  fps: z.number(),
  width: z.number(),
  height: z.number(),
  segments: z.array(
    z.object({
      timelineId: z.string(),
      assetId: z.string(),
      srcIn: z.number(),
      srcOut: z.number(),
      outStart: z.number(),
      outEnd: z.number(),
    }),
  ),
});
export type CutMeta = z.infer<typeof CutMetaSchema>;
