import React, { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";

import {
  activeClick,
  cursorAt,
  pickSceneAt,
  sceneRequiresTarget,
} from "./timeline";
import { useSceneTargetMeasurement } from "./sceneTargetMeasurement";
import type {
  MiniDemoPlayerProps,
  MiniDemoScene,
  MiniDemoTargetId,
} from "./types";

const CLICK_EFFECT_MS = 450;
const CURSOR_PX = 22;
const CLICK_RING_PX = 56;

interface SceneLayerProps {
  scene: MiniDemoScene;
  width: number;
  height: number;
  scale: number;
  opacity: number;
  contentRef?: (element: HTMLDivElement | null) => void;
}

const SceneLayer: React.FC<SceneLayerProps> = ({
  scene,
  width,
  height,
  scale,
  opacity,
  contentRef,
}) => (
  <Box
    aria-hidden={opacity === 0 ? true : undefined}
    inert
    sx={{
      position: "absolute",
      inset: 0,
      width: width * scale,
      height: height * scale,
      opacity,
      pointerEvents: "none",
    }}
  >
    <Box
      ref={contentRef}
      sx={{
        width,
        height,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }}
    >
      {scene.content}
    </Box>
  </Box>
);

const Cursor: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <Box
    data-testid="mini-demo-cursor"
    data-demo-cursor-hotspot-x={x}
    data-demo-cursor-hotspot-y={y}
    sx={{
      position: "absolute",
      left: 0,
      top: 0,
      width: CURSOR_PX,
      height: CURSOR_PX,
      transform: `translate(${x - 3}px, ${y - 2}px)`,
      pointerEvents: "none",
      filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))",
      transition: "transform 60ms linear",
    }}
  >
    <svg width={CURSOR_PX} height={CURSOR_PX} viewBox="0 0 22 22" aria-hidden>
      <path
        d="M3 2 L3 18 L7.5 13.5 L10.2 19.8 L12.6 18.7 L9.9 12.5 L16 12.5 Z"
        fill="#fff"
        stroke="#111"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  </Box>
);

const ClickRing: React.FC<{ x: number; y: number; progress: number }> = ({
  x,
  y,
  progress,
}) => {
  const scale = 0.2 + progress * 1.2;
  const opacity = Math.max(0, 1 - progress);
  return (
    <Box
      data-testid="mini-demo-click-ring"
      data-demo-click-center-x={x}
      data-demo-click-center-y={y}
      sx={{
        position: "absolute",
        left: x - CLICK_RING_PX / 2,
        top: y - CLICK_RING_PX / 2,
        width: CLICK_RING_PX,
        height: CLICK_RING_PX,
        borderRadius: "50%",
        border: "2px solid",
        borderColor: "primary.main",
        transform: `scale(${scale})`,
        opacity,
        pointerEvents: "none",
      }}
    />
  );
};

export const MiniDemoPlayer: React.FC<MiniDemoPlayerProps> = ({
  scenes,
  caption,
  sceneWidth = 1280,
  sceneHeight = 720,
  containerWidth = 600,
  loop = false,
  crossfadeMs = 300,
  startDelayMs = 500,
}) => {
  const [currentMs, setCurrentMs] = useState(0);
  const startTsRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const currentMsRef = useRef(0);
  currentMsRef.current = currentMs;

  // Depend on the structural identity of the scene list (count) rather than
  // the array reference: callers commonly recompute `scenes` whenever a
  // measured cursor target changes, and restarting playback on every cursor
  // update would prevent later scenes from ever being shown when their target
  // is only measurable after they mount (chicken-and-egg).
  const sceneCount = scenes.length;
  const scale = containerWidth / sceneWidth;
  const containerHeight = sceneHeight * scale;

  const pos = pickSceneAt(scenes, currentMs, crossfadeMs, loop);
  const scene = scenes[pos.index];
  const [targetMeasurement, sceneRootRef] = useSceneTargetMeasurement(
    scene?.id ?? null,
    scene?.targetId ?? null,
    sceneWidth,
    sceneHeight
  );
  const targetReady =
    scene === undefined ||
    !sceneRequiresTarget(scene) ||
    (targetMeasurement.sceneId === scene.id &&
      targetMeasurement.targetId === scene.targetId &&
      targetMeasurement.status === "ready");

  useEffect(() => {
    if (sceneCount === 0 || !targetReady) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      startTsRef.current = null;
      return;
    }

    let cancelled = false;
    const tick = (now: number) => {
      if (cancelled) return;
      if (startTsRef.current === null) {
        startTsRef.current = now - startDelayMs - currentMsRef.current;
      }
      const elapsed = now - startTsRef.current - startDelayMs;
      setCurrentMs(elapsed > 0 ? elapsed : 0);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      startTsRef.current = null;
    };
  }, [sceneCount, startDelayMs, targetReady]);

  if (scenes.length === 0 || scene === undefined) return null;

  const nextScene = pos.nextIndex !== null ? scenes[pos.nextIndex] : null;

  const resolveTarget = (targetId: MiniDemoTargetId) =>
    targetId === scene.targetId ? targetMeasurement.position : null;
  const cursorScene = targetReady
    ? cursorAt(scene.cursor ?? [], pos.sceneMs, resolveTarget)
    : null;
  const click = targetReady
    ? activeClick(scene.cursor, pos.sceneMs, CLICK_EFFECT_MS, resolveTarget)
    : null;

  return (
    <Box
      data-testid="mini-demo-player"
      aria-label={caption}
      data-demo-ready={targetReady ? "true" : "false"}
      data-demo-using-fallback="false"
      data-demo-active-scene={scene.id}
      data-demo-target-id={scene.targetId}
      sx={{ width: containerWidth }}
    >
      <Box
        sx={{
          position: "relative",
          width: containerWidth,
          height: containerHeight,
          overflow: "hidden",
          borderRadius: 1,
          border: 1,
          borderColor: "divider",
          backgroundColor: "background.paper",
        }}
      >
        <SceneLayer
          scene={scene}
          width={sceneWidth}
          height={sceneHeight}
          scale={scale}
          opacity={1}
          contentRef={sceneRootRef}
        />
        {nextScene && (
          <SceneLayer
            scene={nextScene}
            width={sceneWidth}
            height={sceneHeight}
            scale={scale}
            opacity={pos.crossfadeT}
          />
        )}
        {cursorScene && (
          <Cursor x={cursorScene.x * scale} y={cursorScene.y * scale} />
        )}
        {click && (
          <ClickRing
            x={click.x * scale}
            y={click.y * scale}
            progress={click.progress}
          />
        )}
      </Box>
      {caption && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 1, fontStyle: "italic" }}
          data-testid="mini-demo-caption"
        >
          {caption}
        </Typography>
      )}
    </Box>
  );
};
