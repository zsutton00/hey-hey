/**
 * Tests for DiscussCapsuleAction
 *
 * Verifies:
 *  (a) the registered CapsuleAction opens the DiscussModal on click
 *  (b) submitting the modal calls launcher.launch with the correct
 *      entityId/entityType
 *  (c) registry resolution for the new Plan and Service entries returns the
 *      expected sessionField/entityType
 */

import React from "react";
import { ModalProvider, useModal } from "../../../../contexts/ModalContext";
import { HostedDiscussOwner } from "../../../InteractionComponent/HostedDiscussOwner";
import { copyPersistentModalRequest } from "../../../../contexts/types/persistentModalRequest";
function TestHost() {
  const modal = useModal();
  return (
    <>
      {modal?.modalInstances.map((item) => {
        const request = copyPersistentModalRequest(item.config);
        return request?.type === "discuss" ? (
          <HostedDiscussOwner
            key={item.id}
            request={request}
            onClose={() => modal.closeModal(item.id)}
          />
        ) : null;
      })}
    </>
  );
}
import { act, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeProvider } from "@mui/material/styles";

import { DiscussCapsuleAction } from "../DiscussCapsuleAction";
import { ActionsCapsuleProvider } from "../../ActionsCapsuleProvider";
import { useActionsCapsule } from "../../ActionsCapsuleContext";
import { CapsuleActionButton } from "../../CapsuleActionButton";
import { resolveEntityTypeConfig } from "../../../InteractionComponent/entityTypeRegistry";
import { createHeyTheme } from "../../../../contexts/ThemeContext";
import {
  ConversationStartRunRequestDtoProviderEnum,
  EntityType,
  TargetEntityType,
} from "../../../../api";
import { useEntityConversationLauncher } from "../../../InteractionComponent/useEntityConversationLauncher";
import { useWorkItem } from "../../../../data/hooks/useWorkItem";
import type { CapsuleActionRegistration } from "../../types";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockLaunch = vi.fn().mockResolvedValue(true);
const mockClearLaunchError = vi.fn();
interface MockWorkItem {
  id: string;
  type: string;
  sections?: Array<{
    key: string;
    materializedMarkdown: string;
    order: number;
  }>;
  dueDate?: string;
  trackedEntities?: [];
}

const mockWorkItemState = vi.hoisted<{
  current: {
    workItem: MockWorkItem | null;
    isLoading: boolean;
    isFetching: boolean;
    error: null;
    refetch: () => Promise<MockWorkItem | null>;
  };
}>(() => ({
  current: {
    workItem: {
      id: "task-1",
      type: "STANDARD",
    },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: async () => null,
  },
}));

vi.mock("../../../InteractionComponent/useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: vi.fn(() => ({
    launch: mockLaunch,
    isLoading: false,
    error: null,
    clearError: mockClearLaunchError,
  })),
}));

vi.mock("../../../../data/hooks/useWorkItem", () => ({
  useWorkItem: vi.fn(() => mockWorkItemState.current),
}));

vi.mock("../../../InteractionComponent/DiscussModal", () => ({
  DiscussModal: ({
    open,
    onSubmit,
    onClose,
    submitError,
    onClearSubmitError,
    fileReferenceScope,
    entityTitle,
    focalEntity,
  }: {
    open: boolean;
    onClose: () => void;
    submitError: { code: string | null; message: string } | null;
    onClearSubmitError: () => void;
    fileReferenceScope:
      | { kind: "task"; taskId: string }
      | { kind: "feature"; featureId: string }
      | null;
    entityTitle?: string;
    focalEntity: { kind: string; entityType?: string; entityId?: string };
    onSubmit: (submission: {
      prompt: string;
      provider: ConversationStartRunRequestDtoProviderEnum;
      model: string | null;
      reasoningEffort: null;
      machineId: string;
    }) => void;
  }) =>
    open ? (
      <div
        data-testid="mock-discuss-modal"
        data-file-reference-scope={fileReferenceScope?.kind ?? ""}
        data-entity-title={entityTitle ?? ""}
        data-focal-entity-type={focalEntity.entityType ?? ""}
        data-focal-entity-id={focalEntity.entityId ?? ""}
      >
        {submitError ? (
          <span data-testid="mock-discuss-error">{submitError.message}</span>
        ) : null}
        <button
          data-testid="mock-discuss-submit"
          onClick={() =>
            onSubmit({
              prompt: "hello",
              provider: ConversationStartRunRequestDtoProviderEnum.Claude,
              model: null,
              reasoningEffort: null,
              machineId: "machine-1",
            })
          }
        >
          submit
        </button>
        <button
          data-testid="mock-discuss-close"
          onClick={() => {
            onClearSubmitError();
            onClose();
          }}
        >
          close
        </button>
      </div>
    ) : null,
}));

