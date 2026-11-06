import { describe, expect, it } from "vitest";
import { buildUnifiedPatchSplit } from "../buildUnifiedPatchSplit";

describe("buildUnifiedPatchSplit", () => {
  it("marks unchanged lines omitted before the first saved hunk", () => {
    const rows = buildUnifiedPatchSplit(
      "@@ -40,2 +40,2 @@\n context\n-oldValue\n+newValue\n",
    );

    expect(rows[0]).toEqual({
      type: "gap",
      oldLine: null,
      newLine: null,
      oldLineNumber: null,
      newLineNumber: null,
      gapLabel: "… 39 unchanged lines omitted …",
    });
    expect(rows[1]).toMatchObject({
      type: "equal",
      oldLineNumber: 40,
      newLineNumber: 40,
    });
  });

  it("does not add a leading marker for a patch starting at the beginning", () => {
    const rows = buildUnifiedPatchSplit(
      "@@ -0,0 +1,2 @@\n+const value = 1;\n+export { value };\n",
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: "insert", newLineNumber: 1 });
  });
});
