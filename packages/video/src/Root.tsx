import React from "react";
import { Composition } from "remotion";
import { Final, type FinalProps } from "./Final";
import type { Edit, PlatformId, ResolvedCue, SubtitleChunk } from "@thelma/shared";
import editJson from "../public/edit.json";
import subtitlesJson from "../public/subtitles.json";
import resolvedCuesJson from "../public/resolved-cues.json";
import cutMetaJson from "../public/cut-meta.json";

const edit = editJson as Edit;
const subtitles = subtitlesJson as SubtitleChunk[];
const resolvedCues = resolvedCuesJson as ResolvedCue[];
const durationSec = Math.max(
  1,
  (cutMetaJson as { probedDurationSec?: number }).probedDurationSec ?? 5,
);
const fps = edit.fps || 30;

const defaultProps: FinalProps = {
  platform: (edit.layoutPreset as PlatformId) || "universal",
  showGuides: true,
  edit,
  subtitles,
  resolvedCues,
  baseVideo: "base.mp4",
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Final"
        component={Final}
        durationInFrames={Math.max(1, Math.round(durationSec * fps))}
        fps={fps}
        width={edit.width || 1080}
        height={edit.height || 1920}
        defaultProps={defaultProps}
      />
      <Composition
        id="SafeGuides"
        component={Final}
        durationInFrames={Math.max(1, Math.round(durationSec * fps))}
        fps={fps}
        width={edit.width || 1080}
        height={edit.height || 1920}
        defaultProps={{ ...defaultProps, showGuides: true }}
      />
    </>
  );
};
