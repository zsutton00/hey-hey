import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenItemsSyncStatus } from "./OpenItemsSyncStatus";

const { state } = vi.hoisted(() => ({
  state: {
    pending: 0,
    queued: 0,
    isLoading: false,
    isFetching: false,
    offline: false,
    stale: false,
    error: null as Error | null,
  },
}));
vi.mock("../../contexts/OpenItemsContext", () => ({
  useOpenItems: () => state,
}));

describe("Open Items saving presentation", () => {
  beforeEach(() => {
    Object.assign(state, {
      pending: 0,
      queued: 0,
      isLoading: false,
      isFetching: false,
      offline: false,
      stale: false,
      error: null,
    });
  });

  it.each([
    {},
    { isLoading: true },
    { isFetching: true },
    { stale: true },
    { error: new Error("Unavailable") },
    { offline: true, pending: 2, queued: 2 },
  ])("stays quiet without an active save: %o", (status) => {
    Object.assign(state, status);
    const { container } = render(<OpenItemsSyncStatus />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one unobtrusive indicator across overlapping saves and removes it on completion", () => {
    state.pending = 2;
    const { rerender, container } = render(<OpenItemsSyncStatus />);
    const indicator = screen.getByRole("progressbar", {
      name: "Saving Open Items",
    });
    expect(indicator).toHaveStyle({
      position: "absolute",
      opacity: "0.25",
      pointerEvents: "none",
    });
    expect(screen.getAllByTestId("open-items-saving")).toHaveLength(1);
    expect(container).toHaveTextContent("");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    state.pending = 1;
    rerender(<OpenItemsSyncStatus />);
    expect(screen.getAllByTestId("open-items-saving")).toHaveLength(1);
    state.pending = 0;
    rerender(<OpenItemsSyncStatus />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts queued intent separately from a save and clears after failure", () => {
    Object.assign(state, { pending: 3, queued: 2 });
    const { rerender, container } = render(<OpenItemsSyncStatus />);
    expect(screen.getByTestId("open-items-saving")).toBeInTheDocument();
    Object.assign(state, { pending: 2, error: new Error("Save failed") });
    rerender(<OpenItemsSyncStatus />);
    expect(container).toBeEmptyDOMElement();
  });
});
