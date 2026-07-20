import { z } from "zod";

export const PlatformIdSchema = z.enum([
  "universal",
  "tiktok",
  "instagram",
  "facebook",
]);
export type PlatformId = z.infer<typeof PlatformIdSchema>;

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Rect = z.infer<typeof RectSchema>;

export const InsetsSchema = z.object({
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
});
export type Insets = z.infer<typeof InsetsSchema>;

export const SlotNameSchema = z.enum([
  "captionBand",
  "title",
  "lowerThird",
  "center",
  "fullBleed",
  "cornerTR",
  "cornerTL",
]);
export type SlotName = z.infer<typeof SlotNameSchema>;

export type PlatformProfile = {
  id: PlatformId;
  width: number;
  height: number;
  insets: Insets;
  slots: Record<SlotName, Rect>;
};

const W = 1080;
const H = 1920;

function safeRect(insets: Insets): Rect {
  return {
    x: insets.left,
    y: insets.top,
    width: W - insets.left - insets.right,
    height: H - insets.top - insets.bottom,
  };
}

function buildSlots(insets: Insets): Record<SlotName, Rect> {
  const safe = safeRect(insets);
  const captionHeight = Math.round(safe.height * 0.18);
  // Upper-middle of safe rect — avoids platform caption chrome at bottom
  const captionY = safe.y + Math.round(safe.height * 0.28);

  return {
    fullBleed: { x: 0, y: 0, width: W, height: H },
    center: {
      x: safe.x + Math.round(safe.width * 0.05),
      y: safe.y + Math.round(safe.height * 0.25),
      width: Math.round(safe.width * 0.9),
      height: Math.round(safe.height * 0.4),
    },
    title: {
      x: safe.x + Math.round(safe.width * 0.05),
      y: safe.y + Math.round(safe.height * 0.08),
      width: Math.round(safe.width * 0.9),
      height: Math.round(safe.height * 0.18),
    },
    captionBand: {
      x: safe.x + Math.round(safe.width * 0.04),
      y: captionY,
      width: Math.round(safe.width * 0.92),
      height: captionHeight,
    },
    lowerThird: {
      x: safe.x + Math.round(safe.width * 0.05),
      y: safe.y + Math.round(safe.height * 0.72),
      width: Math.round(safe.width * 0.9),
      height: Math.round(safe.height * 0.2),
    },
    cornerTR: {
      x: safe.x + Math.round(safe.width * 0.55),
      y: safe.y + Math.round(safe.height * 0.05),
      width: Math.round(safe.width * 0.4),
      height: Math.round(safe.height * 0.22),
    },
    cornerTL: {
      x: safe.x + Math.round(safe.width * 0.05),
      y: safe.y + Math.round(safe.height * 0.05),
      width: Math.round(safe.width * 0.4),
      height: Math.round(safe.height * 0.22),
    },
  };
}

function profile(id: PlatformId, insets: Insets): PlatformProfile {
  return { id, width: W, height: H, insets, slots: buildSlots(insets) };
}

/** Intersection of TikTok / IG / FB — default master export. */
export const PLATFORM_PROFILES: Record<PlatformId, PlatformProfile> = {
  universal: profile("universal", {
    top: 260,
    bottom: 450,
    left: 90,
    right: 120,
  }),
  tiktok: profile("tiktok", {
    top: 150,
    bottom: 420,
    left: 60,
    right: 120,
  }),
  instagram: profile("instagram", {
    top: 210,
    bottom: 320,
    left: 70,
    right: 100,
  }),
  facebook: profile("facebook", {
    top: 100,
    bottom: 300,
    left: 70,
    right: 100,
  }),
};

export function getPlatformProfile(id: PlatformId): PlatformProfile {
  return PLATFORM_PROFILES[id];
}

export function getSlot(platform: PlatformId, slot: SlotName): Rect {
  return PLATFORM_PROFILES[platform].slots[slot];
}
