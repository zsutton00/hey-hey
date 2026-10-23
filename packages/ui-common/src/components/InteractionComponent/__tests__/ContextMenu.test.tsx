import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeProvider } from "@mui/material/styles";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  EntityType,
  TargetEntityType,
} from "../../../api";
import type {
  EntityContextDto,
  ProposalResponseDto,
  Influence,
} from "../../../api";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";
import {
  InteractionComponent,
  OpenItemInteractionComponent,
} from "../InteractionComponent";
import { PreviewHostProvider } from "../../../contexts/PreviewHostContext";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import type { InteractionComponentProps } from "../types";
import type { DiscussModalSubmitInput } from "../DiscussModal";
import { ContextMenu } from "../ContextMenu";

// ---------------------------------------------------------------------------
// Module mocks
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

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: vi.fn(() => ({ workItem: undefined })),
}));

const mockGetEntityNames = vi.fn().mockResolvedValue({ data: [] });

vi.mock("../../../clients/serviceClients", async () => {
  const actual = await vi.importActual<
    typeof import("../../../clients/serviceClients")
  >("../../../clients/serviceClients");
  return {
    ...actual,
    entitiesClient: {
      getEntityNames: (...args: unknown[]) => mockGetEntityNames(...args),
    },
  };
});

const mockLaunch = vi.fn().mockResolvedValue(true);

vi.mock("../useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: vi.fn(() => ({
    launch: mockLaunch,
    isLoading: false,
    error: null,
  })),
}));

const mockNavigate = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => mockNavigate),
}));

vi.mock("../../WebUtils/navigateToEntity", () => ({
  navigateToEntity: vi.fn(),
}));

vi.mock("../DiscussModal", () => ({
  DiscussModal: ({
    open,
    onClose,
    onSubmit,
    isLoading,
  }: {
    open: boolean;
    onClose: () => void;
    onSubmit: (submission: DiscussModalSubmitInput) => void;
    isLoading?: boolean;
    entityTitle?: string;
    organizationId?: string;
    projectId?: string;
  }) => {
    if (!open) return null;
    const [prompt, setPrompt] = React.useState("");
    return (
      <div data-testid="discuss-modal">
        <input
          role="textbox"
          value={prompt}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setPrompt(e.target.value)
          }
        />
        <button
          data-testid="discuss-modal-submit"
          disabled={isLoading || prompt.trim().length === 0}
          onClick={() =>
            onSubmit({
              prompt: prompt.trim(),
              provider: ConversationStartRunRequestDtoProviderEnum.Claude,
              model: null,
              reasoningEffort: null,
              machineId: "machine-context-menu",
            })
          }
        >
          Ask with context
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    );
  },
}));

// Import after vi.mock so we get the mocked version (hoisting applies).
import { useEntityContext } from "../../../data/hooks/useEntityContext";
import { navigateToEntity } from "../../WebUtils/navigateToEntity";
const mockUseEntityContext = vi.mocked(useEntityContext);
const mockNavigateToEntity = vi.mocked(navigateToEntity);

