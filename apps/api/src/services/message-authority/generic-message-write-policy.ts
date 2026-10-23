import {
  SystemMessageData,
  UserMessageAgentInputProvenance,
  UserMessageData,
} from '../../generated';
import { isAgentSystemMessageData } from '../../utils/type-checks';

export type GenericMessageConsequence =
  | 'PASSIVE_PROJECTION'
  | 'SERVER_MUTATION'
  | 'EXECUTABLE_INPUT'
  | 'AUTHORITY_CONTROL';

/** Closed registry: adding a SystemMessageData discriminator requires an explicit consequence. */
export const SYSTEM_MESSAGE_CONSEQUENCE = {
  QUESTIONS: 'PASSIVE_PROJECTION',
  ANALYSIS: 'PASSIVE_PROJECTION',
  NOOP: 'PASSIVE_PROJECTION',
  INITIATIVES: 'PASSIVE_PROJECTION',
  ARTIFACTS_GENERATION: 'PASSIVE_PROJECTION',
  TASKS: 'PASSIVE_PROJECTION',
  FEATURE_LIST: 'PASSIVE_PROJECTION',
  TASK_STUBS: 'PASSIVE_PROJECTION',
  TASK_PRIORITY: 'PASSIVE_PROJECTION',
  ERROR: 'PASSIVE_PROJECTION',
  INTEGRATIONS: 'PASSIVE_PROJECTION',
  CODING_PROMPTS: 'PASSIVE_PROJECTION',
  AGENT: 'PASSIVE_PROJECTION',
  ROUTING: 'PASSIVE_PROJECTION',
  DAILY_SESSION: 'PASSIVE_PROJECTION',
  SESSION_MONITOR: 'AUTHORITY_CONTROL',
  TASK_MONITOR_TASK_ACTIVITY: 'PASSIVE_PROJECTION',
  TASK_MONITOR_INTERVENTION: 'PASSIVE_PROJECTION',
  TASK_MONITOR_SUPERVISION: 'PASSIVE_PROJECTION',
  TASK_MONITOR_LAUNCH_RECOVERY: 'PASSIVE_PROJECTION',
  CARRIER: 'PASSIVE_PROJECTION',
} satisfies Record<SystemMessageData.TypeEnum, GenericMessageConsequence>;

export const genericSystemMessageViolation = (
  data: SystemMessageData,
): string | null => {
  if (SYSTEM_MESSAGE_CONSEQUENCE[data.type] !== 'PASSIVE_PROJECTION') {
    return `${data.type} must use its typed owning admission boundary`;
  }
  if (data.triggersAgent !== undefined) {
    return 'data.triggersAgent is server-owned executable authority';
  }
  if (
    isAgentSystemMessageData(data) &&
    data.completesExternalAgentNode !== undefined
  ) {
    return 'data.completesExternalAgentNode must use the typed completion admission boundary';
  }
  return null;
};

export const genericUserMessageViolation = (
  data: UserMessageData,
  admittedMachineEffect: boolean,
): string | null => {
  if (data.triggersAgent !== undefined) {
    return 'data.triggersAgent is server-owned executable authority';
  }
  const provenance = data.agentInput?.provenance;
  if (
    !admittedMachineEffect &&
    (provenance === UserMessageAgentInputProvenance.TaskMonitor ||
      provenance === UserMessageAgentInputProvenance.SessionMonitor)
  ) {
    return `data.agentInput.provenance=${provenance} requires an admitted machine effect`;
  }
  return null;
};

export const genericMessageUpdateViolation = (data: object): string | null => {
  if ('triggersAgent' in data) {
    return 'data.triggersAgent is server-owned executable authority';
  }
  if ('completesExternalAgentNode' in data) {
    return 'data.completesExternalAgentNode must use the typed completion admission boundary';
  }
  if (
    'type' in data &&
    data.type === SystemMessageData.TypeEnum.SessionMonitor
  ) {
    return 'SESSION_MONITOR must use its typed owning admission boundary';
  }
  return null;
};
