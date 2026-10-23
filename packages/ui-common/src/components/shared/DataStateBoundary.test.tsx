import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataStateBoundary } from "./DataStateBoundary";
import { dataStateBoundaryFixtures } from "./DataStateBoundary.fixtures";
import { DataStateLoadingProvider } from "./DataStateLoadingProvider";
import { LoadingPanel } from "../AgentSession/LoadingPanel";

describe("DataStateBoundary", () => {
  it("responds to reduced-motion preference changes while mounted", async () => {
    const media = new EventTarget();
    let reduced = false;
    const originalMatchMedia = window.matchMedia;
    const scroll = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    window.matchMedia = (query) => ({
      get matches() {
        return reduced;
      },
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: media.addEventListener.bind(media),
      removeEventListener: media.removeEventListener.bind(media),
      dispatchEvent: media.dispatchEvent.bind(media),
    });
    const view = (loading: boolean) => (
      <DataStateBoundary
        loading={loading}
        fetched={!loading}
        presentation={{
          queryIdentity: "selection",
          hasUsableContent: !loading,
          transition: "opacity-height",
        }}
      >
        <button>Ready</button>
      </DataStateBoundary>
    );
    const { rerender, unmount } = render(view(true));
    act(() => {
      reduced = true;
      media.dispatchEvent(new Event("change"));
    });
    rerender(view(false));
    await waitFor(() =>
      expect(screen.getByTestId("data-state-presentation").style.height).toBe(
        "auto"
      )
    );
    unmount();
    window.matchMedia = originalMatchMedia;
    scroll.mockRestore();
  });
  it("keeps usable content mounted and focused during coordinated refresh and resets on identity replacement", () => {
    const page = (identity: string, usable: boolean, loading: boolean) => (
      <DataStateLoadingProvider>
        <DataStateBoundary
          loading={loading}
          fetched={usable}
          presentation={{
            queryIdentity: identity,
            hasUsableContent: usable,
            transition: "opacity",
          }}
          initialContent={<div>Skeleton</div>}
        >
          <button>Activity row</button>
        </DataStateBoundary>
      </DataStateLoadingProvider>
    );
    const { rerender } = render(page("first", true, false));
    const row = screen.getByRole("button");
    row.focus();
    rerender(page("first", true, true));
    expect(screen.getByRole("button")).toBe(row);
    expect(row).toHaveFocus();
    expect(screen.queryByTestId("data-state-boundary-loading")).toBeNull();
    rerender(page("second", false, true));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("data-state-loading-content")).toHaveAttribute(
      "inert"
    );
  });

  it("keeps the same single indicator while nested reads and session preparation hand off", () => {
    const page = (sessionReady: boolean, messagesReady: boolean) => (
      <DataStateLoadingProvider>
        <DataStateBoundary loading={false} fetched={sessionReady}>
          <div>Session header</div>
          {messagesReady ? (
            <div>Messages</div>
          ) : (
            <LoadingPanel label="Loading messages" />
          )}
        </DataStateBoundary>
      </DataStateLoadingProvider>
    );
    const { rerender } = render(page(false, false));
    const indicator = screen.getByRole("status");
    rerender(page(true, false));
    expect(screen.getAllByRole("status")).toEqual([indicator]);
    expect(screen.getByText("Session header")).not.toBeVisible();
    expect(screen.queryByText("Loading messages")).not.toBeInTheDocument();
    rerender(page(true, true));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Messages")).toBeVisible();
  });

  it("clears pending registrations on unmount and reveals ready error content", () => {
    const { rerender } = render(
      <DataStateLoadingProvider>
        <DataStateBoundary loading fetched={false}>
          {null}
        </DataStateBoundary>
      </DataStateLoadingProvider>
    );
    rerender(
      <DataStateLoadingProvider>
        <div role="alert">Unable to load session</div>
      </DataStateLoadingProvider>
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeVisible();
  });
  it.each([
    { loading: false, fetched: false },
    { loading: true, fetched: false },
    { loading: true, fetched: true },
  ])(
    "renders shared loading for loading=$loading and fetched=$fetched",
    ({ loading, fetched }) => {
      render(
        <DataStateBoundary loading={loading} fetched={fetched}>
          {dataStateBoundaryFixtures.ready.children}
        </DataStateBoundary>
      );

      expect(screen.getByTestId("data-state-boundary-loading")).toBeVisible();
      expect(
        screen.queryByTestId("data-state-boundary-ready-content")
      ).not.toBeInTheDocument();
    }
  );

  it("passes children through only after fetching has finished", () => {
    render(<DataStateBoundary {...dataStateBoundaryFixtures.ready} />);

    expect(
      screen.getByTestId("data-state-boundary-ready-content")
    ).toBeVisible();
    expect(
      screen.queryByTestId("data-state-boundary-loading")
    ).not.toBeInTheDocument();
  });
});
