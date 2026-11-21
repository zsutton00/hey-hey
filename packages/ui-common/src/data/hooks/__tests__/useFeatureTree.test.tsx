import React from "react";
import {
  render,
  renderHook,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { WorkStatus } from "../../../api";
import {
  FakeWorkItemServer,
  type FakeWorkItem,
} from "../../../test/workItemGraphQL";
import { WebSocketHandler } from "../../websockets/handler";
import { useFeatureTree } from "../useFeatureTree";
import { useWorkItems } from "../useWorkItems";
import { FeatureTreeVisualization } from "../../../components/Features/FeatureTreeVisualization";
import { PathServiceProvider } from "../../../contexts";
import type { PathService } from "../../../services/webPathService";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    createTask: vi.fn(),
    updateTask: vi.fn(),
  },
  entityContextClient: {
    getEntityContext: vi.fn(),
  },
}));

import {
  unifiedApiClient,
  entityContextClient,
} from "../../../clients/serviceClients";

const ORG_ID = "org-1";
const PROJ_ID = "project-1";
const mockedClient = vi.mocked(unifiedApiClient);
const mockedContext = vi.mocked(entityContextClient);

function makeFeature(
  id: string,
  name: string,
  parentTaskId?: string,
): FakeWorkItem {
  return {
    id,
    name,
    type: "FEATURE",
    status: WorkStatus.Backlog,
    parentTaskId: parentTaskId ?? null,
  };
}

const mockPathService: PathService = {
  feature: ({ featureId }: { projectId: string; featureId: string }) =>
    `/features/${featureId}`,
  task: ({ taskId }: { projectId: string; taskId: string }) =>
    `/tasks/${taskId}`,
} as unknown as PathService;

// The server holds the features; a write adds to it, and the server's change
// event is what brings the new feature to every view.
let server: FakeWorkItemServer;
let handler: WebSocketHandler;

const announceCreated = (taskId: string) =>
  handler.handleEvent({
    type: "task.created",
    timestamp: "2026-11-01T00:00:00.000Z",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    taskId,
  });

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  server = new FakeWorkItemServer([
    makeFeature("root", "Root Feature"),
    makeFeature("child", "Child Feature", "root"),
  ]);
  handler = new WebSocketHandler(
    createStore(),
    undefined,
    server.queryClient,
    server.graphql.apollo,
  );
  mockedClient.createTask.mockImplementation((args: unknown) => {
    const { createTaskDto } = args as {
      createTaskDto: { name: string; parentTaskId?: string };
    };
    server.add(
      makeFeature("created", createTaskDto.name, createTaskDto.parentTaskId),
    );
    return Promise.resolve({ data: { data: { id: "created" } } }) as never;
  });
  mockedContext.getEntityContext.mockResolvedValue({
    data: { data: { featureHierarchy: [] } },
  } as never);
});

describe("useFeatureTree", () => {
  it("builds the feature hierarchy from the fetched features", async () => {
    const { result } = renderHook(() => useFeatureTree(ORG_ID, PROJ_ID), {
      wrapper: server.wrapper,
    });

    await waitFor(() => {
      expect(result.current.allFeatures).toHaveLength(2);
    });

    expect(result.current.roots).toHaveLength(1);
    expect(result.current.roots[0].feature.id).toBe("root");
    expect(result.current.roots[0].children).toHaveLength(1);
    expect(result.current.roots[0].children[0].feature.id).toBe("child");
    expect(server.received("GetWorkItems")).toContainEqual(
      expect.objectContaining({
        type: "FEATURE",
        withSections: true,
        sectionKeys: ["description", "requirements"],
      }),
    );
  });

  it("picks up a feature created elsewhere once the server reports it", async () => {
    const { result } = renderHook(
      () => ({
        tree: useFeatureTree(ORG_ID, PROJ_ID),
        workItems: useWorkItems(ORG_ID, "task", PROJ_ID),
      }),
      { wrapper: server.wrapper },
    );

    await waitFor(() => {
      expect(result.current.tree.allFeatures).toHaveLength(2);
    });

    await act(async () => {
      await result.current.workItems.createTask({
        name: "Created Feature",
        type: "FEATURE",
        parentTaskId: "root",
      });
    });
    // The write alone does not edit what the tree shows.
    expect(result.current.tree.allFeatures).toHaveLength(2);

    act(() => announceCreated("created"));

    await waitFor(() => {
      expect(result.current.tree.allFeatures.map((f) => f.id)).toContain(
        "created",
      );
    });
    expect(result.current.tree.roots[0].children).toHaveLength(2);
  });
});

// A sibling consumer that creates a feature through the shared work-item store.
function CreateFeatureButton(): React.ReactElement {
  const { createTask } = useWorkItems(ORG_ID, "task", PROJ_ID);
  return (
    <button
      type="button"
      data-testid="create-feature"
      onClick={() => {
        void createTask({
          name: "Freshly Created Feature",
          type: "FEATURE",
          parentTaskId: "root",
        }).then(() => announceCreated("created"));
      }}
    >
      create
    </button>
  );
}

describe("FeatureTreeVisualization — refresh after feature creation", () => {
  it("renders a feature created elsewhere without a reload", async () => {
    render(
      <MemoryRouter>
        <PathServiceProvider pathService={mockPathService}>
          <CreateFeatureButton />
          <FeatureTreeVisualization
            organizationId={ORG_ID}
            projectId={PROJ_ID}
          />
        </PathServiceProvider>
      </MemoryRouter>,
      { wrapper: server.wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText("Child Feature")).toBeInTheDocument();
    });
    expect(
      screen.queryByText("Freshly Created Feature"),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("create-feature"));

    await waitFor(() => {
      expect(screen.getByText("Freshly Created Feature")).toBeInTheDocument();
    });
  });
});
