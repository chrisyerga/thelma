import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import {
  CensorBurst,
  Slot,
  useSafeFrame,
} from "@thelma/graphics";
import type { PlatformId, SubtitleChunk, SubtitleStyle } from "@thelma/shared";
import { getSlot } from "@thelma/shared";

export const KaraokeSubtitles: React.FC<{
  chunks: SubtitleChunk[];
  style: SubtitleStyle;
  platform?: PlatformId;
}> = ({ chunks, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const { platform } = useSafeFrame();
  const slot = style.slot ?? "captionBand";
  const rect = getSlot(platform, slot);

  const active = chunks.find((c) => t >= c.start && t < c.end);
  if (!active) return null;

  return (
    <AbsoluteFill style={{ zIndex: 10 }}>
      <Slot
        name={slot}
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          alignContent: "center",
          gap: 12,
          padding: 8,
        }}
      >
        {active.words.map((w, i) => {
          const on = t >= w.start && t < w.end;
          if (w.censor) {
            return (
              <span
                key={`${w.start}-${i}`}
                style={{
                  fontFamily: style.fontFamily,
                  fontWeight: style.fontWeight,
                  fontSize: style.fontSize,
                  WebkitTextStroke: `${style.outlineWidth}px ${style.outlineColor}`,
                  paintOrder: "stroke fill",
                }}
              >
                <CensorBurst seed={i + Math.floor(w.start * 10)} />
              </span>
            );
          }
          return (
            <span
              key={`${w.start}-${i}`}
              style={{
                fontFamily: style.fontFamily,
                fontWeight: style.fontWeight,
                fontSize: style.fontSize,
                color: on ? style.highlightColor : style.color,
                WebkitTextStroke: `${style.outlineWidth}px ${style.outlineColor}`,
                paintOrder: "stroke fill",
                transform: on ? "scale(1.06)" : "scale(1)",
                transition: "none",
                maxWidth: rect.width,
              }}
            >
              {w.text}
            </span>
          );
        })}
      </Slot>
    </AbsoluteFill>
  );
};
