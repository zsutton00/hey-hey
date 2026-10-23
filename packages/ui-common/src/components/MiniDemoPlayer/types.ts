import type { ReactNode } from "react";

export type MiniDemoTargetId = string & {
  readonly __miniDemoTargetId: unique symbol;
};

const targetId = <T extends string>(value: T): T & MiniDemoTargetId =>
  value as T & MiniDemoTargetId;

/** Shared semantic identities used by live Help and preset-backed scenes. */
export const MINI_DEMO_TARGETS = {
  featuresNavLink: targetId("features-nav-link"),
  servicesNavLink: targetId("services-nav-link"),
  featureChildrenDiscussButton: targetId("feature-children-discuss-button"),
  createServiceButton: targetId("create-service-button"),
  codingSessionsTab: targetId("coding-sessions-tab"),
  startNewSessionButton: targetId("start-new-session-button"),
  createServiceSubmitButton: targetId("create-service-submit-button"),
} as const;

export const DEMO_SCENE_ATTRIBUTE = "data-demo-scene" as const;
export const DEMO_TARGET_ATTRIBUTE = "data-demo-target" as const;

export interface CoordinateCursorKeyframe {
  /** Time in ms within the scene (0 = scene start). */
  t: number;
  /** X position in the scene's natural coordinate space (e.g. 0..sceneWidth). */
  x: number;
  /** Y position in the scene's natural coordinate space (e.g. 0..sceneHeight). */
  y: number;
  /** When true, fire a click effect at this moment. */
  click?: boolean;
}

export interface TargetCursorKeyframe {
  /** Time in ms within the scene (0 = scene start). */
  t: number;
  /** Resolve this keyframe against the marked target in the rendered scene. */
  target: MiniDemoTargetId;
  /** When true, fire a click effect at this moment. */
  click?: boolean;
}

export type CursorKeyframe = CoordinateCursorKeyframe | TargetCursorKeyframe;

export interface MiniDemoScene {
  id: string;
  /** React composition for this scene, rendered at natural (sceneWidth × sceneHeight) size. */
  content: ReactNode;
  /** Time the scene is on screen at full opacity, excluding the crossfade tail. */
  durationMs: number;
  /** Semantic identity of the one demonstrated control in this scene, when applicable. */
  targetId?: MiniDemoTargetId;
  /** Cursor keyframe path within this scene. Omit to hide the cursor. */
  cursor?: CursorKeyframe[];
}

export interface MiniDemoPlayerProps {
  scenes: MiniDemoScene[];
  /** Caption rendered above the clip. */
  caption?: string;
  /** Natural width of each scene in px. Default 1280. */
  sceneWidth?: number;
  /** Natural height of each scene in px. Default 720. */
  sceneHeight?: number;
  /** Rendered (scaled) container width in px. Default 600. */
  containerWidth?: number;
  /** Loop after the last scene. Default false. */
  loop?: boolean;
  /** Crossfade duration between scenes in ms. Default 300. */
  crossfadeMs?: number;
  /** Delay before playback begins; the first-scene static frame is visible during it. Default 500. */
  startDelayMs?: number;
}
