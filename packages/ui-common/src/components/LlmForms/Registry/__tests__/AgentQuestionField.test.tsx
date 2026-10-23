import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentQuestionPayload } from "../../../../api";
import { AgentQuestionField } from "../AgentQuestionField";

const submitAnswerMock = vi.hoisted(() => vi.fn());
vi.mock(
  "../../../../data/hooks/useSubmitControllerAuthorizedQuestionAnswer",
  () => ({
    useSubmitControllerAuthorizedQuestionAnswer: () => ({
      submit: submitAnswerMock,
      isPending: false,
    }),
  })
);

const basePayload: AgentQuestionPayload = {
  responseType: "agent_question_v1",
  requestId: "question-1",
  sessionId: "provider-session-1",
  agentType: "claude",
  idempotencyToken: "idem-q1",
  questions: [
    {
      question: "Which database?",
      header: "Database",
      multiSelect: false,
      options: [
        { label: "Postgres", description: "Relational store" },
        { label: "SQLite", description: "Embedded file" },
      ],
    },
    {
      question: "Which caches?",
      header: "Caching",
      multiSelect: true,
      options: [
        { label: "Redis", description: "In-memory" },
        { label: "CDN", description: "Edge" },
      ],
    },
  ],
};

const renderField = (payload: AgentQuestionPayload = basePayload) =>
  render(
    <AgentQuestionField
      config={{
        field: "question-field",
        description: "Agent question",
        type: "agent_question",
        payload,
      }}
      context={{
        conversationId: "conversation-1",
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionId: "session-1",
      }}
      isSubmitted={false}
    />
  );

describe("AgentQuestionField", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders every question with its header, options and descriptions", () => {
    renderField();

    expect(screen.getByText("Database")).toBeInTheDocument();
    expect(screen.getByText("Which caches?")).toBeInTheDocument();
    expect(screen.getByText("Relational store")).toBeInTheDocument();
    expect(screen.getByText("Edge")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("submits one answer per question, joining multi-select labels", async () => {
    submitAnswerMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderField();

    const submit = screen.getByTestId("agent-question-submit-question-1");
    expect(submit).toBeDisabled();

    await user.click(screen.getByLabelText(/Postgres/));
    await user.click(screen.getByLabelText(/Redis/));
    await user.click(screen.getByLabelText(/CDN/));
    await user.click(submit);

    await waitFor(() => {
      expect(submitAnswerMock).toHaveBeenCalledTimes(1);
    });
    expect(submitAnswerMock).toHaveBeenCalledWith({
      requestId: "question-1",
      sessionId: "provider-session-1",
      agentType: "claude",
      answers: {
        "Which database?": "Postgres",
        "Which caches?": "Redis, CDN",
      },
      idempotencyToken: "idem-q1",
    });
    expect(
      await screen.findByTestId("agent-question-answered-question-1")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-question-submit-question-1")
    ).not.toBeInTheDocument();
  });

  it("accepts a free-text Other answer in place of the options", async () => {
    submitAnswerMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderField({ ...basePayload, questions: [basePayload.questions[0]!] });

    await user.click(screen.getByLabelText("Other"));
    await user.type(screen.getByTestId("agent-question-other-0"), "MySQL");
    await user.click(screen.getByTestId("agent-question-submit-question-1"));

    await waitFor(() => {
      expect(submitAnswerMock).toHaveBeenCalledWith(
        expect.objectContaining({ answers: { "Which database?": "MySQL" } })
      );
    });
  });

  it("shows persisted answers read-only without a submit control", () => {
    renderField({
      ...basePayload,
      answers: { "Which database?": "SQLite", "Which caches?": "CDN" },
    });

    expect(screen.getByTestId("agent-question-answer-0")).toHaveTextContent(
      "SQLite"
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("surfaces delivery errors and keeps the form submittable", async () => {
    submitAnswerMock.mockRejectedValue(
      new Error("Controller authorization denied: nope")
    );
    const user = userEvent.setup();
    renderField({ ...basePayload, questions: [basePayload.questions[0]!] });

    await user.click(screen.getByLabelText(/SQLite/));
    await user.click(screen.getByTestId("agent-question-submit-question-1"));

    expect(
      await screen.findByTestId("agent-question-error-question-1")
    ).toHaveTextContent("nope");
    expect(
      screen.getByTestId("agent-question-submit-question-1")
    ).toBeEnabled();
  });
});
