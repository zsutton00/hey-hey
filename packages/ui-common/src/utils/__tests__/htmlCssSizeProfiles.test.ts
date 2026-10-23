import { describe, expect, it } from "vitest";
import { resolveHtmlCssSize } from "../htmlCssSizeProfiles";

const definition = {
  key: "preview",
  label: "Preview",
  kind: "html/css" as const,
  defaultSizeKey: "panel",
  sizeProfiles: [
    {
      key: "panel",
      label: "Panel",
      breakpoints: [
        {
          minContainerWidth: 0,
          inline: { width: 280, height: 180 },
          page: { width: 480, height: 320 },
        },
        {
          minContainerWidth: 600,
          inline: { width: 520, height: 300 },
          page: { width: 900, height: 600 },
        },
      ],
    },
  ],
};

describe("resolveHtmlCssSize", () => {
  it("uses the default and greatest breakpoint for each context", () => {
    expect(
      resolveHtmlCssSize({
        definition,
        content: { html: "", css: "" },
        context: "inline",
        containerWidth: 599,
      })
    ).toEqual({ profileKey: "panel", width: 280, height: 180 });
    expect(
      resolveHtmlCssSize({
        definition,
        content: { html: "", css: "" },
        context: "page",
        containerWidth: 600,
      })
    ).toEqual({ profileKey: "panel", width: 900, height: 600 });
  });
  it("fails closed for an unknown selection", () => {
    expect(
      resolveHtmlCssSize({
        definition,
        content: { html: "", css: "", sizeKey: "missing" },
        context: "inline",
        containerWidth: 800,
      })
    ).toBeNull();
  });

  it("selects the greatest matching breakpoint without relying on array order", () => {
    const unorderedDefinition = {
      ...definition,
      sizeProfiles: [
        {
          ...definition.sizeProfiles[0],
          breakpoints: [
            definition.sizeProfiles[0].breakpoints[1],
            definition.sizeProfiles[0].breakpoints[0],
          ],
        },
      ],
    };

    expect(
      resolveHtmlCssSize({
        definition: unorderedDefinition,
        content: {},
        context: "inline",
        containerWidth: 800,
      })
    ).toEqual({ profileKey: "panel", width: 520, height: 300 });
  });
});
