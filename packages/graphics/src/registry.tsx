import React from "react";
import { TitleCard } from "./TitleCard";
import { CatPaw } from "./CatPaw";
import { AbsoluteFill } from "remotion";

const registry: Record<
  string,
  React.FC<Record<string, unknown>>
> = {
  TitleCard: TitleCard as React.FC<Record<string, unknown>>,
  CatPaw: CatPaw as React.FC<Record<string, unknown>>,
};

export function renderGraphic(
  generator: string,
  params: Record<string, unknown> = {},
): React.ReactNode {
  const Comp = registry[generator];
  if (!Comp) {
    return (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          color: "#fff",
          fontSize: 40,
          fontFamily: "monospace",
        }}
      >
        Unknown graphic: {generator}
      </AbsoluteFill>
    );
  }
  return <Comp {...params} />;
}

export function listGenerators(): string[] {
  return Object.keys(registry);
}
