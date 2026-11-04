import { describe, expect, it } from "vitest";
import {
  deriveIncomingScreen,
  deriveScreenNextOptions,
  goBack,
  goToScreen,
  groupScreenNextOptions,
  orderFlowScreenIds,
  type UxFlowShape,
} from "../deriveScreenNextOptions";

type Edge = UxFlowShape["edges"][number];

const edge = (
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  actionLabel: string,
  transitionRole?: Edge["transitionRole"],
): Edge => ({ id, sourceNodeId, targetNodeId, actionLabel, transitionRole });

const flow: UxFlowShape = {
  steps: [
    { id: "cart", name: "Cart" },
    { id: "pay", name: "Payment" },
    { id: "failed", name: "Payment failed" },
    { id: "done", name: "Receipt" },
  ],
  edges: [
    edge("e1", "cart", "pay", "Check out", "PRIMARY_PROGRESSION"),
    edge("e2", "pay", "failed", "Card declined", "ERROR_PATH"),
    edge("e3", "pay", "done", "Pay", "PRIMARY_PROGRESSION"),
    edge("e4", "failed", "pay", "Try again", "RECOVERY"),
    edge("e5", "pay", "cart", "Edit cart", "RETURN"),
    edge("e6", "pay", "done", "Pay with saved card"),
  ],
};

describe("deriveScreenNextOptions", () => {
  it("lists every outgoing transition, including branches and repeats to one target", () => {
    const options = deriveScreenNextOptions(flow, "pay");

    expect(options.map((option) => option.edgeId)).toEqual([
      "e2",
      "e3",
      "e5",
      "e6",
    ]);
    expect(options.filter((option) => option.targetStepId === "done")).toEqual([
      expect.objectContaining({ actionLabel: "Pay", targetName: "Receipt" }),
      expect.objectContaining({
        actionLabel: "Pay with saved card",
        targetName: "Receipt",
      }),
    ]);
  });

  it("returns nothing for a screen without outgoing transitions", () => {
    expect(deriveScreenNextOptions(flow, "done")).toEqual([]);
  });
});

describe("groupScreenNextOptions", () => {
  it("orders groups main, error, recovery, return, then role-less under Other options", () => {
    const groups = groupScreenNextOptions(deriveScreenNextOptions(flow, "pay"));

    expect(groups.map((group) => group.title)).toEqual([
      "Main path",
      "Error path",
      "Return",
      "Other options",
    ]);
    expect(groups.at(-1)?.options.map((option) => option.actionLabel)).toEqual([
      "Pay with saved card",
    ]);
  });

  it("never infers a role from the label", () => {
    const groups = groupScreenNextOptions(
      deriveScreenNextOptions(
        {
          steps: flow.steps,
          edges: [edge("x", "cart", "pay", "Cancel and go back")],
        },
        "cart",
      ),
    );

    expect(groups).toEqual([
      expect.objectContaining({ role: null, title: "Other options" }),
    ]);
  });
});

describe("orderFlowScreenIds", () => {
  it("orders screens as the grid places them", () => {
    expect(orderFlowScreenIds(flow, new Map())).toEqual([
      "cart",
      "pay",
      "done",
      "failed",
    ]);
  });
});

describe("walkthrough trail", () => {
  it("goes back to the screen the person came from, not an incoming transition", () => {
    const trail = goToScreen(goToScreen(["cart"], "pay"), "failed");

    expect(deriveIncomingScreen(trail)).toBe("pay");
    expect(goBack(trail)).toEqual(["cart", "pay"]);
  });

  it("has no screen to go back to at the start", () => {
    expect(deriveIncomingScreen(["cart"])).toBeNull();
    expect(goBack(["cart"])).toEqual(["cart"]);
  });
});
