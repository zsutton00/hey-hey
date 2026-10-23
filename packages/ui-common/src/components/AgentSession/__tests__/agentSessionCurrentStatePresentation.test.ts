import { describe, expect, it } from "vitest";
import {
  AGENT_SESSION_CURRENT_STATE_PRESENTATION,
  getAgentSessionCurrentStatePresentation,
  getAgentSessionRowSignalPresentation,
  isAgentSessionCurrentStateIndicatorVisible,
  isAgentSessionCurrentStateActionable,
} from "../agentSessionCurrentStatePresentation";
import { AgentSessionCurrentState, ConversationPhase } from "../../../api";
import {
  LoadingSpinnerIcon,
  PlanReadyIcon,
  ThoughtBubbleIcon,
  WritingIcon,
} from "../../shared/SubtleActivityIcon";

const ALL_CURRENT_STATES = [
  AgentSessionCurrentState.Idle,
  AgentSessionCurrentState.Starting,
  AgentSessionCurrentState.GatheringContext,
  AgentSessionCurrentState.Thinking,
  AgentSessionCurrentState.Writing,
  AgentSessionCurrentState.AwaitingApproval,
  AgentSessionCurrentState.PlanReady,
  AgentSessionCurrentState.ImplementationReady,
] as const satisfies readonly AgentSessionCurrentState[];

const ACTIONABLE_CURRENT_STATES = new Set<AgentSessionCurrentState>([
  AgentSessionCurrentState.AwaitingApproval,
  AgentSessionCurrentState.PlanReady,
  AgentSessionCurrentState.ImplementationReady,
]);