describe("ContextMenu — contribution submenu", () => {
  it("keeps the parent action and supports pointer and keyboard travel", async () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu
      position={{ x: 20, y: 20 }}
      contributions={[{ id: "groups", section: "primary", order: 0, items: [{
        action: "add", label: "Add to group", testId: "parent",
        submenu: [{ action: "group-one", label: "One", testId: "child" }],
      }] }]}
      onAction={onAction}
      onClose={onClose}
      onViewHistory={vi.fn()}
      onNavigateToEntity={vi.fn()}
      onNavigateToConversation={vi.fn()}
    />);
    const parent = screen.getByTestId("parent");
    expect(parent).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.getByTestId("interaction-menu-submenu-arrow")).toBeInTheDocument();
    await user.hover(parent);
    expect(screen.getByTestId("child")).toBeInTheDocument();
    await user.hover(screen.getByTestId("child"));
    expect(screen.getByTestId("child")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("child"), { key: "Escape" });
    expect(screen.queryByTestId("child")).not.toBeInTheDocument();
    expect(parent).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(parent, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("child")).toHaveFocus());
    await user.click(screen.getByTestId("child"));
    expect(onAction).toHaveBeenCalledWith("group-one");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has no arrow when there are no child entries", () => {
    render(<ContextMenu
      position={{ x: 20, y: 20 }}
      contributions={[{ id: "groups", section: "primary", order: 0, items: [{ action: "add", label: "Add to group" }] }]}
      onAction={vi.fn()}
      onClose={vi.fn()}
      onViewHistory={vi.fn()}
      onNavigateToEntity={vi.fn()}
      onNavigateToConversation={vi.fn()}
    />);
    expect(screen.queryByTestId("interaction-menu-submenu-arrow")).not.toBeInTheDocument();
    expect(screen.queryByTestId("interaction-submenu")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ENTITY_ID = "task-abc";
const ENTITY_TYPE = TargetEntityType.Task;
const ORG_ID = "org-1";
const PROJECT_ID = "proj-1";
const CREATED_AT = "2026-01-15T10:00:00.000Z";

function buildProps(
  overrides: Partial<InteractionComponentProps> = {}
): InteractionComponentProps {
  return {
    entityId: ENTITY_ID,
    entityType: ENTITY_TYPE,
    hasProposalSupport: true,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    children: <div data-testid="child-content">Content</div>,
    ...overrides,
  };
}

function buildInfluence(overrides: Partial<Influence> = {}): Influence {
  return {
    entityId: "influencer-1",
    entityType: EntityType.DesignDoc,
    reasoning: "This design document shaped the task scope",
    reasonType: "explicit_mention",
    ...overrides,
  };
}

function buildOriginInfluence(overrides: Partial<Influence> = {}): Influence {
  return buildInfluence({
    entityId: "origin-task-1",
    entityType: EntityType.Task,
    reasoning: "Authoring tool was invoked from this task",
    reasonType: "origin",
    ...overrides,
  });
}

function buildProposal(
  overrides: Partial<ProposalResponseDto> = {}
): ProposalResponseDto {
  return {
    id: "proposal-1",
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Approved,
    targetEntityId: ENTITY_ID,
    targetEntityType: TargetEntityType.Task,
    updates: {},
    requestorId: "user-1",
    influences: [],
    approvals: [],
    conversationId: "conv-1",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function buildEntityContext(
  overrides: Partial<EntityContextDto> = {}
): EntityContextDto {
  return {
    entityId: ENTITY_ID,
    entityType: EntityType.Task,
    createdAt: CREATED_AT,
    proposals: [],
    availableMcpTools: [],
    ...overrides,
  };
}

function openMenu() {
  fireEvent.contextMenu(screen.getByTestId("interaction-component"));
}

// ---------------------------------------------------------------------------
// Tests: loading state
// ---------------------------------------------------------------------------

describe("ContextMenu — loading state", () => {
  beforeEach(() => {
    mockUseEntityContext.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      fetch: vi.fn(),
    });
  });

  it("shows loading text while entity context is in flight", () => {
    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(screen.getByText("Loading context...")).toBeInTheDocument();
  });

  it("does not render the provenance summary while loading", () => {
    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(screen.queryByTestId("provenance-summary")).not.toBeInTheDocument();
  });

  it("does not render View All History while loading", () => {
    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.queryByTestId("interaction-menu-view-all-history")
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: empty proposals — render nothing in the provenance region
// ---------------------------------------------------------------------------

describe("ContextMenu — empty proposals", () => {
  beforeEach(() => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({ proposals: [] }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });
  });

  it("renders neither the summary nor View All History", () => {
    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(screen.queryByTestId("provenance-summary")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("interaction-menu-view-all-history")
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: removed UI no longer renders
// ---------------------------------------------------------------------------

describe("ContextMenu — removed legacy UI", () => {
  it("does not render the standalone View History menu item", () => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({ proposals: [buildProposal()] }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.queryByTestId("interaction-menu-view-history")
    ).not.toBeInTheDocument();
  });

  it("does not render the 'Created — by user/system' footer", () => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [buildProposal({ influences: [buildOriginInfluence()] })],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(screen.queryByText(/by user/)).not.toBeInTheDocument();
    expect(screen.queryByText(/by system/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: Created block — only-CREATE case
// ---------------------------------------------------------------------------

describe("ContextMenu — Created block (only CREATE)", () => {
  beforeEach(() => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [
          buildProposal({
            id: "create-1",
            action: ProposalAction.Create,
            conversationId: "conv-create",
            influences: [buildOriginInfluence()],
          }),
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });
  });

  it("renders the Created row with both source-entity and conversation links", () => {
    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    const row = screen.getByTestId("provenance-created");
    expect(row).toBeInTheDocument();
    expect(row).toHaveTextContent(/via/);
    expect(row).toHaveTextContent(/about/);
    expect(row).toHaveTextContent(/Task/);

    const entityLink = screen.getByTestId("provenance-created-entity-link");
    expect(entityLink).toHaveTextContent("Task");
    expect(entityLink.tagName).toBe("BUTTON");

    const conversationLink = screen.getByTestId(
      "provenance-created-conversation-link"
    );
    expect(conversationLink).toHaveTextContent("Conversation");
    expect(conversationLink.tagName).toBe("BUTTON");
  });

  it("does not render the Last Updated row when no UPDATE proposal exists", () => {
    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.queryByTestId("provenance-last-updated")
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: Last Updated picks the most recent UPDATE
// ---------------------------------------------------------------------------

describe("ContextMenu — Last Updated picks the most recent UPDATE", () => {
  it("uses the most recent APPROVED UPDATE for Last Updated", async () => {
    const user = userEvent.setup();

    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [
          buildProposal({
            id: "create-1",
            action: ProposalAction.Create,
            conversationId: "conv-create",
            createdAt: "2026-01-01T00:00:00.000Z",
            influences: [buildOriginInfluence({ entityId: "origin-create" })],
          }),
          buildProposal({
            id: "update-old",
            action: ProposalAction.Update,
            conversationId: "conv-update-old",
            createdAt: "2026-02-01T00:00:00.000Z",
            influences: [
              buildOriginInfluence({ entityId: "origin-update-old" }),
            ],
          }),
          buildProposal({
            id: "update-new",
            action: ProposalAction.Update,
            conversationId: "conv-update-new",
            createdAt: "2026-03-01T00:00:00.000Z",
            influences: [
              buildOriginInfluence({
                entityId: "origin-update-new",
                entityType: EntityType.Task,
              }),
            ],
          }),
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(screen.getByTestId("provenance-created")).toBeInTheDocument();
    expect(screen.getByTestId("provenance-last-updated")).toBeInTheDocument();

    // Conversation link on the Last Updated row should route to the most
    // recent UPDATE proposal's conversation.
    await user.click(
      screen.getByTestId("provenance-last-updated-conversation-link")
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining("conv-update-new")
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: missing origin influence → conversation-only row
// ---------------------------------------------------------------------------

describe("ContextMenu — missing origin influence", () => {
  it("renders the conversation link but omits the entity link, with no error", () => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [
          buildProposal({
            id: "create-1",
            action: ProposalAction.Create,
            conversationId: "conv-create",
            influences: [],
          }),
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.queryByTestId("provenance-created-entity-link")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("provenance-created-entity-text")
    ).not.toBeInTheDocument();

    const conversationLink = screen.getByTestId(
      "provenance-created-conversation-link"
    );
    expect(conversationLink).toHaveTextContent("Conversation");

    const row = screen.getByTestId("provenance-created");
    expect(row).toHaveTextContent("via Conversation");
    expect(row.textContent ?? "").not.toMatch(/about/);
  });
});

// ---------------------------------------------------------------------------
// Tests: navigation handlers
// ---------------------------------------------------------------------------

describe("ContextMenu — provenance navigation", () => {
  beforeEach(() => {
    mockNavigateToEntity.mockReset();
    mockNavigate.mockReset();
  });

  it("clicking the entity link calls navigateToEntity for the origin entity", async () => {
    const user = userEvent.setup();

    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [
          buildProposal({
            action: ProposalAction.Create,
            conversationId: "conv-create",
            influences: [
              buildOriginInfluence({
                entityId: "origin-task-99",
                entityType: EntityType.Task,
              }),
            ],
          }),
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    await user.click(screen.getByTestId("provenance-created-entity-link"));

    expect(mockNavigateToEntity).toHaveBeenCalledOnce();
    expect(mockNavigateToEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: expect.objectContaining({
          id: "origin-task-99",
          type: "task",
        }),
        projectId: PROJECT_ID,
      })
    );
  });

  it("renders the entity row as plain text when origin entity type is not navigable", () => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [
          buildProposal({
            action: ProposalAction.Create,
            conversationId: "conv-create",
            influences: [
              buildOriginInfluence({
                entityId: "msg-1",
                entityType: EntityType.Message,
              }),
            ],
          }),
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.queryByTestId("provenance-created-entity-link")
    ).not.toBeInTheDocument();

    const entityText = screen.getByTestId("provenance-created-entity-text");
    expect(entityText).toHaveTextContent("Message");

    const conversationLink = screen.getByTestId(
      "provenance-created-conversation-link"
    );
    const row = screen.getByTestId("provenance-created");
    expect(row).toContainElement(entityText);
    expect(row).toContainElement(conversationLink);
    expect(row).toHaveTextContent(/via.*about.*Message/);
  });

  it("clicking the conversation link navigates through the agent session resolver", async () => {
    const user = userEvent.setup();

    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [
          buildProposal({
            action: ProposalAction.Create,
            conversationId: "conv-xyz",
            influences: [buildOriginInfluence()],
          }),
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    await user.click(
      screen.getByTestId("provenance-created-conversation-link")
    );

    expect(mockNavigate).toHaveBeenCalledOnce();
    expect(mockNavigate).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/resolve-agent-session/conv-xyz`
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: View All History
// ---------------------------------------------------------------------------

describe("ContextMenu — View All History", () => {
  it("renders View All History when proposals exist", () => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [buildProposal()],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.getByTestId("interaction-menu-view-all-history")
    ).toBeInTheDocument();
  });

  it("clicking View All History opens the existing history modal", async () => {
    const user = userEvent.setup();

    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [
          buildProposal({
            action: ProposalAction.Create,
            influences: [buildInfluence()],
          }),
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    await user.click(screen.getByTestId("interaction-menu-view-all-history"));

    expect(screen.getByTestId("view-history-modal")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: MCP tools from entity context response
// ---------------------------------------------------------------------------

describe("ContextMenu — MCP tools from entity context response", () => {
  it("renders a labeled menu item for each tool in availableMcpTools", () => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        availableMcpTools: [
          {
            toolName: "edit_task",
            targetEntityType: EntityType.Task,
            label: "Edit Task...",
            description: "Edit this task",
          },
          {
            toolName: "split_task",
            targetEntityType: EntityType.Task,
            label: "Split Task...",
            description: "Split into subtasks",
          },
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.getByTestId("interaction-menu-edit_task")
    ).toBeInTheDocument();
    expect(screen.getByText("Edit Task...")).toBeInTheDocument();
    expect(
      screen.getByTestId("interaction-menu-split_task")
    ).toBeInTheDocument();
    expect(screen.getByText("Split Task...")).toBeInTheDocument();
  });

  it("MCP tool items with no registered handler log a warning and do not invoke onMenuAction", async () => {
    const onMenuAction = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = userEvent.setup();

    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        availableMcpTools: [
          {
            toolName: "edit_task",
            targetEntityType: EntityType.Task,
            label: "Edit Task...",
            description: "Edit this task",
          },
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps({ onMenuAction })} />);
    openMenu();

    await user.click(screen.getByTestId("interaction-menu-edit_task"));

    expect(warn).toHaveBeenCalledWith("Unhandled MCP tool: edit_task");
    expect(onMenuAction).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("renders the built-in Discuss item alongside MCP tools", () => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        availableMcpTools: [
          {
            toolName: "edit_task",
            targetEntityType: EntityType.Task,
            label: "Edit Task...",
            description: "Edit this task",
          },
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(
      screen.getByTestId("interaction-menu-edit_task")
    ).toBeInTheDocument();
    expect(screen.getByTestId("interaction-menu-discuss")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: dismiss behaviors
// ---------------------------------------------------------------------------

describe("ContextMenu — dismiss behaviors", () => {
  beforeEach(() => {
    mockUseEntityContext.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });
  });

  it("dismisses the menu when Escape is pressed", () => {
    render(<InteractionComponent {...buildProps()} />);
    const container = screen.getByTestId("interaction-component");

    openMenu();
    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();

    fireEvent.keyDown(container, { key: "Escape" });

    expect(
      screen.queryByTestId("interaction-context-menu")
    ).not.toBeInTheDocument();
  });

  it("dismisses the menu on outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <InteractionComponent {...buildProps()} />
        <button data-testid="outside-element">Outside</button>
      </div>
    );

    openMenu();
    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();

    await user.click(screen.getByTestId("outside-element"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("interaction-context-menu")
      ).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Discuss action
// ---------------------------------------------------------------------------

describe("ContextMenu — Discuss action", () => {
  beforeEach(() => {
    mockUseEntityContext.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });
    mockLaunch.mockReset();
    mockLaunch.mockResolvedValue(true);
  });

  it("opens the conversation launcher modal when Discuss is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider theme={createHeyTheme("light")}>
        <InteractionComponent {...buildProps()} />
      </ThemeProvider>,
    );

    openMenu();
    const discuss = screen.getByTestId("interaction-menu-discuss");
    const discussIcon = screen.getByTestId("interaction-menu-discuss-icon");
    expect(discuss).toHaveTextContent("Discuss Task");
    expect(discussIcon).toBeInTheDocument();
    expect(window.getComputedStyle(discussIcon).color).toBe(
      "var(--mui-palette-actionable-main)",
    );
    expect(createHeyTheme("light").palette.actionable.main).toBe(
      "rgb(60, 114, 160)",
    );
    await user.click(discuss);

    expect(screen.getByTestId("discuss-modal")).toBeInTheDocument();
  });

  it("calls launcher.launch with the prompt and entity context on submit", async () => {
    const user = userEvent.setup();
    render(<InteractionComponent {...buildProps()} />);

    openMenu();
    await user.click(screen.getByTestId("interaction-menu-discuss"));

    await user.type(screen.getByRole("textbox"), "What should I work on next?");
    await user.click(screen.getByTestId("discuss-modal-submit"));

    expect(mockLaunch).toHaveBeenCalledOnce();
    expect(mockLaunch).toHaveBeenCalledWith({
      prompt: "What should I work on next?",
      context: {
        entityId: ENTITY_ID,
        entityType: ENTITY_TYPE,
      },
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: null,
      reasoningEffort: null,
      machineId: "machine-context-menu",
    });
  });

  it("closes the discuss modal after a successful launch", async () => {
    const user = userEvent.setup();
    render(<InteractionComponent {...buildProps()} />);

    openMenu();
    await user.click(screen.getByTestId("interaction-menu-discuss"));
    await user.type(screen.getByRole("textbox"), "Help me plan this task");
    await user.click(screen.getByTestId("discuss-modal-submit"));

    await waitFor(() => {
      expect(screen.queryByTestId("discuss-modal")).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: View All History — influence navigation inside the modal
// ---------------------------------------------------------------------------

describe("ContextMenu — View All History influence navigation", () => {
  beforeEach(() => {
    mockNavigateToEntity.mockReset();
    mockGetEntityNames.mockClear();
    mockGetEntityNames.mockResolvedValue({ data: [] });
  });

  it("renders the stamped entityTitle as the influence link text and an anchor href from pathService", async () => {
    const user = userEvent.setup();

    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [
          buildProposal({
            action: ProposalAction.Create,
            influences: [
              buildInfluence({
                entityId: "task-xyz",
                entityType: EntityType.Task,
                entityTitle: "Refactor auth flow",
                reasoning: "Related task context",
              }),
            ],
          }),
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();
    await user.click(screen.getByTestId("interaction-menu-view-all-history"));

    const link = await screen.findByRole("link", {
      name: "Refactor auth flow",
    });
    expect(link).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}/tasks/task-xyz`
    );
    // Reasoning continues to render beneath the title.
    expect(screen.getByText("Related task context")).toBeInTheDocument();
  });

  it("clicking the influence title navigates and closes the modal", async () => {
    const user = userEvent.setup();

    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [
          buildProposal({
            action: ProposalAction.Create,
            influences: [
              buildInfluence({
                entityId: "task-xyz",
                entityType: EntityType.Task,
                entityTitle: "Refactor auth flow",
                reasoning: "Related task context",
              }),
            ],
          }),
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();
    await user.click(screen.getByTestId("interaction-menu-view-all-history"));

    await user.click(
      await screen.findByRole("link", { name: "Refactor auth flow" })
    );

    expect(mockNavigateToEntity).toHaveBeenCalledOnce();
    expect(mockNavigateToEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: expect.objectContaining({ id: "task-xyz", type: "task" }),
        projectId: PROJECT_ID,
      })
    );
    expect(screen.queryByTestId("view-history-modal")).not.toBeInTheDocument();
  });

  it("backfills missing entityTitle from the getEntityNames batch", async () => {
    const user = userEvent.setup();

    mockGetEntityNames.mockResolvedValue({
      data: [
        {
          entityId: "task-legacy",
          entityType: EntityType.Task,
          entityName: "Legacy task title",
        },
      ],
    });

    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [
          buildProposal({
            action: ProposalAction.Create,
            influences: [
              buildInfluence({
                entityId: "task-legacy",
                entityType: EntityType.Task,
                entityTitle: null,
                reasoning: "Pulled from registry",
              }),
            ],
          }),
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();
    await user.click(screen.getByTestId("interaction-menu-view-all-history"));

    await waitFor(() => {
      expect(mockGetEntityNames).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          getEntityNamesDto: expect.objectContaining({
            entities: expect.arrayContaining([
              expect.objectContaining({
                entityId: "task-legacy",
                entityType: EntityType.Task,
              }),
            ]),
          }),
        })
      );
    });

    const link = await screen.findByRole("link", {
      name: "Legacy task title",
    });
    expect(link).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}/tasks/task-legacy`
    );
  });

  it("influence items with non-navigable entity types render the title as plain text, not a link", async () => {
    const user = userEvent.setup();

    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        proposals: [
          buildProposal({
            action: ProposalAction.Create,
            influences: [
              buildInfluence({
                entityId: "msg-1",
                entityType: EntityType.Message,
                entityTitle: "Some message",
                reasoning: "A message influenced this",
              }),
            ],
          }),
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();
    await user.click(screen.getByTestId("interaction-menu-view-all-history"));

    expect(screen.getByText("Some message")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Some message" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("A message influenced this")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: static-first ordering
// ---------------------------------------------------------------------------

describe("ContextMenu — static-first ordering", () => {
  it("Discuss appears before MCP items in the DOM", () => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        availableMcpTools: [
          {
            toolName: "edit_task",
            targetEntityType: EntityType.Task,
            label: "Edit Task...",
            description: "Edit this task",
          },
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    const discuss = screen.getByTestId("interaction-menu-discuss");
    const mcpItem = screen.getByTestId("interaction-menu-edit_task");
    // DOCUMENT_POSITION_FOLLOWING (4) means mcpItem follows discuss in the DOM
    expect(
      discuss.compareDocumentPosition(mcpItem) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("Discuss renders while context is loading and loading indicator is positioned below it", () => {
    mockUseEntityContext.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    const discuss = screen.getByTestId("interaction-menu-discuss");
    const loadingText = screen.getByText("Loading context...");
    // Loading indicator must follow Discuss in the DOM
    expect(
      discuss.compareDocumentPosition(loadingText) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("async section collapses completely when MCP tools array is empty", () => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({ availableMcpTools: [] }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });

    render(<InteractionComponent {...buildProps()} />);
    openMenu();

    expect(screen.queryByText("Loading context...")).not.toBeInTheDocument();
    expect(screen.getByTestId("interaction-menu-discuss")).toBeInTheDocument();
    // Preview, Discuss, and the shared Star action should be present.
    const allMenuItems = screen
      .getByTestId("interaction-context-menu")
      .querySelectorAll('[role="menuitem"][data-testid^="interaction-menu-"]');
    expect(allMenuItems).toHaveLength(3);
    expect(screen.getByTestId("interaction-menu-preview")).toBeInTheDocument();
  });

  it("keeps the Open Items menu isolated from generic async actions and provenance", () => {
    mockUseEntityContext.mockReturnValue({
      data: buildEntityContext({
        availableMcpTools: [
          {
            toolName: "edit_task",
            targetEntityType: EntityType.AgentSession,
            label: "Edit Session...",
            description: "Edit this session",
          },
        ],
      }),
      isLoading: false,
      error: null,
      fetch: vi.fn(),
    });
    mockUseEntityContext.mockClear();

    render(
      <PreviewHostProvider host={{ openPreview: vi.fn() }}>
        <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
          {...buildProps({ entityType: TargetEntityType.AgentSession })}
          openItemActions={{
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
          }}
        />
      </PreviewHostProvider>
    );
    openMenu();

    const preview = screen.getByTestId("interaction-menu-preview");
    const pin = screen.getByTestId("interaction-menu-pin");
    const remove = screen.getByTestId("interaction-menu-remove-from-open");
    const select = screen.getByTestId("interaction-menu-select-open-items");
    const activeOnly = screen.getByTestId("interaction-menu-show-active-only");
    const sort = screen.getByTestId("interaction-menu-sort-open-items");
    const removeOthers = screen.getByTestId(
      "interaction-menu-remove-open-others"
    );
    const removeAbove = screen.getByTestId(
      "interaction-menu-remove-open-above"
    );
    const removeBelow = screen.getByTestId(
      "interaction-menu-remove-open-below"
    );
    const removeAll = screen.getByTestId("interaction-menu-remove-all-open");
    const whyOpen = screen.getByTestId("interaction-menu-why-open");
    const discuss = screen.getByTestId("interaction-menu-discuss");
    const star = screen.getByTestId("interaction-menu-star");
    expect(screen.getByTestId("interaction-menu-discuss-icon")).toBeInTheDocument();
    expect(screen.getByTestId("interaction-menu-star-outline-icon")).toBeInTheDocument();

    expect(mockUseEntityContext).not.toHaveBeenCalled();
    expect(discuss).toHaveTextContent("Discuss Agent Session");
    expect(
      screen.queryByTestId("interaction-menu-edit_task")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("provenance-summary")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("interaction-menu-view-all-history")
    ).not.toBeInTheDocument();
    expect(
      preview.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      pin.compareDocumentPosition(whyOpen) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      whyOpen.compareDocumentPosition(discuss) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      discuss.compareDocumentPosition(star) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      star.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      select.compareDocumentPosition(activeOnly) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      activeOnly.compareDocumentPosition(sort) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      sort.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      remove.compareDocumentPosition(removeOthers) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      removeOthers.compareDocumentPosition(removeAbove) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      removeAbove.compareDocumentPosition(removeBelow) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      removeBelow.compareDocumentPosition(removeAll) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const menu = screen.getByTestId("interaction-context-menu");
    const separators = Array.from(menu.querySelectorAll('[role="separator"]'));
    const hasSeparatorBetween = (first: Element, second: Element) =>
      separators.some(
        (separator) =>
          Boolean(
            first.compareDocumentPosition(separator) &
              Node.DOCUMENT_POSITION_FOLLOWING
          ) &&
          Boolean(
            separator.compareDocumentPosition(second) &
              Node.DOCUMENT_POSITION_FOLLOWING
          )
      );
    expect(hasSeparatorBetween(select, activeOnly)).toBe(false);
    expect(hasSeparatorBetween(activeOnly, sort)).toBe(false);
    expect(hasSeparatorBetween(sort, remove)).toBe(false);
    expect(hasSeparatorBetween(remove, removeOthers)).toBe(false);
  });
});
