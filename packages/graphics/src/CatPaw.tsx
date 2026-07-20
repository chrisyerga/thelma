import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Slot } from "./SafeFrame";

/** Recurring character placeholder — replace with your actual cat assets later. */
export const CatPaw: React.FC<{ label?: string }> = ({
  label = "🐱 paw",
}) => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 20, 40], [80, 0, 0], {
    extrapolateRight: "clamp",
  });
  const rot = interpolate(frame, [0, 20], [25, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Slot
        name="cornerTR"
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-end",
        }}
      >
        <div
          style={{
            transform: `translateX(${x}px) rotate(${rot}deg)`,
            fontSize: 96,
            filter: "drop-shadow(0 6px 0 rgba(0,0,0,0.5))",
          }}
        >
          {label}
        </div>
      </Slot>
    </AbsoluteFill>
  );
};
