import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EntityType,
  FeatureTag,
  ProposalAction,
  ProposalEdgeTargetType,
  ProposalEdgeType,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type CreateTaskDto,
  type ProposalResponseDto,
  type ServiceDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { FEATURE_TAG_PALETTE } from "../../Features/featureTagPalette";
import type { CreateTaskProposalUpdates } from "../types";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getTask: getTaskMock },
  tasksClient: {
    organizationsOrganizationIdProjectsProjectIdTasksTaskIdPatch: vi.fn(),
  },
  proposalsClient: {
    updateProposal: vi.fn(),
    getProposal: vi.fn(),
  },
}));

vi.mock("../../../contexts/PathServiceContext", () => ({
  usePathService: () => ({
    feature: ({
      projectId,
      featureId,
    }: {
      projectId: string;
      featureId: string;
    }) => `/projects/${projectId}/features/${featureId}`,
    task: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
      `/projects/${projectId}/tasks/${taskId}`,
  }),
}));

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const registryState = vi.hoisted(() => ({
  definitions: {} as Record<string, WorkItemTypeDefinitionDto>,
  isLoading: false,
  error: null as Error | null,
}));

const useWorkItemTypeByKeyMock = vi.hoisted(() => vi.fn());
const useServicesMock = vi.hoisted(() => vi.fn());
const getTaskMock = vi.hoisted(() => vi.fn());

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: useWorkItemTypeByKeyMock,
  useMentionWorkItemTypeKey: () => ({ typeKey: undefined, isResolved: true }),
}));

vi.mock("../../../data/hooks/useServices", () => ({
  useServices: useServicesMock,
}));

let mockOnParentChange: ((taskId: string | null) => void) | null = null;
vi.mock("../../Selectors/TaskTreePicker", () => ({
  TaskTreePicker: ({
    onChange,
  }: {
    onChange: (taskId: string | null) => void;
  }) => {
    mockOnParentChange = onChange;
    return <div data-testid="task-tree-picker" />;
  },
}));

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({
    children,
    mentionConfig,
  }: {
    children: string;
    mentionConfig?: { organizationId: string; projectId: string };
  }) => (
    <span
      data-testid="mock-markdown-renderer"
      data-mention-organization-id={mentionConfig?.organizationId}
      data-mention-project-id={mentionConfig?.projectId}
    >
      {children}
    </span>
  ),
}));

vi.mock("../../SmarterTextAreaCard/EntityHoverCard", () => ({
  EntityHoverCard: ({
    anchorEl,
    entityId,
    entityType,
    organizationId,
    projectId,
  }: {
    anchorEl: HTMLElement | null;
    entityId: string;
    entityType: string;
    organizationId: string;
    projectId?: string;
  }) =>
    anchorEl ? (
      <div
        data-testid="entity-hover-card"
        data-entity-id={entityId}
        data-entity-type={entityType}
        data-organization-id={organizationId}
        data-project-id={projectId}
      >
        Entity preview
      </div>
    ) : null,
}));

import { proposalsClient, tasksClient } from "../../../clients/serviceClients";
import { useAuth } from "../../../contexts/AuthContext";
import { TaskCreateRenderer } from "../TaskCreateRenderer";

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";
const TARGET_ID = "feat-target-1";
const USER_ID = "user-42";

const mockedUseAuth = vi.mocked(useAuth);

const mockAuthValue = (userId: string | null) =>
  ({
    isAuthenticated: !!userId,
    user: userId ? { id: userId, email: `${userId}@example.com` } : null,
    loading: false,
    login: vi.fn(),
    completeChangePassword: vi.fn(),
    logout: vi.fn(),
    toggleDevAdminMode: vi.fn(),
  }) as never;

const featureUpdates: CreateTaskDto = {
  type: "FEATURE",
  name: "New Feature",
  parentTaskId: null,
  tag: FeatureTag.Product,
} as CreateTaskDto;

const taskUpdates: CreateTaskDto = {
  type: "STANDARD",
  name: "New Task",
  parentTaskId: "parent-original",
} as CreateTaskDto;

