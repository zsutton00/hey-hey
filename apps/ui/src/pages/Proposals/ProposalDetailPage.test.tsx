import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ProposalDetailPage } from "./ProposalDetailPage";
import { normalizeProposalReturnTarget } from "./proposalReturnTarget";

let capturedOnApplied: ((proposalId: string) => void | Promise<void>) | undefined;

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "organization-id" }),
}));

vi.mock("./ProposalDetailView", () => ({
  ProposalDetailView: (props: {
    onApplied?: (proposalId: string) => void | Promise<void>;
  }) => {
    capturedOnApplied = props.onApplied;
    return <div data-testid="proposal-detail-view" />;
  },
}));

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
      {location.hash}
    </div>
  );
};

function renderPage(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/projects/:projectId/proposals/:proposalId"
          element={<ProposalDetailPage />}
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  capturedOnApplied = undefined;
});

describe("normalizeProposalReturnTarget", () => {
  it.each([
    ["/projects/project-id/tasks/root-id?tab=graph", "/projects/project-id/tasks/root-id?tab=graph"],
    ["/projects/project-id/tasks/root-id?tab=graph#node", "/projects/project-id/tasks/root-id?tab=graph#node"],
    [null, null],
    ["https://example.com/escape", null],
    ["//example.com/escape", null],
    ["javascript:alert(1)", null],
    ["projects/project-id", null],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeProposalReturnTarget(input)).toBe(expected);
  });
});

describe("ProposalDetailPage return navigation", () => {
  it("replace-navigates to the query-stable internal origin only after completion", async () => {
    const returnTo = "/projects/project-id/tasks/root-id?tab=graph&mode=review#node";
    renderPage(
      `/projects/project-id/proposals/proposal-id?returnTo=${encodeURIComponent(returnTo)}`,
    );

    expect(screen.getByTestId("proposal-detail-view")).toBeInTheDocument();
    expect(capturedOnApplied).toBeDefined();

    await act(async () => {
      await capturedOnApplied?.("proposal-id");
    });

    expect(screen.getByTestId("location")).toHaveTextContent(returnTo);
  });

  it.each([
    "/projects/project-id/proposals/proposal-id",
    "/projects/project-id/proposals/proposal-id?returnTo=https%3A%2F%2Fexample.com",
    "/projects/project-id/proposals/proposal-id?returnTo=%2F%2Fexample.com",
  ])("retains normal detail behavior for %s", (entry) => {
    renderPage(entry);

    expect(screen.getByTestId("proposal-detail-view")).toBeInTheDocument();
    expect(capturedOnApplied).toBeUndefined();
  });
});
