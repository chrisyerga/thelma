import { z } from "zod";
import { PlatformIdSchema } from "./platforms";

export const TargetSchema = z.object({
  id: z.string(),
  maxSec: z.number().positive(),
  label: z.string().optional(),
});

export const ProjectSchema = z.object({
  version: z.literal(1),
  slug: z.string(),
  title: z.string(),
  createdAt: z.string(),
  activeEditId: z.string().nullable().default(null),
  layoutPreset: PlatformIdSchema.default("universal"),
  platforms: z.array(PlatformIdSchema).default(["universal"]),
  targets: z.array(TargetSchema).default([
    { id: "teaser", maxSec: 30, label: "Teaser" },
    { id: "short", maxSec: 60, label: "Short" },
    { id: "main", maxSec: 300, label: "Main" },
  ]),
  fps: z.number().default(30),
  width: z.number().default(1080),
  height: z.number().default(1920),
});

export type Project = z.infer<typeof ProjectSchema>;
export type Target = z.infer<typeof TargetSchema>;
