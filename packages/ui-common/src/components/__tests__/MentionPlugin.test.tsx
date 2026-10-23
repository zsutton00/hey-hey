import React from "react";
import { render } from "@testing-library/react";
import { MentionPlugin } from "../SmarterTextAreaCard/MentionPlugin";
import { describe, it, expect } from "vitest";

describe("MentionPlugin", () => {
  it("does not render entity search UI for bare @ lookup", () => {
    const { container } = render(<MentionPlugin />);

    expect(
      container.querySelector('[data-testid="mention-popup"]')
    ).not.toBeInTheDocument();
  });
});
