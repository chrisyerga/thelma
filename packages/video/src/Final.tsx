import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  staticFile,
} from "remotion";
import {
  SafeAreaGuides,
  SafeFrameProvider,
} from "@thelma/graphics";
import type {
  Edit,
  PlatformId,
  ResolvedCue,
  SubtitleChunk,
} from "@thelma/shared";
import { KaraokeSubtitles } from "./KaraokeSubtitles";
import { FlairLayer } from "./FlairLayer";
import { CueLayer } from "./CueLayer";

export type FinalProps = {
  platform: PlatformId;
  showGuides: boolean;
  edit: Edit;
  subtitles: SubtitleChunk[];
  resolvedCues: ResolvedCue[];
  baseVideo: string;
};

export const Final: React.FC<FinalProps> = ({
  platform,
  showGuides,
  edit,
  subtitles,
  resolvedCues,
  baseVideo,
}) => {
  return (
    <SafeFrameProvider platform={platform} showGuides={showGuides}>
      <AbsoluteFill style={{ backgroundColor: "#000" }}>
        <OffthreadVideo src={staticFile(baseVideo)} />
        <CueLayer cues={resolvedCues} />
        <FlairLayer chunks={subtitles} />
        <KaraokeSubtitles chunks={subtitles} style={edit.subtitle} />
        <SafeAreaGuides />
      </AbsoluteFill>
    </SafeFrameProvider>
  );
};
