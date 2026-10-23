import { describe, expect, it } from "vitest";
import { buildFeatureDiffMessage } from "../featureDiffMessage";

describe("buildFeatureDiffMessage", () => {
  it("wraps the diff in the I-just-updated and please-draft-a-task prompt", () => {
    const message = buildFeatureDiffMessage(
      { description: "first line\nsecond line", requirements: "" },
      { description: "first line\nsecond line edited", requirements: "" }
    );

    expect(message.startsWith("I just updated this feature.")).toBe(true);
    expect(
      message
        .trimEnd()
        .endsWith("Please draft a task to implement these changes.")
    ).toBe(true);
  });

  it("emits a unified diff with +/- and context for a sparse single-line edit", () => {
    const before = [
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
    ].join("\n");
    const after = [
      "alpha",
      "beta",
      "gamma",
      "delta-updated",
      "epsilon",
      "zeta",
      "eta",
    ].join("\n");

    const message = buildFeatureDiffMessage(
      { description: before, requirements: "" },
      { description: after, requirements: "" }
    );

    expect(message).toContain("### Description");
    expect(message).toContain("-delta");
    expect(message).toContain("+delta-updated");
    // Surrounding context preserved.
    expect(message).toContain(" gamma");
    expect(message).toContain(" epsilon");
  });

  it("omits sections that did not change", () => {
    const message = buildFeatureDiffMessage(
      { description: "unchanged", requirements: "original requirements" },
      { description: "unchanged", requirements: "new requirements" }
    );

    expect(message).not.toContain("### Description");
    expect(message).toContain("### Requirements");
  });

  it("falls back to full updated content when change density exceeds the threshold", () => {
    const before = "old line one\nold line two\nold line three";
    const after =
      "completely different one\ncompletely different two\ncompletely different three";

    const message = buildFeatureDiffMessage(
      { description: before, requirements: "" },
      { description: after, requirements: "" }
    );

    expect(message).toContain("### Description (updated content)");
    expect(message).toContain("completely different one");
    expect(message).toContain("completely different three");
    // Fallback path should not duplicate the prior content.
    expect(message).not.toContain("old line one");
    // And should not include unified-diff +/- markers for this section.
    expect(message).not.toMatch(/^-old line/m);
    expect(message).not.toMatch(/^\+completely different/m);
  });

  it("mixes diff and full-content fallback across sections in one message", () => {
    const sparseBefore = [
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
    ].join("\n");
    const sparseAfter = [
      "alpha",
      "beta",
      "gamma",
      "delta-updated",
      "epsilon",
      "zeta",
      "eta",
    ].join("\n");
    const denseBefore = "old line one\nold line two\nold line three";
    const denseAfter =
      "completely different one\ncompletely different two\ncompletely different three";

    const message = buildFeatureDiffMessage(
      { description: sparseBefore, requirements: denseBefore },
      { description: sparseAfter, requirements: denseAfter }
    );

    expect(message).toContain("### Description");
    expect(message).toContain("-delta");
    expect(message).toContain("+delta-updated");
    expect(message).toContain("### Requirements (updated content)");
    expect(message).toContain("completely different one");
  });
});
