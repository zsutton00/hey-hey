import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HelpDemo } from "../../../api";

import { HelpDemoPlayer } from "../HelpDemoPlayer";
import { MINI_DEMO_PRESET_KEYS } from "../presetRegistry";

const presetDemo = {
  id: "demo-1",
  ordering: 1,
  caption: "Open the feature tree.",
  kind: "preset",
  presetKey: MINI_DEMO_PRESET_KEYS.featuresNav,
} satisfies HelpDemo;

const dslDemo = {
  id: "demo-2",
  ordering: 2,
  caption: "Render a scripted walkthrough.",
  kind: "dsl",
  definition: {},
} satisfies HelpDemo;

const missingPresetDemo = {
  id: "demo-3",
  ordering: 3,
  caption: "This preset is missing.",
  kind: "preset",
  presetKey: "missing-preset",
} satisfies HelpDemo;

const silenceReactError = () =>
  vi.spyOn(console, "error").mockImplementation(() => {});

describe("HelpDemoPlayer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders preset scenes with the help demo row caption", () => {
    render(<HelpDemoPlayer demo={presetDemo} />);

    expect(screen.getByTestId("help-demo-player")).toHaveAttribute(
      "data-help-demo-id",
      "demo-1"
    );
    expect(screen.getByTestId("mini-demo-player")).toHaveAttribute(
      "aria-label",
      "Open the feature tree."
    );
    expect(screen.getByTestId("mini-demo-caption")).toHaveTextContent(
      "Open the feature tree."
    );
    expect(screen.getByText("Welcome to Hey Hey")).toBeInTheDocument();
  });

  it("throws a clear not-yet-implemented error for dsl rows", () => {
    silenceReactError();

    expect(() => render(<HelpDemoPlayer demo={dslDemo} />)).toThrow(
      "Help demo DSL rendering is not implemented yet."
    );
  });

  it("surfaces the registry error for an unknown preset key", () => {
    silenceReactError();

    expect(() => render(<HelpDemoPlayer demo={missingPresetDemo} />)).toThrow(
      'Unknown mini-demo preset key "missing-preset". Known keys: features-nav.'
    );
  });
});
