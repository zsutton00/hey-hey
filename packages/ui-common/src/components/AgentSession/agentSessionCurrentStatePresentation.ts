import type { SvgIconComponent } from "@mui/icons-material";
import CodeOutlinedIcon from "@mui/icons-material/CodeOutlined";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { AgentSessionCurrentState, ConversationPhase } from "../../api";
import {
  LoadingSpinnerIcon,
  PlanReadyIcon,
  ThoughtBubbleIcon,
  WritingIcon,
} from "../shared/SubtleActivityIcon";

export type AgentSessionCurrentStateActivity =
  "none" | "starting" | "thinking" | "writing";

export type AgentSessionCurrentStateIconAnimation =
  "none" | "opacity" | "rotation";

interface AgentSessionCurrentStatePresentationDefinition {
  label: string;
  ariaLabel: string;
  activity: AgentSessionCurrentStateActivity;
  isActive: boolean;
  Icon: SvgIconComponent;
  iconAnimation: AgentSessionCurrentStateIconAnimation;
  iconViewBox: string;
}

export interface AgentSessionCurrentStatePresentation extends AgentSessionCurrentStatePresentationDefinition {
  isActionable: boolean;
}

export type AgentSessionRowLifecycleSignal =
  | {
      kind: "currentState";
      currentState: Exclude<
        AgentSessionCurrentState,
        typeof AgentSessionCurrentState.Idle
      >;
    }
  | {
      kind: "conversationPhase";
      phase: typeof ConversationPhase.Reviewing;
    }
  | { kind: "none" };

export interface AgentSessionRowSignalPresentation {
  lifecycle: AgentSessionRowLifecycleSignal;
  showMessageReadyIcon: boolean;
}

/**
 * The state-to-copy/activity contract is intentionally exhaustive. Actionability
 * is derived below because it is a property of the current state, not stored
 * presentation data.
 */
export const AGENT_SESSION_CURRENT_STATE_PRESENTATION = {
  [AgentSessionCurrentState.Idle]: {
    label: "Idle",
    ariaLabel: "Idle",
    activity: "none",
    isActive: false,
    Icon: RadioButtonUncheckedIcon,
    iconAnimation: "none",
    iconViewBox: "0 0 24 24",
  },
  [AgentSessionCurrentState.Starting]: {
    label: "Starting conversation...",
    ariaLabel: "Starting",
    activity: "starting",
    isActive: true,
    Icon: LoadingSpinnerIcon,
    iconAnimation: "rotation",
    iconViewBox: "0 0 32 32",
  },
  [AgentSessionCurrentState.GatheringContext]: {
    label: "Gathering context...",
    ariaLabel: "Gathering context",
    activity: "starting",
    isActive: true,
    Icon: LoadingSpinnerIcon,
    iconAnimation: "rotation",
    iconViewBox: "0 0 32 32",
  },
  [AgentSessionCurrentState.Thinking]: {
    label: "Thinking...",
    ariaLabel: "Thinking",
    activity: "thinking",
    isActive: true,
    Icon: ThoughtBubbleIcon,
    iconAnimation: "opacity",
    iconViewBox: "0 0 32 32",
  },
  [AgentSessionCurrentState.Writing]: {
    label: "Writing Response...",
    ariaLabel: "Writing",
    activity: "writing",
    isActive: true,
    Icon: WritingIcon,
    iconAnimation: "opacity",
    iconViewBox: "0 0 21 21",
  },
  [AgentSessionCurrentState.AwaitingApproval]: {
    label: "Awaiting approval",
    ariaLabel: "Awaiting approval",
    activity: "none",
    isActive: false,
    Icon: PauseCircleOutlineIcon,
    iconAnimation: "none",
    iconViewBox: "0 0 24 24",
  },
  [AgentSessionCurrentState.PlanReady]: {
    label: "Plan ready",
    ariaLabel: "Plan ready",
    activity: "none",
    isActive: false,
    Icon: PlanReadyIcon,
    iconAnimation: "opacity",
    iconViewBox: "0 0 32 32",
  },
  [AgentSessionCurrentState.ImplementationReady]: {
    label: "Implementation ready",
    ariaLabel: "Implementation ready",
    activity: "none",
    isActive: false,
    Icon: CodeOutlinedIcon,
    iconAnimation: "none",
    iconViewBox: "0 0 24 24",
  },
} satisfies Record<
  AgentSessionCurrentState,
  AgentSessionCurrentStatePresentationDefinition
>;

export const isAgentSessionCurrentStateActionable = (
  currentState: AgentSessionCurrentState,
): boolean => {
  switch (currentState) {
    case AgentSessionCurrentState.AwaitingApproval:
    case AgentSessionCurrentState.PlanReady:
    case AgentSessionCurrentState.ImplementationReady:
      return true;
    default:
      return false;
  }
};

export const isAgentSessionCurrentStateIndicatorVisible = (
  currentState: AgentSessionCurrentState | undefined,
): currentState is Exclude<
  AgentSessionCurrentState,
  typeof AgentSessionCurrentState.Idle
> =>
  currentState !== undefined && currentState !== AgentSessionCurrentState.Idle;

export const getAgentSessionCurrentStatePresentation = (
  currentState: AgentSessionCurrentState,
): AgentSessionCurrentStatePresentation => ({
  ...AGENT_SESSION_CURRENT_STATE_PRESENTATION[currentState],
  isActionable: isAgentSessionCurrentStateActionable(currentState),
});

/**
 * Shared lifecycle and user-scoped output attention never suppress one another.
 * REVIEWING remains a conversation-phase fallback only while currentState does
 * not provide a visible canonical lifecycle value.
 */
export const getAgentSessionRowSignalPresentation = (
  currentState: AgentSessionCurrentState | undefined,
  messageReady: boolean,
  conversationPhase?: ConversationPhase,
): AgentSessionRowSignalPresentation => {
  if (
    currentState !== undefined &&
    currentState !== AgentSessionCurrentState.Idle
  ) {
    return {
      lifecycle: { kind: "currentState", currentState },
      showMessageReadyIcon: messageReady,
    };
  }

  return {
    lifecycle:
      conversationPhase === ConversationPhase.Reviewing
        ? { kind: "conversationPhase", phase: conversationPhase }
        : { kind: "none" },
    showMessageReadyIcon: messageReady,
  };
};
