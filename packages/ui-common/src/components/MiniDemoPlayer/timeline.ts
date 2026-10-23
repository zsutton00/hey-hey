import type {
  CoordinateCursorKeyframe,
  CursorKeyframe,
  MiniDemoScene,
  MiniDemoTargetId,
} from "./types";

export interface ScenePosition {
  /** Index of the active (foreground) scene. */
  index: number;
  /** Time in ms within the active scene. Clamped to [0, durationMs]. */
  sceneMs: number;
  /** Index of the next scene during crossfade, or null when not crossfading. */
  nextIndex: number | null;
  /** Crossfade progress [0,1], or 0 when not crossfading. */
  crossfadeT: number;
  /** True once playback has run past the final scene without looping. */
  ended: boolean;
}

export const totalTimelineMs = (
  scenes: MiniDemoScene[],
  crossfadeMs: number
): number => {
  if (scenes.length === 0) return 0;
  const dwell = scenes.reduce((sum, s) => sum + s.durationMs, 0);
  return dwell + Math.max(0, scenes.length - 1) * crossfadeMs;
};

export const pickSceneAt = (
  scenes: MiniDemoScene[],
  rawMs: number,
  crossfadeMs: number,
  loop: boolean
): ScenePosition => {
  if (scenes.length === 0) {
    return {
      index: 0,
      sceneMs: 0,
      nextIndex: null,
      crossfadeT: 0,
      ended: true,
    };
  }

  const total = totalTimelineMs(scenes, crossfadeMs);
  let t = rawMs;
  let ended = false;
  if (t < 0) t = 0;
  if (t > total) {
    if (loop && total > 0) {
      t = t % total;
    } else {
      t = total;
      ended = true;
    }
  }

  let acc = 0;
  for (let i = 0; i < scenes.length; i++) {
    const dwellEnd = acc + scenes[i].durationMs;
    if (t <= dwellEnd) {
      return {
        index: i,
        sceneMs: t - acc,
        nextIndex: null,
        crossfadeT: 0,
        ended: ended && i === scenes.length - 1,
      };
    }
    const isLast = i === scenes.length - 1;
    if (isLast) {
      return {
        index: i,
        sceneMs: scenes[i].durationMs,
        nextIndex: null,
        crossfadeT: 0,
        ended: true,
      };
    }
    const fadeEnd = dwellEnd + crossfadeMs;
    if (t <= fadeEnd) {
      return {
        index: i,
        sceneMs: scenes[i].durationMs,
        nextIndex: i + 1,
        crossfadeT: crossfadeMs > 0 ? (t - dwellEnd) / crossfadeMs : 1,
        ended: false,
      };
    }
    acc = fadeEnd;
  }

  const lastIdx = scenes.length - 1;
  return {
    index: lastIdx,
    sceneMs: scenes[lastIdx].durationMs,
    nextIndex: null,
    crossfadeT: 0,
    ended: true,
  };
};

const smoothstep = (r: number): number => r * r * (3 - 2 * r);

export interface CursorPosition {
  x: number;
  y: number;
}

export type CursorTargetResolver = (
  targetId: MiniDemoTargetId
) => CursorPosition | null;

const isCoordinateKeyframe = (
  keyframe: CursorKeyframe
): keyframe is CoordinateCursorKeyframe => "x" in keyframe;

const resolveKeyframe = (
  keyframe: CursorKeyframe,
  resolveTarget?: CursorTargetResolver
): CursorPosition | null => {
  if (isCoordinateKeyframe(keyframe)) {
    return { x: keyframe.x, y: keyframe.y };
  }
  return resolveTarget?.(keyframe.target) ?? null;
};

export const cursorAt = (
  keyframes: CursorKeyframe[],
  sceneMs: number,
  resolveTarget?: CursorTargetResolver
): CursorPosition | null => {
  if (keyframes.length === 0) return null;
  const first = keyframes[0];
  if (sceneMs <= first.t) return resolveKeyframe(first, resolveTarget);
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (sceneMs >= a.t && sceneMs <= b.t) {
      const aPosition = resolveKeyframe(a, resolveTarget);
      const bPosition = resolveKeyframe(b, resolveTarget);
      if (!aPosition || !bPosition) return null;
      if (b.t === a.t) return bPosition;
      const eased = smoothstep((sceneMs - a.t) / (b.t - a.t));
      return {
        x: aPosition.x + (bPosition.x - aPosition.x) * eased,
        y: aPosition.y + (bPosition.y - aPosition.y) * eased,
      };
    }
  }
  const last = keyframes[keyframes.length - 1];
  return resolveKeyframe(last, resolveTarget);
};

export interface ActiveClick {
  x: number;
  y: number;
  /** Progress through the click effect [0,1]. */
  progress: number;
}

export const activeClick = (
  keyframes: CursorKeyframe[] | undefined,
  sceneMs: number,
  effectDurMs: number,
  resolveTarget?: CursorTargetResolver
): ActiveClick | null => {
  if (!keyframes || keyframes.length === 0 || effectDurMs <= 0) return null;
  for (const k of keyframes) {
    if (!k.click) continue;
    if (sceneMs >= k.t && sceneMs <= k.t + effectDurMs) {
      const position = resolveKeyframe(k, resolveTarget);
      if (!position) return null;
      return {
        x: position.x,
        y: position.y,
        progress: (sceneMs - k.t) / effectDurMs,
      };
    }
  }
  return null;
};

export const sceneRequiresTarget = (scene: MiniDemoScene): boolean =>
  scene.targetId !== undefined;