function makeFeatureProposal(): ProposalResponseDto & {
  updates: CreateTaskDto;
} {
  return {
    id: "proposal-1",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Pending,
    targetEntityId: TARGET_ID,
    targetEntityType: TargetEntityType.Task,
    updates: featureUpdates,
    requestorId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as ProposalResponseDto & { updates: CreateTaskDto };
}

function makeTaskProposal(): ProposalResponseDto & { updates: CreateTaskDto } {
  return {
    id: "proposal-task-1",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Pending,
    targetEntityId: TARGET_ID,
    targetEntityType: TargetEntityType.Task,
    updates: taskUpdates,
    requestorId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as ProposalResponseDto & { updates: CreateTaskDto };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockOnParentChange = null;
  mockedUseAuth.mockReturnValue(mockAuthValue(USER_ID));
  registryState.definitions = {
    STANDARD: {
      key: "STANDARD",
      name: "Project Task",
      sections: [
        { key: "description", label: "Overview" },
        { key: "acceptanceCriteria", label: "Done When" },
        { key: "requirements", label: "Requirements" },
      ],
      allowedStatuses: [],
    },
    FEATURE: {
      key: "FEATURE",
      name: "Project Feature",
      sections: [
        {
          key: "requirements",
          label: "Requirements",
          kind: "json",
          schemaRef: "#/components/schemas/FeatureRequirementsSection",
        },
      ],
      allowedStatuses: [],
    },
  };
  registryState.isLoading = false;
  registryState.error = null;
  useWorkItemTypeByKeyMock.mockImplementation(
    (_organizationId: string, _projectId: string, typeKey?: string) => ({
      workItemTypeDefinition: typeKey
        ? registryState.definitions[typeKey]
        : undefined,
      isLoading: registryState.isLoading,
      isFetching: registryState.isLoading,
      isFetched: !registryState.isLoading,
      isReady: !registryState.isLoading && !registryState.error,
      error: registryState.error,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    }),
  );
  useServicesMock.mockReturnValue({
    services: [],
    isLoading: false,
    error: null,
  });
  getTaskMock.mockReset();
});

describe("TaskCreateRenderer — service assignments", () => {
  it("renders the complete proposed service set as names", () => {
    const proposal = makeTaskProposal() as ProposalResponseDto & {
      updates: CreateTaskProposalUpdates;
    };
    proposal.updates.serviceIds = ["service-api", "service-ui"];
    useServicesMock.mockReturnValue({
      services: [
        { id: "service-api", name: "API", organizationId: ORG_ID },
        { id: "service-ui", name: "Web App", organizationId: ORG_ID },
      ] as ServiceDto[],
      isLoading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("task-proposal-services")).toHaveTextContent(
      "ServicesAPI, Web App",
    );
    expect(screen.queryByText("service-api")).not.toBeInTheDocument();
    expect(screen.queryByText("service-ui")).not.toBeInTheDocument();
    expect(useServicesMock).toHaveBeenCalledWith(ORG_ID, {
      projectId: PROJ_ID,
      enabled: true,
    });
  });

  it("renders an explicit unavailable state instead of service IDs", () => {
    const proposal = makeTaskProposal() as ProposalResponseDto & {
      updates: CreateTaskProposalUpdates;
    };
    proposal.updates.serviceIds = ["missing-service"];

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("One or more proposed services are unavailable."),
    ).toBeInTheDocument();
    expect(screen.queryByText("missing-service")).not.toBeInTheDocument();
  });
});

describe("TaskCreateRenderer — structured feature requirements", () => {
  it("renders explicit groups while keeping ungrouped records flat", () => {
    const proposal = makeFeatureProposal() as ProposalResponseDto & {
      updates: CreateTaskProposalUpdates;
    };
    proposal.updates = {
      ...proposal.updates,
      sections: [
        {
          key: "requirements",
          content: JSON.stringify({
            records: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                statement: "Ungrouped",
                designedBy: [],
                fulfilledBy: [],
                contracts: [],
              },
              {
                id: "00000000-0000-4000-8000-000000000002",
                statement: "Grouped",
                group: "Access",
                designedBy: [],
                fulfilledBy: [
                  {
                    entityType: "TASK",
                    entityId: "00000000-0000-4000-8000-000000000003",
                    entityTitle: "Title 00000000-0000-4000-8000-000000000003",
                  },
                ],
                contracts: [],
              },
            ],
          }),
        },
      ],
    };

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    const section = screen.getByTestId("task-proposal-section");
    expect(
      within(section).getAllByTestId("structured-requirement-row"),
    ).toHaveLength(2);
    expect(
      within(section).getByTestId("structured-requirements-group"),
    ).toHaveTextContent("Access");
    expect(section).toHaveTextContent("Ungrouped");
    expect(section).toHaveTextContent("Grouped");
    expect(
      within(section).getByTestId("structured-requirement-citations"),
    ).toHaveAttribute("data-citation-slot", "fulfilledBy");
    expect(section).not.toHaveTextContent("Other");
  });

  it("renders canonical JSON groups without reconstructing markdown metadata", () => {
    const proposal = makeFeatureProposal() as ProposalResponseDto & {
      updates: CreateTaskProposalUpdates;
    };
    proposal.updates = {
      ...proposal.updates,
      sections: [
        {
          key: "requirements",
          content: JSON.stringify({
            records: [
              {
                id: "00000000-0000-4000-8000-000000000004",
                statement: "Grouped requirement",
                group: "Shared configuration contract",
                designedBy: [],
                fulfilledBy: [],
                contracts: [],
              },
            ],
          }),
        },
      ],
    };

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    const section = screen.getByTestId("task-proposal-section");
    expect(
      within(section).getByTestId("structured-requirements-group"),
    ).toHaveTextContent("Shared configuration contract");
    expect(
      within(section).getByTestId("structured-requirement-row"),
    ).toHaveTextContent("Grouped requirement");
    expect(section).not.toHaveTextContent(/group:/);
  });
});

