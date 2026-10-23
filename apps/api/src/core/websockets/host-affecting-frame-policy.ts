import {
  HostAffectingActionType,
  WebSocketApplicationEffectEvent,
  WebSocketCliReadRequestEvent,
  WebSocketConversationControlEvent,
  WebSocketConversationTriggerEvent,
  WebSocketExactActionEvent,
  WebSocketMonitorCommandEvent,
} from '../../generated';

export type HostAffectingFrame =
  | WebSocketConversationTriggerEvent
  | WebSocketConversationControlEvent
  | WebSocketMonitorCommandEvent
  | WebSocketCliReadRequestEvent
  | WebSocketApplicationEffectEvent
  | WebSocketExactActionEvent;

export interface HostAffectingFramePolicy {
  actionType: HostAffectingActionType;
  frameType: HostAffectingFrame['type'];
}

const exhaustive = (value: never): never => {
  throw new Error(`Unhandled host-affecting frame variant: ${String(value)}`);
};

/**
 * Closed policy for every executable/host-observing protocol-2 frame. Keeping
 * the discriminator arms here makes generated union growth a compile failure
 * instead of an accidental unauthorised delivery path.
 */
export function classifyHostAffectingFrame(
  frame: HostAffectingFrame,
): HostAffectingFramePolicy {
  switch (frame.type) {
    case 'trigger.conversation':
      return {
        frameType: frame.type,
        actionType: HostAffectingActionType.ConversationTrigger,
      };
    case 'trigger.control':
      switch (frame.envelope.event.kind) {
        case 'compact_run':
          return {
            frameType: frame.type,
            actionType: HostAffectingActionType.ConversationControlCompactRun,
          };
        case 'permission_decision':
          return {
            frameType: frame.type,
            actionType:
              HostAffectingActionType.ConversationControlPermissionDecision,
          };
        case 'question_answer':
          return {
            frameType: frame.type,
            actionType: HostAffectingActionType.ConversationTrigger,
          };
        default:
          return exhaustive(frame.envelope.event);
      }
    case 'trigger.monitor_command':
      if (!('authorization' in frame.envelope)) {
        throw new Error(
          'Authority-neutral Task Monitor input is not host-affecting.',
        );
      }
      switch (frame.envelope.event.command.cause) {
        case 'START':
          return {
            frameType: frame.type,
            actionType: HostAffectingActionType.TaskMonitorStart,
          };
        case 'RESUME':
          return {
            frameType: frame.type,
            actionType: HostAffectingActionType.TaskMonitorResume,
          };
        case 'JUDGMENT_RESOLVED':
          return {
            frameType: frame.type,
            actionType: HostAffectingActionType.TaskMonitorJudgmentResolved,
          };
        case 'CONTINUE':
          return {
            frameType: frame.type,
            actionType: HostAffectingActionType.TaskMonitorContinue,
          };
        case 'COMPLETE':
          return {
            frameType: frame.type,
            actionType: HostAffectingActionType.TaskMonitorComplete,
          };
        default:
          return exhaustive(frame.envelope.event.command);
      }
    case 'cli.read.request':
      return {
        frameType: frame.type,
        actionType: HostAffectingActionType.CliRead,
      };
    case 'trigger.application_effect':
      return {
        frameType: frame.type,
        actionType: HostAffectingActionType.ApplicationEffectLaunch,
      };
    case 'trigger.exact_action':
      return {
        frameType: frame.type,
        actionType: HostAffectingActionType.ExactActionDelivery,
      };
    default:
      return exhaustive(frame);
  }
}
