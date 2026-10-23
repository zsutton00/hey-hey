import React from "react";
import { createPortal } from "react-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InteractionComponent,
  InteractionSurface,
  OpenItemInteractionComponent,
} from "../InteractionComponent";
import type { InteractionComponentProps, OpenItemActions } from "../types";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  EntityType,
  MachineExecutionReadinessState,
  TargetEntityType,
  type AvailableMcpToolDto,
} from "../../../api";
import { PreviewHostProvider } from "../../../contexts/PreviewHostContext";
import { OpenItemLocatorProvider } from "../../../contexts/OpenItemLocatorContext";
import { OPEN_ITEM_INTERACTION_ENTITY_TYPES } from "../entityTypeRegistry";

// ---------------------------------------------------------------------------
// IntersectionObserver mock — immediately reports all observed elements as
// visible so the indicator-corner hook picks "bottom-left".
// ---------------------------------------------------------------------------

class MockIntersectionObserver {
  private callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Stable navigate mock so navigation can be asserted across renders.
const mockNavigate = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => mockNavigate),
}));

vi.mock("../../WebUtils/navigateToEntity", () => ({
  navigateToEntity: vi.fn(),
}));

vi.mock("../../../data/hooks/useEntityContext", () => ({
  useEntityContext: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
    fetch: vi.fn(),
  })),
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

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: vi.fn(() => ({ workItem: undefined })),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: (
    _organizationId: string,
    _projectId: string,
    targetTypeKey: string | undefined,
  ) => ({
    isAllowed: targetTypeKey === "STANDARD",
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: () => ({ workItemTypeSummary: undefined }),
}));

vi.mock("../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: vi.fn(() => ({
    machines: [
      {
        machineId: "machine-1",
        name: "CLI One",
        pairedAt: "2026-01-01T00:00:00.000Z",
        active: true,
        authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
        executionReadiness: MachineExecutionReadinessState.Ready,
        currentControllerEligibility:
          CurrentControllerMachineEligibilityState.Eligible,
        bindings: [],
      },
    ],
  })),
}));

vi.mock("../../../hooks/auth/useRole", () => ({
  useRole: () => ({
    isAuthenticated: true,
    organizationRole: null,
    hasOrganizationRole: () => false,
    isOrganizationOwner: false,
    isOrganizationAdmin: false,
    isOrganizationMember: false,
    isOrganizationViewer: false,
  }),
}));

vi.mock("../../../data/hooks/usePlatformAdminAccess", () => ({
  usePlatformAdminAccess: () => ({ isPlatformAdmin: false, isResolved: true }),
}));

const mockLaunch = vi.fn().mockResolvedValue(true);
const mockClearLaunchError = vi.fn();

vi.mock("../useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: vi.fn(() => ({
    launch: mockLaunch,
    isLoading: false,
    error: null,
    clearError: mockClearLaunchError,
  })),
}));

import { useEntityContext } from "../../../data/hooks/useEntityContext";
import { useWorkItem } from "../../../data/hooks/useWorkItem";
import { useEntityConversationLauncher } from "../useEntityConversationLauncher";

const mockUseEntityContext = vi.mocked(useEntityContext);
const mockUseWorkItem = vi.mocked(useWorkItem);
const mockUseEntityConversationLauncher = vi.mocked(
  useEntityConversationLauncher,
);

vi.mock(
  "../../SmarterTextAreaCard/slashCommands/RichSlashCommandPlugin",
  () => ({
    RichSlashCommandPlugin: () => null,
  }),
);

