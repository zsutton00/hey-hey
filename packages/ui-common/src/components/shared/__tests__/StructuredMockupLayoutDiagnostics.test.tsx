import { describe, expect, it } from "vitest";
import {
  formatStructuredMockupSizingTuple,
  getAlignmentGuideAxis,
  getParentLayoutMetadata,
  placeDiagnosticBadge,
} from "../StructuredMockupLayoutDiagnostics";

const layout = {
  widthMode: "fixed" as const,
  widthValue: 239.6,
  heightMode: "content" as const,
  heightValue: 80,
};

describe("StructuredMockupLayoutDiagnostics helpers", () => {
  it("formats renderer-normalized sizing modes", () => {
    expect(formatStructuredMockupSizingTuple(layout)).toBe(
      "(fixed 240px, content)"
    );
    expect(
      formatStructuredMockupSizingTuple({
        ...layout,
        widthMode: "fill",
      })
    ).toBe("(fill, content)");
    expect(
      formatStructuredMockupSizingTuple({
        ...layout,
        widthMode: "fit",
      })
    ).toBe("(fit, content)");
  });

  it("describes parent layout and its applicable guide axis", () => {
    const metadata = getParentLayoutMetadata(
      {
        ...layout,
        direction: "row",
        justify: "spread",
        align: "center",
        padding: 15.6,
        gap: 7.7,
      },
      { left: 0, top: 0, width: 601.4, height: 199.6 }
    );
    expect(metadata).toEqual({
      dimensions: "601 × 200",
      direction: "row",
      justification: "spread",
      alignment: "center",
      padding: 16,
      gap: 8,
    });
    expect(getAlignmentGuideAxis("row")).toBe("horizontal");
    expect(getAlignmentGuideAxis("column")).toBe("vertical");
  });

  it.each(["start", "center", "end", "spread"] as const)(
    "reports %s as the effective parent justification",
    (justification) => {
      expect(
        getParentLayoutMetadata(
          {
            ...layout,
            direction: "row",
            justify: justification,
            align: "stretch",
            padding: 8,
            gap: 12,
          },
          { left: 0, top: 0, width: 600, height: 80 }
        ).justification
      ).toBe(justification);
    }
  );

  it("keeps selected information anchored at the element bottom-right", () => {
    expect(
      placeDiagnosticBadge({
        anchor: { left: 400, top: 120, width: 160, height: 80 },
        corner: "bottom-right",
      })
    ).toEqual({ left: 560, top: 200 });
  });

  it("anchors parent information by its bottom-left at the parent top-right", () => {
    expect(
      placeDiagnosticBadge({
        anchor: { left: 20, top: 80, width: 600, height: 240 },
        corner: "top-right",
      })
    ).toEqual({ left: 620, top: 80 });
  });
});