// Helper: harness reads the registered actions and exposes a click trigger.
const ActionsHarness: React.FC<{ onActions: (actions: unknown[]) => void }> = ({
  onActions,
}) => {
  const ctx = useActionsCapsule();
  React.useEffect(() => {
    onActions(ctx.actions);
  }, [ctx.actions, onActions]);
  return null;
};

type ThemeMode = "light" | "dark";

const renderWithProvider = (ui: React.ReactNode, mode: ThemeMode = "light") =>
  render(
    <ThemeProvider theme={createHeyTheme(mode)}>
      <ModalProvider>
        <ActionsCapsuleProvider>
          {ui}
          <TestHost />
        </ActionsCapsuleProvider>
      </ModalProvider>
    </ThemeProvider>,
  );

const mockUseEntityConversationLauncher = vi.mocked(
  useEntityConversationLauncher,
);
const mockUseWorkItem = vi.mocked(useWorkItem);

beforeEach(() => {
  mockLaunch.mockClear();
  mockClearLaunchError.mockClear();
  mockWorkItemState.current = {
    workItem: {
      id: "task-1",
      type: "STANDARD",
    },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: async () => null,
  };
  mockUseEntityConversationLauncher.mockReturnValue({
    launch: mockLaunch,
    isLoading: false,
    error: null,
    clearError: mockClearLaunchError,
  });
});

