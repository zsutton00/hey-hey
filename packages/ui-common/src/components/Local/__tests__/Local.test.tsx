import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Local } from "../Local";

afterEach(() => {
  delete window.__HEY_HEY_RUNTIME_CONFIG__;
  cleanup();
});

describe("Local", () => {
  it("shows its content in a local deployment", () => {
    window.__HEY_HEY_RUNTIME_CONFIG__ = { deployment: "local" };
    render(<Local>local only</Local>);
    expect(screen.getByText("local only")).toBeInTheDocument();
  });

  it.each([{ deployment: "hosted" }, undefined])(
    "renders nothing outside a local deployment (%o)",
    (config) => {
      if (config) {
        window.__HEY_HEY_RUNTIME_CONFIG__ = config;
      }
      const { container } = render(<Local>local only</Local>);
      expect(container).toBeEmptyDOMElement();
    },
  );
});
