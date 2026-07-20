import { z } from "zod";
import { CueSchema, TimelineClipSchema } from "./edit";

export const CandidateCompletenessSchema = z.enum([
  "ready",
  "needs_footage",
]);

export const StoryCandidateSchema = z.object({
  id: z.string(),
  title: z.string(),
  pitch: z.string(),
  targetId: z.string(),
  maxSec: z.number(),
  completeness: CandidateCompletenessSchema,
  needsFootageNotes: z.array(z.string()).default([]),
  beats: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      approxSec: z.number().optional(),
    }),
  ),
  suggestedTimeline: z.array(TimelineClipSchema).default([]),
  suggestedCues: z.array(CueSchema).default([]),
  graphicIdeas: z.array(z.string()).default([]),
  sfxIdeas: z.array(z.string()).default([]),
});

export const StoryCandidatesSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  model: z.string().optional(),
  candidates: z.array(StoryCandidateSchema),
});

export type StoryCandidate = z.infer<typeof StoryCandidateSchema>;
export type StoryCandidates = z.infer<typeof StoryCandidatesSchema>;
