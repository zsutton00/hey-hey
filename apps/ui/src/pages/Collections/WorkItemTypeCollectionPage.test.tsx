import { render, screen } from "@testing-library/react";
import { AxiosError } from "axios";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewPresentationProvider } from "../../contexts/PreviewPresentationContext";
import { WorkItemTypeCollectionPage } from "./WorkItemTypeCollectionPage";

const customDefinition = {
  key: "CUSTOM_DELIVERABLE",
  name: "Deliverables",
  allowedStatuses: ["COMPLETED", "ACTIVE", "BACKLOG"],
};
const useWorkItemTypeByKeyMock = vi.fn();
const collectionPropsMock = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  useProject: () => ({ data: { name: "Project" } }),
  useWorkItemTypeByKey: (...args: unknown[]) =>
    useWorkItemTypeByKeyMock(...args),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));

vi.mock("@hey-hey/ui-common/components", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/components")
  >("@hey-hey/ui-common/components");
  return {
    EntityCollectionPage: (props: {
      typeDefinition: Parameters<typeof actual.buildDefaultStatusTabs>[0];
      searchPlaceholder?: string;
    }) => {
      collectionPropsMock(props);
      return (
        <div data-testid="entity-collection-page">
          <input
            data-testid="entity-collection-search"
            placeholder={props.searchPlaceholder}
          />
          {actual.buildDefaultStatusTabs(props.typeDefinition).map((tab) => (
            <span key={tab.id} data-testid="entity-collection-status-tab">
              {tab.label}
            </span>
          ))}
        </div>
      );
    },
  };
});

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
  DetailPageHeader: ({ title }: { title: React.ReactNode }) => <h1>{title}</h1>,
  PageBreadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav data-testid="breadcrumbs">
      {items.map((item) => item.label).join(" / ")}
    </nav>
  ),
}));

vi.mock("../NotFound", () => ({
  default: () => <div data-testid="not-found" />,
}));

const readyType = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  workItemTypeSummary: { status: "ACTIVE", definition: customDefinition },
  workItemTypeDefinition: customDefinition,
  isReady: true,
  error: null,
  ...overrides,
});

const renderPage = (preview = false) => {
  const page = (
    <Routes>
      <Route
        path="projects/:projectId/collections/:typeKey"
        element={<WorkItemTypeCollectionPage preview={preview} />}
      />
    </Routes>
  );
  return render(
    <MemoryRouter
      initialEntries={["/projects/project-1/collections/CUSTOM_DELIVERABLE"]}
    >
      {preview ? (
        <PreviewPresentationProvider>{page}</PreviewPresentationProvider>
      ) : (
        page
      )}
    </MemoryRouter>,
  );
};

describe("WorkItemTypeCollectionPage", () => {
  beforeEach(() => {
    useWorkItemTypeByKeyMock.mockReset().mockReturnValue(readyType());
    collectionPropsMock.mockReset();
  });

  it("resolves the definition from the route key and renders the shared collection", () => {
    renderPage();

    expect(useWorkItemTypeByKeyMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "CUSTOM_DELIVERABLE",
    );
    expect(collectionPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        typeDefinition: customDefinition,
      }),
    );
    expect(collectionPropsMock.mock.lastCall?.[0]).not.toHaveProperty(
      "includeTrackedWorkSummary",
    );
    expect(collectionPropsMock.mock.lastCall?.[0]).not.toHaveProperty(
      "renderRowAttention",
    );
  });

  it("titles the page and breadcrumb with the type's display name", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { name: "Deliverables" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("breadcrumbs")).toHaveTextContent(
      "Projects / Project / Deliverables",
    );
  });

  it("uses the registry's plural display name where one is defined", () => {
    const definition = { ...customDefinition, key: "BUG", name: "Bug" };
    useWorkItemTypeByKeyMock.mockReturnValue(
      readyType({
        workItemTypeSummary: { status: "ACTIVE", definition },
        workItemTypeDefinition: definition,
      }),
    );

    renderPage();

    expect(screen.getByRole("heading", { name: "Bugs" })).toBeInTheDocument();
  });

  it("shows the type's declared statuses with In Progress first and no All tab", () => {
    renderPage();

    const labels = screen
      .getAllByTestId("entity-collection-status-tab")
      .map((tab) => tab.textContent);
    expect(labels[0]).toBe("In progress");
    expect(labels).toHaveLength(customDefinition.allowedStatuses.length);
    expect(labels).not.toContain("All");
  });

  it("gives the collection search a type-specific placeholder", () => {
    renderPage();

    expect(screen.getByTestId("entity-collection-search")).toHaveAttribute(
      "placeholder",
      "Search deliverables",
    );
  });

  it("suppresses the title and breadcrumbs in Preview", () => {
    renderPage(true);

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("breadcrumbs")).not.toBeInTheDocument();
    expect(screen.getByTestId("entity-collection-page")).toBeInTheDocument();
  });

  it("renders only the loading state while the definition is unavailable", () => {
    useWorkItemTypeByKeyMock.mockReturnValue(
      readyType({
        workItemTypeSummary: undefined,
        workItemTypeDefinition: undefined,
        isReady: false,
      }),
    );

    renderPage();

    expect(
      screen.getByTestId("work-item-type-collection-loading"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("entity-collection-page")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("breadcrumbs")).not.toBeInTheDocument();
    expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();
    expect(collectionPropsMock).not.toHaveBeenCalled();
  });

  it("renders not-found when the registry has no such type", () => {
    useWorkItemTypeByKeyMock.mockReturnValue(
      readyType({
        workItemTypeSummary: undefined,
        workItemTypeDefinition: undefined,
      }),
    );

    renderPage();

    expect(screen.getByTestId("not-found")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-collection-page")).not.toBeInTheDocument();
  });

  it("renders not-found when the registry answers 404 for the key", () => {
    const error = new AxiosError("Not Found");
    error.response = { status: 404 } as AxiosError["response"];
    useWorkItemTypeByKeyMock.mockReturnValue(
      readyType({
        workItemTypeSummary: undefined,
        workItemTypeDefinition: undefined,
        isReady: false,
        error,
      }),
    );

    renderPage();

    expect(screen.getByTestId("not-found")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders not-found for an inactive type", () => {
    useWorkItemTypeByKeyMock.mockReturnValue(
      readyType({
        workItemTypeSummary: { status: "ARCHIVED", definition: customDefinition },
      }),
    );

    renderPage();

    expect(screen.getByTestId("not-found")).toBeInTheDocument();
    expect(screen.queryByTestId("entity-collection-page")).not.toBeInTheDocument();
  });

  it("surfaces non-404 registry failures instead of an empty collection", () => {
    useWorkItemTypeByKeyMock.mockReturnValue(
      readyType({
        workItemTypeSummary: undefined,
        workItemTypeDefinition: undefined,
        isReady: false,
        error: new Error("registry down"),
      }),
    );

    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("registry down");
    expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();
  });
});
