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
import { Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { TaskSource, WorkStatus, type TaskResponseDto } from "../../../api";
import { useFeatureTree } from "../useFeatureTree";
import { useWorkItems } from "../useWorkItems";
import { FeatureTreeVisualization } from "../../../components/Features/FeatureTreeVisualization";
import { PathServiceProvider } from "../../../contexts";
import type { PathService } from "../../../services/webPathService";
import { referencesResponse } from "../../../components/Features/__tests__/featureTreeReferences";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTasks: vi.fn(),
    getTask: vi.fn(),
    listWorkItemReferences: vi.fn(),
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
const PROJ_ID = "proj-1";
const mockedClient = vi.mocked(unifiedApiClient);
const mockedContext = vi.mocked(entityContextClient);

function makeFeature(
  id: string,
  name: string,
  parentTaskId?: string
): TaskResponseDto {
  return {
    id,
    name,
    type: "FEATURE",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    status: WorkStatus.Backlog,
    source: TaskSource.User,
    parentTaskId,
  };
}

const mockPathService: PathService = {
  feature: ({ featureId }: { projectId: string; featureId: string }) =>
    `/features/${featureId}`,
  task: ({ taskId }: { projectId: string; taskId: string }) =>
    `/tasks/${taskId}`,
} as unknown as PathService;

// The mock backend: getTasks reads from this list, createTask appends to it.
let backendFeatures: TaskResponseDto[];

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  backendFeatures = [
    makeFeature("root", "Root Feature"),
    makeFeature("child", "Child Feature", "root"),
  ];
  mockedClient.getTasks.mockImplementation(
    () => Promise.resolve({ data: { data: [...backendFeatures] } }) as never
  );
  // The project tree reads structure from the cached reference hierarchy.
  mockedClient.listWorkItemReferences.mockImplementation(
    () => Promise.resolve(referencesResponse(backendFeatures)) as never
  );
  mockedClient.createTask.mockImplementation((args: unknown) => {
    const { createTaskDto } = args as {
      createTaskDto: { name: string; parentTaskId?: string };
    };
    const created = makeFeature(
      "created",
      createTaskDto.name,
      createTaskDto.parentTaskId
    );
    backendFeatures = [...backendFeatures, created];
    return Promise.resolve({ data: { data: created } }) as never;
  });
  mockedContext.getEntityContext.mockResolvedValue({
    data: { data: { featureHierarchy: [] } },
  } as never);
});

const jotaiWrapper = ({ children }: { children: React.ReactNode }) => (
  <Provider>{children}</Provider>
);

describe("useFeatureTree", () => {
  it("builds the feature hierarchy from the fetched features", async () => {
    const { result } = renderHook(() => useFeatureTree(ORG_ID, PROJ_ID), {
      wrapper: jotaiWrapper,
    });

    await waitFor(() => {
      expect(result.current.allFeatures).toHaveLength(2);
    });

    expect(result.current.roots).toHaveLength(1);
    expect(result.current.roots[0].feature.id).toBe("root");
    expect(result.current.roots[0].children).toHaveLength(1);
    expect(result.current.roots[0].children[0].feature.id).toBe("child");
    expect(mockedClient.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "FEATURE",
        limit: 500,
        includeSectionKeys: ["description", "requirements"],
      }),
      expect.anything(),
    );
  });

  it("picks up a feature created elsewhere without a remount", async () => {
    const { result } = renderHook(
      () => ({
        tree: useFeatureTree(ORG_ID, PROJ_ID),
        workItems: useWorkItems(ORG_ID, "task", PROJ_ID),
      }),
      { wrapper: jotaiWrapper }
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

    // The tree refetched off the shared work-item store and now includes the
    // new feature — no caller had to re-mount the hook or reload the page.
    await waitFor(() => {
      expect(result.current.tree.allFeatures.map((f) => f.id)).toContain(
        "created"
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
        });
      }}
    >
      create
    </button>
  );
}

describe("FeatureTreeVisualization — refresh after feature creation", () => {
  it("renders a feature created elsewhere without a reload", async () => {
    render(
      <Provider>
        <MemoryRouter>
          <PathServiceProvider pathService={mockPathService}>
            <CreateFeatureButton />
            <FeatureTreeVisualization
              organizationId={ORG_ID}
              projectId={PROJ_ID}
            />
          </PathServiceProvider>
        </MemoryRouter>
      </Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("Child Feature")).toBeInTheDocument();
    });
    expect(
      screen.queryByText("Freshly Created Feature")
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("create-feature"));

    await waitFor(() => {
      expect(screen.getByText("Freshly Created Feature")).toBeInTheDocument();
    });
  });
});
