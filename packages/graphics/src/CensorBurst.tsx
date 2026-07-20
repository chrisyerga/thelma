import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

const GLYPHS = ["#", "@", "$", "%", "!", "*", "&"];

/** Scrambled swear cover — audio still plays, dignity does not. */
export const CensorBurst: React.FC<{ seed?: number }> = ({ seed = 0 }) => {
  const frame = useCurrentFrame();
  const shake = Math.sin(frame * 1.7 + seed) * 4;
  const text = Array.from({ length: 4 }, (_, i) =>
    GLYPHS[(frame + seed + i * 3) % GLYPHS.length],
  ).join("");

  const scale = interpolate(frame % 8, [0, 4, 8], [1, 1.12, 1]);

  return (
    <span
      style={{
        display: "inline-block",
        color: "#ff2d55",
        transform: `translateX(${shake}px) scale(${scale})`,
        fontWeight: 900,
        textShadow: "0 2px 0 #000",
      }}
    >
      {text}
    </span>
  );
};