vi.mock("../../SmarterTextAreaCard/FeatureReferenceDiscoveryPlugin", () => ({
  FeatureReferenceDiscoveryPlugin: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENTITY_ID = "entity-123";
const ENTITY_TYPE = "TASK" as const;

const InlineActionIcon = (): React.ReactElement => (
  <span data-testid="inline-action-icon" />
);

function buildProps(
  overrides: Partial<InteractionComponentProps> = {},
): InteractionComponentProps {
  return {
    entityId: ENTITY_ID,
    entityType: ENTITY_TYPE,
    hasProposalSupport: true,
    organizationId: "org-1",
    projectId: "proj-1",
    children: <div data-testid="child-content">Child</div>,
    ...overrides,
  };
}

function buildOpenItemActions(
  overrides: Partial<OpenItemActions> = {},
): OpenItemActions {
  return {
    pin: { hasTargets: true, onSelect: vi.fn() },
    unpin: { hasTargets: false, onSelect: vi.fn() },
    sort: { direction: "newest", onSelect: vi.fn() },
    activeOnly: { enabled: false, onSelect: vi.fn() },
    onRemoveFromOpen: vi.fn(),
    removeOthers: { hasTargets: true, onSelect: vi.fn() },
    removeAllAbove: { hasTargets: true, onSelect: vi.fn() },
    removeAllBelow: { hasTargets: true, onSelect: vi.fn() },
    removeAll: { hasTargets: true, onSelect: vi.fn() },
    whyOpen: { kind: "add", onSelect: vi.fn() },
    ...overrides,
  };
}

function PortaledContextMenuTarget() {
  return createPortal(
    <div data-testid="portaled-context-menu-target">Portal target</div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Tests: hasProposalSupport=false — inert wrapper branch
// ---------------------------------------------------------------------------

describe("InteractionComponent — hasProposalSupport=false", () => {
  it("renders children inside an inert wrapper", () => {
    render(
      <InteractionComponent {...buildProps({ hasProposalSupport: false })} />,
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.getByTestId("interaction-component")).toBeInTheDocument();
  });

  it("does not render the interaction indicator", () => {
    render(
      <InteractionComponent {...buildProps({ hasProposalSupport: false })} />,
    );

    expect(
      screen.queryByTestId("interaction-indicator"),
    ).not.toBeInTheDocument();
  });

  it("renders the required Preview menu without proposal support", () => {
    const onContextMenuOpen = vi.fn();
    render(
      <InteractionComponent
        {...buildProps({ hasProposalSupport: false, onContextMenuOpen })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();
    expect(screen.getByTestId("interaction-menu-preview")).toBeInTheDocument();
    expect(screen.getByTestId("interaction-menu-discuss")).toBeInTheDocument();
    expect(onContextMenuOpen).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });
  });

  it("sets data-interaction-state to idle", () => {
    render(
      <InteractionComponent {...buildProps({ hasProposalSupport: false })} />,
    );

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "data-interaction-state",
      "idle",
    );
  });

  it("sets data-entity-id and data-entity-type attributes", () => {
    render(
      <InteractionComponent {...buildProps({ hasProposalSupport: false })} />,
    );

    const el = screen.getByTestId("interaction-component");
    expect(el).toHaveAttribute("data-entity-id", ENTITY_ID);
    expect(el).toHaveAttribute("data-entity-type", ENTITY_TYPE);
  });
});

// ---------------------------------------------------------------------------
// Tests: hasProposalSupport=true — interactive branch
// ---------------------------------------------------------------------------

describe("InteractionComponent — hasProposalSupport=true", () => {
  it("renders children and the interaction indicator", () => {
    render(<InteractionComponent {...buildProps()} />);

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.getByTestId("interaction-indicator")).toBeInTheDocument();
  });

  it("renders inline actions and routes them through the exact entity handlers", async () => {
    const user = userEvent.setup();
    const onCreateTask = vi.fn();
    const onCreateBug = vi.fn();
    const inlineActionsFor = (featureId: string) => [
      {
        action: "discuss" as const,
        label: "Discuss",
        testId: `${featureId}-discuss`,
      },
      {
        action: "create_task" as const,
        label: "Add Task",
        onSelect: onCreateTask,
        testId: `${featureId}-create-task`,
      },
      {
        action: "create_bug" as const,
        label: "Add Bug",
        onSelect: onCreateBug,
        testId: `${featureId}-create-bug`,
      },
    ];

    render(
      <>
        <InteractionComponent
          {...buildProps({
            entityId: "feature-one",
            entityTitle: "Feature One",
            inlineActions: inlineActionsFor("feature-one"),
          })}
        />
        <InteractionComponent
          {...buildProps({
            entityId: "feature-two",
            entityTitle: "Feature Two",
            inlineActions: inlineActionsFor("feature-two"),
          })}
        />
      </>,
    );

    expect(screen.getByTestId("feature-two-discuss")).toHaveTextContent(
      "Discuss",
    );
    expect(screen.getByTestId("feature-two-create-task")).toHaveTextContent(
      "Add Task",
    );
    expect(screen.getByTestId("feature-two-create-bug")).toHaveTextContent(
      "Add Bug",
    );

    await user.click(screen.getByTestId("feature-two-discuss"));
    expect(screen.getByText("Feature Two")).toBeInTheDocument();

    await user.click(screen.getByText("Cancel"));
    await user.click(screen.getByTestId("feature-two-create-task"));

    expect(onCreateTask).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("feature-two-create-bug"));

    expect(onCreateBug).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();
  });

  it("renders icon actions as compact accessible buttons", () => {
    render(
      <InteractionComponent
        {...buildProps({
          inlineActions: [
            {
              action: "discuss",
              label: "Discuss",
              icon: InlineActionIcon,
              testId: "icon-discuss",
            },
            {
              action: "create_task",
              label: "Add Task",
              icon: InlineActionIcon,
              testId: "icon-add-task",
            },
            {
              action: "create_bug",
              label: "Add Bug",
              icon: InlineActionIcon,
              testId: "icon-add-bug",
            },
          ],
        })}
      />,
    );

    expect(screen.getByTestId("icon-discuss")).toHaveStyle({
      backgroundColor: "rgb(124, 58, 237)",
      borderRadius: "50%",
    });
    expect(screen.getByTestId("icon-add-task")).toHaveStyle({
      backgroundColor: "rgb(20, 98, 113)",
      borderRadius: "50%",
    });
    const bugButton = screen.getByTestId("icon-add-bug");
    expect(bugButton).toHaveAttribute("aria-label", "Add Bug");
    expect(bugButton).toHaveStyle({
      backgroundColor: "rgb(43, 129, 142)",
      borderRadius: "50%",
    });
    expect(screen.getAllByTestId("inline-action-icon")).toHaveLength(3);
  });

  it("right-click fires onContextMenuOpen with entity context", () => {
    const onContextMenuOpen = vi.fn();
    render(<InteractionComponent {...buildProps({ onContextMenuOpen })} />);

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(onContextMenuOpen).toHaveBeenCalledOnce();
    expect(onContextMenuOpen).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });
  });

  it("single-button ctrl-click opens the menu for the exact entity", () => {
    const onContextMenuOpen = vi.fn();
    render(<InteractionComponent {...buildProps({ onContextMenuOpen })} />);

    fireEvent.contextMenu(screen.getByTestId("interaction-component"), {
      button: 0,
      ctrlKey: true,
      clientX: 24,
      clientY: 36,
    });

    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();
    expect(onContextMenuOpen).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });
  });

  it("renders an inline semantic root when requested", () => {
    render(
      <InteractionComponent {...buildProps({ surfaceLayout: "inline" })} />,
    );

    expect(screen.getByTestId("interaction-component").tagName).toBe("SPAN");
  });

  it("right-click opens the context menu", () => {
    render(<InteractionComponent {...buildProps()} />);

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();
  });

  it("does not open from a portaled descendant and preserves its native context menu", () => {
    const onContextMenuOpen = vi.fn();
    render(
      <InteractionComponent
        {...buildProps({
          onContextMenuOpen,
          children: <PortaledContextMenuTarget />,
        })}
      />,
    );

    const wasNotPrevented = fireEvent.contextMenu(
      screen.getByTestId("portaled-context-menu-target"),
    );

    expect(wasNotPrevented).toBe(true);
    expect(
      screen.queryByTestId("interaction-context-menu"),
    ).not.toBeInTheDocument();
    expect(onContextMenuOpen).not.toHaveBeenCalled();
  });

  it("sets data-interaction-state to menuOpen after right-click", () => {
    render(<InteractionComponent {...buildProps()} />);

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "data-interaction-state",
      "menuOpen",
    );
  });

  it("sets data-interaction-state to hovering on mouse enter", async () => {
    const user = userEvent.setup();
    render(<InteractionComponent {...buildProps()} />);

    await user.hover(screen.getByTestId("interaction-component"));

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "data-interaction-state",
      "hovering",
    );
  });

  it("sets data-interaction-state back to idle on mouse leave", async () => {
    const user = userEvent.setup();
    render(<InteractionComponent {...buildProps()} />);

    await user.hover(screen.getByTestId("interaction-component"));
    await user.unhover(screen.getByTestId("interaction-component"));

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "data-interaction-state",
      "idle",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: keyboard interactions
// ---------------------------------------------------------------------------

describe("InteractionComponent — keyboard interactions", () => {
  it("Enter key opens the context menu and fires onContextMenuOpen", () => {
    const onContextMenuOpen = vi.fn();
    render(<InteractionComponent {...buildProps({ onContextMenuOpen })} />);

    const container = screen.getByTestId("interaction-component");
    fireEvent.keyDown(container, { key: "Enter" });

    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();
    expect(onContextMenuOpen).toHaveBeenCalledOnce();
    expect(onContextMenuOpen).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });
  });

  it("Escape key closes the menu when menu is open", () => {
    render(<InteractionComponent {...buildProps()} />);

    const container = screen.getByTestId("interaction-component");

    // Open the menu first
    fireEvent.contextMenu(container);
    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();

    // Close with Escape
    fireEvent.keyDown(container, { key: "Escape" });

    expect(
      screen.queryByTestId("interaction-context-menu"),
    ).not.toBeInTheDocument();
  });

  it("Escape key does nothing when menu is not open", () => {
    render(<InteractionComponent {...buildProps()} />);

    const container = screen.getByTestId("interaction-component");
    fireEvent.keyDown(container, { key: "Escape" });

    // No error, no menu opened
    expect(
      screen.queryByTestId("interaction-context-menu"),
    ).not.toBeInTheDocument();
  });

  it("keyboard access still opens Preview without proposal support", () => {
    const onContextMenuOpen = vi.fn();
    render(
      <InteractionComponent
        {...buildProps({ hasProposalSupport: false, onContextMenuOpen })}
      />,
    );

    const container = screen.getByTestId("interaction-component");
    fireEvent.keyDown(container, { key: "Enter" });

    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();
    expect(screen.getByTestId("interaction-menu-preview")).toBeInTheDocument();
    expect(onContextMenuOpen).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: menu action callbacks
// ---------------------------------------------------------------------------

describe("InteractionComponent — menu action callbacks", () => {
  const createTaskTool: AvailableMcpToolDto = {
    toolName: "create_task",
    targetEntityType: EntityType.Task,
    label: "Create Task...",
    description: "Propose a new task",
  };

  const unknownTool: AvailableMcpToolDto = {
    toolName: "unknown_future_tool",
    targetEntityType: EntityType.Task,
    label: "Unknown",
    description: "An MCP tool with no registered handler",
  };

  it("discuss action opens DiscussModal and does not call onMenuAction", async () => {
    const onMenuAction = vi.fn();
    const user = userEvent.setup();
    render(<InteractionComponent {...buildProps({ onMenuAction })} />);

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    await user.click(screen.getByTestId("interaction-menu-discuss"));

    expect(screen.getByTestId("discuss-modal")).toBeInTheDocument();
    expect(onMenuAction).not.toHaveBeenCalled();
  });

  it("keeps launch failures in DiscussModal and clears them when the modal closes", async () => {
    mockUseEntityConversationLauncher.mockReturnValue({
      launch: mockLaunch,
      isLoading: false,
      error: {
        code: null,
        message: "Unable to start this conversation",
      },
      clearError: mockClearLaunchError,
    });
    const user = userEvent.setup();
    render(<InteractionComponent {...buildProps()} />);

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.click(screen.getByTestId("interaction-menu-discuss"));

    expect(screen.getByTestId("discuss-modal-submit-error")).toHaveTextContent(
      "Unable to start this conversation",
    );
    expect(
      screen.getByTestId("child-content").parentElement,
    ).not.toHaveTextContent("Unable to start this conversation");

    await user.click(screen.getByText("Cancel"));

    expect(mockClearLaunchError).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();
  });

  it("known MCP toolName opens the machine-resolving discussion flow and does not invoke onMenuAction", async () => {
    const onMenuAction = vi.fn();
    const user = userEvent.setup();
    render(
      <InteractionComponent
        {...buildProps({
          availableTools: [createTaskTool],
          onMenuAction,
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.click(screen.getByTestId("interaction-menu-create_task"));

    expect(screen.getByTestId("discuss-modal")).toBeInTheDocument();
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(onMenuAction).not.toHaveBeenCalled();
  });

  it("unknown MCP toolName logs a warning and does not invoke onMenuAction", async () => {
    const onMenuAction = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <InteractionComponent
        {...buildProps({
          availableTools: [unknownTool],
          onMenuAction,
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.click(
      screen.getByTestId("interaction-menu-unknown_future_tool"),
    );

    expect(warn).toHaveBeenCalledWith(
      "Unhandled MCP tool: unknown_future_tool",
    );
    expect(onMenuAction).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("clicking a menu action closes the context menu", async () => {
    const user = userEvent.setup();
    render(
      <InteractionComponent
        {...buildProps({ availableTools: [createTaskTool] })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();

    await user.click(screen.getByTestId("interaction-menu-create_task"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("interaction-context-menu"),
      ).not.toBeInTheDocument();
    });
  });

  it("onContextMenuOpen fires with correct context when menu is opened via right-click", () => {
    const onContextMenuOpen = vi.fn();
    render(<InteractionComponent {...buildProps({ onContextMenuOpen })} />);

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(onContextMenuOpen).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });
  });
});

describe("InteractionComponent — Preview and Open actions", () => {
  it("hides only Preview when disabled and preserves the other menu actions", async () => {
    const user = userEvent.setup();
    const onContextualAction = vi.fn();
    const createTaskTool: AvailableMcpToolDto = {
      toolName: "create_task",
      targetEntityType: EntityType.Task,
      label: "Create Task...",
      description: "Propose a new task",
    };

    render(
      <InteractionComponent
        {...buildProps({
          disablePreview: true,
          contextualActions: [
            {
              action: "custom_action",
              label: "Custom action",
              testId: "interaction-menu-custom-action",
              onSelect: onContextualAction,
            },
          ],
          availableTools: [createTaskTool],
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(
      screen.queryByTestId("interaction-menu-preview"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("interaction-menu-discuss")).toHaveTextContent(
      "Discuss Task",
    );
    expect(screen.getByTestId("interaction-menu-star")).toBeInTheDocument();
    expect(
      screen.getByTestId("interaction-menu-custom-action"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("interaction-menu-create_task"),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("interaction-menu-custom-action"));
    expect(onContextualAction).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.click(screen.getByTestId("interaction-menu-create_task"));
    expect(screen.getByTestId("discuss-modal")).toBeInTheDocument();
  });

  it("lets typed adapters supply a lightweight custom menu", () => {
    render(
      <InteractionSurface
        entityId={ENTITY_ID}
        entityType={ENTITY_TYPE}
        renderMenu={({ menuRef, closeMenu }) => (
          <div ref={menuRef} data-testid="custom-interaction-menu">
            <button onClick={closeMenu}>Close custom menu</button>
          </div>
        )}
      >
        <div data-testid="child-content">Child</div>
      </InteractionSurface>,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(screen.getByTestId("custom-interaction-menu")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close custom menu" }));
    expect(
      screen.queryByTestId("custom-interaction-menu"),
    ).not.toBeInTheDocument();
  });

  it("does not open a custom menu from a portaled descendant", () => {
    const onContextMenuOpen = vi.fn();
    render(
      <InteractionSurface
        entityId={ENTITY_ID}
        entityType={ENTITY_TYPE}
        onContextMenuOpen={onContextMenuOpen}
        renderMenu={({ menuRef }) => (
          <div ref={menuRef} data-testid="custom-interaction-menu" />
        )}
      >
        <PortaledContextMenuTarget />
      </InteractionSurface>,
    );

    const wasNotPrevented = fireEvent.contextMenu(
      screen.getByTestId("portaled-context-menu-target"),
    );

    expect(wasNotPrevented).toBe(true);
    expect(
      screen.queryByTestId("custom-interaction-menu"),
    ).not.toBeInTheDocument();
    expect(onContextMenuOpen).not.toHaveBeenCalled();
  });

  it("mounts no generic entity, conversation, or work-item detail hooks for Open Items", () => {
    mockUseEntityContext.mockClear();
    mockUseWorkItem.mockClear();
    mockUseEntityConversationLauncher.mockClear();

    render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        entityId={ENTITY_ID}
        entityType={ENTITY_TYPE}
        openItemActions={buildOpenItemActions()}
      >
        <div data-testid="child-content">Child</div>
      </OpenItemInteractionComponent>,
    );
    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(mockUseEntityContext).not.toHaveBeenCalled();
    expect(mockUseWorkItem).not.toHaveBeenCalled();
    expect(mockUseEntityConversationLauncher).not.toHaveBeenCalled();
  });

  it("keeps generic entity context mounted while lazily mounting Discuss behavior", () => {
    mockUseEntityContext.mockClear();
    mockUseWorkItem.mockClear();
    mockUseEntityConversationLauncher.mockClear();

    render(<InteractionComponent {...buildProps()} />, {
      reactStrictMode: false,
    });

    expect(mockUseEntityContext).toHaveBeenCalledTimes(2);
    expect(mockUseWorkItem).not.toHaveBeenCalled();
    expect(mockUseEntityConversationLauncher).not.toHaveBeenCalled();
  });

  it("preserves keyboard menu access and restores focus for Open Items", () => {
    render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        entityId={ENTITY_ID}
        entityType={ENTITY_TYPE}
        openItemActions={buildOpenItemActions()}
      >
        <div data-testid="child-content">Child</div>
      </OpenItemInteractionComponent>,
    );

    const container = screen.getByTestId("interaction-component");
    container.focus();
    fireEvent.keyDown(container, { key: "Enter" });
    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();

    fireEvent.keyDown(container, { key: "Escape" });
    expect(
      screen.queryByTestId("interaction-context-menu"),
    ).not.toBeInTheDocument();
    expect(container).toHaveFocus();
  });

  it("starts selection from the menu and reports menu opening and closing", () => {
    const onSelectItems = vi.fn();
    const onContextMenuOpen = vi.fn();
    const onContextMenuClose = vi.fn();
    render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        entityId={ENTITY_ID}
        entityType={ENTITY_TYPE}
        openItemActions={buildOpenItemActions()}
        onSelectItems={onSelectItems}
        onContextMenuOpen={onContextMenuOpen}
        onContextMenuClose={onContextMenuClose}
      >
        <div>Open item</div>
      </OpenItemInteractionComponent>,
    );
    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(onContextMenuOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("interaction-menu-select-open-items"));
    expect(onSelectItems).toHaveBeenCalledTimes(1);
    expect(onContextMenuClose).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("interaction-context-menu"),
    ).not.toBeInTheDocument();
  });

  it("mounts contributed Discuss behavior only after an Open Item selects it", async () => {
    mockUseWorkItem.mockClear();
    mockUseEntityConversationLauncher.mockClear();
    const user = userEvent.setup();
    render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        entityId={ENTITY_ID}
        entityType={ENTITY_TYPE}
        organizationId="org-1"
        projectId="proj-1"
        openItemActions={buildOpenItemActions()}
      >
        <div>Open item</div>
      </OpenItemInteractionComponent>,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(mockUseWorkItem).not.toHaveBeenCalled();
    expect(mockUseEntityConversationLauncher).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("interaction-menu-discuss"));
    expect(screen.getByTestId("discuss-modal")).toBeInTheDocument();
    expect(mockUseWorkItem).toHaveBeenCalled();
    expect(mockUseEntityConversationLauncher).toHaveBeenCalled();
  });

  it("keeps contributed proposal Discuss on canonical proposal navigation", async () => {
    const user = userEvent.setup();
    mockNavigate.mockClear();
    render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        entityId={ENTITY_ID}
        entityType={EntityType.Proposal}
        organizationId="org-1"
        projectId="proj-1"
        openItemActions={buildOpenItemActions()}
      >
        <div>Proposal</div>
      </OpenItemInteractionComponent>,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.click(screen.getByTestId("interaction-menu-discuss"));
    expect(mockNavigate).toHaveBeenCalledWith(
      `/projects/proj-1/proposals/${ENTITY_ID}?editing=true`,
    );
    expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();
  });

  it.each(Object.values(OPEN_ITEM_INTERACTION_ENTITY_TYPES))(
    "always exposes Preview for supported entity type %s",
    (entityType) => {
      render(<InteractionComponent {...buildProps({ entityType })} />);

      fireEvent.contextMenu(screen.getByTestId("interaction-component"));

      expect(
        screen.getByTestId("interaction-menu-preview"),
      ).toBeInTheDocument();
    },
  );

  it("shows Discuss and Preview immediately for a lowercase work-item mention type", () => {
    render(
      <InteractionComponent
        {...buildProps({ entityType: "feature", entitySubtype: "FEATURE" })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(screen.getByTestId("interaction-menu-discuss")).toHaveTextContent(
      "Discuss Feature",
    );
    expect(screen.getByTestId("interaction-menu-preview")).toBeInTheDocument();
  });

  it("labels a canonical task with its feature subtype", () => {
    render(
      <InteractionComponent
        {...buildProps({
          entityType: TargetEntityType.Task,
          entitySubtype: "FEATURE",
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(screen.getByTestId("interaction-menu-discuss")).toHaveTextContent(
      "Discuss Feature",
    );
  });

  it("opens Preview through the required application host", async () => {
    const openPreview = vi.fn();
    const user = userEvent.setup();
    mockNavigate.mockClear();
    render(
      <PreviewHostProvider host={{ openPreview }}>
        <OpenItemInteractionComponent
          selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
          entityId={ENTITY_ID}
          entityType={TargetEntityType.AgentSession}
          openItemActions={buildOpenItemActions()}
        >
          <div data-testid="child-content">Child</div>
        </OpenItemInteractionComponent>
      </PreviewHostProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.click(screen.getByTestId("interaction-menu-preview"));

    expect(openPreview).toHaveBeenCalledOnce();
    expect(openPreview).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: "agent_session",
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not expose Preview for an explicitly unsupported entity type", () => {
    const openPreview = vi.fn();
    render(
      <PreviewHostProvider host={{ openPreview }}>
        <InteractionComponent
          {...buildProps({ entityType: TargetEntityType.Service })}
        />
      </PreviewHostProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(
      screen.queryByTestId("interaction-menu-preview"),
    ).not.toBeInTheDocument();
  });

  it("never hides Preview when the application host is missing", () => {
    render(
      <InteractionComponent
        {...buildProps({ entityType: TargetEntityType.AgentSession })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(screen.getByTestId("interaction-menu-preview")).toBeInTheDocument();
  });

  it("opens consumer-provided Open actions without proposal support", async () => {
    const onRemoveFromOpen = vi.fn();
    const onAddWhyOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        {...buildProps({ hasProposalSupport: false })}
        openItemActions={buildOpenItemActions({
          onRemoveFromOpen,
          whyOpen: { kind: "add", onSelect: onAddWhyOpen },
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(screen.getByTestId("interaction-menu-discuss")).toHaveTextContent(
      "Discuss Task",
    );
    await user.click(screen.getByTestId("interaction-menu-remove-from-open"));
    expect(onRemoveFromOpen).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(screen.getByTestId("interaction-menu-why-open")).toHaveTextContent(
      "Add note",
    );
    await user.click(screen.getByTestId("interaction-menu-why-open"));
    expect(onAddWhyOpen).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });
  });

  it("dispatches the state-dependent Pin and Unpin actions", async () => {
    const onPin = vi.fn();
    const onUnpin = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        {...buildProps({ hasProposalSupport: false })}
        openItemActions={buildOpenItemActions({
          pin: { hasTargets: true, onSelect: onPin },
          unpin: { hasTargets: false, onSelect: onUnpin },
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(screen.getByTestId("interaction-menu-pin")).toBeInTheDocument();
    expect(
      screen.queryByTestId("interaction-menu-unpin"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByTestId("interaction-menu-pin"));
    expect(onPin).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });

    unmount();
    render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        {...buildProps({ hasProposalSupport: false })}
        openItemActions={buildOpenItemActions({
          pin: { hasTargets: false, onSelect: onPin },
          unpin: { hasTargets: true, onSelect: onUnpin },
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(
      screen.queryByTestId("interaction-menu-pin"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByTestId("interaction-menu-unpin"));
    expect(onUnpin).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });
  });

  it("renders and dispatches the available Open Items sort direction", async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        {...buildProps({ hasProposalSupport: false })}
        openItemActions={buildOpenItemActions({
          sort: { direction: "newest", onSelect: onSort },
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(
      screen.getByTestId("interaction-menu-sort-open-items"),
    ).toHaveTextContent("Sort by newest");
    expect(
      screen
        .getByTestId("interaction-menu-sort-open-items")
        .compareDocumentPosition(
          screen.getByTestId("interaction-menu-remove-from-open"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(screen.getByTestId("interaction-menu-sort-open-items"));
    expect(onSort).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });

    unmount();
    render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        {...buildProps({ hasProposalSupport: false })}
        openItemActions={buildOpenItemActions({
          sort: { direction: "oldest", onSelect: onSort },
        })}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(
      screen.getByTestId("interaction-menu-sort-open-items"),
    ).toHaveTextContent("Sort by oldest");
  });

  it("renders the active-only action as a checked Open Items filter", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        {...buildProps({ hasProposalSupport: false })}
        openItemActions={buildOpenItemActions({
          activeOnly: { enabled: false, onSelect: onToggle },
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    const activeOnly = screen.getByRole("menuitemcheckbox", {
      name: "Show active only",
    });
    expect(activeOnly).toHaveAttribute("aria-checked", "false");
    await user.click(activeOnly);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        {...buildProps({ hasProposalSupport: false })}
        openItemActions={buildOpenItemActions({
          activeOnly: { enabled: true, onSelect: onToggle },
        })}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Show all items" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("adds or removes selected Open Items through the top-level group action", async () => {
    const onAssign = vi.fn().mockResolvedValue(true);
    const onCreate = vi.fn().mockResolvedValue(true);
    const onUngroup = vi.fn();
    const selectedIdentities = [
      { entityId: ENTITY_ID, entityType: ENTITY_TYPE },
      { entityId: "entity-456", entityType: ENTITY_TYPE },
    ];
    const user = userEvent.setup();
    const { rerender } = render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities, onRemoveSelected: vi.fn() }}
        {...buildProps({ hasProposalSupport: false })}
        openItemActions={buildOpenItemActions()}
        openItemGroupActions={{
          groups: [
            { id: "group-current", name: "Current" },
            { id: "group-next", name: "Next" },
          ],
          onAssign,
          onCreate,
          onUngroup,
        }}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    const addToGroup = screen.getByTestId("interaction-menu-add-to-group");
    expect(addToGroup).toBeInTheDocument();
    expect(addToGroup).toHaveTextContent("Add items to group");
    expect(addToGroup).toHaveAttribute("aria-haspopup", "menu");
    await user.hover(addToGroup);
    await user.click(screen.getByTestId("interaction-menu-group-group-next"));
    expect(onAssign).toHaveBeenCalledWith("group-next", selectedIdentities, {
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });
    expect(
      screen.queryByTestId("open-item-group-submit"),
    ).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.hover(screen.getByTestId("interaction-menu-add-to-group"));
    await user.click(screen.getByTestId("interaction-menu-group-add-new"));
    expect(screen.getByLabelText("Group name")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    const reopenedAddToGroup = screen.getByTestId(
      "interaction-menu-add-to-group",
    );
    expect(
      within(screen.getByTestId("interaction-context-menu")).getAllByRole(
        "menuitem",
      )[0],
    ).toBe(reopenedAddToGroup);
    expect(
      screen.getAllByRole("menuitem").indexOf(reopenedAddToGroup),
    ).toBeLessThan(
      screen
        .getAllByRole("menuitem")
        .indexOf(screen.getByTestId("interaction-menu-why-open")),
    );

    await user.click(reopenedAddToGroup);
    await user.click(screen.getByRole("combobox", { name: "Group" }));
    await user.click(screen.getByRole("option", { name: "Next" }));
    await user.click(screen.getByTestId("open-item-group-submit"));
    expect(onAssign).toHaveBeenCalledWith("group-next", selectedIdentities, {
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.click(screen.getByTestId("interaction-menu-add-to-group"));
    await user.type(screen.getByLabelText("Group name"), "  Shared work  ");
    await waitFor(() =>
      expect(screen.getByTestId("open-item-group-submit")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("open-item-group-submit"));
    expect(onCreate).toHaveBeenCalledWith("Shared work", selectedIdentities, {
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });

    rerender(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities, onRemoveSelected: vi.fn() }}
        {...buildProps({ hasProposalSupport: false })}
        openItemActions={buildOpenItemActions()}
        openItemGroupActions={{
          groups: [
            { id: "group-current", name: "Current" },
            { id: "group-next", name: "Next" },
          ],
          currentGroupId: "group-current",
          onAssign,
          onCreate,
          onUngroup,
        }}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    const removeFromGroup = screen.getByTestId(
      "interaction-menu-remove-from-group",
    );
    const removeFromOpen = screen.getByTestId(
      "interaction-menu-remove-from-open",
    );
    expect(removeFromGroup).toHaveTextContent("Remove items from group");
    expect(
      removeFromGroup.compareDocumentPosition(removeFromOpen) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const moveToGroup = screen.getByTestId("interaction-menu-add-to-group");
    expect(moveToGroup).toHaveTextContent("Move items to group");
    await user.hover(moveToGroup);
    expect(
      screen.queryByTestId("interaction-menu-group-group-current"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByTestId("interaction-menu-group-group-next"));
    expect(onAssign).toHaveBeenLastCalledWith(
      "group-next",
      selectedIdentities,
      {
        entityId: ENTITY_ID,
        entityType: ENTITY_TYPE,
      },
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.click(screen.getByTestId("interaction-menu-remove-from-group"));
    expect(onUngroup).toHaveBeenCalledWith(selectedIdentities, {
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });
  });

  it("omits Select items while the row is already in selection mode", () => {
    render(
      <OpenItemInteractionComponent
        selectionMode
        selection={{
          selectedIdentities: [
            { entityId: ENTITY_ID, entityType: ENTITY_TYPE },
          ],
          onRemoveSelected: vi.fn(),
        }}
        entityId={ENTITY_ID}
        entityType={ENTITY_TYPE}
        openItemActions={buildOpenItemActions()}
      >
        <div>Open item</div>
      </OpenItemInteractionComponent>,
    );
    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(
      screen.queryByTestId("interaction-menu-select-open-items"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("interaction-menu-remove-from-open"),
    ).toBeInTheDocument();
  });

  it("renders the edit variant when a why-open note already exists", () => {
    render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        {...buildProps()}
        openItemActions={buildOpenItemActions({
          onRemoveFromOpen: vi.fn(),
          whyOpen: { kind: "edit", onSelect: vi.fn() },
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(screen.getByTestId("interaction-menu-why-open")).toHaveTextContent(
      "Edit note",
    );
    expect(screen.getByTestId("interaction-menu-why-open")).toHaveAttribute(
      "data-menu-action",
      "edit_why_open",
    );
  });

  it("keeps hover and native anchor clicks observational", async () => {
    const openPreview = vi.fn();
    const onRemoveFromOpen = vi.fn();
    const onEditWhyOpen = vi.fn();
    const onLinkClick = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
    });
    const user = userEvent.setup();
    render(
      <PreviewHostProvider host={{ openPreview }}>
        <OpenItemInteractionComponent
          selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
          {...buildProps({
            entityType: TargetEntityType.AgentSession,
            children: (
              <a
                data-testid="open-item-link"
                href="/projects/proj-1/sessions/one"
                onClick={onLinkClick}
              >
                Open item
              </a>
            ),
          })}
          openItemActions={buildOpenItemActions({
            onRemoveFromOpen,
            whyOpen: { kind: "edit", onSelect: onEditWhyOpen },
          })}
        />
      </PreviewHostProvider>,
    );

    await user.hover(screen.getByTestId("interaction-component"));
    expect(openPreview).not.toHaveBeenCalled();
    expect(onRemoveFromOpen).not.toHaveBeenCalled();
    expect(onEditWhyOpen).not.toHaveBeenCalled();

    const link = screen.getByTestId("open-item-link");
    expect(link).toHaveAttribute("href", "/projects/proj-1/sessions/one");
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(true);
    expect(
      screen.queryByTestId("interaction-context-menu"),
    ).not.toBeInTheDocument();
    fireEvent.click(link, { metaKey: true });
    expect(onLinkClick).toHaveBeenCalledOnce();
    expect(onLinkClick.mock.calls[0]?.[0].metaKey).toBe(true);
    expect(openPreview).not.toHaveBeenCalled();
    expect(onRemoveFromOpen).not.toHaveBeenCalled();
    expect(onEditWhyOpen).not.toHaveBeenCalled();
  });

  it("renders and dispatches Open Items bulk removal actions with targets", async () => {
    const onRemoveOthers = vi.fn();
    const onRemoveAllAbove = vi.fn();
    const onRemoveAllBelow = vi.fn();
    const onRemoveAll = vi.fn();
    const user = userEvent.setup();
    render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        {...buildProps({ hasProposalSupport: false })}
        openItemActions={buildOpenItemActions({
          removeOthers: { hasTargets: true, onSelect: onRemoveOthers },
          removeAllAbove: { hasTargets: true, onSelect: onRemoveAllAbove },
          removeAllBelow: { hasTargets: true, onSelect: onRemoveAllBelow },
          removeAll: { hasTargets: true, onSelect: onRemoveAll },
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    await user.click(screen.getByTestId("interaction-menu-remove-open-others"));
    expect(onRemoveOthers).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.click(screen.getByTestId("interaction-menu-remove-open-above"));
    expect(onRemoveAllAbove).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.click(screen.getByTestId("interaction-menu-remove-open-below"));
    expect(onRemoveAllBelow).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.click(screen.getByTestId("interaction-menu-remove-all-open"));
    expect(onRemoveAll).toHaveBeenCalledWith({
      entityId: ENTITY_ID,
      entityType: ENTITY_TYPE,
    });
  });

  it("omits Open Items bulk removal actions without targets", () => {
    render(
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        {...buildProps({ hasProposalSupport: false })}
        openItemActions={buildOpenItemActions({
          removeOthers: { hasTargets: false, onSelect: vi.fn() },
          removeAllAbove: { hasTargets: false, onSelect: vi.fn() },
          removeAllBelow: { hasTargets: false, onSelect: vi.fn() },
          removeAll: { hasTargets: false, onSelect: vi.fn() },
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(
      screen.queryByTestId("interaction-menu-remove-open-others"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("interaction-menu-remove-open-above"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("interaction-menu-remove-open-below"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("interaction-menu-remove-all-open"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: Discuss routing by entity type
// ---------------------------------------------------------------------------

describe("InteractionComponent — Discuss routing", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it("Discuss on a PROPOSAL entity navigates to the proposal detail page in edit mode", async () => {
    const user = userEvent.setup();
    render(
      <InteractionComponent
        {...buildProps({ entityType: EntityType.Proposal })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(screen.getByTestId("interaction-menu-discuss")).toHaveTextContent(
      "Discuss Proposal",
    );
    await user.click(screen.getByTestId("interaction-menu-discuss"));

    expect(mockNavigate).toHaveBeenCalledWith(
      `/projects/proj-1/proposals/${ENTITY_ID}?editing=true`,
    );
    expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();
  });

  it("Discuss on a non-proposal entity opens the DiscussModal and does not navigate", async () => {
    const user = userEvent.setup();
    render(<InteractionComponent {...buildProps()} />);

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(screen.getByTestId("interaction-menu-discuss")).toHaveTextContent(
      "Discuss Task",
    );
    await user.click(screen.getByTestId("interaction-menu-discuss"));

    expect(screen.getByTestId("discuss-modal")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders the labeled Discuss action above MCP-derived items", () => {
    const createTaskTool: AvailableMcpToolDto = {
      toolName: "create_task",
      targetEntityType: EntityType.Task,
      label: "Create Task...",
      description: "Propose a new task",
    };
    render(
      <InteractionComponent
        {...buildProps({ availableTools: [createTaskTool] })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    const menuItems = screen.getAllByRole("menuitem");
    expect(
      menuItems.indexOf(screen.getByTestId("interaction-menu-discuss")),
    ).toBeLessThan(
      menuItems.indexOf(screen.getByTestId("interaction-menu-create_task")),
    );
  });
});

describe("InteractionComponent — registry tracking eligibility", () => {
  const attachToGoalTool: AvailableMcpToolDto = {
    toolName: "attach_to_goal",
    targetEntityType: EntityType.Task,
    label: "Add to Goal...",
    description: "Attach this task to a goal",
    validTaskTypes: ["STANDARD", "BUG", "FEATURE"],
  };

  it("omits attach_to_goal when entitySubtype is GOAL", () => {
    render(
      <InteractionComponent
        {...buildProps({
          availableTools: [attachToGoalTool],
          entitySubtype: "GOAL",
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(
      screen.queryByTestId("interaction-menu-attach_to_goal"),
    ).not.toBeInTheDocument();
  });

  it("surfaces attach_to_goal for a STANDARD task", () => {
    render(
      <InteractionComponent
        {...buildProps({
          availableTools: [attachToGoalTool],
          entitySubtype: "STANDARD",
        })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(
      screen.getByTestId("interaction-menu-attach_to_goal"),
    ).toBeInTheDocument();
  });

  it("fails closed when the target subtype is unavailable", () => {
    const unconstrained: AvailableMcpToolDto = {
      ...attachToGoalTool,
      validTaskTypes: undefined,
    };
    render(
      <InteractionComponent
        {...buildProps({ availableTools: [unconstrained] })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(
      screen.queryByTestId("interaction-menu-attach_to_goal"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: outside click closes menu
// ---------------------------------------------------------------------------

describe("InteractionComponent — outside click", () => {
  it("clicking outside the component closes the menu", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <InteractionComponent {...buildProps()} />
        <button data-testid="outside-button">Outside</button>
      </div>,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();

    await user.click(screen.getByTestId("outside-button"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("interaction-context-menu"),
      ).not.toBeInTheDocument();
    });
  });
});

it("passes the complete applicable selection to the Open Items bulk owner", () => {
  const selectedIdentities = [
    { entityId: "one", entityType: "task" },
    { entityId: "two", entityType: "design_doc" },
  ];
  const onRemoveSelected = vi.fn();
  render(
    <OpenItemInteractionComponent
      entityId={ENTITY_ID}
      entityType={ENTITY_TYPE}
      draggable={false}
      openItemActions={buildOpenItemActions()}
      selection={{ selectedIdentities, onRemoveSelected }}
    >
      <div>Selected row</div>
    </OpenItemInteractionComponent>,
  );
  fireEvent.contextMenu(screen.getByTestId("interaction-component"));
  const removeItems = screen.getByTestId("interaction-menu-remove-from-open");
  expect(removeItems).toHaveTextContent("Remove items from Open");
  expect(removeItems).toHaveAttribute(
    "data-menu-action",
    "remove_selected_open",
  );
  expect(
    screen.queryByTestId("interaction-menu-remove-selected-open"),
  ).not.toBeInTheDocument();
  fireEvent.click(removeItems);
  expect(onRemoveSelected).toHaveBeenCalledWith(selectedIdentities);
});

describe("InteractionComponent — Show in open items", () => {
  it("shows the action when a locator is mounted and preview is supported", () => {
    render(
      <OpenItemLocatorProvider locator={{ showInOpenItems: vi.fn() }}>
        <InteractionComponent
          {...buildProps({ entityType: TargetEntityType.AgentSession })}
        />
      </OpenItemLocatorProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(
      screen.getByTestId("interaction-menu-show-in-open-items"),
    ).toBeInTheDocument();
  });

  it("omits the action when no locator is mounted", () => {
    render(
      <InteractionComponent
        {...buildProps({ entityType: TargetEntityType.AgentSession })}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(screen.getByTestId("interaction-menu-preview")).toBeInTheDocument();
    expect(
      screen.queryByTestId("interaction-menu-show-in-open-items"),
    ).not.toBeInTheDocument();
  });

  it("omits the action for an explicitly unsupported entity type", () => {
    render(
      <OpenItemLocatorProvider locator={{ showInOpenItems: vi.fn() }}>
        <InteractionComponent
          {...buildProps({ entityType: TargetEntityType.Service })}
        />
      </OpenItemLocatorProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(
      screen.queryByTestId("interaction-menu-show-in-open-items"),
    ).not.toBeInTheDocument();
  });

  it("calls the locator with the entity, label and task subtype", async () => {
    const showInOpenItems = vi.fn();
    const user = userEvent.setup();
    render(
      <OpenItemLocatorProvider locator={{ showInOpenItems }}>
        <InteractionComponent
          {...buildProps({
            entityType: TargetEntityType.Task,
            entityTitle: "Checkout flow",
            entitySubtype: "FEATURE",
          })}
        />
      </OpenItemLocatorProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    await user.click(screen.getByTestId("interaction-menu-show-in-open-items"));

    expect(showInOpenItems).toHaveBeenCalledOnce();
    expect(showInOpenItems).toHaveBeenCalledWith({
      entity: { entityType: "task", entityId: ENTITY_ID },
      label: "Checkout flow",
      taskType: "FEATURE",
    });
  });
});
