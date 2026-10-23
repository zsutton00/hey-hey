import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EntityType,
  GoalAudience,
  TargetEntityType,
  type ActiveGoalDto,
  type EntityContextDto,
} from "../../../api";
import { InteractionComponent } from "../InteractionComponent";
import type { InteractionComponentProps } from "../types";

// ---------------------------------------------------------------------------
// Hook mocks
// ---------------------------------------------------------------------------

vi.mock("../../../data/hooks/useEntityContext", () => ({
  useEntityContext: vi.fn(),
}));

vi.mock("../../../data/hooks/useEntityStars", () => ({
  useEntityStar: vi.fn(() => ({
    isStarred: false,
    isLoading: false,
    isMutating: false,
    error: null,
    mutationError: null,
    toggle: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockFetchGoals = vi.fn();
const mockUseActiveGoalsResult = {
  data: null as ActiveGoalDto[] | null,
  isLoading: false,
  error: null as string | null,
  fetch: mockFetchGoals,
};

vi.mock("../../../data/hooks/useActiveGoals", () => ({
  useActiveGoals: vi.fn(() => mockUseActiveGoalsResult),
}));

const mockAttach = vi.fn();
const mockUseAttachToGoalResult = {
  attach: mockAttach,
  isLoading: false,
  error: null as string | null,
};

vi.mock("../../../data/hooks/useAttachToGoal", () => ({
  useAttachToGoal: vi.fn(() => mockUseAttachToGoalResult),
}));

const mockWorkItemTypeEligibility = {
  isAllowed: true as boolean | undefined,
  isReady: true,
  isLoading: false,
  error: null as Error | null,
};

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: vi.fn(() => mockWorkItemTypeEligibility),
}));

vi.mock("../useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: vi.fn(() => ({
    launch: vi.fn().mockResolvedValue(true),
    isLoading: false,
    error: null,
  })),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
}));

vi.mock("../../WebUtils/navigateToEntity", () => ({
  navigateToEntity: vi.fn(),
}));

import { useEntityContext } from "../../../data/hooks/useEntityContext";
const mockUseEntityContext = vi.mocked(useEntityContext);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTITY_ID = "task-target-1";
const ENTITY_TYPE = TargetEntityType.Task;
const ORG_ID = "org-1";
const PROJECT_ID = "proj-1";

function buildProps(
  overrides: Partial<InteractionComponentProps> = {},
): InteractionComponentProps {
  return {
    entityId: ENTITY_ID,
    entityType: ENTITY_TYPE,
    hasProposalSupport: true,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    entitySubtype: "STANDARD",
    children: <div data-testid="child-content">Content</div>,
    ...overrides,
  };
}

function buildEntityContext(
  overrides: Partial<EntityContextDto> = {},
): EntityContextDto {
  return {
    entityId: ENTITY_ID,
    entityType: EntityType.Task,
    createdAt: "2026-01-01T00:00:00.000Z",
    proposals: [],
    availableMcpTools: [
      {
        toolName: "attach_to_goal",
        targetEntityType: EntityType.Task,
        label: "Add to Goal...",
        description: "Attach this entity to an active goal",
      },
    ],
    ...overrides,
  };
}

function buildGoal(overrides: Partial<ActiveGoalDto> = {}): ActiveGoalDto {
  return {
    id: "goal-1",
    name: "Ship onboarding",
    dueDate: "2026-06-01T00:00:00.000Z",
    audience: GoalAudience.Project,
    ...overrides,
  };
}

function openMenu() {
  fireEvent.contextMenu(screen.getByTestId("interaction-component"));
}

beforeEach(() => {
  mockFetchGoals.mockReset();
  mockAttach.mockReset();
  mockUseActiveGoalsResult.data = null;
  mockUseActiveGoalsResult.isLoading = false;
  mockUseActiveGoalsResult.error = null;
  mockUseAttachToGoalResult.isLoading = false;
  mockUseAttachToGoalResult.error = null;
  mockWorkItemTypeEligibility.isAllowed = true;
  mockWorkItemTypeEligibility.isReady = true;
  mockWorkItemTypeEligibility.isLoading = false;
  mockWorkItemTypeEligibility.error = null;
  mockUseEntityContext.mockReturnValue({
    data: buildEntityContext(),
    isLoading: false,
    error: null,
    fetch: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InteractionComponent — attach_to_goal menu dispatch", () => {
  it("renders the attach_to_goal menu item from MCP entity context", () => {
    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.getByTestId("interaction-menu-attach_to_goal"),
    ).toBeInTheDocument();
    expect(screen.getByText("Add to Goal...")).toBeInTheDocument();
  });

  it("hides attach_to_goal while registry eligibility is unavailable", () => {
    mockWorkItemTypeEligibility.isAllowed = undefined;
    mockWorkItemTypeEligibility.isReady = false;

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.queryByTestId("interaction-menu-attach_to_goal"),
    ).not.toBeInTheDocument();
  });

  it("hides attach_to_goal when the active registry revokes eligibility", () => {
    mockWorkItemTypeEligibility.isAllowed = false;

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.queryByTestId("interaction-menu-attach_to_goal"),
    ).not.toBeInTheDocument();
  });

  it("uses registry eligibility for a custom type instead of validTaskTypes", () => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        availableMcpTools: [
          {
            toolName: "attach_to_goal",
            targetEntityType: EntityType.Task,
            label: "Add to Goal...",
            description: "Attach this entity to an active goal",
            validTaskTypes: ["STANDARD"],
          },
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(
      <InteractionComponent
        {...buildProps({ entitySubtype: "CUSTOM_DELIVERABLE" })}
      />,
    );
    openMenu();

    expect(
      screen.getByTestId("interaction-menu-attach_to_goal"),
    ).toBeInTheDocument();
  });

  it("clicking attach_to_goal opens the GoalPickerModal and fetches goals", async () => {
    const user = userEvent.setup();
    render(<InteractionComponent {...buildProps()} />);

    openMenu();
    await user.click(screen.getByTestId("interaction-menu-attach_to_goal"));

    expect(screen.getByTestId("goal-picker-modal")).toBeInTheDocument();
    expect(mockFetchGoals).toHaveBeenCalled();
  });

  it("does not forward attach_to_goal to onMenuAction (handled in-component)", async () => {
    const user = userEvent.setup();
    const onMenuAction = vi.fn();
    render(<InteractionComponent {...buildProps({ onMenuAction })} />);

    openMenu();
    await user.click(screen.getByTestId("interaction-menu-attach_to_goal"));

    expect(onMenuAction).not.toHaveBeenCalled();
  });
});

