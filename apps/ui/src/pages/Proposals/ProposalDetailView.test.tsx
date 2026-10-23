import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalDetailView } from "./ProposalDetailView";

const { deleteProposalMock } = vi.hoisted(() => ({
  deleteProposalMock: vi.fn(),
}));

const canonicalBoundaryMock = vi.fn();

vi.mock("@hey-hey/ui-common/clients", () => ({
  proposalsClient: { deleteProposal: deleteProposalMock },
}));

vi.mock("@hey-hey/ui-common/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/components")>()),
  ProposalDetail: ({
    onPresentationLoaded,
  }: {
    onPresentationLoaded?: (label: string) => void;
  }) => {
    React.useEffect(() => {
      onPresentationLoaded?.("Update launch policy");
    }, [onPresentationLoaded]);
    return <div data-testid="proposal-detail">Proposal review</div>;
  },
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  CanonicalPageBoundary: ({
    children,
    composition,
  }: {
    children: React.ReactNode;
    composition: unknown;
  }) => {
    canonicalBoundaryMock(composition);
    return children;
  },
  TrackingProvider: ({ children }: { children: React.ReactNode }) => children,
  createCanonicalPageDescriptor: (
    entityType: string,
    entityId: string,
    lineage: unknown,
    presentation?: unknown,
  ) => ({ entityType, entityId, lineage, presentation }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useProject: () => ({ data: { id: "project-1", name: "Project" } }),
}));

vi.mock("@hey-hey/ui-common/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/i18n")>()),
  compose: (value: string) => value,
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    proposal: ({ projectId, proposalId }: Record<string, string>) =>
      `/projects/${projectId}/proposals/${proposalId}`,
  },
}));

vi.mock("../../components/Layout", () => ({
  DetailPageBody: ({ content }: { content: React.ReactNode }) => content,
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DetailPageTabs: ({
    value,
    onChange,
    tabs,
  }: {
    value: string;
    onChange: (value: string) => unknown;
    tabs: Array<{ value: string; label: string }>;
  }) => (
    <div role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  ),
  PageBreadcrumbs: () => null,
}));

vi.mock("../../components/Tabs", () => ({
  AdminTab: ({ actions }: { actions?: React.ReactNode }) => (
    <section data-testid="admin-tab">{actions}</section>
  ),
}));

const LocationDisplay: React.FC = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
};

const renderDetailView = ({
  searchParams = "",
  preview = false,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  }),
  onUrlUpdate = vi.fn(),
}: {
  searchParams?: string;
  preview?: boolean;
  queryClient?: QueryClient;
  onUrlUpdate?: ReturnType<typeof vi.fn>;
} = {}) => {
  const initialSearch = searchParams ? `?${searchParams}` : "";
  render(
    <NuqsTestingAdapter
      searchParams={searchParams}
      onUrlUpdate={onUrlUpdate}
    >
      <MemoryRouter
        initialEntries={[`/projects/project-1/proposals/proposal-1${initialSearch}`]}
      >
        <QueryClientProvider client={queryClient}>
          <ProposalDetailView
            organizationId="org-1"
            projectId="project-1"
            proposalId="proposal-1"
            preview={preview}
          />
          <LocationDisplay />
        </QueryClientProvider>
      </MemoryRouter>
    </NuqsTestingAdapter>,
  );

  return { onUrlUpdate, queryClient };
};

describe("ProposalDetailView", () => {
  beforeEach(() => {
    deleteProposalMock.mockReset().mockResolvedValue(undefined);
    canonicalBoundaryMock.mockReset();
  });

  it("defaults to Review and keeps the selected tab in the URL", async () => {
    const user = userEvent.setup();
    const { onUrlUpdate } = renderDetailView();

    expect(screen.getByRole("tab", { name: "Review" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("proposal-detail")).toBeInTheDocument();
    expect(screen.queryByTestId("proposal-delete-button")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Admin" }));

    expect(await screen.findByTestId("proposal-delete-button")).toBeInTheDocument();
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("tab")).toBe(
      "admin",
    );

    await user.click(screen.getByRole("tab", { name: "Review" }));
    expect(screen.getByTestId("proposal-detail")).toBeInTheDocument();
  });

  it("confirms project-scoped proposal deletion, refreshes related caches, and stays on the route", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    queryClient.setQueryData(["proposals", "project-1"], [{ id: "proposal-1" }]);
    queryClient.setQueryData(["conversation-messages", "conversation-1"], []);
    queryClient.setQueryData(["project-details", "project-1"], { id: "project-1" });
    const { queryClient: renderedQueryClient } = renderDetailView({
      searchParams: "tab=admin",
      queryClient,
    });

    await user.click(screen.getByTestId("proposal-delete-button"));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "This permanently deletes the proposal record.",
    );
    expect(deleteProposalMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("proposal-admin-confirm-delete-button"));

    await waitFor(() =>
      expect(deleteProposalMock).toHaveBeenCalledWith({
        organizationId: "org-1",
        projectId: "project-1",
        proposalId: "proposal-1",
      }),
    );
    await waitFor(() => {
      expect(
        renderedQueryClient.getQueryState(["proposals", "project-1"])
          ?.isInvalidated,
      ).toBe(true);
      expect(
        renderedQueryClient.getQueryState([
          "conversation-messages",
          "conversation-1",
        ])?.isInvalidated,
      ).toBe(true);
    });
    expect(
      renderedQueryClient.getQueryState(["project-details", "project-1"])
        ?.isInvalidated,
    ).toBe(false);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/proposals/proposal-1",
    );
  });

  it("shows API deletion failures and keeps the confirmation available", async () => {
    const user = userEvent.setup();
    deleteProposalMock.mockRejectedValueOnce(
      new Error("Proposal groups cannot be deleted individually."),
    );
    renderDetailView({ searchParams: "tab=admin" });

    await user.click(screen.getByTestId("proposal-delete-button"));
    await user.click(screen.getByTestId("proposal-admin-confirm-delete-button"));

    expect(
      await screen.findByText("Proposal groups cannot be deleted individually."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/proposals/proposal-1",
    );
  });

  it("keeps the review preview free of page tabs and Admin controls", () => {
    renderDetailView({ preview: true, searchParams: "tab=admin" });

    expect(screen.getByTestId("proposal-detail")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByTestId("proposal-delete-button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("publishes the shared proposal display title in canonical presentation", async () => {
    renderDetailView();

    await waitFor(() => {
      expect(canonicalBoundaryMock).toHaveBeenLastCalledWith({
        kind: "canonical",
        descriptor: {
          entityType: "proposal",
          entityId: "proposal-1",
          lineage: null,
          presentation: {
            kind: "proposal",
            label: "Update launch policy",
          },
        },
      });
    });
  });
});
