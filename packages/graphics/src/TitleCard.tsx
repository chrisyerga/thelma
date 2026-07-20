import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Slot } from "./SafeFrame";

export type TitleCardProps = {
  title?: string;
  subtitle?: string;
};

export const TitleCard: React.FC<TitleCardProps> = ({
  title = "Title",
  subtitle,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame, [0, 12], [30, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Slot
        name="title"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          opacity,
          transform: `translateY(${y}px)`,
        }}
      >
        <div
          style={{
            fontFamily: "Montserrat, sans-serif",
            fontWeight: 800,
            fontSize: 72,
            color: "#fff",
            textAlign: "center",
            textShadow: "0 4px 0 #000",
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: 16,
              fontFamily: "Montserrat, sans-serif",
              fontWeight: 600,
              fontSize: 36,
              color: "#FFD400",
              textAlign: "center",
              textShadow: "0 2px 0 #000",
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </Slot>
    </AbsoluteFill>
  );
};
