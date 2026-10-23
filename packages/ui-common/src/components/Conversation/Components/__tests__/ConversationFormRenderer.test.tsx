import React from "react";
import { act, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockConversationMessage,
  createMockConversation,
  createMockMessage,
  renderWithConversationProvider,
  mockShouldShowForm,
  mockIsFinalStep,
  mockPrepareFormInitialData,
  mockCreateFormContext,
  mockGetButtonSecondAction,
} from "./conversationTestUtils";
import { ConversationFormRenderer as ResolvedFormRenderer } from "../ConversationFormRenderer";
import { useConversationContext } from "../ConversationContext";
import { resolveConversationForm } from "../../utils/conversationResponseModel";
import type { InteractiveReportAttachment } from "../../../Reports/reportConfig";
import type { ConversationMessage } from "../../../../types/conversation";

const ConversationFormRenderer = (props: {
  conversationMessage: ConversationMessage;
  messageIndex: number;
  totalMessages: number;
  inlineReports?: ReportDto[];
  interactiveReportAttachments?: InteractiveReportAttachment[];
  "data-testid"?: string;
}) => {
  const context = useConversationContext();
  const entry = props.conversationMessage;
  const message =
    entry.message.type === "SYSTEM"
      ? {
          ...entry.message,
          reports:
            props.interactiveReportAttachments?.map(({ report }) => report) ??
            entry.message.reports,
        }
      : entry.message;
  const resolvedForm = resolveConversationForm(
    { ...entry, message },
    props.messageIndex === props.totalMessages - 1,
    {
      resolver: context.conversationFormResolver,
      workflowCanSubmit: context.workflowStatus.canSubmit,
      isSubmitting: context.isSubmitting,
      readOnly: context.isReadOnly,
      isCliInputDisabled: context.isCliInputDisabled,
    },
  );
  return (
    <ResolvedFormRenderer
      {...props}
      resolvedForm={{
        ...resolvedForm,
        inlineReports: props.inlineReports ?? resolvedForm.inlineReports,
      }}
    />
  );
};
import {
  ProposalStatus,
  type ProposalResponseDto,
  ReportAudience,
  ReportType,
  ExtendedUIFieldType,
  type QuestionsSystemMessageData,
  type ReportDto,
} from "../../../../api";
import {
  setLifecycle,
  __resetForTests as resetProposalLifecycle,
} from "../../../ProposalDispatchers/proposalSelectedStateCache";
import type { ConversationFormResolution } from "../conversationFormTypes";
import type { RepositoryGroundingSubmission } from "../../../LlmForms/Registry/repositoryGroundingUtils";
import { RepositoryGroundingNextAction } from "../../../LlmForms/Registry/repositoryGroundingUtils";

type TestCliResult = {
  current: {
    type: "ready" | "disconnected";
    machine: { machineId: string };
  };
};

const cliResultRef = vi.hoisted<TestCliResult>(() => ({
  current: {
    type: "ready",
    machine: { machineId: "machine-1" },
  },
}));

vi.mock("../../../AgentSession/runtime/hooks/useCliRequired", () => ({
  useCliRequired: () => cliResultRef.current,
}));

vi.mock("../../../Reports/ReportViewer", () => ({
  ReportViewer: ({
    report,
    featureSyncDecisionInteraction,
    planInteraction,
  }) => (
    <button
      data-testid={`report-viewer-${report.id}`}
      data-interactive={
        planInteraction || featureSyncDecisionInteraction ? "true" : "false"
      }
      data-interaction-disabled={
        planInteraction?.disabled ??
        featureSyncDecisionInteraction?.disabled ??
        false
      }
      data-interaction-conversation-id={
        featureSyncDecisionInteraction?.conversationId
      }
      type="button"
      onClick={() =>
        planInteraction && !planInteraction.disabled
          ? planInteraction.submit(
              { [planInteraction.sourceUiElement.id]: { decision: "approve" } },
              planInteraction.parentMessageId,
            )
          : featureSyncDecisionInteraction &&
              !featureSyncDecisionInteraction.disabled
            ? featureSyncDecisionInteraction.submit(
                "Reports: Keep the current presentation",
                featureSyncDecisionInteraction.parentMessageId,
              )
            : undefined
      }
    >
      report viewer
    </button>
  ),
}));

