import { describe, expect, it } from "vitest";

import { measureSceneTarget } from "../sceneTargetMeasurement";
import { MINI_DEMO_TARGETS } from "../types";

const rect = (
  left: number,
  top: number,
  width: number,
  height: number
): DOMRect =>
  ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);

describe("measureSceneTarget", () => {
  it("waits when the scene or target identity is missing or duplicated", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-demo-scene="features">
        <a data-demo-target="${MINI_DEMO_TARGETS.featuresNavLink}">Features</a>
        <a data-demo-target="${MINI_DEMO_TARGETS.featuresNavLink}">Duplicate</a>
      </div>
    `;

    const measurement = measureSceneTarget(
      root,
      "features",
      MINI_DEMO_TARGETS.featuresNavLink,
      1280,
      720
    );

    expect(measurement.status).toBe("waiting");
    expect(measurement.targetCount).toBe(2);
    expect(measurement.position).toBeNull();
  });

  it("maps the marked target center into the scene's natural coordinates", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-demo-scene="features">
        <a data-demo-target="${MINI_DEMO_TARGETS.featuresNavLink}">Features</a>
      </div>
    `;
    const scene = root.querySelector<HTMLElement>("[data-demo-scene]")!;
    const target = root.querySelector<HTMLElement>("[data-demo-target]")!;
    scene.getBoundingClientRect = () => rect(100, 50, 640, 360);
    target.getBoundingClientRect = () => rect(420, 170, 80, 40);

    const measurement = measureSceneTarget(
      root,
      "features",
      MINI_DEMO_TARGETS.featuresNavLink,
      1280,
      720
    );

    expect(measurement).toMatchObject({
      status: "ready",
      targetCount: 1,
      position: { x: 720, y: 280 },
    });
  });
});
