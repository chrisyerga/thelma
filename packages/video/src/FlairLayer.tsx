import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { renderGraphic } from "@thelma/graphics";
import type { SubtitleChunk } from "@thelma/shared";

const FLAIR_LINGER_SEC = 2.2;

export const FlairLayer: React.FC<{ chunks: SubtitleChunk[] }> = ({
  chunks,
}) => {
  const { fps } = useVideoConfig();
  const items: Array<{ key: string; from: number; dur: number; flair: string }> =
    [];

  for (const chunk of chunks) {
    for (const w of chunk.words) {
      if (!w.flair) continue;
      const from = Math.round(w.start * fps);
      const dur = Math.max(
        1,
        Math.round((w.end - w.start + FLAIR_LINGER_SEC) * fps),
      );
      items.push({
        key: `${w.wordId ?? w.start}-${w.flair}`,
        from,
        dur,
        flair: w.flair,
      });
    }
  }

  return (
    <AbsoluteFill style={{ zIndex: 6 }}>
      {items.map((item) => (
        <Sequence key={item.key} from={item.from} durationInFrames={item.dur}>
          <AbsoluteFill>{renderGraphic(item.flair, {})}</AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
