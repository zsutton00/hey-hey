import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { computeAutomaticDiagramLayout } from "../automaticDiagramLayout";
import { useAutomaticDiagramLayout } from "../useAutomaticDiagramLayout";

vi.mock("../automaticDiagramLayout", () => ({
  computeAutomaticDiagramLayout: vi.fn(),
}));
const compute = vi.mocked(computeAutomaticDiagramLayout);
const input = {
  nodes: [{ id: "start", title: "Start", width: 140, height: 140 }],
  edges: [],
};

describe("automatic diagram layout lifecycle", () => {
  it("does not run for an empty diagram", () => {
    compute.mockReset();
    const { result } = renderHook(() =>
      useAutomaticDiagramLayout({ nodes: [], edges: [] }, true),
    );
    expect(result.current.pending).toBe(false);
    expect(compute).not.toHaveBeenCalled();
  });

  it("skips saved layouts and discards a late result once positions are saved", async () => {
    compute.mockReset();
    let finish: (
      positions: ReadonlyMap<string, { x: number; y: number }>,
    ) => void = () => {};
    compute.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useAutomaticDiagramLayout(input, enabled),
      { initialProps: { enabled: false } },
    );
    expect(compute).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(result.current.pending).toBe(true);
    expect(compute).toHaveBeenCalledWith(input);

    rerender({ enabled: false });
    await act(async () => {
      finish(new Map([["start", { x: 900, y: 800 }]]));
    });
    expect(result.current.active).toBe(false);
    expect(result.current.positions).toBeUndefined();
  });

  it("exposes positions, skips presentation-only reruns, and reports failure", async () => {
    compute.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const positions = new Map([["start", { x: 32, y: 32 }]]);
    compute.mockResolvedValueOnce(positions);
    const { result, rerender } = renderHook(
      ({ title }: { title: string }) =>
        useAutomaticDiagramLayout(
          { ...input, nodes: [{ ...input.nodes[0]!, title }] },
          true,
        ),
      { initialProps: { title: "Start" } },
    );
    await waitFor(() => expect(result.current.positions).toEqual(positions));
    expect(result.current.pending).toBe(false);
    rerender({ title: "Start" });
    expect(compute).toHaveBeenCalledTimes(1);

    compute.mockRejectedValueOnce(new Error("Could not arrange"));
    rerender({ title: "Renamed" });
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.error).toBe("Could not arrange"));
    expect(result.current.positions).toBeUndefined();
  });
});
