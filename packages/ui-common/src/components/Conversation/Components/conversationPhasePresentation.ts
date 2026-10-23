import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import { ConversationPhase } from "../../../api";
import { CodeReviewIcon } from "../../ActionsCapsule/CodeReviewIcon";
import {
  LoadingSpinnerIcon,
  ThoughtBubbleIcon,
  WritingIcon,
} from "../../shared/SubtleActivityIcon";
import type { ComponentType } from "react";
import type { SvgIconProps } from "@mui/material";

type ConversationPhaseActivity =
  "none" | "starting" | "thinking" | "writing" | "reviewing";

type ConversationPhaseIconAnimation = "none" | "opacity" | "rotation";

export interface ConversationPhasePresentation {
  label: string;
  ariaLabel: string;
  activity: ConversationPhaseActivity;
  isActive: boolean;
  Icon: ComponentType<SvgIconProps>;
  iconAnimation: ConversationPhaseIconAnimation;
  iconViewBox: string;
}

const CONVERSATION_PHASE_PRESENTATION = {
  [ConversationPhase.Idle]: {
    label: "Idle",
    ariaLabel: "Idle",
    activity: "none",
    isActive: false,
    Icon: PauseCircleOutlineIcon,
    iconAnimation: "none",
    iconViewBox: "0 0 24 24",
  },
  [ConversationPhase.Starting]: {
    label: "Starting conversation...",
    ariaLabel: "Starting",
    activity: "starting",
    isActive: true,
    Icon: LoadingSpinnerIcon,
    iconAnimation: "rotation",
    iconViewBox: "0 0 32 32",
  },
  [ConversationPhase.GatheringContext]: {
    label: "Gathering context...",
    ariaLabel: "Gathering context",
    activity: "starting",
    isActive: true,
    Icon: LoadingSpinnerIcon,
    iconAnimation: "rotation",
    iconViewBox: "0 0 32 32",
  },
  [ConversationPhase.Thinking]: {
    label: "Thinking...",
    ariaLabel: "Thinking",
    activity: "thinking",
    isActive: true,
    Icon: ThoughtBubbleIcon,
    iconAnimation: "opacity",
    iconViewBox: "0 0 32 32",
  },
  [ConversationPhase.Writing]: {
    label: "Writing Response...",
    ariaLabel: "Writing",
    activity: "writing",
    isActive: true,
    Icon: WritingIcon,
    iconAnimation: "opacity",
    iconViewBox: "0 0 21 21",
  },
  [ConversationPhase.AwaitingApproval]: {
    label: "Awaiting approval",
    ariaLabel: "Awaiting approval",
    activity: "none",
    isActive: false,
    Icon: PauseCircleOutlineIcon,
    iconAnimation: "none",
    iconViewBox: "0 0 24 24",
  },
  [ConversationPhase.Reviewing]: {
    label: "Reviewing...",
    ariaLabel: "Reviewing",
    activity: "reviewing",
    isActive: true,
    Icon: CodeReviewIcon,
    iconAnimation: "opacity",
    iconViewBox: "0 0 24 24",
  },
} satisfies Record<ConversationPhase, ConversationPhasePresentation>;

export const getConversationPhasePresentation = (
  phase: ConversationPhase,
): ConversationPhasePresentation => CONVERSATION_PHASE_PRESENTATION[phase];
