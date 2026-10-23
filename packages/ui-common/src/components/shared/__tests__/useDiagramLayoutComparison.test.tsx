import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  computeDiagramLayoutCandidate,
  type DiagramLayoutCandidate,
} from "../diagramLayoutCandidates";
import { useDiagramLayoutComparison } from "../useDiagramLayoutComparison";

vi.mock("../diagramLayoutCandidates", () => ({
  computeDiagramLayoutCandidate: vi.fn(),
}));
const compute = vi.mocked(computeDiagramLayoutCandidate);
const input = {
  nodes: [{ id: "start", title: "Start", width: 140, height: 140 }],
  edges: [],
};

describe("diagram comparison lifecycle", () => {
  it("does not run automatic layout for an empty diagram", () => {
    compute.mockReset();
    const { result } = renderHook(() => useDiagramLayoutComparison({ nodes: [], edges: [] }, "elk-layered", "RIGHT"));
    expect(result.current.pending).toBe(false);
    expect(compute).not.toHaveBeenCalled();
  });
  it("skips saved layouts and discards a late result after canceling a preview", async () => {
    let finish: (
      positions: ReadonlyMap<string, { x: number; y: number }>,
    ) => void = () => {};
    compute.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result, rerender } = renderHook(
      ({ candidate }: { candidate: DiagramLayoutCandidate | undefined }) =>
        useDiagramLayoutComparison(input, candidate, "RIGHT"),
      { initialProps: { candidate: undefined as DiagramLayoutCandidate | undefined } },
    );
    expect(compute).not.toHaveBeenCalled();
    rerender({ candidate: "elk-layered" });
    expect(result.current.pending).toBe(true);
    expect(compute).toHaveBeenCalledWith(input, "elk-layered", "RIGHT");
    rerender({ candidate: undefined });
    await act(async () => {
      finish(new Map([["start", { x: 900, y: 800 }]]));
    });
    expect(result.current.active).toBe(false);
    expect(result.current.positions).toBeUndefined();
  });

  it("exposes successful positions, skips presentation-only reruns, and reports failure", async () => {
    compute.mockReset();
    const positions = new Map([["start", { x: 32, y: 32 }]]);
    compute.mockResolvedValueOnce(positions);
    const { result, rerender } = renderHook(
      ({ candidate }: { candidate: DiagramLayoutCandidate }) =>
        useDiagramLayoutComparison({ ...input }, candidate, "DOWN"),
      { initialProps: { candidate: "dagre" as DiagramLayoutCandidate } },
    );
    await waitFor(() => expect(result.current.positions).toEqual(positions));
    expect(result.current.pending).toBe(false);
    rerender({ candidate: "dagre" });
    expect(compute).toHaveBeenCalledTimes(1);
    compute.mockRejectedValueOnce(new Error("Could not arrange"));
    rerender({ candidate: "elk-stress" });
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.error).toBe("Could not arrange"));
    expect(result.current.pending).toBe(false);
    expect(result.current.positions).toBeUndefined();
  });
});
