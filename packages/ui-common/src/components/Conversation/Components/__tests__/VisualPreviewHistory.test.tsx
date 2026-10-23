import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createTheme, ThemeProvider } from "@mui/material";
import type {
  AgentSystemMessageData,
  QuestionsSystemMessageData,
  ConversationResponseDto,
  MessageResponseDto,
  ProjectResponseDto,
  ProposalResponseDto,
  UIElement,
} from "../../../../api";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  SecondaryActionHandler,
  TargetEntityType,
} from "../../../../api";
import {
  ConversationProvider,
  useConversationContext,
} from "../ConversationContext";
import { ConversationFormRenderer } from "../ConversationFormRenderer";
import { __resetForTests } from "../../../ProposalDispatchers/proposalSelectedStateCache";

const mocks = vi.hoisted(() => ({
  messages: [] as MessageResponseDto[],
  getProposal: vi.fn(),
  handleApply: vi.fn<() => Promise<void>>(),
  handleReject: vi.fn<() => Promise<void>>(),
  handleNext: vi.fn(),
}));
vi.mock("../../../../data/hooks/useConversationMessages", () => ({
  useConversationMessages: () => ({
    data: mocks.messages,
    error: null,
    isLoading: false,
  }),
}));
vi.mock("../MessageProposals", () => ({
  useMessageProposalActions: () => ({
    handleApply: mocks.handleApply,
    handleReject: mocks.handleReject,
  }),
}));
vi.mock("../../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../clients/serviceClients")
  >()),
  proposalsClient: {
    getProposal: mocks.getProposal,
    getProposalReconciliation: vi.fn(async () => ({
      data: {
        data: {
          status: "CURRENT",
          currentBases: [],
          revisions: [],
          conflictingPaths: [],
        },
      },
    })),
  },
  unifiedApiClient: {
    getTask: vi.fn(async () => ({
      data: {
        data: {
          id: "target",
          name: "Existing visual",
          type: "mockup",
          organizationId: "org",
          projectId: "project",
          sections: [],
          status: "ACTIVE",
        },
      },
    })),
  },
}));
vi.mock("../../hooks", () => ({
  useConversationSubmission: () => ({
    isSubmitting: false,
    handleNext: mocks.handleNext,
  }),
  useConversationScrolling: () => ({}),
}));
vi.mock("../../../../hooks/useWorkflowStatus", () => ({
  useWorkflowStatus: () => ({ canSubmit: true }),
}));
vi.mock("../../../../hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../hooks")>()),
  useUserIdentity: () => ({ userId: "user" }),
}));
vi.mock("../../../AgentSession/runtime/hooks/useCliRequired", () => ({
  useCliRequired: () => ({ type: "ready", machine: { machineId: "machine" } }),
}));
vi.mock("../../../../data/hooks/useSecondaryActions", () => ({
  useSecondaryActions: () => ({ actions: [], isLoading: false }),
}));
vi.mock("../../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({
    workItemTypes: [
      {
        definition: {
          key: "mockup",
          name: "Mockup",
          sections: [],
          role: "project-info",
        },
      },
    ],
    isLoading: false,
  }),
  useWorkItemTypeByKey: () => ({
    workItemTypeDefinition: {
      key: "mockup",
      name: "Mockup",
      sections: [],
      role: "project-info",
    },
    isLoading: false,
  }),
}));
vi.mock("../../../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user" }, isAuthenticated: true }),
}));
vi.mock("../../../../contexts/PathServiceContext", () => ({
  usePathService: () => ({ task: () => "/task", feature: () => "/feature" }),
}));
vi.mock("../../../../data/hooks/useServices", () => ({
  useServices: () => ({ services: [], isLoading: false }),
}));
vi.mock("../../../../data/hooks/useUsers", () => ({
  useUsers: () => ({ data: [] }),
}));
vi.mock("../../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({ workItem: undefined }),
}));
// The editor widget is outside the response-projection boundary. Keep the real
// textarea registry field, initial-value projection and disabled wiring.
vi.mock("../../../SmartTextAreaCard", () => ({
  SmartTextAreaCard: ({
    value,
    disabled,
  }: {
    value: string;
    disabled?: boolean;
  }) => <textarea value={value} disabled={disabled} readOnly />,
}));
vi.mock("../../../InteractionComponent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../InteractionComponent")>()),
  InteractionComponent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const proposal = (id: string, action: ProposalAction): ProposalResponseDto => ({
  id,
  action,
  organizationId: "org",
  projectId: "project",
  type: ProposalType.Single,
  status: ProposalStatus.Draft,
  targetEntityId: "target",
  targetEntityType: TargetEntityType.Task,
  title: `Visual ${id}`,
  updates: { name: `Visual ${id}`, type: "mockup", sections: [] },
  edges: [],
  requestorId: "user",
  requiredApprovals: 1,
  approvals: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
let proposals: ProposalResponseDto[];
const preview: UIElement = {
  id: "visuals",
  type: "plan_generation_visual_preview",
  label: "Visuals",
  payload: {
    responseType: "plan_generation_visual_preview_v1",
    entries: [
      { proposalId: "shared", artifactFamily: "mockup", presentationOrder: 0 },
      { proposalId: "second", artifactFamily: "diagram", presentationOrder: 1 },
    ],
  },
};
const system = (
  id: string,
  uiElements: UIElement[],
  responses: MessageResponseDto[] = [],
): Extract<MessageResponseDto, { type: "SYSTEM" }> & {
  data: QuestionsSystemMessageData;
} => ({
  id,
  type: "SYSTEM",
  status: "completed",
  conversationId: "conversation",
  projectId: "project",
  createdAt: "2026-01-01T00:00:00Z",
  awaitingResponse: true,
  responses: responses.map((response) => ({
    ...response,
    parentMessageId: id,
  })),
  data: {
    type: "QUESTIONS",
    response: "",
    uiElements,
    detectedIntent: "",
    intentConfidence: 1,
  },
});
const feedback = (
  id: string,
  answered: boolean,
  responses: MessageResponseDto[] = [],
  withApprove = false,
): MessageResponseDto => {
  const message = system(id, [
    { id: "feedback", type: "textarea", label: "Feedback" },
  ]);
  message.data.secondaryActions = [
    {
      id: "refine",
      type: "field_action",
      handler:
        SecondaryActionHandler.PlanGenerationVisualPreviewContinueRevising,
      label: "Continue Revising",
      fieldId: "feedback",
    },
    ...(withApprove
      ? [
          {
            id: "approve",
            type: "field_action",
            handler: SecondaryActionHandler.PlanGenerationVisualPreviewApprove,
            label: "Approve Visual Set",
            fieldId: "feedback",
          },
        ]
      : []),
  ];
  message.responses = answered
    ? [
        {
          id: `${id}-answer`,
          type: "USER",
          status: "completed",
          conversationId: "conversation",
          projectId: "project",
          createdAt: message.createdAt,
          parentMessageId: id,
          data: {
            action: "REFINE",
            payload: { feedback: "Keep the navigation visible" },
          },
          responses: responses.map((response) => ({
            ...response,
            parentMessageId: `${id}-answer`,
          })),
        },
      ]
    : responses;
  return message;
};
const trigger = (id: string, previewId: string): MessageResponseDto => ({
  ...system(id, [], [system(previewId, [preview])]),
  data: {
    type: "AGENT",
    response: "",
    detectedIntent: "",
    intentConfidence: 1,
    triggersAgent: {
      promptType: "plan_shaping_visual_preview",
      nodeId: "visual-node",
      triggerMessageId: id,
      payload: {
        designDocId: "doc",
        planId: "plan",
        featureId: "feature",
        refinementRound: 0,
        entries: [],
      },
    },
  } satisfies AgentSystemMessageData,
});
const completion = (
  triggerId: string,
  answered: boolean,
): MessageResponseDto => {
  const data: AgentSystemMessageData = {
    type: "AGENT",
    response: "",
    detectedIntent: "",
    intentConfidence: 1,
    uiElements: [{ id: "agent_hidden", type: "agent_hidden", label: "" }],
    completesExternalAgentNode: {
      nodeId: "visual-node",
      action: "READY",
      completesTriggerMessageId: triggerId,
    },
  };
  return {
    ...system(
      `${triggerId}-completion`,
      [],
      [feedback(`${triggerId}-feedback`, answered)],
    ),
    data,
  };
};
const conversation: ConversationResponseDto = {
  id: "conversation",
  organizationId: "org",
  projectId: "project",
  status: "IN_PROGRESS",
  initiatedBy: "USER",
  workflowName: "plan-from-design-doc",
  version: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const project: ProjectResponseDto = {
  id: "project",
  organizationId: "org",
  name: "Project",
  status: "ACTIVE",
  hasEstablishedActivity: true,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
};
const Timeline = () => {
  const { conversationTimeline, resolvedForms } = useConversationContext();
  return (
    <>
      {conversationTimeline
        .filter(({ message }) => message.type === "SYSTEM")
        .map((entry, index) => (
          <section key={entry.message.id} data-testid={entry.message.id}>
            <ConversationFormRenderer
              resolvedForm={resolvedForms.get(entry.message.id)!}
              conversationMessage={entry}
              messageIndex={index}
              totalMessages={conversationTimeline.length}
            />
          </section>
        ))}
    </>
  );
};
const mount = (submitted = false) =>
  render(
    <ThemeProvider
      theme={createTheme({ palette: { actionable: { main: "#123456" } } })}
    >
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <ConversationProvider
            conversation={conversation}
            project={project}
            scrollPolicy={{ mode: "disabled" }}
            suggestionDecisions={{
              decisionsById: {},
              getDecision: () => undefined,
              upsertDecision: vi.fn(),
              getRoutingDecision: () => undefined,
              upsertRoutingDecision: vi.fn(),
            }}
            conversationFormResolver={
              submitted
                ? (entry) =>
                    entry.message.id === "current-preview"
                      ? {
                          responseDeclarations: [
                            {
                              ownership: "exclusive",
                              currentFieldId: preview.id,
                              submissionKind: "field",
                            },
                          ],
                          uiElements: [preview],
                          disabled: false,
                          isSubmitted: true,
                          submit: async () => {},
                        }
                      : null
                : undefined
            }
          >
            <Timeline />
          </ConversationProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
const old = () => within(screen.getByTestId("old-preview"));
const current = () => within(screen.getByTestId("current-preview"));

beforeEach(() => {
  vi.clearAllMocks();
  __resetForTests();
  localStorage.clear();
  proposals = [
    proposal("shared", ProposalAction.Create),
    proposal("second", ProposalAction.Delete),
  ];
  mocks.getProposal.mockImplementation(
    ({ proposalId }: { proposalId: string }) =>
      Promise.resolve({
        data: { data: proposals.find(({ id }) => id === proposalId) },
      }),
  );
  mocks.handleApply.mockResolvedValue(undefined);
  mocks.handleReject.mockResolvedValue(undefined);
  mocks.messages = [
    system(
      "old-preview",
      [preview],
      [
        feedback("old-feedback", true, [
          system(
            "current-preview",
            [preview],
            [feedback("current-feedback", false)],
          ),
        ]),
      ],
    ),
  ];
});

describe("visual preview history through production form and action wiring", () => {
  it("uses a direct trigger parent reference when the trigger row is outside the loaded page", async () => {
    mocks.messages = [
      { ...system("old-preview", [preview]), parentMessageId: "old-trigger" },
      completion("old-trigger", true),
      {
        ...system("current-preview", [preview]),
        parentMessageId: "current-trigger",
      },
      completion("current-trigger", false),
    ];
    mount();
    await waitFor(() =>
      expect(current().getByTestId("proposal-approve")).toBeEnabled(),
    );
    expect(old().queryByTestId("proposal-approve")).not.toBeInTheDocument();
  });

  it("does not close a preview for an unrelated submitted question", async () => {
    const unrelated = system("unrelated", []);
    unrelated.responses = feedback("unrelated", true).responses;
    mocks.messages = [system("current-preview", [preview], [unrelated])];
    mount();
    await waitFor(() =>
      expect(current().getByTestId("proposal-approve")).toBeEnabled(),
    );
  });

  it("keeps a completed historical preview visible without a direct USER child", async () => {
    const previous = system(
      "old-preview",
      [preview],
      [system("current-preview", [preview])],
    );
    previous.awaitingResponse = false;
    mocks.messages = [previous];
    mount();
    await waitFor(() =>
      expect(old().getByTestId("proposal-approval-progress")).toBeVisible(),
    );
    expect(old().queryByTestId("proposal-approve")).not.toBeInTheDocument();
    expect(current().getByTestId("proposal-approve")).toBeEnabled();
  });

  it("consumes submitted state even when the owner supplies disabled=false", async () => {
    mount(true);
    await waitFor(() =>
      expect(current().getByTestId("proposal-approval-progress")).toBeVisible(),
    );
    expect(current().queryByTestId("proposal-approve")).not.toBeInTheDocument();
    expect(
      current().queryByRole("button", { name: "Reject" }),
    ).not.toBeInTheDocument();
    expect(current().getByRole("button", { name: "Next" })).toBeEnabled();
  });
  it("joins separate completion roots by explicit trigger identity, independent of root order", async () => {
    mocks.messages = [
      completion("current-trigger", false),
      trigger("old-trigger", "old-preview"),
      completion("old-trigger", true),
      trigger("current-trigger", "current-preview"),
    ];
    const first = mount();
    await waitFor(() =>
      expect(current().getByTestId("proposal-approve")).toBeEnabled(),
    );
    expect(old().queryByTestId("proposal-approve")).not.toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Keep the navigation visible"),
    ).toBeDisabled();
    first.unmount();
    mount();
    await waitFor(() =>
      expect(current().getByTestId("proposal-approve")).toBeEnabled(),
    );
    expect(old().queryByTestId("proposal-approve")).not.toBeInTheDocument();
  });

  it.each([
    ProposalAction.Create,
    ProposalAction.Update,
    ProposalAction.Delete,
  ])(
    "keeps historical %s decisions absent across remount while the same DRAFT remains actionable",
    async (action) => {
      proposals[0] = proposal("shared", action);
      const first = mount();
      await waitFor(() =>
        expect(current().getByTestId("proposal-approve")).toBeEnabled(),
      );
      expect(old().queryByTestId("proposal-approve")).not.toBeInTheDocument();
      expect(
        old().queryByRole("button", { name: "Reject" }),
      ).not.toBeInTheDocument();
      expect(old().getByTestId("proposal-approval-progress")).toHaveTextContent(
        "0 of 1 approvals",
      );
      expect(
        screen.getByDisplayValue("Keep the navigation visible"),
      ).toBeDisabled();
      fireEvent.click(old().getByRole("button", { name: "Next" }));
      await waitFor(() =>
        expect(old().getByRole("button", { name: "Previous" })).toBeEnabled(),
      );
      expect(old().queryByTestId("proposal-approve")).not.toBeInTheDocument();
      expect(mocks.handleApply).not.toHaveBeenCalled();
      expect(mocks.handleReject).not.toHaveBeenCalled();
      first.unmount();
      mount();
      await waitFor(() =>
        expect(current().getByTestId("proposal-approve")).toBeEnabled(),
      );
      expect(old().queryByTestId("proposal-approve")).not.toBeInTheDocument();
      expect(
        screen.getByDisplayValue("Keep the navigation visible"),
      ).toBeDisabled();
      fireEvent.click(current().getByTestId("proposal-approve"));
      await waitFor(() =>
        expect(
          mocks.handleApply.mock.calls.map(([proposalId]) => proposalId),
        ).toEqual(["shared"]),
      );
      await waitFor(() =>
        expect(old().getByTestId("proposal-stepper-dot-0")).toHaveAttribute(
          "data-lifecycle",
          "applied",
        ),
      );
    },
  );

  it("ignores a historical preview's DRAFT copies when approving the current visual set", async () => {
    proposals = [
      {
        ...proposal("shared", ProposalAction.Create),
        status: ProposalStatus.Approved,
      },
      {
        ...proposal("second", ProposalAction.Delete),
        status: ProposalStatus.Rejected,
      },
      proposal("old-only", ProposalAction.Create),
    ];
    const oldPreview: UIElement = {
      ...preview,
      payload: {
        responseType: "plan_generation_visual_preview_v1",
        entries: [
          {
            proposalId: "shared",
            artifactFamily: "mockup",
            presentationOrder: 0,
          },
          {
            proposalId: "old-only",
            artifactFamily: "mockup",
            presentationOrder: 1,
          },
        ],
      },
    };
    mocks.messages = [
      system(
        "old-preview",
        [oldPreview],
        [
          feedback("old-feedback", true, [
            system(
              "current-preview",
              [preview],
              [feedback("current-feedback", false, [], true)],
            ),
          ]),
        ],
      ),
    ];
    mount();
    fireEvent.click(
      await within(screen.getByTestId("current-feedback")).findByTestId(
        "plan-generation-visual-preview-approve",
      ),
    );
    await waitFor(() => expect(mocks.handleNext).toHaveBeenCalledTimes(1));
    expect(mocks.handleNext.mock.calls[0][0]).toEqual({
      feedback: { action: "APPROVED", payload: {} },
    });
    expect(
      screen.queryByTestId("plan-generation-visual-preview-approve-confirm"),
    ).not.toBeInTheDocument();
    expect(mocks.handleApply).not.toHaveBeenCalled();
    expect(mocks.handleReject).not.toHaveBeenCalled();
  });

  it("preserves pending, failure and retry behavior for current approval", async () => {
    let rejectApproval: (error: Error) => void = () => {};
    mocks.handleApply.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectApproval = reject;
        }),
    );
    mount();
    fireEvent.click(await current().findByTestId("proposal-approve"));
    await waitFor(() =>
      expect(current().getByRole("progressbar")).toBeVisible(),
    );
    await act(async () => rejectApproval(new Error("Approval unavailable")));
    expect(current().getByText("Approval unavailable")).toBeVisible();
    fireEvent.click(current().getByRole("button", { name: "Retry Create" }));
    await waitFor(() => expect(mocks.handleApply).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(old().getByTestId("proposal-stepper-dot-0")).toHaveAttribute(
        "data-lifecycle",
        "applied",
      ),
    );
  });

  it("keeps a failed rejection DRAFT on reopening and allows a current retry", async () => {
    mocks.handleReject.mockRejectedValueOnce(
      new Error("Rejection unavailable"),
    );
    const first = mount();
    fireEvent.click(await current().findByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByTestId("proposal-reject-submit"));
    await waitFor(() =>
      expect(mocks.handleReject).toHaveBeenCalledWith("shared", ""),
    );
    first.unmount();
    mount();
    fireEvent.click(await current().findByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByTestId("proposal-reject-submit"));
    await waitFor(() => expect(mocks.handleReject).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(old().getByTestId("proposal-stepper-dot-0")).toHaveAttribute(
        "data-lifecycle",
        "rejected",
      ),
    );
    expect(old().queryByTestId("proposal-approve")).not.toBeInTheDocument();
  });
});
