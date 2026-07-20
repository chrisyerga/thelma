import React, { createContext, useContext } from "react";
import { AbsoluteFill } from "remotion";
import {
  getPlatformProfile,
  getSlot,
  type PlatformId,
  type Rect,
  type SlotName,
} from "@thelma/shared";

type SafeFrameCtx = {
  platform: PlatformId;
  showGuides: boolean;
};

const Ctx = createContext<SafeFrameCtx>({
  platform: "universal",
  showGuides: false,
});

export function SafeFrameProvider({
  platform,
  showGuides = false,
  children,
}: {
  platform: PlatformId;
  showGuides?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Ctx.Provider value={{ platform, showGuides }}>{children}</Ctx.Provider>
  );
}

export function useSafeFrame() {
  return useContext(Ctx);
}

export function useSlot(slot: SlotName): Rect {
  const { platform } = useSafeFrame();
  return getSlot(platform, slot);
}

/** Position children absolutely inside a named slot. */
export function Slot({
  name,
  children,
  style,
}: {
  name: SlotName;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const rect = useSlot(name);
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Translucent overlays for studio — chrome danger zones + slot outlines. */
export function SafeAreaGuides() {
  const { platform, showGuides } = useSafeFrame();
  if (!showGuides) return null;

  const profile = getPlatformProfile(platform);
  const { insets, width, height, slots } = profile;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 1000 }}>
      {/* Dim unsafe margins */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height: insets.top,
          background: "rgba(255, 60, 60, 0.28)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width,
          height: insets.bottom,
          background: "rgba(255, 60, 60, 0.28)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: insets.top,
          width: insets.left,
          height: height - insets.top - insets.bottom,
          background: "rgba(255, 60, 60, 0.22)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 0,
          top: insets.top,
          width: insets.right,
          height: height - insets.top - insets.bottom,
          background: "rgba(255, 60, 60, 0.22)",
        }}
      />
      {/* Slot outlines */}
      {(Object.entries(slots) as [SlotName, Rect][]).map(([name, r]) => (
        <div
          key={name}
          style={{
            position: "absolute",
            left: r.x,
            top: r.y,
            width: r.width,
            height: r.height,
            border: "1px dashed rgba(0, 255, 180, 0.7)",
            boxSizing: "border-box",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: 4,
              fontSize: 18,
              color: "rgba(0,255,180,0.9)",
              fontFamily: "monospace",
            }}
          >
            {name}
          </span>
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          padding: "4px 10px",
          background: "rgba(0,0,0,0.65)",
          color: "#fff",
          fontFamily: "monospace",
          fontSize: 20,
        }}
      >
        safe: {platform}
      </div>
    </AbsoluteFill>
  );
}