describe("DiscussCapsuleAction", () => {
  it.each(["light", "dark"] as const)(
    "uses the %s theme actionable role for its rendered icon chip",
    (mode) => {
      const seen: CapsuleActionRegistration[][] = [];
      const theme = createHeyTheme(mode);

      renderWithProvider(
        <>
          <DiscussCapsuleAction
            entityId="task-1"
            entityType={EntityType.Task}
            entityTitle="Test Task"
            organizationId="org-1"
            projectId="proj-1"
          />
          <ActionsHarness
            onActions={(actions) =>
              seen.push(actions as CapsuleActionRegistration[])
            }
          />
        </>,
        mode,
      );

      const action = seen.at(-1)?.[0];
      expect(action).toBeDefined();
      if (!action) {
        throw new Error("Discuss action was not registered");
      }

      expect(action.iconStyle).toEqual({
        backgroundColor: theme.palette.actionable.main,
        color: theme.palette.actionable.contrastText,
      });

      render(
        <ThemeProvider theme={theme}>
          <CapsuleActionButton
            action={action}
            idx={0}
            isActive={false}
            isAnyExpanded={false}
            onClick={vi.fn()}
          />
        </ThemeProvider>,
      );

      const button = screen.getByTestId("capsule-action-discuss");
      const iconChip = button.querySelector(
        ".MuiButton-startIcon",
      ) as HTMLElement;
      const icon = button.querySelector(
        ".MuiButton-startIcon .MuiSvgIcon-root",
      ) as HTMLElement;

      expect(window.getComputedStyle(iconChip).backgroundColor).toBe(
        "rgb(60, 114, 160)",
      );
      expect(window.getComputedStyle(icon).color).toBe("rgb(255, 255, 255)");
    },
  );

  it("registers a click-behavior CapsuleAction that opens the DiscussModal", async () => {
    const seen: unknown[][] = [];
    const onActions = (actions: unknown[]): void => {
      seen.push(actions);
    };

    renderWithProvider(
      <>
        <DiscussCapsuleAction
          entityId="task-1"
          entityType={EntityType.Task}
          entityTitle="Test Task"
          organizationId="org-1"
          projectId="proj-1"
        />
        <ActionsHarness onActions={onActions} />
      </>,
    );

    const latest = seen[seen.length - 1] as Array<{
      id: string;
      behavior: string;
      onClick?: () => void;
    }>;
    expect(latest).toHaveLength(1);
    expect(latest[0].id).toBe("discuss");
    expect(latest[0].behavior).toBe("click");

    expect(screen.queryByTestId("mock-discuss-modal")).not.toBeInTheDocument();

    await act(async () => {
      latest[0].onClick?.();
    });

    expect(screen.getByTestId("mock-discuss-modal")).toBeInTheDocument();
    expect(screen.getByTestId("mock-discuss-modal")).toHaveAttribute(
      "data-file-reference-scope",
      "task",
    );
  });

  it("calls launcher.launch with the correct entityId/entityType on submit", async () => {
    const seen: unknown[][] = [];
    const onActions = (actions: unknown[]): void => {
      seen.push(actions);
    };

    renderWithProvider(
      <>
        <DiscussCapsuleAction
          entityId="plan-9"
          entityType={TargetEntityType.Task}
          entityTitle="My Plan"
          organizationId="org-1"
          projectId="proj-1"
        />
        <ActionsHarness onActions={onActions} />
      </>,
    );

    const latest = seen[seen.length - 1] as Array<{
      onClick?: () => void;
    }>;

    await act(async () => {
      latest[0].onClick?.();
    });

    await act(async () => {
      screen.getByTestId("mock-discuss-submit").click();
    });

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockLaunch).toHaveBeenCalledWith({
      prompt: "hello",
      context: {
        entityId: "plan-9",
        entityType: TargetEntityType.Task,
        entitySubtype: "STANDARD",
      },
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: null,
      reasoningEffort: null,
      machineId: "machine-1",
    });
  });

  it("launches a goal with the description from the loaded work item", async () => {
    mockWorkItemState.current = {
      workItem: {
        id: "goal-1",
        type: "GOAL",
        sections: [
          {
            key: "description",
            materializedMarkdown: "Use the refreshed persisted description.",
            order: 0,
          },
        ],
        dueDate: "2026-08-31",
        trackedEntities: [],
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: async () => null,
    };
    const seen: unknown[][] = [];

    renderWithProvider(
      <>
        <DiscussCapsuleAction
          entityId="goal-1"
          entityType={EntityType.Task}
          organizationId="org-1"
          projectId="proj-1"
        />
        <ActionsHarness onActions={(actions) => seen.push(actions)} />
      </>,
    );

    const latest = seen[seen.length - 1] as Array<{ onClick?: () => void }>;
    await act(async () => {
      latest[0].onClick?.();
    });
    await act(async () => {
      screen.getByTestId("mock-discuss-submit").click();
    });

    expect(mockLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          entityId: "goal-1",
          entityType: EntityType.Task,
          entitySubtype: "GOAL",
          goalSnapshot: {
            description: "Use the refreshed persisted description.",
            dueDate: "2026-08-31",
            trackedEntities: [],
          },
        },
      }),
    );
  });

  it("waits for the current goal before launching from a newly opened modal", async () => {
    const refreshedGoal: MockWorkItem = {
      id: "goal-1",
      type: "GOAL",
      sections: [
        {
          key: "description",
          materializedMarkdown: "Loaded before launch.",
          order: 0,
        },
      ],
      dueDate: "2026-08-31",
      trackedEntities: [],
    };
    mockWorkItemState.current = {
      workItem: null,
      isLoading: true,
      isFetching: true,
      error: null,
      refetch: vi.fn(async () => refreshedGoal),
    };
    const seen: unknown[][] = [];

    renderWithProvider(
      <>
        <DiscussCapsuleAction
          entityId="goal-1"
          entityType={EntityType.Task}
          organizationId="org-1"
          projectId="proj-1"
        />
        <ActionsHarness onActions={(actions) => seen.push(actions)} />
      </>,
    );

    const latest = seen[seen.length - 1] as Array<{ onClick?: () => void }>;
    await act(async () => {
      latest[0].onClick?.();
    });
    await act(async () => {
      screen.getByTestId("mock-discuss-submit").click();
    });

    expect(mockWorkItemState.current.refetch).toHaveBeenCalledOnce();
    expect(mockLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          entityId: "goal-1",
          entityType: EntityType.Task,
          entitySubtype: "GOAL",
          goalSnapshot: {
            description: "Loaded before launch.",
            dueDate: "2026-08-31",
            trackedEntities: [],
          },
        },
      }),
    );
  });

  it("passes launch failures into the modal and clears them on close", async () => {
    mockUseEntityConversationLauncher.mockReturnValue({
      launch: mockLaunch,
      isLoading: false,
      error: { code: null, message: "Unable to start this conversation" },
      clearError: mockClearLaunchError,
    });
    const seen: unknown[][] = [];

    renderWithProvider(
      <>
        <DiscussCapsuleAction
          entityId="task-1"
          entityType={EntityType.Task}
          organizationId="org-1"
          projectId="proj-1"
        />
        <ActionsHarness onActions={(actions) => seen.push(actions)} />
      </>,
    );

    const latest = seen[seen.length - 1] as Array<{ onClick?: () => void }>;
    await act(async () => {
      latest[0].onClick?.();
    });

    expect(screen.getByTestId("mock-discuss-error")).toHaveTextContent(
      "Unable to start this conversation",
    );

    await act(async () => {
      screen.getByTestId("mock-discuss-close").click();
    });

    expect(mockClearLaunchError).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("mock-discuss-modal")).not.toBeInTheDocument();
  });

  it("opens and launches with canonical PROJECT identity without loading a work item", async () => {
    const seen: unknown[][] = [];

    renderWithProvider(
      <>
        <DiscussCapsuleAction
          entityId="project-1"
          entityType={EntityType.Project}
          entityTitle="Project Alpha"
          organizationId="org-1"
          projectId="project-1"
        />
        <ActionsHarness onActions={(actions) => seen.push(actions)} />
      </>,
    );

    const latest = seen[seen.length - 1] as Array<{ onClick?: () => void }>;
    await act(async () => {
      latest[0].onClick?.();
    });

    expect(mockUseWorkItem).toHaveBeenLastCalledWith(
      "org-1",
      "task",
      "project-1",
      expect.objectContaining({ enabled: false }),
    );
    expect(screen.getByTestId("mock-discuss-modal")).toHaveAttribute(
      "data-entity-title",
      "Project Alpha",
    );
    expect(screen.getByTestId("mock-discuss-modal")).toHaveAttribute(
      "data-focal-entity-type",
      EntityType.Project,
    );
    expect(screen.getByTestId("mock-discuss-modal")).toHaveAttribute(
      "data-focal-entity-id",
      "project-1",
    );

    await act(async () => {
      screen.getByTestId("mock-discuss-submit").click();
    });

    expect(mockLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          entityId: "project-1",
          entityType: EntityType.Project,
        },
      }),
    );
  });

  it("renders nothing when organizationId or projectId are missing", () => {
    const seen: unknown[][] = [];
    const onActions = (actions: unknown[]): void => {
      seen.push(actions);
    };

    renderWithProvider(
      <>
        <DiscussCapsuleAction
          entityId="task-1"
          entityType={EntityType.Task}
          organizationId=""
          projectId="proj-1"
        />
        <ActionsHarness onActions={onActions} />
      </>,
    );

    const latest = seen[seen.length - 1] as unknown[];
    expect(latest).toHaveLength(0);
  });
});

describe("entityTypeRegistry — Plan and Service entries", () => {
  it("resolves PLAN to the expected sessionField/entityType", () => {
    const config = resolveEntityTypeConfig("PLAN");
    expect(config).toBeDefined();
    expect(config?.displayLabel).toBe("plan");
    expect(config?.lineageFieldMapping).toEqual({
      sessionField: "entityId",
      entityType: "plan",
    });
  });

  it("resolves SERVICE to the expected sessionField/entityType", () => {
    const config = resolveEntityTypeConfig("SERVICE");
    expect(config).toBeDefined();
    expect(config?.displayLabel).toBe("service");
    expect(config?.lineageFieldMapping).toEqual({
      sessionField: "entityId",
      entityType: "service",
    });
  });
});
