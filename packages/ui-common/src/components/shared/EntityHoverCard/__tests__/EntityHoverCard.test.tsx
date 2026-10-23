import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TaskSource,
  TargetEntityType,
  WorkItemTypeRole,
  WorkItemTypeSectionDefinitionKindEnum,
  WorkStatus,
  type AgentSessionDto,
  type MessageResponseDto,
  type ProposalResponseDto,
  type TaskResponseDto,
} from "../../../../api";
import { useEntityDetails } from "../../../../data/hooks/useEntityDetails";
import { useLatestMessage } from "../../../../data/hooks/useLatestMessage";
import { useWorkItemTypeByKey } from "../../../../data/hooks/useWorkItemTypes";
import type { PlanWorkItem } from "../../../../data/plans/canonicalPlan";
import { EntityHoverCard } from "../EntityHoverCard";

vi.mock("../../../SmarterTextAreaCard/MentionBadge", () => ({
  MentionBadgeInner: ({
    mention,
  }: {
    mention: { entityId: string; entityType: string; entityName: string };
  }) => (
    <span
      data-testid="parsed-hover-card-mention"
      data-entity-id={mention.entityId}
      data-entity-type={mention.entityType}
    >
      {mention.entityName}
    </span>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../../data/hooks/useEntityDetails", () => ({
  useEntityDetails: vi.fn(),
}));

vi.mock("../../../../data/hooks/useLatestMessage", () => ({
  useLatestMessage: vi.fn(),
}));

vi.mock("../../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: vi.fn(),
  useMentionWorkItemTypeKey: () => ({ typeKey: undefined, isResolved: true }),
}));

const mockUseEntityDetails = vi.mocked(useEntityDetails);
const mockUseLatestMessage = vi.mocked(useLatestMessage);
const mockUseWorkItemTypeByKey = vi.mocked(useWorkItemTypeByKey);

const buildPlan = (overrides: Partial<PlanWorkItem> = {}): PlanWorkItem => ({
  id: "plan-1",
  name: "Release plan",
  type: "PLAN",
  parentTaskId: "feature-1",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Active,
  source: TaskSource.System,
  childCounts: { total: 0 },
  sections: [
    {
      id: "outcome-section",
      key: "outcome",
      order: 0,
      materializedMarkdown: "Ship the new release flow",
    },
  ],
  ...overrides,
});

const renderCard = (plan: PlanWorkItem) => {
  render(<div data-testid="anchor" />);
  const anchor = screen.getByTestId("anchor");

  mockUseEntityDetails.mockReturnValue({
    data: plan,
    isLoading: false,
    error: null,
  });

  render(
    <EntityHoverCard
      entityId={plan.id}
      entityType="PLAN"
      organizationId={plan.organizationId}
      projectId={plan.projectId}
      anchorEl={anchor}
    />,
  );
};

const buildAgentSession = (
  overrides: Partial<AgentSessionDto> = {},
): AgentSessionDto =>
  ({
    id: "session-1",
    title: "Resolve launch blockers",
    conversationId: "conversation-1",
    status: "IN_PROGRESS",
    type: "CODING",
    provider: "codex",
    ...overrides,
  }) as AgentSessionDto;

const buildProposal = (
  overrides: Partial<ProposalResponseDto> = {},
): ProposalResponseDto => ({
  id: "proposal-1",
  organizationId: "org-1",
  projectId: "project-1",
  type: ProposalType.Single,
  action: ProposalAction.Update,
  status: ProposalStatus.Draft,
  targetEntityId: "task-1",
  targetEntityType: TargetEntityType.Task,
  title: "Clarify proposal mentions",
  updates: {},
  requestorId: "user-1",
  requiredApprovals: 1,
  approvals: [],
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
  ...overrides,
});

const buildMessage = (
  overrides: Partial<MessageResponseDto> = {},
): MessageResponseDto =>
  ({
    id: "message-1",
    projectId: "project-1",
    conversationId: "conversation-1",
    type: "SYSTEM",
    status: "COMPLETED",
    data: { response: "Latest agent update" },
    createdAt: "2026-07-14T00:00:00.000Z",
    awaitingResponse: false,
    ...overrides,
  }) as MessageResponseDto;

