import { describe, expect, it } from "vitest";
import { findUxFlowStartScreenId } from "../diagramElementMetadata";

const screen = (id: string, name: string, role?: string) => ({
  id,
  name,
  sections: [
    {
      id: `${id}-metadata`,
      key: "diagramElementMetadata",
      order: 0,
      content: JSON.stringify({
        role: role ?? "UI",
        canonicalReference: { entityType: "TASK", entityId: `mockup-${id}` },
      }),
    },
    { id: `${id}-body`, key: "description", order: 1, content: `${name} body` },
  ],
});

type Steps = Parameters<typeof findUxFlowStartScreenId>[0];

describe("findUxFlowStartScreenId", () => {
  it("finds the UI_START screen among populated stored screens", () => {
    const steps = [
      screen("a", "Cart"),
      screen("b", "Landing", "UI_START"),
      screen("c", "Checkout"),
    ] as unknown as Steps;

    expect(findUxFlowStartScreenId(steps)).toBe("b");
  });

  it("returns null for a flow with no marked start or no metadata", () => {
    const steps = [
      screen("a", "Cart"),
      { id: "x", name: "Legacy", sections: [] },
    ] as unknown as Steps;

    expect(findUxFlowStartScreenId(steps)).toBeNull();
  });

  it("picks deterministically by name then id when several are marked", () => {
    const steps = [
      screen("z", "Welcome", "UI_START"),
      screen("m", "Landing", "UI_START"),
      screen("a", "Landing", "UI_START"),
    ] as unknown as Steps;

    expect(findUxFlowStartScreenId(steps)).toBe("a");
    expect(findUxFlowStartScreenId([...steps].reverse())).toBe("a");
  });
});