describe("Agent Session current-state presentation", () => {
  it("defines presentation data for every generated current state", () => {
    expect(Object.keys(AGENT_SESSION_CURRENT_STATE_PRESENTATION)).toEqual(
      expect.arrayContaining([...ALL_CURRENT_STATES]),
    );
    expect(Object.keys(AGENT_SESSION_CURRENT_STATE_PRESENTATION)).toHaveLength(
      ALL_CURRENT_STATES.length,
    );

    for (const currentState of ALL_CURRENT_STATES) {
      const presentation =
        getAgentSessionCurrentStatePresentation(currentState);

      expect(presentation.label).not.toBe("");
      expect(presentation.ariaLabel).not.toBe("");
      expect(presentation.activity).toBeDefined();
      expect(presentation.Icon).toBeDefined();
      expect(presentation.iconAnimation).toBeDefined();
      expect(presentation.iconViewBox).not.toBe("");
      expect(presentation.isActionable).toBe(
        ACTIONABLE_CURRENT_STATES.has(currentState),
      );
      expect(
        AGENT_SESSION_CURRENT_STATE_PRESENTATION[currentState],
      ).not.toHaveProperty("isActionable");
    }
  });

  it("derives actionability only for approval and the two review-ready states", () => {
    for (const currentState of ALL_CURRENT_STATES) {
      expect(isAgentSessionCurrentStateActionable(currentState)).toBe(
        ACTIONABLE_CURRENT_STATES.has(currentState),
      );
    }
  });

  it("shows an indicator for every non-idle current state", () => {
    expect(isAgentSessionCurrentStateIndicatorVisible(undefined)).toBe(false);
    expect(
      isAgentSessionCurrentStateIndicatorVisible(AgentSessionCurrentState.Idle),
    ).toBe(false);

    for (const currentState of ALL_CURRENT_STATES.slice(1)) {
      expect(isAgentSessionCurrentStateIndicatorVisible(currentState)).toBe(
        true,
      );
    }
  });

  it("keeps active processing distinct from actionable presentation", () => {
    expect(
      getAgentSessionCurrentStatePresentation(
        AgentSessionCurrentState.Starting,
      ),
    ).toMatchObject({ isActive: true, isActionable: false });
    expect(
      getAgentSessionCurrentStatePresentation(
        AgentSessionCurrentState.GatheringContext,
      ),
    ).toMatchObject({
      label: "Gathering context...",
      isActive: true,
      isActionable: false,
    });
    expect(
      getAgentSessionCurrentStatePresentation(
        AgentSessionCurrentState.Thinking,
      ),
    ).toMatchObject({ isActive: true, isActionable: false });
    expect(
      getAgentSessionCurrentStatePresentation(AgentSessionCurrentState.Writing),
    ).toMatchObject({ isActive: true, isActionable: false });

    for (const currentState of ACTIONABLE_CURRENT_STATES) {
      expect(
        getAgentSessionCurrentStatePresentation(currentState),
      ).toMatchObject({ isActive: false, isActionable: true });
    }

    expect(
      getAgentSessionCurrentStatePresentation(AgentSessionCurrentState.Idle),
    ).toMatchObject({ isActive: false, isActionable: false });
  });

  it("reuses the supplied activity glyphs", () => {
    expect(
      AGENT_SESSION_CURRENT_STATE_PRESENTATION[
        AgentSessionCurrentState.Starting
      ].Icon,
    ).toBe(LoadingSpinnerIcon);
    expect(
      AGENT_SESSION_CURRENT_STATE_PRESENTATION[
        AgentSessionCurrentState.Thinking
      ].Icon,
    ).toBe(ThoughtBubbleIcon);
    expect(
      AGENT_SESSION_CURRENT_STATE_PRESENTATION[AgentSessionCurrentState.Writing]
        .Icon,
    ).toBe(WritingIcon);
    expect(
      AGENT_SESSION_CURRENT_STATE_PRESENTATION[
        AgentSessionCurrentState.PlanReady
      ].Icon,
    ).toBe(PlanReadyIcon);
  });

  it.each([
    AgentSessionCurrentState.Starting,
    AgentSessionCurrentState.Thinking,
    AgentSessionCurrentState.Writing,
    AgentSessionCurrentState.AwaitingApproval,
    AgentSessionCurrentState.PlanReady,
    AgentSessionCurrentState.ImplementationReady,
  ])("shows %s independently from MESSAGE_READY", (currentState) => {
    expect(getAgentSessionRowSignalPresentation(currentState, true)).toEqual({
      lifecycle: { kind: "currentState", currentState },
      showMessageReadyIcon: true,
    });
  });

  it("uses REVIEWING only when canonical current state is idle", () => {
    expect(
      getAgentSessionRowSignalPresentation(
        AgentSessionCurrentState.Idle,
        true,
        ConversationPhase.Reviewing,
      ),
    ).toEqual({
      lifecycle: {
        kind: "conversationPhase",
        phase: ConversationPhase.Reviewing,
      },
      showMessageReadyIcon: true,
    });
  });

  it.each([
    AgentSessionCurrentState.Starting,
    AgentSessionCurrentState.Thinking,
    AgentSessionCurrentState.Writing,
    AgentSessionCurrentState.AwaitingApproval,
  ])(
    "keeps canonical %s when conversation phase is REVIEWING",
    (currentState) => {
      expect(
        getAgentSessionRowSignalPresentation(
          currentState,
          true,
          ConversationPhase.Reviewing,
        ),
      ).toEqual({
        lifecycle: { kind: "currentState", currentState },
        showMessageReadyIcon: true,
      });
    },
  );

  it("shows MESSAGE_READY only when lifecycle projections are idle", () => {
    expect(
      getAgentSessionRowSignalPresentation(
        AgentSessionCurrentState.Idle,
        true,
        ConversationPhase.Idle,
      ),
    ).toEqual({
      lifecycle: { kind: "none" },
      showMessageReadyIcon: true,
    });
  });

  it("uses REVIEWING while canonical current state has not hydrated", () => {
    expect(
      getAgentSessionRowSignalPresentation(
        undefined,
        false,
        ConversationPhase.Reviewing,
      ),
    ).toEqual({
      lifecycle: {
        kind: "conversationPhase",
        phase: ConversationPhase.Reviewing,
      },
      showMessageReadyIcon: false,
    });
  });

  it("keeps both projections absent when neither has a visible signal", () => {
    expect(
      getAgentSessionRowSignalPresentation(
        AgentSessionCurrentState.Idle,
        false,
      ),
    ).toEqual({
      lifecycle: { kind: "none" },
      showMessageReadyIcon: false,
    });
  });
});