describe("InteractionComponent — contextual menu actions", () => {
  it("renders and dispatches a surface-owned action with the row identity", async () => {
    const user = userEvent.setup();
    const onRemoveFromGoal = vi.fn();
    render(
      <InteractionComponent
        {...buildProps({
          contextualActions: [
            {
              action: "remove_from_goal",
              label: "Remove from goal",
              testId: "interaction-menu-remove-from-goal",
              onSelect: onRemoveFromGoal,
            },
          ],
        })}
      />,
    );

    openMenu();
    await user.click(screen.getByTestId("interaction-menu-remove-from-goal"));

    expect(onRemoveFromGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: ENTITY_ID,
        entityType: ENTITY_TYPE,
      }),
    );
  });
});

describe("GoalPickerModal — list ordering and selection", () => {
  const memberGoal = buildGoal({
    id: "goal-member",
    name: "Members-only OKR",
    audience: GoalAudience.Members,
  });
  const projectGoal = buildGoal({
    id: "goal-project",
    name: "Project-wide goal",
    audience: GoalAudience.Project,
  });

  it("renders goals in the server's order (member-of first) and badges Members audience", async () => {
    const user = userEvent.setup();
    mockUseActiveGoalsResult.data = [memberGoal, projectGoal];

    render(<InteractionComponent {...buildProps()} />);
    openMenu();
    await user.click(screen.getByTestId("interaction-menu-attach_to_goal"));

    const list = screen.getByTestId("goal-picker-list");
    const items = within(list).getAllByRole("button");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute(
      "data-testid",
      `goal-picker-item-${memberGoal.id}`,
    );
    expect(items[1]).toHaveAttribute(
      "data-testid",
      `goal-picker-item-${projectGoal.id}`,
    );
    expect(
      screen.getByTestId(`goal-picker-members-chip-${memberGoal.id}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`goal-picker-members-chip-${projectGoal.id}`),
    ).not.toBeInTheDocument();
  });
});

describe("GoalPickerModal — registry eligibility", () => {
  it("fails closed before opening while the project type snapshot is loading", () => {
    mockWorkItemTypeEligibility.isAllowed = undefined;
    mockWorkItemTypeEligibility.isReady = false;
    mockWorkItemTypeEligibility.isLoading = true;

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.queryByTestId("interaction-menu-attach_to_goal"),
    ).not.toBeInTheDocument();
    expect(mockFetchGoals).not.toHaveBeenCalled();
  });

  it("does not expose or fetch goals for an ineligible work-item type", () => {
    mockWorkItemTypeEligibility.isAllowed = false;

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.queryByTestId("interaction-menu-attach_to_goal"),
    ).not.toBeInTheDocument();
    expect(mockFetchGoals).not.toHaveBeenCalled();
  });
});

describe("GoalPickerModal — confirm flow", () => {
  it("confirming a goal calls attach with the entity as target and closes the modal", async () => {
    const user = userEvent.setup();
    const goal = buildGoal({ id: "goal-pick" });
    mockUseActiveGoalsResult.data = [goal];
    mockAttach.mockResolvedValue({
      edge: {},
      target: {},
      created: true,
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();
    await user.click(screen.getByTestId("interaction-menu-attach_to_goal"));

    await user.click(screen.getByTestId(`goal-picker-item-${goal.id}`));
    await user.click(screen.getByTestId("goal-picker-confirm"));

    expect(mockAttach).toHaveBeenCalledOnce();
    expect(mockAttach).toHaveBeenCalledWith({
      goalId: goal.id,
      targetEntityId: ENTITY_ID,
      targetEntityType: ENTITY_TYPE,
    });

    await waitFor(() => {
      expect(screen.queryByTestId("goal-picker-modal")).not.toBeInTheDocument();
    });
  });

  it("re-confirming an existing goal still closes the modal silently (created=false)", async () => {
    const user = userEvent.setup();
    const goal = buildGoal({ id: "goal-existing" });
    mockUseActiveGoalsResult.data = [goal];
    mockAttach.mockResolvedValue({
      edge: {},
      target: {},
      created: false,
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();
    await user.click(screen.getByTestId("interaction-menu-attach_to_goal"));

    await user.click(screen.getByTestId(`goal-picker-item-${goal.id}`));
    await user.click(screen.getByTestId("goal-picker-confirm"));

    expect(mockAttach).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByTestId("goal-picker-modal")).not.toBeInTheDocument();
    });
  });
});
