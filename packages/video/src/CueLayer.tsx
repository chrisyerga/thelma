import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion";
import { renderGraphic } from "@thelma/graphics";
import type { ResolvedCue } from "@thelma/shared";

const AUDIO_EXT = /\.(mp3|wav|aac|m4a|flac|ogg|opus)$/i;

function mediaSrc(cue: ResolvedCue): string | null {
  const p = cue.params?.path;
  if (typeof p === "string") {
    // Prefer files synced under public/media/
    const base = p.split("/").pop();
    if (base) return staticFile(`media/${base}`);
  }
  if (cue.mediaRef) {
    return staticFile(`media/${cue.mediaRef}`);
  }
  return null;
}

function mediaBasename(cue: ResolvedCue): string | null {
  if (typeof cue.params?.path === "string") {
    return cue.params.path.split("/").pop() ?? null;
  }
  return cue.mediaRef ?? null;
}

export const CueLayer: React.FC<{ cues: ResolvedCue[] }> = ({ cues }) => {
  const { fps } = useVideoConfig();

  return (
    <>
      {cues.map((cue) => {
        const from = Math.round(cue.start * fps);
        const durationInFrames = Math.max(
          1,
          Math.round((cue.end - cue.start) * fps),
        );

        if (cue.kind === "sfx" || cue.kind === "narration") {
          const src = mediaSrc(cue);
          if (!src) return null;
          return (
            <Sequence key={cue.id} from={from} durationInFrames={durationInFrames}>
              <Audio src={src} />
            </Sequence>
          );
        }

        if (cue.kind === "greenscreen") {
          const src = mediaSrc(cue);
          if (!src) return null;
          const keyColor =
            typeof cue.params?.keyColor === "string"
              ? cue.params.keyColor
              : "#00FF00";
          return (
            <Sequence key={cue.id} from={from} durationInFrames={durationInFrames}>
              <AbsoluteFill style={{ zIndex: 4 }}>
                <OffthreadVideo
                  src={src}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    // CSS chromakey approximation — swap for @remotion chroma later
                    mixBlendMode: "screen",
                    filter: `drop-shadow(0 0 0 ${keyColor})`,
                  }}
                />
              </AbsoluteFill>
            </Sequence>
          );
        }

        if (
          cue.kind === "overlay" ||
          cue.kind === "fullscreen" ||
          cue.kind === "flair"
        ) {
          if (cue.generator) {
            return (
              <Sequence
                key={cue.id}
                from={from}
                durationInFrames={durationInFrames}
              >
                <AbsoluteFill
                  style={{ zIndex: cue.kind === "fullscreen" ? 5 : 3 }}
                >
                  {renderGraphic(cue.generator, cue.params ?? {})}
                </AbsoluteFill>
              </Sequence>
            );
          }

          // Imported still / audio overlay (no generator) — mediaRef may be an asset id
          const src = mediaSrc(cue);
          const base = mediaBasename(cue);
          if (!src || !base) return null;
          if (AUDIO_EXT.test(base)) {
            return (
              <Sequence
                key={cue.id}
                from={from}
                durationInFrames={durationInFrames}
              >
                <Audio src={src} />
              </Sequence>
            );
          }
          // Still image (by extension) or asset-id alias synced without an extension
          return (
            <Sequence
              key={cue.id}
              from={from}
              durationInFrames={durationInFrames}
            >
              <AbsoluteFill
                style={{ zIndex: cue.kind === "fullscreen" ? 5 : 3 }}
              >
                <Img
                  src={src}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit:
                      cue.kind === "fullscreen" ? "cover" : "contain",
                  }}
                />
              </AbsoluteFill>
            </Sequence>
          );
        }

        return null;
      })}
    </>
  );
};
