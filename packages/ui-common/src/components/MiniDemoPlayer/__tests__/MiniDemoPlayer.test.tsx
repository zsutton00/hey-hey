import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MiniDemoPlayer } from "../MiniDemoPlayer";
import { MINI_DEMO_TARGETS } from "../types";
import type { MiniDemoScene } from "../types";

const scenes: MiniDemoScene[] = [
  {
    id: "first",
    content: <div data-testid="scene-first">First</div>,
    durationMs: 1000,
    cursor: [
      { t: 0, x: 50, y: 50 },
      { t: 500, x: 200, y: 50 },
    ],
  },
  {
    id: "second",
    content: <div data-testid="scene-second">Second</div>,
    durationMs: 1000,
  },
];

describe("MiniDemoPlayer", () => {
  it("renders the static first scene and caption before playback advances", () => {
    render(<MiniDemoPlayer scenes={scenes} caption="Walk through Hey Hey" />);
    expect(screen.getByTestId("mini-demo-caption")).toHaveTextContent(
      "Walk through Hey Hey"
    );
    expect(screen.getByTestId("scene-first")).toBeInTheDocument();
    expect(screen.queryByTestId("scene-second")).not.toBeInTheDocument();
    expect(screen.getByTestId("mini-demo-cursor")).toBeInTheDocument();
    expect(screen.getByTestId("mini-demo-player")).toHaveAttribute(
      "data-demo-ready",
      "true"
    );
    expect(screen.getByTestId("mini-demo-player")).toHaveAttribute(
      "data-demo-using-fallback",
      "false"
    );
  });

  it("keeps the static scene visible and waits without an approximate cursor", () => {
    const targetScenes: MiniDemoScene[] = [
      {
        id: "targeted",
        targetId: MINI_DEMO_TARGETS.featuresNavLink,
        content: (
          <div data-demo-scene="targeted">
            <a
              data-demo-target={MINI_DEMO_TARGETS.featuresNavLink}
              href="/features"
            >
              Features
            </a>
          </div>
        ),
        durationMs: 1000,
        cursor: [
          { t: 0, x: 10, y: 10 },
          { t: 500, target: MINI_DEMO_TARGETS.featuresNavLink, click: true },
        ],
      },
    ];

    render(<MiniDemoPlayer scenes={targetScenes} />);

    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.queryByTestId("mini-demo-cursor")).not.toBeInTheDocument();
    expect(screen.getByTestId("mini-demo-player")).toHaveAttribute(
      "data-demo-ready",
      "false"
    );
    expect(screen.getByTestId("mini-demo-player")).toHaveAttribute(
      "data-demo-using-fallback",
      "false"
    );
  });

  it("renders nothing when no scenes are provided", () => {
    const { container } = render(<MiniDemoPlayer scenes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
