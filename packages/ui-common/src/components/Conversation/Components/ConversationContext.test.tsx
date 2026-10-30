import {
  conversationFixture,
  fixtureMessages,
} from "../../../test/conversationFixtures";
import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { getDefaultStore } from "jotai";
import {
  ConversationProvider,
  useConversationContext,
} from "./ConversationContext";
import type {
  ConversationResponseDto,
  ProjectResponseDto,
  ReportDto,
} from "../../../api";
import {
  ReportType,
  ProposalStatus,
  TargetEntityType,
  type SecondaryActionConfig,
  type UIElement,
} from "../../../api";
import userEvent from "@testing-library/user-event";
import { getButtonSecondActions } from "../utils/conversationFormHelpers";
import {
  setLifecycle,
  __resetForTests as resetProposalLifecycle,
} from "../../ProposalDispatchers/proposalSelectedStateCache";
import { messageRealtimeByConversationAtom } from "../../../data/websockets/messageRealtimeState";
const TestStageReadiness: React.FC<{
  onSubmit: ReturnType<typeof vi.fn>;
}> = ({ onSubmit }) => {
  const { proposalInteraction } = useConversationContext();
  const field: UIElement = {
    id: "review",
    type: "plan_generation_stage_review",
    label: "Stages",
    payload: { expectedStageCount: 2 },
  };
  const action: SecondaryActionConfig = {
    id: "ready",
    type: "field_action",
    presentation: "BUTTON",
    label: "Ready for next step",
    fieldId: field.id,
    handler: "plan_generation_stage_review_approve_all",
  };
  const actions = getButtonSecondActions(
    { secondaryActions: [action] },
    [field],
    "review-message",
    vi.fn(),
    onSubmit,
    {
      conversationId: "conversation",
      projectId: "project",
      organizationId: "organization",
      interaction: proposalInteraction,
      messageData: { type: "QUESTIONS", uiElements: [field] },
    },
  );
  return (
    <>
      {actions[0]?.render?.(
        { review: { payload: { feedback: "" } } },
        { isSubmissionLocked: false },
      )}
    </>
  );
};
// Test component to access context
const TestComponent: React.FC = () => {
  const { conversationTimeline } = useConversationContext();
  return <div data-testid="timeline-count">{conversationTimeline.length}</div>;
};
const TestCliGateComponent: React.FC = () => {
  const { isCliInputDisabled } = useConversationContext();
  return (
    <div data-testid="cli-input-disabled">{String(isCliInputDisabled)}</div>
  );
};
const TestTimelineIdsComponent: React.FC = () => {
  const { conversationTimeline } = useConversationContext();
  return (
    <div data-testid="timeline-ids">
      {conversationTimeline.map((entry) => entry.message.id).join("|")}
    </div>
  );
};
const TestProposalsComponent: React.FC = () => {
  const { conversationTimeline } = useConversationContext();
  return (
    <div data-testid="timeline-proposals">
      {conversationTimeline
        .map((entry) => {
          const proposalCount =
            entry.message.type === "SYSTEM"
              ? (entry.message.proposals?.length ?? 0)
              : 0;
          return `${entry.message.id}:${proposalCount}`;
        })
        .join("|")}
    </div>
  );
};
const TestReportsComponent: React.FC = () => {
  const { conversationTimeline } = useConversationContext();
  return (
    <div data-testid="timeline-reports">
      {conversationTimeline
        .map((entry) => {
          const reportCount =
            entry.message.type === "SYSTEM"
              ? (entry.message.reports?.length ?? 0)
              : 0;
          return `${entry.message.id}:${reportCount}`;
        })
        .join("|")}
    </div>
  );
};
const TestArtifactIdsComponent: React.FC = () => {
  const { conversationTimeline } = useConversationContext();
  return (
    <div data-testid="timeline-artifact-ids">
      {conversationTimeline
        .map((entry) => {
          if (entry.message.type !== "SYSTEM") {
            return `${entry.message.id}:p[]:r[]`;
          }
          const proposalIds = (entry.message.proposals ?? [])
            .map((proposal) => proposal.id)
            .join(",");
          const reportIds = (entry.message.reports ?? [])
            .map((report) => report.id)
            .join(",");
          return `${entry.message.id}:p[${proposalIds}]:r[${reportIds}]`;
        })
        .join("|")}
    </div>
  );
};
const TestResponseComponent: React.FC = () => {
  const { conversationTimeline } = useConversationContext();
  const firstMessageResponse =
    conversationTimeline[0]?.message.type === "SYSTEM"
      ? (conversationTimeline[0].message.data?.response ?? "")
      : "";
  return <div data-testid="timeline-response">{firstMessageResponse}</div>;
};
const TestRenderCountComponent: React.FC = () => {
  const { conversationTimeline } = useConversationContext();
  const renderCountRef = React.useRef(0);
  renderCountRef.current += 1;
  return (
    <>
      <div data-testid="timeline-count">{conversationTimeline.length}</div>
      <div data-testid="render-count">{renderCountRef.current}</div>
    </>
  );
};
// Mock the hooks used by ConversationProvider
vi.mock("../hooks", () => ({
  useConversationSubmission: vi.fn(() => ({
    isSubmitting: false,
    versionConflictDialog: null,
    handleNext: vi.fn(),
    handleRetrySuccess: vi.fn(),
    handleAnalysisAcknowledged: vi.fn(),
  })),
  useConversationScrolling: vi.fn(() => ({
    handleStepClick: vi.fn(),
  })),
}));
const cliResultRef = vi.hoisted(() => ({
  current: {
    type: "disconnected",
    machine: { machineId: "machine-1" },
  } as
    | {
        type: "loading";
      }
    | {
        type: "ready";
        machine: {
          machineId: string;
        };
      }
    | {
        type: "disconnected";
        machine: {
          machineId: string;
        };
      },
}));
vi.mock("../../AgentSession/runtime/hooks/useCliRequired", () => ({
  useCliRequired: vi.fn(() => cliResultRef.current),
}));
const toolCallsHook = vi.hoisted(() => ({ use: vi.fn() }));
vi.mock("../../AgentSession/runtime/hooks/useLatestTurnToolCalls", () => ({
  useLatestTurnToolCalls: (...args: unknown[]) => toolCallsHook.use(...args),
}));
vi.mock("../../../hooks", () => ({
  useUserIdentity: vi.fn(() => ({
    userId: "test-user",
  })),
}));
vi.mock("../../../hooks/useWorkflowStatus", () => ({
  useWorkflowStatus: vi.fn(() => ({
    status: "active",
    message: "Ready",
    canSubmit: true,
    showLoader: false,
  })),
}));
describe("ConversationContext Timeline Calculation", () => {
  beforeEach(() => {
    const store = getDefaultStore();
    store.set(messageRealtimeByConversationAtom, {});
  });
  const suggestionDecisions = {
    decisionsById: {},
    getDecision: () => undefined,
    upsertDecision: vi.fn(),
  };
  const mockProject: ProjectResponseDto = {
    id: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
    name: "Test Project",
    description: "Test Description",
    organizationId: "test-org",
    status: "active" as any,
    createdAt: "2025-09-06T05:16:15.429Z",
    updatedAt: "2025-09-06T05:16:15.429Z",
    deletedAt: null,
  };
  const testConversationData: ConversationResponseDto = conversationFixture(
    {
      id: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
      projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
      workflowId:
        "initiative-refinement-f53579a6-9997-4ef7-a10d-581342737cfc-1757135776015",
      workflowName: null,
      initiatedBy: "SYSTEM",
      triggerEvent: "initiative_reasoning_created",
      status: "IN_PROGRESS",
      title: "initiative-refinement - Node: prompt_next_input",
      version: 6,
      lastModifiedBy: null,
      category: "initiative_refinement",
      initiativeId: "f53579a6-9997-4ef7-a10d-581342737cfc",
      workflowAboutId: null,
      createdAt: "2025-09-06T05:16:15.429Z",
      updatedAt: "2025-09-06T05:17:14.618Z",
    },
    [
      {
        id: "5e35ad80-2be1-4808-bb3a-17a12c73bd68",
        workflowId:
          "initiative-refinement-f53579a6-9997-4ef7-a10d-581342737cfc-1757135776015",
        projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
        status: "completed",
        conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
        parentMessageId: null,
        createdAt: "2025-09-06T05:16:16.157Z",
        responses: [
          {
            id: "d447b059-bd58-4163-a070-1fd3aff6d281",
            workflowId:
              "initiative-refinement-f53579a6-9997-4ef7-a10d-581342737cfc-1757135776015",
            projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
            status: "open",
            conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
            parentMessageId: "5e35ad80-2be1-4808-bb3a-17a12c73bd68",
            createdAt: "2025-09-06T05:17:13.951Z",
            responses: [],
            type: "SYSTEM",
            data: {
              type: "QUESTIONS",
              response:
                "Great! We've got details now. These help define the particulars of this initiative. What do think?",
              uiElements: [
                {
                  id: "what_next",
                  type: "textarea",
                  label: "What should we do next",
                  influences: [],
                },
              ],
              detectedIntent: "",
              intentConfidence: 0,
            },
            awaitingResponse: true,
          },
        ],
        type: "SYSTEM",
        data: {
          type: "INITIATIVES",
          response: "opener processing completed",
          reasoning: null,
          uiElements: [
            {
              id: "initiative_feedback",
              type: "initiative_intro",
              label:
                "Let's review the high-level description of this initiative. What would you like to change or improve?",
              required: false,
              influences: [],
              description:
                "You're currently reviewing the description level of this initiative. Feel free to suggest changes or approve to move to the next step.",
              placeholder:
                "Share your thoughts on the initiative name, description, scope, or priority...",
            },
          ],
          currentLevel: "description",
          detectedIntent: "opener_displayed",
          intentConfidence: 1,
        },
        awaitingResponse: false,
      },
    ],
  ) as ConversationResponseDto;
  it("omits a marked SYSTEM row while retaining its nested response", () => {
    const root = fixtureMessages(testConversationData)[0];
    if (!root || root.type !== "SYSTEM")
      throw new Error("Missing fixture SYSTEM message");
    const conversation = conversationFixture(testConversationData, [
      {
        ...root,
        data: {
          type: "QUESTIONS",
          response: "Starting...",
          uiElements: [
            {
              id: "hidden",
              type: "agent_hidden",
              label: "Hidden",
              influences: [],
            },
          ],
        },
      },
    ]);
    const { getByTestId } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(conversation)}
        project={mockProject}
        animationType="minimal"
        suggestionDecisions={suggestionDecisions}
      >
        <TestTimelineIdsComponent />
      </ConversationProvider>,
    );
    expect(getByTestId("timeline-ids").textContent).toBe(
      "d447b059-bd58-4163-a070-1fd3aff6d281",
    );
  });
  it("should create a timeline with 2 messages from nested conversation data", () => {
    const { getByTestId } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(testConversationData)}
        project={mockProject}
        animationType="minimal"
        suggestionDecisions={suggestionDecisions}
      >
        <TestComponent />
      </ConversationProvider>,
    );
    const timelineCount = getByTestId("timeline-count");
    // Should have 2 messages: parent message + its response
    expect(timelineCount.textContent).toBe("2");
  });
  it("should flatten system descendants when the top-level conversation message is USER", () => {
    const userRootConversation: ConversationResponseDto = conversationFixture(
      {
        ...testConversationData,
      },
      [
        {
          id: "top-user",
          workflowId: "test-workflow",
          projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
          status: "completed",
          conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
          parentMessageId: null,
          createdAt: "2025-09-06T05:16:16.157Z",
          responses: [
            {
              id: "nested-system-under-user",
              workflowId: "test-workflow",
              projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
              status: "open",
              conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
              parentMessageId: "top-user",
              createdAt: "2025-09-06T05:17:13.951Z",
              responses: [],
              type: "SYSTEM",
              data: {
                type: "ANALYSIS",
                response: "Nested system message",
              },
              awaitingResponse: false,
            },
          ],
          type: "USER",
          data: {
            comment: "Top-level user message",
          },
          awaitingResponse: false,
        },
      ],
    ) as ConversationResponseDto;
    const { getByTestId } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(userRootConversation)}
        project={mockProject}
        animationType="minimal"
        suggestionDecisions={suggestionDecisions}
      >
        <TestComponent />
      </ConversationProvider>,
    );
    const timelineCount = getByTestId("timeline-count");
    // Top-level user + nested system descendant
    expect(timelineCount.textContent).toBe("2");
  });
  it("should exclude nested USER responses from timeline by default", () => {
    const nestedUserConversation: ConversationResponseDto = conversationFixture(
      {
        ...testConversationData,
      },
      [
        {
          id: "root-system",
          workflowId: "test-workflow",
          projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
          status: "completed",
          conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
          parentMessageId: null,
          createdAt: "2025-09-06T05:16:16.157Z",
          responses: [
            {
              id: "nested-user",
              workflowId: "test-workflow",
              projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
              status: "completed",
              conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
              parentMessageId: "root-system",
              createdAt: "2025-09-06T05:17:00.000Z",
              responses: [
                {
                  id: "nested-system",
                  workflowId: "test-workflow",
                  projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
                  status: "open",
                  conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
                  parentMessageId: "nested-user",
                  createdAt: "2025-09-06T05:17:30.000Z",
                  responses: [],
                  type: "SYSTEM",
                  data: {
                    type: "QUESTIONS",
                    response: "Follow-up system question",
                    uiElements: [],
                  },
                  awaitingResponse: true,
                },
              ],
              type: "USER",
              data: {
                comment: "Nested user response",
              },
              awaitingResponse: false,
            },
          ],
          type: "SYSTEM",
          data: {
            type: "QUESTIONS",
            response: "Root question",
            uiElements: [],
          },
          awaitingResponse: false,
        },
      ],
    );
    const { getByTestId } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(nestedUserConversation)}
        project={mockProject}
        animationType="minimal"
        suggestionDecisions={suggestionDecisions}
      >
        <>
          <TestComponent />
          <TestTimelineIdsComponent />
        </>
      </ConversationProvider>,
    );
    expect(getByTestId("timeline-count").textContent).toBe("2");
    expect(getByTestId("timeline-ids").textContent).toBe(
      "root-system|nested-system",
    );
  });
  it("should include nested USER responses when renderNestedUserMessages is enabled", () => {
    const nestedUserConversation: ConversationResponseDto = conversationFixture(
      {
        ...testConversationData,
      },
      [
        {
          id: "root-system",
          workflowId: "test-workflow",
          projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
          status: "completed",
          conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
          parentMessageId: null,
          createdAt: "2025-09-06T05:16:16.157Z",
          responses: [
            {
              id: "nested-user",
              workflowId: "test-workflow",
              projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
              status: "completed",
              conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
              parentMessageId: "root-system",
              createdAt: "2025-09-06T05:17:00.000Z",
              responses: [
                {
                  id: "nested-system",
                  workflowId: "test-workflow",
                  projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
                  status: "open",
                  conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
                  parentMessageId: "nested-user",
                  createdAt: "2025-09-06T05:17:30.000Z",
                  responses: [],
                  type: "SYSTEM",
                  data: {
                    type: "QUESTIONS",
                    response: "Follow-up system question",
                    uiElements: [],
                  },
                  awaitingResponse: true,
                },
              ],
              type: "USER",
              data: {
                comment: "Nested user response",
              },
              awaitingResponse: false,
            },
          ],
          type: "SYSTEM",
          data: {
            type: "QUESTIONS",
            response: "Root question",
            uiElements: [],
          },
          awaitingResponse: false,
        },
      ],
    );
    const { getByTestId } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(nestedUserConversation)}
        project={mockProject}
        animationType="minimal"
        renderNestedUserMessages={true}
        suggestionDecisions={suggestionDecisions}
      >
        <>
          <TestComponent />
          <TestTimelineIdsComponent />
        </>
      </ConversationProvider>,
    );
    expect(getByTestId("timeline-count").textContent).toBe("3");
    expect(getByTestId("timeline-ids").textContent).toBe(
      "root-system|nested-user|nested-system",
    );
  });
  it("should include nested USER responses whose text rides the agentInput envelope", () => {
    const agentInputConversation: ConversationResponseDto = conversationFixture(
      {
        ...testConversationData,
      },
      [
        {
          id: "root-system",
          workflowId: "test-workflow",
          projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
          status: "completed",
          conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
          parentMessageId: null,
          createdAt: "2025-09-06T05:16:16.157Z",
          responses: [
            {
              id: "kickoff-user",
              workflowId: "test-workflow",
              projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
              status: "completed",
              conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
              parentMessageId: "root-system",
              createdAt: "2025-09-06T05:17:00.000Z",
              responses: [
                {
                  id: "followup-user",
                  workflowId: "test-workflow",
                  projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
                  status: "open",
                  conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
                  parentMessageId: "kickoff-user",
                  createdAt: "2025-09-06T05:17:30.000Z",
                  responses: [],
                  type: "USER",
                  // Follow-up: text rides `agentInput.userMessage`.
                  data: {
                    agentInput: { promptType: "free_form", userMessage: "hi!" },
                  } as never,
                  awaitingResponse: false,
                },
              ],
              type: "USER",
              // Run kickoff: prose rides agentInput.userMessage just like the
              // follow-up path, after the coordinated start-run payload rename.
              data: {
                agentInput: {
                  promptType: "free_form",
                  userMessage: "testing! say hi!",
                },
              } as never,
              awaitingResponse: false,
            },
          ],
          type: "SYSTEM",
          data: {
            type: "QUESTIONS",
            response: "Root question",
            uiElements: [],
          },
          awaitingResponse: false,
        },
      ],
    );
    const { getByTestId } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(agentInputConversation)}
        project={mockProject}
        animationType="minimal"
        renderNestedUserMessages={true}
        suggestionDecisions={suggestionDecisions}
      >
        <>
          <TestComponent />
          <TestTimelineIdsComponent />
        </>
      </ConversationProvider>,
    );
    expect(getByTestId("timeline-count").textContent).toBe("3");
    expect(getByTestId("timeline-ids").textContent).toBe(
      "root-system|kickoff-user|followup-user",
    );
  });
  it("should handle empty messages array", () => {
    const emptyConversation = conversationFixture(
      {
        ...testConversationData,
      },
      [],
    );
    const { getByTestId } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(emptyConversation)}
        project={mockProject}
        animationType="minimal"
        suggestionDecisions={suggestionDecisions}
      >
        <TestComponent />
      </ConversationProvider>,
    );
    const timelineCount = getByTestId("timeline-count");
    expect(timelineCount.textContent).toBe("0");
  });
  it("should handle null conversation", () => {
    const { container } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(null)}
        project={mockProject}
        animationType="minimal"
        suggestionDecisions={suggestionDecisions}
      >
        <TestComponent />
      </ConversationProvider>,
    );
    // Should render null when no active conversation
    expect(container.firstChild).toBeNull();
  });
  it("should show ROUTING message when it is the last message", () => {
    const conversationWithRoutingAtEnd: ConversationResponseDto =
      conversationFixture(
        {
          ...testConversationData,
        },
        [
          {
            id: "regular-message",
            workflowId: "test-workflow",
            projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
            status: "completed",
            conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
            parentMessageId: null,
            createdAt: "2025-09-06T05:16:16.157Z",
            responses: [
              {
                id: "routing-message",
                workflowId: "test-workflow",
                projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
                status: "open",
                conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
                parentMessageId: "regular-message",
                createdAt: "2025-09-06T05:17:13.951Z",
                responses: [],
                type: "SYSTEM",
                data: {
                  type: "ROUTING",
                } as any,
                awaitingResponse: false,
              },
            ],
            type: "SYSTEM",
            data: {
              type: "QUESTIONS",
              response: "Regular question",
              uiElements: [],
            },
            awaitingResponse: false,
          },
        ],
      );
    const { getByTestId } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(conversationWithRoutingAtEnd)}
        project={mockProject}
        animationType="minimal"
        suggestionDecisions={suggestionDecisions}
      >
        <TestComponent />
      </ConversationProvider>,
    );
    const timelineCount = getByTestId("timeline-count");
    // Should show both messages: regular + routing (since routing is last)
    expect(timelineCount.textContent).toBe("2");
  });
  it("should filter out ROUTING message when it is not the last message", () => {
    const conversationWithRoutingInMiddle: ConversationResponseDto =
      conversationFixture(
        {
          ...testConversationData,
        },
        [
          {
            id: "first-message",
            workflowId: "test-workflow",
            projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
            status: "completed",
            conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
            parentMessageId: null,
            createdAt: "2025-09-06T05:16:16.157Z",
            responses: [
              {
                id: "routing-message",
                workflowId: "test-workflow",
                projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
                status: "completed",
                conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
                parentMessageId: "first-message",
                createdAt: "2025-09-06T05:17:13.951Z",
                responses: [
                  {
                    id: "final-message",
                    workflowId: "test-workflow",
                    projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
                    status: "open",
                    conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
                    parentMessageId: "routing-message",
                    createdAt: "2025-09-06T05:18:13.951Z",
                    responses: [],
                    type: "SYSTEM",
                    data: {
                      type: "QUESTIONS",
                      response: "Final question",
                      uiElements: [],
                    },
                    awaitingResponse: true,
                  },
                ],
                type: "SYSTEM",
                data: {
                  type: "ROUTING",
                } as any,
                awaitingResponse: false,
              },
            ],
            type: "SYSTEM",
            data: {
              type: "QUESTIONS",
              response: "First question",
              uiElements: [],
            },
            awaitingResponse: false,
          },
        ],
      );
    const { getByTestId } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(conversationWithRoutingInMiddle)}
        project={mockProject}
        animationType="minimal"
        suggestionDecisions={suggestionDecisions}
      >
        <TestComponent />
      </ConversationProvider>,
    );
    const timelineCount = getByTestId("timeline-count");
    // Should show only 2 messages: first + final (routing filtered out)
    expect(timelineCount.textContent).toBe("2");
  });
  it("should handle conversation with only ROUTING message", () => {
    const conversationOnlyRouting: ConversationResponseDto =
      conversationFixture(
        {
          ...testConversationData,
        },
        [
          {
            id: "only-routing-message",
            workflowId: "test-workflow",
            projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
            status: "open",
            conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
            parentMessageId: null,
            createdAt: "2025-09-06T05:16:16.157Z",
            responses: [],
            type: "SYSTEM",
            data: {
              type: "ROUTING",
            } as any,
            awaitingResponse: false,
          },
        ],
      );
    const { getByTestId } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(conversationOnlyRouting)}
        project={mockProject}
        animationType="minimal"
        suggestionDecisions={suggestionDecisions}
      >
        <TestComponent />
      </ConversationProvider>,
    );
    const timelineCount = getByTestId("timeline-count");
    // Should show the routing message since it's the only/last message
    expect(timelineCount.textContent).toBe("1");
  });
  it("should overlay realtime loading and streaming responses on timeline messages", () => {
    const store = getDefaultStore();
    const realtimeConversation = conversationFixture(
      {
        ...testConversationData,
      },
      [
        {
          ...fixtureMessages(testConversationData)[0]!,
          status: "open",
        },
      ],
    ) as ConversationResponseDto;
    const conversationId = realtimeConversation.id;
    const messageId = fixtureMessages(realtimeConversation)[0]!.id;
    act(() => {
      store.set(messageRealtimeByConversationAtom, {
        [conversationId]: {
          patchesByMessageId: {
            [messageId]: {
              messageId,
              requestId: "req-1",
              lastSequence: 1,
              loadingText: "Working on it...",
            },
          },
          gapRefetchTriggered: false,
        },
      });
    });
    const { getByTestId } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(realtimeConversation)}
        project={mockProject}
        animationType="minimal"
        suggestionDecisions={suggestionDecisions}
      >
        <TestResponseComponent />
      </ConversationProvider>,
    );
    expect(getByTestId("timeline-response").textContent).toBe(
      "Working on it...",
    );
    act(() => {
      store.set(messageRealtimeByConversationAtom, {
        [conversationId]: {
          patchesByMessageId: {
            [messageId]: {
              messageId,
              requestId: "req-1",
              lastSequence: 2,
              response: "Final streamed response",
            },
          },
          gapRefetchTriggered: false,
        },
      });
    });
    expect(getByTestId("timeline-response").textContent).toBe(
      "Final streamed response",
    );
    act(() => {
      store.set(messageRealtimeByConversationAtom, {});
    });
  });
  describe("isCliInputDisabled (execution-readiness gating)", () => {
    beforeEach(() => {
      cliResultRef.current = {
        type: "disconnected",
        machine: { machineId: "machine-1" },
      };
    });
    it("is false when no agentSessionId is provided (gating does not apply)", () => {
      cliResultRef.current = {
        type: "ready",
        machine: { machineId: "machine-1" },
      };
      const { getByTestId } = render(
        <ConversationProvider
          conversation={withCanonicalMessages(testConversationData)}
          project={mockProject}
          animationType="minimal"
          suggestionDecisions={suggestionDecisions}
        >
          <TestCliGateComponent />
        </ConversationProvider>,
      );
      expect(getByTestId("cli-input-disabled").textContent).toBe("false");
    });
    it("is true when readiness is unavailable (no status received yet)", () => {
      // cliResultRef.current already set to disconnected in beforeEach.
      const { getByTestId } = render(
        <ConversationProvider
          conversation={withCanonicalMessages(testConversationData)}
          project={mockProject}
          animationType="minimal"
          agentSessionId="agent-session-1"
          suggestionDecisions={suggestionDecisions}
        >
          <TestCliGateComponent />
        </ConversationProvider>,
      );
      expect(getByTestId("cli-input-disabled").textContent).toBe("true");
    });
    it("is true when execution readiness is unavailable", () => {
      cliResultRef.current = {
        type: "disconnected",
        machine: { machineId: "machine-1" },
      };
      const { getByTestId } = render(
        <ConversationProvider
          conversation={withCanonicalMessages(testConversationData)}
          project={mockProject}
          animationType="minimal"
          agentSessionId="agent-session-1"
          suggestionDecisions={suggestionDecisions}
        >
          <TestCliGateComponent />
        </ConversationProvider>,
      );
      expect(getByTestId("cli-input-disabled").textContent).toBe("true");
    });
    it("is false only when execution readiness reports ready", () => {
      cliResultRef.current = {
        type: "ready",
        machine: { machineId: "machine-1" },
      };
      const { getByTestId } = render(
        <ConversationProvider
          conversation={withCanonicalMessages(testConversationData)}
          project={mockProject}
          animationType="minimal"
          agentSessionId="agent-session-1"
          suggestionDecisions={suggestionDecisions}
        >
          <TestCliGateComponent />
        </ConversationProvider>,
      );
      expect(getByTestId("cli-input-disabled").textContent).toBe("false");
    });
  });
  describe("live tool calls (single poller)", () => {
    const TestToolCallsComponent: React.FC = () => {
      const { latestTurnToolCalls, hasInterstitialInTimeline } =
        useConversationContext();
      return (
        <div data-testid="tool-calls">
          {latestTurnToolCalls.status}|{String(hasInterstitialInTimeline)}
        </div>
      );
    };
    const interstitialConversation = (response: string) => {
      const root = fixtureMessages(testConversationData)[0]!;
      if (root.type !== "SYSTEM") throw new Error("Missing SYSTEM fixture");
      return withCanonicalMessages(
        conversationFixture(testConversationData, [
          {
            ...root,
            responses: [],
            data: {
              type: "AGENT",
              response,
              uiElements: [
                { id: "interstitial", type: "interstitial", label: "" },
              ],
            },
          },
        ]),
      );
    };
    const renderProvider = (
      conversation: ConversationResponseDto,
      agentSessionCurrentState?:
        "IDLE" | "STARTING" | "THINKING" | "WRITING" | "AWAITING_APPROVAL",
    ) =>
      render(
        <ConversationProvider
          conversation={conversation}
          project={mockProject}
          animationType="minimal"
          agentSessionId="agent-session-1"
          agentSessionCurrentState={agentSessionCurrentState}
          suggestionDecisions={suggestionDecisions}
        >
          <TestToolCallsComponent />
        </ConversationProvider>,
      );
    beforeEach(() => {
      toolCallsHook.use.mockReset();
      toolCallsHook.use.mockReturnValue({ status: "idle" });
    });
    it.each(["THINKING", "WRITING"] as const)(
      "polls while the session is %s, before any narration exists",
      (state) => {
        const { getByTestId } = renderProvider(
          withCanonicalMessages(testConversationData),
          state,
        );
        expect(toolCallsHook.use).toHaveBeenLastCalledWith({
          organizationId: "test-org",
          projectId: mockProject.id,
          agentSessionId: "agent-session-1",
          activityKey: "",
          enabled: true,
        });
        expect(getByTestId("tool-calls").textContent).toBe("idle|false");
      },
    );
    it.each(["IDLE", "STARTING", "AWAITING_APPROVAL", undefined] as const)(
      "does not poll when the session is %s",
      (state) => {
        renderProvider(withCanonicalMessages(testConversationData), state);
        expect(toolCallsHook.use).toHaveBeenLastCalledWith(
          expect.objectContaining({ enabled: false }),
        );
      },
    );
    it("shares the polled state and flags narration in the timeline", () => {
      toolCallsHook.use.mockReturnValue({ status: "disabled" });
      const { getByTestId } = renderProvider(
        interstitialConversation("Reading files"),
        "WRITING",
      );
      expect(toolCallsHook.use).toHaveBeenLastCalledWith(
        expect.objectContaining({ activityKey: "Reading files" }),
      );
      expect(getByTestId("tool-calls").textContent).toBe("disabled|true");
    });
  });
  describe("explicit message artifact associations", () => {
    type AnyMessage = ConversationResponseDto["messages"][number];
    const baseFields = {
      workflowId: "test-workflow",
      projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
      conversationId: "702587f1-37bc-4f45-b6b8-d84ab5ced7a9",
      parentMessageId: null,
      createdAt: "2026-06-16T05:16:16.157Z",
      responses: [],
      awaitingResponse: false,
    };
    const carrier = (
      id: string,
      proposalIds: string[],
      reports: ReportDto[] = [],
    ): AnyMessage =>
      ({
        ...baseFields,
        id,
        status: "completed",
        type: "SYSTEM",
        data: { type: "CARRIER" },
        proposals: proposalIds.map((pid) => ({ id: pid })),
        reports,
      }) as unknown as AnyMessage;
    const report = (
      id: string,
      overrides: Partial<ReportDto> = {},
    ): ReportDto =>
      ({
        id,
        organizationId: "test-org",
        projectId: "7df1a7c5-4251-4809-ac4e-5b456539e40d",
        reportType: "IMPLEMENT",
        audience: "PROJECT_VISIBLE",
        title: "Report",
        payload: {
          reportType: "IMPLEMENT",
          summary:
            "Implemented the report metadata placement behavior and preserved the legacy fallback path.",
          filesChanged: [],
        },
        version: 1,
        schemaVersion: 1,
        createdAt: "2026-06-16T05:16:30.000Z",
        expiresAt: "2026-06-17T05:16:30.000Z",
        entities: [],
        ...overrides,
      }) as unknown as ReportDto;
    const completion = (id: string, response: string): AnyMessage =>
      ({
        ...baseFields,
        id,
        status: "completed",
        type: "SYSTEM",
        data: {
          type: "AGENT",
          response,
          actionHint: "task_complete",
          detectedIntent: "agent_response",
          intentConfidence: 1,
        },
      }) as unknown as AnyMessage;
    const delta = (
      id: string,
      response: string,
      options: {
        providerSessionId?: string;
        promptHandler?: string;
        createdAt?: string;
      } = {},
    ): AnyMessage =>
      ({
        ...baseFields,
        id,
        createdAt: options.createdAt ?? baseFields.createdAt,
        status: "completed",
        type: "SYSTEM",
        data: {
          type: "AGENT",
          response,
          ...(options.providerSessionId !== undefined
            ? { providerSessionId: options.providerSessionId }
            : {}),
          ...(options.promptHandler !== undefined
            ? { promptHandler: options.promptHandler }
            : {}),
        },
      }) as unknown as AnyMessage;
    const interstitial = (
      id: string,
      response: string,
      providerSessionId: string,
      responses: AnyMessage[] = [],
    ): AnyMessage =>
      ({
        ...baseFields,
        id,
        status: "completed",
        type: "SYSTEM",
        responses,
        data: {
          type: "AGENT",
          response,
          providerSessionId,
          uiElements: [{ id: "interstitial", type: "interstitial", label: "" }],
        },
      }) as unknown as AnyMessage;
    const renderTimeline = (messages: AnyMessage[]) =>
      render(
        <ConversationProvider
          conversation={withCanonicalMessages(
            conversationFixture(
              { ...testConversationData },
              messages,
            ) as ConversationResponseDto,
          )}
          project={mockProject}
          animationType="minimal"
          suggestionDecisions={suggestionDecisions}
        >
          <>
            <TestTimelineIdsComponent />
            <TestProposalsComponent />
            <TestReportsComponent />
            <TestArtifactIdsComponent />
          </>
        </ConversationProvider>,
      );
    it("enables readiness from any carrier approval without mounting its proposal component", async () => {
      resetProposalLifecycle();
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      const messages = [
        carrier("earlier-carrier", ["one"]),
        carrier("later-carrier", ["two"]),
      ];
      for (const message of messages) {
        if (message.type === "SYSTEM") {
          message.proposals = message.proposals?.map((p) => ({
            ...p,
            status: ProposalStatus.Draft,
            targetEntityType: TargetEntityType.Task,
            updates: { type: "PLAN_STAGE" },
            updatedAt: "2026-09-09T00:00:00Z",
          }));
        }
      }
      const { getByTestId, getByText, getByRole } = render(
        <ConversationProvider
          conversation={withCanonicalMessages(
            conversationFixture({ ...testConversationData }, messages),
          )}
          project={mockProject}
          suggestionDecisions={suggestionDecisions}
        >
          <TestTimelineIdsComponent />
          <TestStageReadiness onSubmit={onSubmit} />
        </ConversationProvider>,
      );
      expect(getByTestId("timeline-ids")).toHaveTextContent(
        "earlier-carrier|later-carrier",
      );
      expect(getByTestId("plan-generation-stage-review-ready")).toBeDisabled();
      act(() => setLifecycle("one", "applied"));
      expect(getByTestId("plan-generation-stage-review-ready")).toBeEnabled();
      await user.click(getByTestId("plan-generation-stage-review-ready"));
      expect(getByText("1/2 stages are approved.")).toBeVisible();
      await user.click(getByRole("button", { name: "Acknowledged" }));
      expect(onSubmit).not.toHaveBeenCalled();
      act(() => setLifecycle("one", "rejected"));
      expect(getByTestId("plan-generation-stage-review-ready")).toBeDisabled();
    });
    it("keeps explicit final-message artifacts on their source messages across turns and reloads", () => {
      const buildExplicitMessages = (): AnyMessage[] => [
        interstitial(
          "interstitial-narration",
          "Reviewing the completed response.",
          "provider-session-1",
        ),
        delta("narrative-delta", "The response is ready."),
        {
          ...completion("final-message-a", "First response complete."),
          proposals: [
            { id: "proposal-a-ungrouped" },
            {
              id: "proposal-a-group-one",
              groupMembership: { groupId: "proposal-group-a" },
            },
            {
              id: "proposal-a-group-two",
              groupMembership: { groupId: "proposal-group-a" },
            },
          ],
          reports: [
            report("report-a-inline", { reportType: ReportType.Snapshot }),
            report("report-a-interactive", { reportType: ReportType.Plan }),
          ],
        } as unknown as AnyMessage,
        {
          ...completion("final-message-b", "Second response complete."),
          proposals: [{ id: "proposal-b-ungrouped" }],
          reports: [
            report("report-b-inline", { reportType: ReportType.Implement }),
          ],
        } as unknown as AnyMessage,
      ];
      const { getByTestId, rerender } = renderTimeline(buildExplicitMessages());
      const expectExplicitPlacement = () => {
        expect(getByTestId("timeline-ids").textContent).toBe(
          "interstitial-narration|narrative-delta|final-message-a|final-message-b",
        );
        expect(getByTestId("timeline-proposals").textContent).toBe(
          "interstitial-narration:0|narrative-delta:0|final-message-a:3|final-message-b:1",
        );
        expect(getByTestId("timeline-reports").textContent).toBe(
          "interstitial-narration:0|narrative-delta:0|final-message-a:2|final-message-b:1",
        );
        expect(getByTestId("timeline-artifact-ids").textContent).toBe(
          "interstitial-narration:p[]:r[]|narrative-delta:p[]:r[]|final-message-a:p[proposal-a-ungrouped,proposal-a-group-one,proposal-a-group-two]:r[report-a-inline,report-a-interactive]|final-message-b:p[proposal-b-ungrouped]:r[report-b-inline]",
        );
      };
      expectExplicitPlacement();
      rerender(
        <ConversationProvider
          conversation={withCanonicalMessages(
            conversationFixture(
              {
                ...testConversationData,
              },
              buildExplicitMessages(),
            ) as ConversationResponseDto,
          )}
          project={mockProject}
          animationType="minimal"
          suggestionDecisions={suggestionDecisions}
        >
          <>
            <TestTimelineIdsComponent />
            <TestProposalsComponent />
            <TestReportsComponent />
            <TestArtifactIdsComponent />
          </>
        </ConversationProvider>,
      );
      expectExplicitPlacement();
    });
    it("keeps unresolved carrier artifacts at their source across turns and reloads", () => {
      const buildMessages = (): AnyMessage[] => [
        interstitial(
          "interstitial-a",
          "Narrating the first interaction.",
          "provider-session-a",
        ),
        carrier(
          "unresolved-carrier-a",
          ["carrier-proposal-a"],
          [report("carrier-report-a", { reportType: ReportType.Snapshot })],
        ),
        {
          ...completion("current-final-message", "First response complete."),
          proposals: [{ id: "current-proposal" }],
          reports: [
            report("current-report", { reportType: ReportType.Implement }),
          ],
        } as unknown as AnyMessage,
        interstitial(
          "interstitial-b",
          "Narrating the second interaction.",
          "provider-session-b",
        ),
        carrier(
          "unresolved-carrier-b",
          ["carrier-proposal-b"],
          [report("carrier-report-b", { reportType: ReportType.Snapshot })],
        ),
        {
          ...completion(
            "reconciled-final-message",
            "Second response complete.",
          ),
          proposals: [{ id: "reconciled-proposal" }],
          reports: [
            report("reconciled-report", { reportType: ReportType.Implement }),
          ],
        } as unknown as AnyMessage,
      ];
      const { getByTestId, rerender } = renderTimeline(buildMessages());
      const expectSourcePlacement = () => {
        expect(getByTestId("timeline-ids").textContent).toBe(
          "interstitial-a|unresolved-carrier-a|current-final-message|interstitial-b|unresolved-carrier-b|reconciled-final-message",
        );
        expect(getByTestId("timeline-proposals").textContent).toBe(
          "interstitial-a:0|unresolved-carrier-a:1|current-final-message:1|interstitial-b:0|unresolved-carrier-b:1|reconciled-final-message:1",
        );
        expect(getByTestId("timeline-reports").textContent).toBe(
          "interstitial-a:0|unresolved-carrier-a:1|current-final-message:1|interstitial-b:0|unresolved-carrier-b:1|reconciled-final-message:1",
        );
        expect(getByTestId("timeline-artifact-ids").textContent).toBe(
          "interstitial-a:p[]:r[]|unresolved-carrier-a:p[carrier-proposal-a]:r[carrier-report-a]|current-final-message:p[current-proposal]:r[current-report]|interstitial-b:p[]:r[]|unresolved-carrier-b:p[carrier-proposal-b]:r[carrier-report-b]|reconciled-final-message:p[reconciled-proposal]:r[reconciled-report]",
        );
      };
      expectSourcePlacement();
      rerender(
        <ConversationProvider
          conversation={withCanonicalMessages(
            conversationFixture(
              {
                ...testConversationData,
              },
              buildMessages(),
            ) as ConversationResponseDto,
          )}
          project={mockProject}
          animationType="minimal"
          suggestionDecisions={suggestionDecisions}
        >
          <>
            <TestTimelineIdsComponent />
            <TestProposalsComponent />
            <TestReportsComponent />
            <TestArtifactIdsComponent />
          </>
        </ConversationProvider>,
      );
      expectSourcePlacement();
    });
  });
  it("should not rerender when realtime updates are for a different conversation", () => {
    const store = getDefaultStore();
    const realtimeConversation = conversationFixture(
      {
        ...testConversationData,
      },
      [
        {
          ...fixtureMessages(testConversationData)[0]!,
          status: "open",
        },
      ],
    ) as ConversationResponseDto;
    const conversationId = realtimeConversation.id;
    const messageId = fixtureMessages(realtimeConversation)[0]!.id;
    const otherConversationId = "other-conversation-id";
    act(() => {
      store.set(messageRealtimeByConversationAtom, {
        [conversationId]: {
          patchesByMessageId: {
            [messageId]: {
              messageId,
              requestId: "req-1",
              lastSequence: 1,
              response: "Streaming response",
            },
          },
          gapRefetchTriggered: false,
        },
      });
    });
    const { getByTestId } = render(
      <ConversationProvider
        conversation={withCanonicalMessages(realtimeConversation)}
        project={mockProject}
        animationType="minimal"
        suggestionDecisions={suggestionDecisions}
      >
        <TestRenderCountComponent />
      </ConversationProvider>,
    );
    expect(getByTestId("timeline-count").textContent).toBe("2");
    expect(getByTestId("render-count").textContent).toBe("1");
    const currentRealtimeState = store.get(messageRealtimeByConversationAtom);
    act(() => {
      store.set(messageRealtimeByConversationAtom, {
        ...currentRealtimeState,
        [otherConversationId]: {
          patchesByMessageId: {
            "other-message-id": {
              messageId: "other-message-id",
              requestId: "req-other",
              lastSequence: 1,
              loadingText: "Other conversation update",
            },
          },
          gapRefetchTriggered: false,
        },
      });
    });
    expect(getByTestId("render-count").textContent).toBe("1");
  });
});

const canonicalMessagesMock = vi.hoisted(() => vi.fn());
vi.mock("../../../data/hooks/useConversationMessages", () => ({
  useConversationMessages: canonicalMessagesMock,
}));
function withCanonicalMessages(conversation: ConversationResponseDto) {
  const messages = fixtureMessages(conversation);
  canonicalMessagesMock.mockReturnValue({
    data: messages,
    orderedData: messages,
    undatedInputs: [],
    isFetched: true,
    isReady: true,
    isLoading: false,
    isFetching: false,
    isStale: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(messages),
    markStale: vi.fn(),
  });
  return conversation;
}
