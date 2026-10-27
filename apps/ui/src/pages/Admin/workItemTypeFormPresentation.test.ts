import { describe, expect, it } from "vitest";
import {
  ALL_EDGE_TARGET_TYPES,
  WORK_ITEM_TYPE_FIELD_PRESENTATION,
  formatCapabilityKey,
  hydrateEdgeTargetSelection,
  reduceEdgeTargetSelection,
  serializeEdgeTargetSelection,
} from "./workItemTypeFormPresentation";

describe("workItemTypeFormPresentation", () => {
  it("distinguishes purpose from writing standards", () => {
    expect(WORK_ITEM_TYPE_FIELD_PRESENTATION.description.label).toBe("Purpose");
    expect(WORK_ITEM_TYPE_FIELD_PRESENTATION.writingStandards.label).toBe(
      "Writing standards",
    );
    expect(
      WORK_ITEM_TYPE_FIELD_PRESENTATION["writingStandards.create"].label,
    ).toBe("Writing standard — Create");
    expect(
      WORK_ITEM_TYPE_FIELD_PRESENTATION["writingStandards.edit"].label,
    ).toBe("Writing standard — Edit");
    expect(
      WORK_ITEM_TYPE_FIELD_PRESENTATION["sections.writingStandard"].label,
    ).toBe("Section writing standard");
  });
  it("hydrates the empty any-type contract as selected All", () => {
    expect(hydrateEdgeTargetSelection([])).toEqual([ALL_EDGE_TARGET_TYPES]);
    expect(hydrateEdgeTargetSelection(["FEATURE", "BUG"])).toEqual([
      "FEATURE",
      "BUG",
    ]);
  });

  it("switches from explicit keys to All deterministically", () => {
    expect(
      reduceEdgeTargetSelection(
        ["FEATURE"],
        ["FEATURE", ALL_EDGE_TARGET_TYPES],
      ),
    ).toEqual([ALL_EDGE_TARGET_TYPES]);
  });

  it("switches from All to explicit keys deterministically", () => {
    expect(
      reduceEdgeTargetSelection(
        [ALL_EDGE_TARGET_TYPES],
        [ALL_EDGE_TARGET_TYPES, "FEATURE"],
      ),
    ).toEqual(["FEATURE"]);
  });

  it("returns to All when the last explicit key is removed", () => {
    expect(reduceEdgeTargetSelection(["FEATURE"], [])).toEqual([
      ALL_EDGE_TARGET_TYPES,
    ]);
  });

  it("serializes selected All to the unchanged empty-array contract", () => {
    expect(serializeEdgeTargetSelection([ALL_EDGE_TARGET_TYPES])).toEqual([]);
    expect(serializeEdgeTargetSelection(["FEATURE", "BUG"])).toEqual([
      "FEATURE",
      "BUG",
    ]);
  });

  it("formats dynamic capability keys for people", () => {
    expect(formatCapabilityKey("showsInExplorerSidebar")).toBe(
      "Shows in explorer sidebar",
    );
    expect(formatCapabilityKey("renders_inline")).toBe("Renders inline");
  });
});