const submissionMocks = vi.hoisted(() => ({
  emit: vi.fn(),
  launchRepositoryGroundingAnalysis: vi.fn(),
}));

vi.mock("../../hooks/useConversationEvents", () => ({
  useConversationEvents: () => ({ emit: submissionMocks.emit }),
}));

vi.mock("../../../../data/hooks/useRepositoryGroundingAnalysisLaunch", () => ({
  useRepositoryGroundingAnalysisLaunch: () => ({
    launchRepositoryGroundingAnalysis:
      submissionMocks.launchRepositoryGroundingAnalysis,
  }),
}));

vi.mock("../../../LlmForms/DynamicForm", () => ({
  DynamicForm: ({
    disabled,
    isSubmitted,
    isSubmittable,
    secondActions,
    status,
    composerResetMode,
    uiElements,
    inlineReports,
    onNext,
  }: {
    disabled: boolean;
    isSubmitted: boolean;
    isSubmittable: boolean;
    secondActions?: unknown[];
    status: string;
    composerResetMode?: "preserve" | "clearOnSuccess";
    uiElements?: Array<{ id: string }>;
    inlineReports?: ReportDto[];
    onNext: (data: Record<string, unknown>) => void;
  }) => (
    <button
      type="button"
      data-testid="dynamic-form"
      data-disabled={disabled}
      data-submitted={isSubmitted}
      data-submittable={isSubmittable}
      data-has-second-action={
        secondActions && secondActions.length > 0 ? "true" : "false"
      }
      data-status={status}
      data-composer-reset-mode={composerResetMode ?? "preserve"}
      data-ui-element-ids={uiElements?.map((element) => element.id).join(",")}
      data-inline-report-ids={inlineReports
        ?.map((report) => report.id)
        .join(",")}
      disabled={disabled}
      onClick={() =>
        onNext(
          uiElements?.[0]?.id
            ? { [uiElements[0].id]: "Use the safer behavior." }
            : { field: "value" },
        )
      }
    >
      dynamic form
    </button>
  ),
}));