describe("TaskCreateRenderer — parent override via proposal PATCH", () => {
  it("changing the parent does not issue any network call while the proposal is pending", async () => {
    const proposalPatch = vi.mocked(proposalsClient.updateProposal);
    const taskPatch = vi.mocked(
      tasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdPatch,
    );

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={makeTaskProposal()}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    act(() => mockOnParentChange?.("parent-new"));

    await Promise.resolve();
    expect(proposalPatch).not.toHaveBeenCalled();
    expect(taskPatch).not.toHaveBeenCalled();
  });

  it("PATCHes the proposal with the new parent and a USER user_reason influence on Apply, then invokes onApply", async () => {
    const user = userEvent.setup();
    const proposalPatch = vi.mocked(proposalsClient.updateProposal);
    proposalPatch.mockResolvedValue({ data: { data: {} } } as never);

    const onApply = vi.fn();
    const proposal = makeTaskProposal();

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={onApply}
        />
      </MemoryRouter>,
    );

    act(() => mockOnParentChange?.("parent-new"));

    await user.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(proposalPatch).toHaveBeenCalledTimes(1);
    });
    expect(proposalPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        projectId: PROJ_ID,
        proposalId: proposal.id,
        updateProposalDto: {
          updates: {
            ...taskUpdates,
            parentTaskId: "parent-new",
          },
          influences: [
            {
              entityId: USER_ID,
              entityType: EntityType.User,
              reasonType: "user_reason",
              reasoning: "user updated parent task",
            },
          ],
        },
      }),
    );
    await waitFor(() => {
      expect(onApply).toHaveBeenCalledTimes(1);
    });
  });

  it("does not PATCH the proposal when the user did not change the parent", async () => {
    const user = userEvent.setup();
    const proposalPatch = vi.mocked(proposalsClient.updateProposal);
    const onApply = vi.fn();

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={makeTaskProposal()}
          status={{ state: "pending" }}
          onApply={onApply}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /create/i }));

    expect(proposalPatch).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});

describe("TaskCreateRenderer — feature tag override", () => {
  it("PATCHes the created feature with the user's tag override after apply", async () => {
    const user = userEvent.setup();
    const proposalPatch = vi.mocked(proposalsClient.updateProposal);
    const mockedPatch = vi.mocked(
      tasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdPatch,
    );
    mockedPatch.mockResolvedValue({ data: { data: {} } } as never);

    const proposal = makeFeatureProposal();

    const { rerender } = render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getAllByText(FEATURE_TAG_PALETTE[FeatureTag.Product].label).length,
    ).toBeGreaterThan(0);

    const select = screen.getByLabelText("Override feature tag");
    await user.click(select);
    await user.click(
      screen.getByRole("option", {
        name: new RegExp(FEATURE_TAG_PALETTE[FeatureTag.Backend].label),
      }),
    );

    rerender(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "applied" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockedPatch).toHaveBeenCalledTimes(1);
    });
    expect(mockedPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        projectId: PROJ_ID,
        taskId: TARGET_ID,
        updateTaskDto: {
          tag: FeatureTag.Backend,
        },
      }),
    );
    expect(proposalPatch).not.toHaveBeenCalled();
  });
});

