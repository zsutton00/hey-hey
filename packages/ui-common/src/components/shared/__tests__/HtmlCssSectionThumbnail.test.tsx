import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WorkItemTypeSectionDefinition } from "../../../api";
import { HtmlCssSectionThumbnail } from "../HtmlCssSectionThumbnail";

const definition = {
  key: "screen",
  label: "Screen",
  kind: "html/css",
  defaultSizeKey: "desktop",
  sizeProfiles: [
    {
      key: "desktop",
      label: "Desktop",
      breakpoints: [
        {
          minContainerWidth: 0,
          inline: { width: 1440, height: 2400 },
          page: { width: 1440, height: 2400 },
        },
      ],
    },
  ],
} as unknown as WorkItemTypeSectionDefinition;

const content = JSON.stringify({ html: "<main>Tall</main>", css: "" });

describe("HtmlCssSectionThumbnail", () => {
  it("fits the whole mockup inside a fixed height", () => {
    render(
      <HtmlCssSectionThumbnail
        content={content}
        definition={definition}
        width={2000}
        maxHeight={180}
      />,
    );

    const box = screen.getByTestId("html-css-section-thumbnail");
    expect(box).toHaveStyle({ height: "180px", width: "108px" });
  });

  it("scales to the given width when no height is set", () => {
    render(
      <HtmlCssSectionThumbnail
        content={content}
        definition={definition}
        width={360}
      />,
    );

    const box = screen.getByTestId("html-css-section-thumbnail");
    expect(box).toHaveStyle({ height: "600px", width: "360px" });
  });
});