describe("ConversationFormRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cliResultRef.current.type = "disconnected";
    submissionMocks.launchRepositoryGroundingAnalysis.mockResolvedValue({
      id: "session-1",
    });
  });

  it("wires repository analysis launch to the current workflow message", async () => {
    const formContext: Record<string, unknown> = {};
    const message = createMockConversationMessage({
      message: createMockMessage({
        id: "repository-grounding-message",
        data: {
          type: "QUESTIONS",
          nodeId: "repository_grounding_configuration",
          uiElements: [
            { id: "repository-grounding", type: "repository_grounding" },
          ],
        } as QuestionsSystemMessageData,
      }),
    });
    await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={0}
        totalMessages={1}
      />,
      {
        timeline: [message],
        formContext,
        conversationOverride: createMockConversation({
          id: "conversation-1",
          workflowId: "workflow-1",
        }),
      },
    );
    const submission = {
      entryMode: "existing",
      serviceId: "service-1",
      brief: "Analyze the selected service.",
      machineId: "machine-1",
      scope: "comprehensive",
      provider: "codex",
      model: "gpt-5.6-codex",
      reasoningEffort: "high",
      fastMode: false,
      bounds: {
        maxFiles: 100,
        maxTotalBytes: 1_000_000,
        maxFileBytes: 100_000,
        maxDepth: 8,
        maxGeneratedFiles: 20,
        maxIgnoredFiles: 20,
        maxUnsupportedFiles: 20,
        maxBinaryFiles: 20,
      },
      nextAction: RepositoryGroundingNextAction.StartAnalysis,
    } satisfies RepositoryGroundingSubmission;

    const launch = formContext.onRepositoryGroundingLaunch;
    expect(launch).toBeTypeOf("function");
    await act(async () => {
      await (launch as (value: RepositoryGroundingSubmission) => Promise<void>)(
        submission,
      );
    });

    expect(
      submissionMocks.launchRepositoryGroundingAnalysis,
    ).toHaveBeenCalledWith({
      organizationId: "test-org-id",
      projectId: "test-project-id",
      conversationId: "conversation-1",
      workflowId: "workflow-1",
      nodeId: "repository_grounding_configuration",
      parentMessageId: "repository-grounding-message",
      submission,
    });
    expect(submissionMocks.emit).toHaveBeenCalledWith({
      type: "submission-success",
      payload: {
        messageId: "repository-grounding-message",
        data: { repository_grounding: submission },
      },
    });
  });

  it("does not emit submission success when repository readiness is rejected", async () => {
    submissionMocks.launchRepositoryGroundingAnalysis.mockRejectedValueOnce(
      new Error("The selected machine is offline."),
    );
    const formContext: Record<string, unknown> = {};
    const message = createMockConversationMessage({
      message: createMockMessage({
        id: "repository-grounding-message",
        data: {
          type: "QUESTIONS",
          nodeId: "repository_grounding_configuration",
          uiElements: [
            { id: "repository-grounding", type: "repository_grounding" },
          ],
        } as QuestionsSystemMessageData,
      }),
    });
    await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={0}
        totalMessages={1}
      />,
      {
        timeline: [message],
        formContext,
        conversationOverride: createMockConversation({
          id: "conversation-1",
          workflowId: "workflow-1",
        }),
      },
    );

    const launch = formContext.onRepositoryGroundingLaunch;
    await expect(
      (launch as (value: RepositoryGroundingSubmission) => Promise<void>)({
        entryMode: "existing",
        serviceId: "service-1",
        brief: "Analyze the selected service.",
        machineId: "machine-1",
        scope: "comprehensive",
        provider: "codex",
        model: "gpt-5.6-codex",
        reasoningEffort: "high",
        fastMode: false,
        bounds: {
          maxFiles: 100,
          maxTotalBytes: 1_000_000,
          maxFileBytes: 100_000,
          maxDepth: 8,
          maxGeneratedFiles: 20,
          maxIgnoredFiles: 20,
          maxUnsupportedFiles: 20,
          maxBinaryFiles: 20,
        },
        nextAction: RepositoryGroundingNextAction.StartAnalysis,
      }),
    ).rejects.toThrow("The selected machine is offline.");
    expect(submissionMocks.emit).not.toHaveBeenCalled();
  });

  it("passes all carrier proposals and live approvals into the current form context", async () => {
    resetProposalLifecycle();
    const review = createMockConversationMessage({
      message: createMockMessage({
        id: "review",
        data: {
          type: "QUESTIONS",
          uiElements: [
            {
              id: "stages",
              type: "plan_generation_stage_review",
              label: "Stages",
              payload: { expectedStageCount: 2 },
            },
          ],
        },
      }),
    });
    const carriers = ["one", "two"].map((id) =>
      createMockConversationMessage({
        message: createMockMessage({
          id: `carrier-${id}`,
          data: { type: "CARRIER" },
          proposals: [
            {
              id,
              status: ProposalStatus.Draft,
              updatedAt: "2026-09-09T00:00:00Z",
            } as ProposalResponseDto,
          ],
        }),
      }),
    );
    await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={review}
        messageIndex={2}
        totalMessages={3}
      />,
      { timeline: [...carriers, review] },
    );
    expect(mockCreateFormContext.mock.lastCall?.at(-4)).toEqual({
      proposals: [
        { proposalId: "one", lifecycle: "DRAFT", targetWorkItemType: null },
        { proposalId: "two", lifecycle: "DRAFT", targetWorkItemType: null },
      ],
    });
    act(() => setLifecycle("one", "applied"));
    expect(mockCreateFormContext.mock.lastCall?.at(-4)).toEqual({
      proposals: [
        {
          proposalId: "one",
          lifecycle: "APPROVED",
          targetWorkItemType: null,
        },
        { proposalId: "two", lifecycle: "DRAFT", targetWorkItemType: null },
      ],
    });
  });

  it("renders a dynamic form when the message is eligible", async () => {
    const message = createMockConversationMessage({
      message: createMockMessage({
        data: {
          type: "QUESTIONS",
          uiElements: [{ id: "element-1" }],
        } as QuestionsSystemMessageData,
      }),
    });

    const sharedContext = {
      context: "value",
      interaction: { proposals: [] },
    };
    await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={0}
        totalMessages={1}
      />,
      {
        timeline: [message],
        calculateMessageStatus: "processing",
        workflowStatus: { canSubmit: false },
        isFinalStep: true,
        formInitialData: { initial: "data" },
        formContext: sharedContext,
        secondActions: [{ type: "action" }],
      },
    );

    expect(mockShouldShowForm).toHaveBeenCalledWith(message);
    expect(mockIsFinalStep).toHaveBeenCalledWith(0, 1);
    expect(mockPrepareFormInitialData).toHaveBeenCalled();
    expect(mockCreateFormContext).toHaveBeenCalled();
    expect(mockGetButtonSecondAction).toHaveBeenCalled();
    expect(mockGetButtonSecondAction.mock.calls[0]?.[5]).toBe(sharedContext);

    const button = screen.getByTestId("dynamic-form");
    expect(button).toHaveAttribute("data-disabled", "true");
    expect(button).toHaveAttribute("data-submitted", "true");
    expect(button).toHaveAttribute("data-submittable", "true");
    expect(button).toHaveAttribute("data-has-second-action", "true");
    expect(button).toHaveAttribute("data-status", "processing");
    expect(button).toHaveAttribute("data-composer-reset-mode", "preserve");
  });

  it("calls handleNext with the message id when the form is submitted", async () => {
    const message = createMockConversationMessage({
      message: createMockMessage({ id: "message-with-form" }),
    });

    const { onNext } = await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={1}
        totalMessages={3}
      />,
      {
        timeline: [message],
        isFinalStep: false,
      },
    );

    screen.getByTestId("dynamic-form").click();

    expect(onNext).toHaveBeenCalledWith(
      { field: "value" },
      "message-with-form",
    );
  });

  it("passes the rendered SYSTEM message node to secondary action submissions", async () => {
    const message = createMockConversationMessage({
      message: createMockMessage({
        id: "message-with-source-node",
        data: {
          type: "QUESTIONS",
          nodeId: "source-workflow-node",
          uiElements: [],
        } as QuestionsSystemMessageData,
      }),
    });

    const { onNext } = await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={0}
        totalMessages={1}
      />,
      { timeline: [message] },
    );

    const submitFromSecondaryAction = mockGetButtonSecondAction.mock
      .calls[0]?.[4] as
      | ((
          data: Record<string, unknown>,
          messageId: string,
          options?: Record<string, never>,
        ) => void)
      | undefined;

    submitFromSecondaryAction?.(
      { field: "value" },
      "message-with-source-node",
      {},
    );

    expect(onNext).toHaveBeenCalledWith(
      { field: "value" },
      "message-with-source-node",
      { nodeId: "source-workflow-node" },
    );
  });

  it("keeps generic forms disabled when CLI readiness is unavailable", async () => {
    cliResultRef.current.type = "disconnected";
    const message = createMockConversationMessage({
      message: createMockMessage({
        data: {
          type: "QUESTIONS",
          uiElements: [{ id: "element-1" }],
        } as QuestionsSystemMessageData,
      }),
    });

    await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={0}
        totalMessages={1}
      />,
      { timeline: [message], agentSessionId: "agent-session-id" },
    );

    expect(screen.getByTestId("dynamic-form")).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });

  it("renders and submits an owner-resolved form independently of generic readiness", async () => {
    const message = createMockConversationMessage({
      message: createMockMessage({ id: "owner-resolved-form-message" }),
    });
    const submit = vi.fn().mockResolvedValue(undefined);
    const formResolution: ConversationFormResolution = {
      responseDeclarations: [],
      uiElements: [{ id: "owner-field", type: ExtendedUIFieldType.Textarea }],
      disabled: false,
      isSubmitted: false,
      composerResetMode: "clearOnSuccess",
      submit,
    };
    const conversationFormResolver = vi.fn(() => formResolution);

    const { onNext } = await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={0}
        totalMessages={1}
      />,
      {
        timeline: [message],
        agentSessionId: "unrelated-agent-session",
        workflowStatus: { canSubmit: false },
        isFormSubmissionDisabled: true,
        isFormSubmitted: true,
        shouldShowForm: false,
        conversationFormResolver,
      },
    );

    const form = screen.getByTestId("dynamic-form");
    expect(conversationFormResolver).toHaveBeenCalledWith(message);
    expect(form).toHaveAttribute("data-disabled", "false");
    expect(form).toHaveAttribute("data-submitted", "false");
    expect(form).toHaveAttribute("data-ui-element-ids", "owner-field");
    expect(form).toHaveAttribute("data-composer-reset-mode", "clearOnSuccess");

    form.click();

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        "owner-field": "Use the safer behavior.",
      }),
    );
    expect(onNext).not.toHaveBeenCalled();
    expect(submissionMocks.emit).toHaveBeenCalledWith({
      type: "submission-success",
      payload: {
        messageId: "owner-resolved-form-message",
        data: { "owner-field": "Use the safer behavior." },
      },
    });
  });

  it("uses the owner resolution for unavailable form state", async () => {
    const message = createMockConversationMessage({
      message: createMockMessage({ id: "unavailable-owner-form-message" }),
    });
    const conversationFormResolver = vi.fn((): ConversationFormResolution => ({
      responseDeclarations: [],
      uiElements: [{ id: "owner-field", type: ExtendedUIFieldType.Textarea }],
      disabled: true,
      isSubmitted: false,
      submit: vi.fn().mockResolvedValue(undefined),
    }));

    await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={0}
        totalMessages={1}
      />,
      {
        timeline: [message],
        workflowStatus: { canSubmit: false },
        isFormSubmissionDisabled: true,
        shouldShowForm: false,
        conversationFormResolver,
      },
    );

    expect(screen.getByTestId("dynamic-form")).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });

  it("reports owner submission failures without falling back to handleNext", async () => {
    const message = createMockConversationMessage({
      message: createMockMessage({ id: "failed-owner-form-message" }),
    });
    const submit = vi
      .fn()
      .mockRejectedValue(new Error("The owner could not accept the form."));
    const conversationFormResolver = vi.fn((): ConversationFormResolution => ({
      responseDeclarations: [],
      uiElements: [{ id: "owner-field", type: ExtendedUIFieldType.Textarea }],
      disabled: false,
      isSubmitted: false,
      submit,
    }));

    const { onNext } = await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={0}
        totalMessages={1}
      />,
      { timeline: [message], conversationFormResolver },
    );

    screen.getByTestId("dynamic-form").click();

    await waitFor(() =>
      expect(submissionMocks.emit).toHaveBeenCalledWith({
        type: "submission-error",
        payload: {
          error: expect.any(Error),
          data: { "owner-field": "Use the safer behavior." },
          parentMessageId: "failed-owner-form-message",
        },
      }),
    );
    expect(onNext).not.toHaveBeenCalled();
  });

  it("does not render a dynamic form when shouldShowForm is false", async () => {
    const message = createMockConversationMessage({
      message: createMockMessage({
        data: {
          type: "QUESTIONS",
          uiElements: [{ id: "element-1" }],
        } as QuestionsSystemMessageData,
      }),
    });

    await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={0}
        totalMessages={1}
      />,
      {
        timeline: [message],
        shouldShowForm: false,
      },
    );

    expect(screen.queryByTestId("dynamic-form")).not.toBeInTheDocument();
  });

  it("renders a read-only form preview when viewer is readOnly", async () => {
    const message = createMockConversationMessage({
      message: createMockMessage({
        data: {
          type: "QUESTIONS",
          uiElements: [{ id: "element-1", type: "coding_prompt_startup_plan" }],
        } as QuestionsSystemMessageData,
      }),
    });

    await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={0}
        totalMessages={1}
      />,
      {
        timeline: [message],
        readOnly: true,
        isFormSubmissionDisabled: false,
        isFormSubmitted: false,
      },
    );

    const button = screen.getByTestId("dynamic-form");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("data-disabled", "true");
  });

  it.each(["exclusive", "contribution", "display-only"] as const)(
    "renders an attached PLAN report with %s ownership and suppresses its duplicated field",
    async (ownership) => {
      const sourceUiElement = {
        id: "startup-plan-field",
        type: "coding_prompt_startup_plan",
        label: "Startup plan",
      };
      const message = createMockConversationMessage({
        message: createMockMessage({
          id: "interactive-plan-message",
          data: {
            type: "QUESTIONS",
            uiElements: [sourceUiElement],
          } as QuestionsSystemMessageData,
        }),
      });
      const report = {
        id: "interactive-plan-report",
        organizationId: "test-org-id",
        audience: ReportAudience.ProjectVisible,
        version: 1,
        schemaVersion: 1,
        sourceExecutionId: "run-1",
        createdAt: "2026-08-20T00:00:00.000Z",
        expiresAt: null,
        entities: [],
        reportType: ReportType.Plan,
        title: "Startup plan",
        payload: {},
      } as ReportDto;

      const { onNext } = await renderWithConversationProvider(
        <ConversationFormRenderer
          conversationMessage={message}
          interactiveReportAttachments={[
            { report, responseUiElement: sourceUiElement },
          ]}
          messageIndex={0}
          totalMessages={1}
        />,
        {
          timeline: [message],
          conversationFormResolver:
            ownership === "exclusive"
              ? undefined
              : () => ({
                  uiElements: [sourceUiElement],
                  responseDeclarations: [
                    ownership === "display-only"
                      ? { ownership }
                      : {
                          ownership,
                          currentFieldId: sourceUiElement.id,
                          submissionKind: "report",
                        },
                  ],
                  disabled: false,
                  isSubmitted: false,
                  submit: vi.fn(),
                }),
        },
      );

      const reportViewer = screen.getByTestId(
        "report-viewer-interactive-plan-report",
      );
      expect(reportViewer).toHaveAttribute(
        "data-interactive",
        String(ownership === "exclusive"),
      );
      expect(screen.queryByTestId("dynamic-form")).not.toBeInTheDocument();

      reportViewer.click();
      if (ownership === "exclusive") {
        expect(onNext).toHaveBeenCalledWith(
          { "startup-plan-field": { decision: "approve" } },
          "interactive-plan-message",
        );
      } else {
        expect(onNext).not.toHaveBeenCalled();
      }
    },
  );

  it("renders an attached Feature Sync decision report with an explicit response context", async () => {
    const responseUiElement = {
      id: "feature-sync-decision-response",
      type: "agent-reply-textarea",
      label: "Feature Sync decision response",
    };
    const message = createMockConversationMessage({
      message: createMockMessage({ id: "feature-sync-decision-message" }),
    });
    const report = {
      id: "feature-sync-decision-report",
      reportType: ReportType.FeatureSyncDecision,
    } as ReportDto;

    const { onNext } = await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        interactiveReportAttachments={[{ report, responseUiElement }]}
        messageIndex={0}
        totalMessages={1}
      />,
      { timeline: [message] },
    );

    const reportViewer = screen.getByTestId(
      "report-viewer-feature-sync-decision-report",
    );
    expect(reportViewer).toHaveAttribute("data-interactive", "true");
    expect(reportViewer).toHaveAttribute("data-interaction-disabled", "false");
    expect(reportViewer).toHaveAttribute(
      "data-interaction-conversation-id",
      "test-conversation-id",
    );

    reportViewer.click();
    expect(onNext).toHaveBeenCalledWith(
      { response: "Reports: Keep the current presentation" },
      "feature-sync-decision-message",
    );
  });

  it("does not pass a Feature Sync response context to read-only viewers", async () => {
    const message = createMockConversationMessage({
      message: createMockMessage({ id: "read-only-feature-sync-message" }),
    });
    const report = {
      id: "read-only-feature-sync-report",
      reportType: ReportType.FeatureSyncDecision,
    } as ReportDto;

    await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        interactiveReportAttachments={[
          {
            report,
            responseUiElement: {
              id: "feature-sync-decision-response",
              type: "agent-reply-textarea",
              label: "Feature Sync decision response",
            },
          },
        ]}
        messageIndex={0}
        totalMessages={1}
      />,
      { timeline: [message], readOnly: true },
    );

    expect(
      screen.getByTestId("report-viewer-read-only-feature-sync-report"),
    ).toHaveAttribute("data-interactive", "false");
  });

  it("keeps completed interstitial narration while rendering its carried PLAN report as disabled interactive review", async () => {
    const narrationUiElement = {
      id: "interstitial",
      type: "interstitial",
      label: "",
    };
    const responseUiElement = {
      id: "coding_prompt_startup_plan",
      type: "coding_prompt_startup_plan",
      label: "Startup plan",
    };
    const message = createMockConversationMessage({
      canEdit: false,
      message: createMockMessage({
        id: "interstitial-plan-message",
        data: {
          type: "AGENT",
          response: "Prepared the implementation plan.",
          uiElements: [narrationUiElement],
        } as QuestionsSystemMessageData,
      }),
    });
    const report = {
      id: "carried-plan-report",
      reportType: ReportType.Plan,
    } as ReportDto;

    const { onNext } = await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        interactiveReportAttachments={[{ report, responseUiElement }]}
        messageIndex={0}
        totalMessages={2}
      />,
      {
        timeline: [message],
        isFinalStep: false,
        isFormSubmissionDisabled: true,
        isFormSubmitted: true,
      },
    );

    expect(screen.getByTestId("dynamic-form")).toHaveAttribute(
      "data-ui-element-ids",
      "interstitial",
    );
    const reportViewer = screen.getByTestId(
      "report-viewer-carried-plan-report",
    );
    expect(reportViewer).toHaveAttribute("data-interactive", "true");
    expect(reportViewer).toHaveAttribute("data-interaction-disabled", "true");

    reportViewer.click();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("uses the host message edit state for a carried PLAN report without a form", async () => {
    const responseUiElement = {
      id: "coding_prompt_startup_plan",
      type: "coding_prompt_startup_plan",
      label: "Startup plan",
    };
    const message = createMockConversationMessage({
      canEdit: false,
      message: createMockMessage({
        id: "carrier-hosted-plan-message",
        data: {
          type: "AGENT",
          response: "Prepared the implementation plan.",
        } as QuestionsSystemMessageData,
      }),
    });
    const report = {
      id: "carrier-hosted-plan-report",
      reportType: ReportType.Plan,
    } as ReportDto;

    const { onNext } = await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        interactiveReportAttachments={[{ report, responseUiElement }]}
        messageIndex={0}
        totalMessages={1}
      />,
      {
        timeline: [message],
        shouldShowForm: false,
        isFormSubmissionDisabled: true,
      },
    );

    expect(screen.queryByTestId("dynamic-form")).not.toBeInTheDocument();
    const reportViewer = screen.getByTestId(
      "report-viewer-carrier-hosted-plan-report",
    );
    expect(reportViewer).toHaveAttribute("data-interactive", "true");
    expect(reportViewer).toHaveAttribute("data-interaction-disabled", "true");

    reportViewer.click();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("keeps the PLAN presentation interactive while submission readiness disables its controls", async () => {
    const responseUiElement = {
      id: "coding_prompt_startup_plan",
      type: "coding_prompt_startup_plan",
      label: "Startup plan",
    };
    const message = createMockConversationMessage({
      message: createMockMessage({ id: "temporarily-disabled-plan-message" }),
    });
    const report = {
      id: "temporarily-disabled-plan-report",
      reportType: ReportType.Plan,
    } as ReportDto;

    const { onNext } = await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        interactiveReportAttachments={[{ report, responseUiElement }]}
        messageIndex={0}
        totalMessages={1}
      />,
      {
        timeline: [message],
        workflowStatus: { canSubmit: false },
        isFormSubmissionDisabled: true,
      },
    );

    const reportViewer = screen.getByTestId(
      "report-viewer-temporarily-disabled-plan-report",
    );
    expect(reportViewer).toHaveAttribute("data-interactive", "true");
    expect(reportViewer).toHaveAttribute("data-interaction-disabled", "true");
    reportViewer.click();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("falls back to a read-only PLAN report when the conversation cannot respond", async () => {
    const sourceUiElement = {
      id: "startup-plan-field",
      type: "coding_prompt_startup_plan",
      label: "Startup plan",
    };
    const message = createMockConversationMessage({
      message: createMockMessage({
        data: {
          type: "QUESTIONS",
          uiElements: [sourceUiElement],
        } as QuestionsSystemMessageData,
      }),
    });
    const report = {
      id: "read-only-plan-report",
      reportType: ReportType.Plan,
    } as ReportDto;

    await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        interactiveReportAttachments={[
          { report, responseUiElement: sourceUiElement },
        ]}
        messageIndex={0}
        totalMessages={1}
      />,
      { timeline: [message], readOnly: true },
    );

    expect(
      screen.getByTestId("report-viewer-read-only-plan-report"),
    ).toHaveAttribute("data-interactive", "false");
    expect(screen.queryByTestId("dynamic-form")).not.toBeInTheDocument();
  });

  it("passes composer reset override from conversation context", async () => {
    const message = createMockConversationMessage({
      message: createMockMessage({
        data: {
          type: "QUESTIONS",
          uiElements: [{ id: "element-1" }],
        } as QuestionsSystemMessageData,
      }),
    });

    await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={0}
        totalMessages={1}
      />,
      {
        timeline: [message],
        composerResetMode: "clearOnSuccess",
      },
    );

    expect(screen.getByTestId("dynamic-form")).toHaveAttribute(
      "data-composer-reset-mode",
      "clearOnSuccess",
    );
  });

  it("passes inline report attachments into the dynamic field path", async () => {
    const message = createMockConversationMessage({
      message: createMockMessage({
        data: {
          type: "QUESTIONS",
          uiElements: [{ id: "interstitial", type: "interstitial" }],
        } as QuestionsSystemMessageData,
      }),
    });

    await renderWithConversationProvider(
      <ConversationFormRenderer
        conversationMessage={message}
        messageIndex={0}
        totalMessages={1}
        inlineReports={[{ id: "feature-sync-decision-report" } as ReportDto]}
      />,
      { timeline: [message] },
    );

    expect(screen.getByTestId("dynamic-form")).toHaveAttribute(
      "data-inline-report-ids",
      "feature-sync-decision-report",
    );
  });
});