describe("TaskCreateRenderer — applied title preview", () => {
  it("links the resolved target while the post-apply tag PATCH is in flight", async () => {
    const user = userEvent.setup();
    const mockedPatch = vi.mocked(
      tasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdPatch,
    );
    mockedPatch.mockReturnValue(new Promise(() => {}));

    const proposal = makeFeatureProposal();
    const { rerender } = render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByLabelText("Override feature tag"));
    await user.click(
      screen.getByRole("option", {
        name: new RegExp(FEATURE_TAG_PALETTE[FeatureTag.Backend].label),
      }),
    );

    rerender(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "applied" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockedPatch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("link", { name: "New Feature" })).toHaveAttribute(
      "href",
      `/projects/${PROJ_ID}/features/${TARGET_ID}`,
    );
  });

  it("opens the delayed preview with the materialized target identity", () => {
    vi.useFakeTimers();

    try {
      render(
        <MemoryRouter>
          <TaskCreateRenderer
            proposal={makeTaskProposal()}
            status={{ state: "applied" }}
            onApply={() => {}}
          />
        </MemoryRouter>,
      );

      const link = screen.getByRole("link", { name: "New Task" });
      fireEvent.mouseEnter(link);

      act(() => {
        vi.advanceTimersByTime(299);
      });
      expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1);
      });

      const preview = screen.getByTestId("entity-hover-card");
      expect(preview).toHaveAttribute("data-entity-id", TARGET_ID);
      expect(preview).toHaveAttribute("data-entity-type", "task");
      expect(preview).toHaveAttribute("data-organization-id", ORG_ID);
      expect(preview).toHaveAttribute("data-project-id", PROJ_ID);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TaskCreateRenderer — project registry type labels", () => {
  it("renders a MODE files section through the structured files renderer", () => {
    registryState.definitions.MODE = {
      key: "MODE",
      name: "Project Mode",
      sections: [
        { key: "description", label: "Catalog description" },
        { key: "instructions", label: "MODE.md instructions" },
        {
          key: "files",
          label: "Supporting files",
          kind: "json",
          schemaRef: "#/components/schemas/ProjectModeFilesV1",
        },
        {
          key: "applicability",
          label: "Applicable work-item types",
          kind: "json",
          schemaRef: "#/components/schemas/ProjectModeApplicabilityV1",
        },
      ],
      allowedStatuses: [],
    };
    const proposal = makeTaskProposal();
    proposal.updates = {
      ...proposal.updates,
      type: "MODE",
      sections: [
        { key: "description", content: "Catalog entry" },
        { key: "instructions", content: "Read MODE.md before starting." },
        {
          key: "files",
          content: {
            schemaVersion: "project-mode-files.v1",
            files: {
              "MODE.md": "# Follow the project instructions",
              "references/review.md": "## Review the acceptance criteria",
            },
          },
        },
        {
          key: "applicability",
          content: { eligibleWorkItemTypeKeys: ["STANDARD", "BUG"] },
        },
      ],
    };
    const onApply = vi.fn();

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={onApply}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Catalog description")).toBeInTheDocument();
    expect(screen.getByText("MODE.md instructions")).toBeInTheDocument();
    expect(screen.getByText("Supporting files")).toBeInTheDocument();
    expect(screen.getByText("Applicable work-item types")).toBeInTheDocument();
    expect(
      screen.getByTestId("mode-files-section-renderer"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mode-files-selected-path")).toHaveTextContent(
      "MODE.md",
    );
    expect(screen.getByTestId("mode-files-selected-content")).toHaveTextContent(
      "# Follow the project instructions",
    );
    expect(
      within(screen.getByTestId("mode-files-selected-content")).getByTestId(
        "mock-markdown-renderer",
      ),
    ).toHaveAttribute("data-mention-organization-id", ORG_ID);
    expect(
      within(screen.getByTestId("mode-files-selected-content")).getByTestId(
        "mock-markdown-renderer",
      ),
    ).toHaveAttribute("data-mention-project-id", PROJ_ID);
    expect(screen.getAllByTestId("mode-files-file")[0]).toHaveTextContent(
      "MODE.md",
    );
    expect(screen.getByTestId("mode-files-file-list")).toHaveTextContent(
      "references/review.md",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "references/review.md" }),
    );
    expect(screen.getByTestId("mode-files-selected-content")).toHaveTextContent(
      "## Review the acceptance criteria",
    );
    expect(
      within(screen.getByTestId("mode-files-selected-content")).getByTestId(
        "mock-markdown-renderer",
      ),
    ).toHaveAttribute("data-mention-project-id", PROJ_ID);
    expect(screen.getByTestId("mode-files-selected-path")).toHaveStyle({
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    });
    expect(screen.getAllByTestId("json-section-renderer")).toHaveLength(1);
    expect(screen.getByTestId("json-section-content")).toHaveTextContent(
      "eligibleWorkItemTypeKeys",
    );
    expect(screen.getByTestId("json-section-content")).toHaveTextContent(
      '"STANDARD"',
    );
    expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("renders a registry-selected structured mockup as a static proposal preview", () => {
    registryState.definitions.STRUCTURED_MOCKUP = {
      key: "STRUCTURED_MOCKUP",
      name: "Structured Mockup",
      sections: [
        {
          key: "mockup",
          label: "Mockup",
          kind: "structured-mockup",
          defaultSizeKey: "panel",
          sizeProfiles: [
            {
              key: "panel",
              label: "Panel",
              breakpoints: [
                {
                  minContainerWidth: 0,
                  inline: { width: 420, height: 260 },
                  page: { width: 800, height: 600 },
                },
              ],
            },
          ],
        },
      ],
      allowedStatuses: [],
    };
    const proposal = makeTaskProposal();
    proposal.updates = {
      ...proposal.updates,
      type: "STRUCTURED_MOCKUP",
      sections: [
        {
          key: "mockup",
          content: {
            schemaVersion: "work-item-structured-mockup.v5",
            revision: 1,
            content: [
              {
                type: "icon",
                props: {
                  id: "settings",
                  width: { mode: "fit" },
                  height: { mode: "content" },
                  iconKey: "settings",
                  accessibleLabel: "Settings",
                  description: "Opens settings",
                },
              },
            ],
            annotations: [],
          },
        },
      ],
    };

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("structured-mockup-section-renderer"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("structured-mockup-section-renderer"),
    ).toHaveAttribute("data-rendering-context", "inline");
    expect(screen.getByLabelText("Settings")).toBeInTheDocument();
    expect(
      screen.getByTestId("structured-mockup-semantic-metadata-indicator"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/schemaVersion/)).not.toBeInTheDocument();
  });

  it("renders arbitrary proposed sections in registry order with registry labels", () => {
    registryState.definitions.CUSTOM = {
      key: "CUSTOM",
      name: "Research Brief",
      sections: [
        { key: "audience", label: "Intended Audience" },
        { key: "description", label: "Research Summary" },
      ],
      allowedStatuses: [],
    };
    const proposal = makeTaskProposal();
    proposal.updates = {
      ...proposal.updates,
      type: "CUSTOM",
      sections: [
        { key: "description", content: "Summary content" },
        { key: "undeclared", content: "Do not render" },
        { key: "audience", content: "Product teams" },
      ],
    };

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    const sections = screen.getAllByTestId("task-proposal-section");
    expect(sections.map((section) => section.dataset.sectionKey)).toEqual([
      "audience",
      "description",
    ]);
    expect(sections[0]).toHaveTextContent("Intended AudienceProduct teams");
    expect(sections[1]).toHaveTextContent("Research SummarySummary content");
    expect(screen.queryByText("Do not render")).not.toBeInTheDocument();
  });

  it("uses the project definition name for canonical and custom types", () => {
    registryState.definitions.CUSTOM = {
      key: "CUSTOM",
      name: "Research Brief",
      sections: [],
      allowedStatuses: [],
    };

    const customProposal = makeTaskProposal();
    customProposal.updates = {
      ...customProposal.updates,
      type: "CUSTOM",
    };

    const { rerender } = render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={customProposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Research Brief")).toBeInTheDocument();
    expect(screen.queryByText("CUSTOM")).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={makeTaskProposal()}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Project Task")).toBeInTheDocument();
    expect(useWorkItemTypeByKeyMock).toHaveBeenLastCalledWith(
      ORG_ID,
      PROJ_ID,
      "STANDARD",
    );
  });

  it("labels an archived definition for historical review", () => {
    registryState.definitions.ARCHIVED = {
      key: "ARCHIVED",
      name: "Archived Brief",
      sections: [],
      allowedStatuses: [],
    };

    const proposal = makeTaskProposal();
    proposal.updates = { ...proposal.updates, type: "ARCHIVED" };

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Archived Brief")).toBeInTheDocument();
  });

  it("shows loading, registry error, and unavailable states without a fallback label", () => {
    registryState.isLoading = true;
    const { rerender } = render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={makeTaskProposal()}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId("task-create-work-item-type-loading"),
    ).toBeInTheDocument();

    registryState.isLoading = false;
    registryState.error = new Error("Registry unavailable");
    rerender(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={makeTaskProposal()}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId("task-create-work-item-type-load-error"),
    ).toHaveTextContent("Registry unavailable");

    registryState.error = null;
    delete registryState.definitions.STANDARD;
    rerender(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={makeTaskProposal()}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId("task-create-work-item-type-unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByText("STANDARD")).not.toBeInTheDocument();
    expect(screen.queryByText("Task")).not.toBeInTheDocument();
  });
});

describe("TaskCreateRenderer — Agent Mode availability", () => {
  const defineModeType = () => {
    registryState.definitions.MODE = {
      key: "MODE",
      name: "Project Mode",
      sections: [{ key: "description", label: "Guidance" }],
      allowedStatuses: [],
    };
  };

  it("shows project-wide availability for a mode without Feature dependencies", async () => {
    defineModeType();
    const proposal = makeTaskProposal() as ProposalResponseDto & {
      updates: CreateTaskProposalUpdates;
    };
    proposal.updates = { ...proposal.updates, type: "MODE" };

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Available project-wide"),
    ).toBeInTheDocument();
    expect(getTaskMock).not.toHaveBeenCalled();
  });

  it("resolves declared Feature dependencies and keeps the relationship list", async () => {
    defineModeType();
    const proposal = makeTaskProposal() as ProposalResponseDto & {
      updates: CreateTaskProposalUpdates;
    };
    proposal.updates = { ...proposal.updates, type: "MODE" };
    proposal.edges = [
      {
        targetEntityId: "feature-1",
        targetEntityType: ProposalEdgeTargetType.Task,
        targetEntityTitle: "Reporting",
        edgeType: ProposalEdgeType.DependsOn,
      },
      {
        targetEntityId: "task-1",
        targetEntityType: ProposalEdgeTargetType.Task,
        targetEntityTitle: "Ordinary task",
        edgeType: ProposalEdgeType.DependsOn,
      },
      {
        targetEntityId: "feature-2",
        targetEntityType: ProposalEdgeTargetType.Task,
        targetEntityTitle: "Team Collaboration",
        edgeType: ProposalEdgeType.RelatedTo,
      },
    ];
    getTaskMock.mockImplementation(async ({ taskId }: { taskId: string }) => ({
      data: {
        data:
          taskId === "feature-1"
            ? { id: taskId, name: "Reporting", type: "FEATURE" }
            : { id: taskId, name: "Ordinary task", type: "STANDARD" },
      },
    }));

    render(
      <MemoryRouter>
        <TaskCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
          siblingProposals={new Map()}
        />
      </MemoryRouter>,
    );

    const featureLink = await screen.findByTestId(
      "mode-availability-feature-link",
    );
    expect(featureLink).toHaveTextContent("Reporting");
    expect(featureLink).toHaveAttribute(
      "href",
      `/projects/${PROJ_ID}/features/feature-1`,
    );
    expect(
      screen.getByText("Available in these Features and their descendants:"),
    ).toBeInTheDocument();
    expect(screen.getByText("Relationships")).toBeInTheDocument();
    expect(screen.getByText("relates to")).toBeInTheDocument();
    expect(getTaskMock).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      projectId: PROJ_ID,
      taskId: "feature-1",
    });
    expect(getTaskMock).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      projectId: PROJ_ID,
      taskId: "task-1",
    });
  });
});
