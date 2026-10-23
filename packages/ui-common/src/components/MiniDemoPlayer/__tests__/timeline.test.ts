import { describe, expect, it } from "vitest";

import {
  activeClick,
  cursorAt,
  pickSceneAt,
  sceneRequiresTarget,
  totalTimelineMs,
} from "../timeline";
import { MINI_DEMO_TARGETS } from "../types";
import type { MiniDemoScene } from "../types";

const scenes: MiniDemoScene[] = [
  {
    id: "a",
    content: null,
    durationMs: 1000,
    cursor: [
      { t: 0, x: 0, y: 0 },
      { t: 500, x: 100, y: 0 },
      { t: 800, x: 100, y: 0, click: true },
    ],
  },
  {
    id: "b",
    content: null,
    durationMs: 800,
    cursor: [{ t: 0, x: 200, y: 200 }],
  },
];

const CROSSFADE = 200;

describe("totalTimelineMs", () => {
  it("sums dwell times plus crossfade gaps", () => {
    expect(totalTimelineMs(scenes, CROSSFADE)).toBe(1000 + 200 + 800);
  });

  it("returns 0 for an empty timeline", () => {
    expect(totalTimelineMs([], CROSSFADE)).toBe(0);
  });
});

describe("pickSceneAt", () => {
  it("returns the first scene at t=0 with sceneMs=0 (static first frame)", () => {
    const pos = pickSceneAt(scenes, 0, CROSSFADE, false);
    expect(pos.index).toBe(0);
    expect(pos.sceneMs).toBe(0);
    expect(pos.nextIndex).toBeNull();
    expect(pos.crossfadeT).toBe(0);
  });

  it("advances within the active scene during dwell", () => {
    const pos = pickSceneAt(scenes, 600, CROSSFADE, false);
    expect(pos.index).toBe(0);
    expect(pos.sceneMs).toBe(600);
    expect(pos.nextIndex).toBeNull();
  });

  it("enters crossfade after the dwell boundary", () => {
    const pos = pickSceneAt(scenes, 1100, CROSSFADE, false);
    expect(pos.index).toBe(0);
    expect(pos.nextIndex).toBe(1);
    expect(pos.crossfadeT).toBeCloseTo(0.5, 5);
  });

  it("lands on the next scene after the crossfade ends", () => {
    const pos = pickSceneAt(scenes, 1300, CROSSFADE, false);
    expect(pos.index).toBe(1);
    expect(pos.sceneMs).toBe(100);
  });

  it("clamps and marks ended past the timeline when not looping", () => {
    const pos = pickSceneAt(scenes, 9999, CROSSFADE, false);
    expect(pos.index).toBe(1);
    expect(pos.sceneMs).toBe(800);
    expect(pos.ended).toBe(true);
  });

  it("wraps when loop is enabled", () => {
    const total = totalTimelineMs(scenes, CROSSFADE);
    const pos = pickSceneAt(scenes, total + 250, CROSSFADE, true);
    expect(pos.index).toBe(0);
    expect(pos.sceneMs).toBe(250);
    expect(pos.ended).toBe(false);
  });
});

describe("cursorAt", () => {
  it("returns the first keyframe before any time has passed", () => {
    expect(cursorAt(scenes[0].cursor!, 0)).toEqual({ x: 0, y: 0 });
  });

  it("interpolates between adjacent keyframes with smoothstep easing", () => {
    const mid = cursorAt(scenes[0].cursor!, 250);
    expect(mid).not.toBeNull();
    expect(mid!.x).toBeGreaterThan(0);
    expect(mid!.x).toBeLessThan(100);
    expect(mid!.x).toBeCloseTo(50, 0);
  });

  it("clamps to the last keyframe past the end", () => {
    expect(cursorAt(scenes[0].cursor!, 99999)).toEqual({ x: 100, y: 0 });
  });

  it("returns null for an empty keyframe list", () => {
    expect(cursorAt([], 100)).toBeNull();
  });
});

describe("activeClick", () => {
  it("fires within the click window", () => {
    const click = activeClick(scenes[0].cursor, 850, 200);
    expect(click).not.toBeNull();
    expect(click!.x).toBe(100);
    expect(click!.progress).toBeCloseTo(0.25, 5);
  });

  it("returns null outside the click window", () => {
    expect(activeClick(scenes[0].cursor, 700, 200)).toBeNull();
    expect(activeClick(scenes[0].cursor, 1100, 200)).toBeNull();
  });

  it("returns null when no keyframes are marked click", () => {
    expect(activeClick(scenes[1].cursor, 0, 200)).toBeNull();
  });
});

describe("target keyframes", () => {
  const targetScenes: MiniDemoScene[] = [
    {
      id: "targeted",
      targetId: MINI_DEMO_TARGETS.featuresNavLink,
      content: null,
      durationMs: 1000,
      cursor: [
        { t: 0, x: 10, y: 20 },
        { t: 500, target: MINI_DEMO_TARGETS.featuresNavLink },
        { t: 700, target: MINI_DEMO_TARGETS.featuresNavLink, click: true },
      ],
    },
  ];

  it("resolves target keyframes from the measured position", () => {
    const resolveTarget = () => ({ x: 300, y: 400 });

    expect(cursorAt(targetScenes[0].cursor!, 500, resolveTarget)).toEqual({
      x: 300,
      y: 400,
    });
    expect(
      activeClick(targetScenes[0].cursor, 750, 200, resolveTarget)
    ).toEqual({ x: 300, y: 400, progress: 0.25 });
  });

  it("returns no cursor or click when a target has not been measured", () => {
    expect(cursorAt(targetScenes[0].cursor!, 600)).toBeNull();
    expect(activeClick(targetScenes[0].cursor, 750, 200)).toBeNull();
  });

  it("marks target scenes as requiring measurement", () => {
    expect(sceneRequiresTarget(targetScenes[0])).toBe(true);
    expect(sceneRequiresTarget(scenes[1])).toBe(false);
  });
});