const buildTask = (
  overrides: Partial<TaskResponseDto> = {},
): TaskResponseDto => ({
  id: "finding-1",
  name: "Interview synthesis",
  type: "research_finding",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Active,
  source: TaskSource.User,
  sections: [
    {
      id: "section-evidence",
      key: "evidence",
      order: 0,
      materializedMarkdown: "Five customers struggled to find saved views.",
    },
  ],
  ...overrides,
});

const renderAgentSessionCard = (
  session = buildAgentSession(),
  completeHoverDelay = true,
) => {
  render(<div data-testid="anchor" />);
  const anchor = screen.getByTestId("anchor");

  mockUseEntityDetails.mockReturnValue({
    data: session,
    isLoading: false,
    error: null,
  });

  const rendered = render(
    <EntityHoverCard
      entityId={session.id}
      entityType="AGENT_SESSION"
      organizationId="org-1"
      projectId="project-1"
      anchorEl={anchor}
    />,
  );

  if (completeHoverDelay) {
    act(() => {
      vi.advanceTimersByTime(250);
    });
  }

  return rendered;
};

describe("EntityHoverCard plan preview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockUseLatestMessage.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useLatestMessage>);
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: undefined,
      workItemTypeDefinition: undefined,
      isLoading: false,
      isFetching: false,
      isFetched: false,
      isReady: false,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
  });

  it("selects registry-declared markdown content for a custom work item", () => {
    const task = buildTask();
    mockUseEntityDetails.mockReturnValue({
      data: task,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: undefined,
      workItemTypeDefinition: {
        key: "research_finding",
        name: "Research Finding",
        role: WorkItemTypeRole.WorkItem,
        sections: [
          {
            key: "privateData",
            label: "Private data",
            kind: WorkItemTypeSectionDefinitionKindEnum.Json,
          },
          {
            key: "evidence",
            label: "Evidence",
            kind: WorkItemTypeSectionDefinitionKindEnum.Markdown,
          },
        ],
        allowedStatuses: [WorkStatus.Active],
      },
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    render(<div data-testid="task-anchor" />);
    render(
      <EntityHoverCard
        entityId={task.id}
        entityType="task"
        organizationId={task.organizationId}
        projectId={task.projectId}
        anchorEl={screen.getByTestId("task-anchor")}
      />,
    );

    expect(screen.getByText("Interview synthesis")).toBeInTheDocument();
    expect(
      screen.getByText("Five customers struggled to find saved views."),
    ).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  it("renders a scaled, non-interactive thumbnail for a leading HTML/CSS section", () => {
    const task = buildTask({
      sections: [
        {
          id: "section-mockup",
          key: "mockup",
          order: 0,
          materializedMarkdown: JSON.stringify({
            html: "<main>Saved views</main>",
            css: "main { color: red; }",
          }),
        },
        {
          id: "section-evidence",
          key: "evidence",
          order: 1,
          materializedMarkdown: "Five customers struggled to find saved views.",
        },
      ],
    });
    mockUseEntityDetails.mockReturnValue({
      data: task,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: undefined,
      workItemTypeDefinition: {
        key: task.type,
        name: "Mockup",
        role: WorkItemTypeRole.WorkItem,
        sections: [
          {
            key: "mockup",
            label: "Mockup",
            kind: WorkItemTypeSectionDefinitionKindEnum.HtmlCss,
            defaultSizeKey: "panel",
            sizeProfiles: [
              {
                key: "panel",
                label: "Panel",
                breakpoints: [
                  {
                    minContainerWidth: 0,
                    inline: { width: 736, height: 460 },
                    page: { width: 1200, height: 800 },
                  },
                ],
              },
            ],
          },
          {
            key: "evidence",
            label: "Evidence",
            kind: WorkItemTypeSectionDefinitionKindEnum.Markdown,
          },
        ],
        allowedStatuses: [WorkStatus.Active],
      },
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    render(<div data-testid="mockup-anchor" />);
    render(
      <EntityHoverCard
        entityId={task.id}
        entityType="task"
        organizationId={task.organizationId}
        projectId={task.projectId}
        anchorEl={screen.getByTestId("mockup-anchor")}
      />,
    );

    const thumbnail = screen.getByTestId("html-css-section-thumbnail");
    expect(thumbnail).toHaveStyle({ width: "368px", height: "230px" });
    const iframe = screen.getByTitle("Interview synthesis mockup thumbnail");
    expect(iframe).toHaveAttribute("sandbox", "");
    expect(iframe).toHaveStyle({ pointerEvents: "none" });
    expect(
      screen.queryByText("Five customers struggled to find saved views."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("prefers the HTML/CSS section for mockup items even when markdown leads", () => {
    const task = buildTask({
      type: "mockup",
      sections: [
        {
          id: "section-summary",
          key: "summary",
          order: 0,
          materializedMarkdown: "Saved views layout.",
        },
        {
          id: "section-mockup",
          key: "mockup",
          order: 1,
          materializedMarkdown: JSON.stringify({
            html: "<main>Saved views</main>",
            css: "",
          }),
        },
      ],
    });
    mockUseEntityDetails.mockReturnValue({
      data: task,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: undefined,
      workItemTypeDefinition: {
        key: "mockup",
        name: "Mockup",
        role: WorkItemTypeRole.ProjectInfo,
        sections: [
          {
            key: "summary",
            label: "Summary",
            kind: WorkItemTypeSectionDefinitionKindEnum.Markdown,
          },
          {
            key: "mockup",
            label: "Mockup",
            kind: WorkItemTypeSectionDefinitionKindEnum.HtmlCss,
            defaultSizeKey: "panel",
            sizeProfiles: [
              {
                key: "panel",
                label: "Panel",
                breakpoints: [
                  {
                    minContainerWidth: 0,
                    inline: { width: 736, height: 460 },
                    page: { width: 1200, height: 800 },
                  },
                ],
              },
            ],
          },
        ],
        allowedStatuses: [WorkStatus.Active],
      },
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    render(<div data-testid="mockup-type-anchor" />);
    render(
      <EntityHoverCard
        entityId={task.id}
        entityType="task"
        organizationId={task.organizationId}
        projectId={task.projectId}
        anchorEl={screen.getByTestId("mockup-type-anchor")}
      />,
    );

    expect(
      screen.getByTestId("html-css-section-thumbnail"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Saved views layout.")).not.toBeInTheDocument();
  });

  it("keeps the title and status shell when no declared section is supported", () => {
    const task = buildTask();
    mockUseEntityDetails.mockReturnValue({
      data: task,
      isLoading: false,
      error: null,
    });
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: undefined,
      workItemTypeDefinition: {
        key: task.type,
        name: "Research Finding",
        role: WorkItemTypeRole.WorkItem,
        sections: [
          {
            key: "evidence",
            label: "Evidence",
            kind: WorkItemTypeSectionDefinitionKindEnum.Json,
          },
        ],
        allowedStatuses: [WorkStatus.Active],
      },
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    render(<div data-testid="unsupported-anchor" />);
    render(
      <EntityHoverCard
        entityId={task.id}
        entityType="task"
        organizationId={task.organizationId}
        projectId={task.projectId}
        anchorEl={screen.getByTestId("unsupported-anchor")}
      />,
    );

    expect(screen.getByText("Interview synthesis")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(
      screen.queryByText("Five customers struggled to find saved views."),
    ).not.toBeInTheDocument();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("links the title to titleHref and closes on Escape", () => {
    const task = buildTask();
    const onClose = vi.fn();
    mockUseEntityDetails.mockReturnValue({
      data: task,
      isLoading: false,
      error: null,
    });
    render(<div data-testid="linked-anchor" />);
    render(
      <MemoryRouter>
        <EntityHoverCard
          entityId={task.id}
          entityType="task"
          organizationId={task.organizationId}
          projectId={task.projectId}
          anchorEl={screen.getByTestId("linked-anchor")}
          titleHref="/projects/project-1/tasks/task-1"
          onClose={onClose}
          focusOnOpen
        />
      </MemoryRouter>,
    );

    const title = screen.getByRole("link", { name: task.name });
    expect(title).toHaveAttribute("href", "/projects/project-1/tasks/task-1");
    const card = screen.getByTestId("entity-hover-card");
    expect(card).toHaveFocus();
    fireEvent.keyDown(title, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the title as plain text without titleHref", () => {
    const task = buildTask();
    mockUseEntityDetails.mockReturnValue({
      data: task,
      isLoading: false,
      error: null,
    });
    render(<div data-testid="plain-anchor" />);
    render(
      <EntityHoverCard
        entityId={task.id}
        entityType="task"
        organizationId={task.organizationId}
        projectId={task.projectId}
        anchorEl={screen.getByTestId("plain-anchor")}
      />,
    );

    expect(screen.getByText(task.name)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders details for a populated plan", () => {
    renderCard(
      buildPlan({
        childCounts: { total: 1 },
        sections: [
          {
            id: "outcome-section",
            key: "outcome",
            order: 0,
            materializedMarkdown: "Ship the new release flow",
          },
          {
            id: "description-section",
            key: "description",
            order: 1,
            materializedMarkdown: "Coordinate frontend and backend delivery.",
          },
        ],
      }),
    );

    expect(screen.getByText("Release plan")).toBeInTheDocument();
    expect(
      screen.getByText(
        (content) =>
          content.includes("Ship the new release flow") &&
          content.includes("Coordinate frontend and backend delivery."),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("1 stage")).toBeInTheDocument();
    expect(screen.queryByText("common.error")).not.toBeInTheDocument();
  });

  it("parses canonical and protected mentions in entity description prose", () => {
    const canonicalId = "f9f54b4f-1caa-4b20-b23f-42cb942e7ea8";
    const protectedId = "1ae6576e-9954-423f-8338-20a82972c21c";
    renderCard(
      buildPlan({
        sections: [
          {
            id: "outcome-section",
            key: "outcome",
            order: 0,
            materializedMarkdown: `Deliver @[feature:${canonicalId}|Mention nodes]`,
          },
          {
            id: "description-section",
            key: "description",
            order: 1,
            materializedMarkdown: `Preserve @\\[contract:${protectedId}\\|Menu handoff]`,
          },
        ],
      }),
    );

    const mentions = screen.getAllByTestId("parsed-hover-card-mention");
    expect(mentions).toHaveLength(2);
    expect(mentions[0]).toHaveAttribute("data-entity-id", canonicalId);
    expect(mentions[0]).toHaveAttribute("data-entity-type", "feature");
    expect(mentions[1]).toHaveAttribute("data-entity-id", protectedId);
    expect(mentions[1]).toHaveAttribute("data-entity-type", "contract");
  });

  it("renders a readable preview when a plan has sparse details", () => {
    renderCard(
      buildPlan({
        name: "Sparse plan",
        sections: [],
        childCounts: { total: 0 },
      }),
    );

    expect(screen.getByText("Sparse plan")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.queryByText("common.error")).not.toBeInTheDocument();
  });

  it("renders proposal identity and lifecycle details", () => {
    render(<div data-testid="anchor" />);
    mockUseEntityDetails.mockReturnValue({
      data: buildProposal(),
      isLoading: false,
      error: null,
    });

    render(
      <EntityHoverCard
        entityId="proposal-1"
        entityType="PROPOSAL"
        organizationId="org-1"
        projectId="project-1"
        anchorEl={screen.getByTestId("anchor")}
      />,
    );

    expect(screen.getByText("Clarify proposal mentions")).toBeInTheDocument();
    expect(screen.getByText("UPDATE TASK")).toBeInTheDocument();
    expect(screen.getByText("DRAFT")).toBeInTheDocument();
    expect(screen.queryByText("common.error")).not.toBeInTheDocument();
  });

  describe("pending proposal content", () => {
    const mockupDefinition = {
      key: "mockup",
      name: "Mockup",
      role: WorkItemTypeRole.ProjectInfo,
      sections: [
        {
          key: "summary",
          label: "Summary",
          kind: WorkItemTypeSectionDefinitionKindEnum.Markdown,
        },
        {
          key: "mockup",
          label: "Mockup",
          kind: WorkItemTypeSectionDefinitionKindEnum.HtmlCss,
          defaultSizeKey: "panel",
          sizeProfiles: [
            {
              key: "panel",
              label: "Panel",
              breakpoints: [
                {
                  minContainerWidth: 0,
                  inline: { width: 736, height: 460 },
                  page: { width: 1200, height: 800 },
                },
              ],
            },
          ],
        },
      ],
      allowedStatuses: [WorkStatus.Active],
    };

    const renderProposalCard = (proposal: ProposalResponseDto) => {
      mockUseEntityDetails.mockImplementation(({ entityType }) =>
        entityType === "proposal"
          ? { data: proposal, isLoading: false, error: null }
          : { data: null, isLoading: false, error: null },
      );
      mockUseWorkItemTypeByKey.mockImplementation(
        (_organizationId, _projectId, typeKey) => ({
          workItemTypeSummary: undefined,
          workItemTypeDefinition:
            typeKey === "mockup" ? mockupDefinition : undefined,
          isLoading: false,
          isFetching: false,
          isFetched: true,
          isReady: true,
          error: null,
          isStale: false,
          refetch: vi.fn(),
          markStale: vi.fn(),
        }),
      );
      render(<div data-testid="proposal-anchor" />);
      render(
        <EntityHoverCard
          entityId={proposal.id}
          entityType="PROPOSAL"
          organizationId="org-1"
          projectId="project-1"
          anchorEl={screen.getByTestId("proposal-anchor")}
        />,
      );
    };

    it("renders a thumbnail of a pending mockup CREATE proposal with its header", () => {
      renderProposalCard(
        buildProposal({
          action: ProposalAction.Create,
          targetEntityId: "placeholder-target",
          title: "Saved views mockup",
          updates: {
            name: "Saved views mockup",
            type: "mockup",
            sections: [
              { key: "summary", content: "Saved views layout." },
              {
                key: "mockup",
                content: JSON.stringify({
                  html: "<main>Saved views</main>",
                  css: "",
                }),
              },
            ],
          },
        }),
      );

      expect(screen.getByText("Saved views mockup")).toBeInTheDocument();
      expect(screen.getByText("CREATE TASK")).toBeInTheDocument();
      expect(screen.getByText("DRAFT")).toBeInTheDocument();
      expect(
        screen.getByTestId("html-css-section-thumbnail"),
      ).toBeInTheDocument();
      const iframe = screen.getByTitle("Saved views mockup mockup thumbnail");
      expect(iframe).toHaveAttribute("sandbox", "");
      expect(screen.queryByText("Saved views layout.")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("never requests the CREATE proposal's placeholder target ID", () => {
      renderProposalCard(
        buildProposal({
          action: ProposalAction.Create,
          targetEntityId: "placeholder-target",
          updates: {
            name: "Saved views mockup",
            type: "mockup",
            sections: [
              {
                key: "mockup",
                content: JSON.stringify({ html: "<main />", css: "" }),
              },
            ],
          },
        }),
      );

      expect(
        screen.getByTestId("html-css-section-thumbnail"),
      ).toBeInTheDocument();
      expect(
        mockUseEntityDetails.mock.calls.some(
          ([params]) => params.entityId === "placeholder-target",
        ),
      ).toBe(false);
    });

    it("renders only the header for proposals without previewable content", () => {
      renderProposalCard(buildProposal());

      expect(screen.getByText("Clarify proposal mentions")).toBeInTheDocument();
      expect(screen.getByText("UPDATE TASK")).toBeInTheDocument();
      expect(screen.getByText("DRAFT")).toBeInTheDocument();
      expect(
        screen.queryByTestId("html-css-section-thumbnail"),
      ).not.toBeInTheDocument();
    });
  });

  it("renders the latest message for an agent session through the shared latest-message query", () => {
    mockUseLatestMessage.mockReturnValue({
      data: buildMessage({
        data: { response: "Newest response by message recency" },
      }),
      isLoading: false,
      error: null,
    } as ReturnType<typeof useLatestMessage>);

    renderAgentSessionCard();

    expect(mockUseLatestMessage).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "conversation-1",
      { enabled: true },
    );
    expect(screen.getByText("Resolve launch blockers")).toBeInTheDocument();
    const preview = screen.getByTestId(
      "agent-session-hover-card-latest-message",
    );
    expect(preview).toHaveTextContent("Newest response by message recency");
    expect(preview).toHaveAttribute("data-message-type", "system");
  });

  it("renders canonical and protected mention tokens with their complete parsed identity", () => {
    const canonicalId = "f9f54b4f-1caa-4b20-b23f-42cb942e7ea8";
    const protectedId = "1ae6576e-9954-423f-8338-20a82972c21c";
    mockUseLatestMessage.mockReturnValue({
      data: buildMessage({
        data: {
          response:
            `Review @[task:${canonicalId}|Canonical task] and ` +
            `@\\[contract:${protectedId}\\|Protected contract]`,
        },
      }),
      isLoading: false,
      error: null,
    } as ReturnType<typeof useLatestMessage>);

    renderAgentSessionCard();

    const mentions = screen.getAllByTestId("parsed-hover-card-mention");
    expect(mentions).toHaveLength(2);
    expect(mentions[0]).toHaveAttribute("data-entity-id", canonicalId);
    expect(mentions[0]).toHaveAttribute("data-entity-type", "task");
    expect(mentions[0]).toHaveTextContent("Canonical task");
    expect(mentions[1]).toHaveAttribute("data-entity-id", protectedId);
    expect(mentions[1]).toHaveAttribute("data-entity-type", "contract");
    expect(mentions[1]).toHaveTextContent("Protected contract");
  });

  it("keeps the latest-message query disabled until the deliberate-hover threshold", () => {
    renderAgentSessionCard(buildAgentSession(), false);

    const progress = screen.getByTestId(
      "agent-session-hover-card-message-delay",
    );
    expect(screen.getByText("Resolve launch blockers")).toBeInTheDocument();
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    expect(mockUseLatestMessage).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      "conversation-1",
      { enabled: false },
    );

    act(() => {
      vi.advanceTimersByTime(125);
    });

    expect(progress).toHaveAttribute("aria-valuenow", "48");
    expect(mockUseLatestMessage).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      "conversation-1",
      { enabled: false },
    );

    act(() => {
      vi.advanceTimersByTime(125);
    });

    expect(
      screen.queryByTestId("agent-session-hover-card-message-delay"),
    ).not.toBeInTheDocument();
    expect(mockUseLatestMessage).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      "conversation-1",
      { enabled: true },
    );
  });

  it("cancels the pending latest-message transition when the card closes early", () => {
    const { unmount } = renderAgentSessionCard(buildAgentSession(), false);

    act(() => {
      vi.advanceTimersByTime(125);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(125);
    });

    expect(
      mockUseLatestMessage.mock.calls.some(
        ([, , , options]) => options?.enabled === true,
      ),
    ).toBe(false);
  });

  it("renders a structured user message and bounds a long markdown preview", () => {
    const longMessage = `# Latest update\n\n${"details ".repeat(100)}`;
    mockUseLatestMessage.mockReturnValue({
      data: buildMessage({
        type: "USER",
        data: { agentInput: { userMessage: longMessage } },
      }),
      isLoading: false,
      error: null,
    } as ReturnType<typeof useLatestMessage>);

    renderAgentSessionCard();

    const preview = screen.getByTestId(
      "agent-session-hover-card-latest-message",
    );
    expect(preview).toHaveTextContent("Latest update");
    expect(preview).toHaveTextContent("…");
    expect(preview).toHaveAttribute("data-message-type", "user");
  });

  it("keeps agent-session metadata visible while the latest message loads or fails", () => {
    mockUseLatestMessage.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useLatestMessage>);

    const { rerender } = renderAgentSessionCard();

    expect(screen.getByText("Resolve launch blockers")).toBeInTheDocument();
    expect(screen.getByText("Loading latest message…")).toBeInTheDocument();

    mockUseLatestMessage.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error("network unavailable"),
    } as ReturnType<typeof useLatestMessage>);
    rerender(
      <EntityHoverCard
        entityId="session-1"
        entityType="AGENT_SESSION"
        organizationId="org-1"
        projectId="project-1"
        anchorEl={screen.getByTestId("anchor")}
      />,
    );

    expect(screen.getByText("Resolve launch blockers")).toBeInTheDocument();
    expect(screen.getByText("Latest message unavailable")).toBeInTheDocument();
  });

  it("renders an empty-session state without replacing the hover card", () => {
    renderAgentSessionCard();

    expect(screen.getByText("Resolve launch blockers")).toBeInTheDocument();
    expect(screen.getByText("No messages yet")).toBeInTheDocument();
  });

  it("shows the status chip for coding agent sessions", () => {
    renderAgentSessionCard(buildAgentSession());

    expect(screen.getByText("IN_PROGRESS")).toBeInTheDocument();
  });

  it.each(["DAILY_SESSION", "TASK_REFINING"] as const)(
    "hides the status chip for %s agent sessions",
    (type) => {
      renderAgentSessionCard(buildAgentSession({ type }));

      expect(screen.getByText("Resolve launch blockers")).toBeInTheDocument();
      expect(screen.getByText("codex")).toBeInTheDocument();
      expect(screen.queryByText("IN_PROGRESS")).not.toBeInTheDocument();
    },
  );
});
