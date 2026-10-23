import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSource, WorkStatus, type TaskResponseDto } from "../../../api";
import {
  entityContextClient,
  unifiedApiClient,
} from "../../../clients/serviceClients";
import { PathServiceProvider } from "../../../contexts";
import type { PathService } from "../../../services/webPathService";
import { FeatureTreeVisualization } from "../FeatureTreeVisualization";
import { referencesResponse } from "./featureTreeReferences";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTasks: vi.fn(),
    listWorkItemReferences: vi.fn(),
    updateTask: vi.fn(),
  },
  entityContextClient: {
    getEntityContext: vi.fn(),
  },
}));

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";

const pathService: PathService = {
  feature: ({ featureId }: { projectId: string; featureId: string }) =>
    `/features/${featureId}`,
} as PathService;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function makeFeature(id: string, name: string): TaskResponseDto {
  return {
    id,
    name,
    type: "FEATURE",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    status: WorkStatus.Backlog,
    source: TaskSource.User,
  };
}

function mockFeatureMetadata(features: TaskResponseDto[]): void {
  vi.mocked(unifiedApiClient.getTasks).mockResolvedValue({
    data: { data: features },
  } as never);
}

function renderTree(activeFeatureId?: string): void {
  render(
    <Provider>
      <MemoryRouter>
        <PathServiceProvider pathService={pathService}>
          <FeatureTreeVisualization
            organizationId={ORG_ID}
            projectId={PROJ_ID}
            projectName="Known Project"
            activeFeatureId={activeFeatureId}
            fillHeight={false}
          />
        </PathServiceProvider>
      </MemoryRouter>
    </Provider>
  );
}

describe("FeatureTreeVisualization loading presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("keeps one plain loading state mounted until the hierarchy and relationship reads are ready", async () => {
    const featureRead = createDeferred<unknown>();
    const contextRead = createDeferred<unknown>();
    mockFeatureMetadata([makeFeature("feature-1", "Ready Feature")]);
    vi.mocked(unifiedApiClient.listWorkItemReferences).mockReturnValue(
      featureRead.promise as never
    );
    vi.mocked(entityContextClient.getEntityContext).mockReturnValue(
      contextRead.promise as never
    );

    renderTree("feature-1");

    const loadingState = screen.getByTestId("feature-tree-loading-state");
    expect(loadingState).toBeVisible();
    expect(loadingState).not.toHaveTextContent("Known Project");
    expect(loadingState).not.toHaveStyle({ border: "1px solid" });
    expect(loadingState).not.toHaveStyle({ height: "400px" });
    expect(loadingState).not.toHaveStyle({ minHeight: "400px" });
    expect(screen.getByTestId("feature-tree-loading-progress")).toBeVisible();
    expect(screen.queryByTestId("feature-tree-ready")).not.toBeInTheDocument();

    await act(async () => {
      featureRead.resolve(
        referencesResponse([makeFeature("feature-1", "Ready Feature")])
      );
      await featureRead.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId("feature-tree-loading-state")).toBe(
        loadingState
      );
    });
    expect(screen.queryByText("Ready Feature")).not.toBeInTheDocument();

    await act(async () => {
      contextRead.resolve({
        data: { data: { featureHierarchy: [] } },
      });
      await contextRead.promise;
    });

    const readyTree = await screen.findByTestId("feature-tree-ready");
    expect(screen.queryByTestId("feature-tree-loading-state")).toBeNull();
    expect(screen.getByText("Ready Feature")).toBeVisible();
    expect(readyTree).toHaveStyle({ transition: "opacity 180ms ease" });
  });

  it("renders a failed read distinctly from loading", async () => {
    vi.mocked(unifiedApiClient.listWorkItemReferences).mockRejectedValue(
      new Error("Feature read failed")
    );

    renderTree();

    expect(await screen.findByTestId("feature-tree-error")).toHaveTextContent(
      "Failed to load feature tree: Feature read failed"
    );
    expect(
      screen.queryByTestId("feature-tree-loading-state")
    ).not.toBeInTheDocument();
  });

  it("renders a failed relationship read distinctly from loading", async () => {
    const feature = makeFeature("feature-1", "Ready Feature");
    vi.mocked(unifiedApiClient.listWorkItemReferences).mockResolvedValue(
      referencesResponse([feature]) as never
    );
    mockFeatureMetadata([feature]);
    vi.mocked(entityContextClient.getEntityContext).mockRejectedValue(
      new Error("Relationship read failed")
    );

    renderTree("feature-1");

    expect(await screen.findByTestId("feature-tree-error")).toHaveTextContent(
      "Failed to load feature tree: Relationship read failed"
    );
    expect(
      screen.queryByTestId("feature-tree-loading-state")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("feature-tree-ready")).not.toBeInTheDocument();
  });

  it("renders an empty read distinctly from loading", async () => {
    vi.mocked(unifiedApiClient.listWorkItemReferences).mockResolvedValue(
      referencesResponse([]) as never
    );
    mockFeatureMetadata([]);

    renderTree();

    expect(await screen.findByTestId("feature-tree-empty")).toHaveTextContent(
      "No features to visualize"
    );
    expect(
      screen.queryByTestId("feature-tree-loading-state")
    ).not.toBeInTheDocument();
  });
});
