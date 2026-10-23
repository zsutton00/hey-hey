import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  MINI_DEMO_PRESET_KEYS,
  miniDemoPresetRegistry,
  resolvePreset,
} from "../presetRegistry";
import { MINI_DEMO_TARGETS } from "../types";

describe("resolvePreset", () => {
  it("returns the registered scene set for a known preset key", () => {
    const scenes = resolvePreset(MINI_DEMO_PRESET_KEYS.featuresNav);

    expect(scenes).toHaveLength(2);
    expect(scenes.map((scene) => scene.id)).toEqual([
      "briefing",
      "features-page",
    ]);
    expect(scenes[0].durationMs).toBe(2800);
    expect(scenes[0].targetId).toBe(MINI_DEMO_TARGETS.featuresNavLink);
    render(scenes[0].content);
    expect(
      document.querySelector('[data-demo-scene="briefing"]'),
    ).toBeInTheDocument();
    expect(scenes[0].cursor).toEqual([
      { t: 0, x: 920, y: 540 },
      { t: 1800, target: MINI_DEMO_TARGETS.featuresNavLink },
      { t: 2200, target: MINI_DEMO_TARGETS.featuresNavLink, click: true },
      { t: 2800, target: MINI_DEMO_TARGETS.featuresNavLink },
    ]);
    expect(scenes[1].durationMs).toBe(2400);
  });

  it("creates a fresh scene array on each resolution", () => {
    const firstScenes = resolvePreset(MINI_DEMO_PRESET_KEYS.featuresNav);
    const secondScenes = resolvePreset(MINI_DEMO_PRESET_KEYS.featuresNav);

    expect(firstScenes).not.toBe(secondScenes);
    expect(firstScenes[0]).not.toBe(secondScenes[0]);
    expect(firstScenes[0].content).not.toBe(secondScenes[0].content);
  });

  it("surfaces a clear error for an unknown preset key", () => {
    expect(() => resolvePreset("missing-preset")).toThrow(
      'Unknown mini-demo preset key "missing-preset". Known keys: features-nav.'
    );
  });
});

describe("miniDemoPresetRegistry", () => {
  it("registers the features navigation preset key", () => {
    expect(
      miniDemoPresetRegistry[MINI_DEMO_PRESET_KEYS.featuresNav]
    ).toBeTypeOf("function");
  });
});
