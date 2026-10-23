import { HostAffectingActionType } from '../../../generated';
import {
  classifyHostAffectingFrame,
  HostAffectingFrame,
} from '../host-affecting-frame-policy';

const envelope = (event: unknown) => ({
  machineId: 'machine-1',
  userId: 'user-1',
  nonce: 'nonce-1',
  timestampMs: 1,
  signature: 'signature',
  protocolVersion: 2,
  authorization: {
    kind: 'bounded_grant',
    grantId: 'grant-1',
    target: { kind: 'AGENT_SESSION', id: 'session-1', revision: null },
    agentSessionId: 'session-1',
    authorizedTurnId: null,
    taskMonitorId: null,
  },
  event,
});

const frame = (type: string, event: unknown): HostAffectingFrame =>
  ({
    type,
    timestamp: new Date().toISOString(),
    organizationId: 'org-1',
    projectId: 'project-1',
    envelope: envelope(event),
  }) as never;

describe('classifyHostAffectingFrame', () => {
  it.each([
    [
      'trigger.conversation',
      { promptType: 'implement' },
      HostAffectingActionType.ConversationTrigger,
    ],
    [
      'trigger.control',
      { kind: 'compact_run' },
      HostAffectingActionType.ConversationControlCompactRun,
    ],
    [
      'trigger.control',
      { kind: 'permission_decision' },
      HostAffectingActionType.ConversationControlPermissionDecision,
    ],
    [
      'trigger.control',
      { kind: 'question_answer' },
      HostAffectingActionType.ConversationTrigger,
    ],
    [
      'trigger.monitor_command',
      { command: { cause: 'START' } },
      HostAffectingActionType.TaskMonitorStart,
    ],
    [
      'trigger.monitor_command',
      { command: { cause: 'COMPLETE' } },
      HostAffectingActionType.TaskMonitorComplete,
    ],
    [
      'cli.read.request',
      { operation: 'run.changed_files.count' },
      HostAffectingActionType.CliRead,
    ],
    [
      'cli.read.request',
      { operation: 'run.context_usage.get' },
      HostAffectingActionType.CliRead,
    ],
    [
      'trigger.application_effect',
      { kind: 'application_effect' },
      HostAffectingActionType.ApplicationEffectLaunch,
    ],
    [
      'trigger.exact_action',
      { kind: 'exact_action' },
      HostAffectingActionType.ExactActionDelivery,
    ],
  ])('classifies %s', (type, event, actionType) => {
    expect(classifyHostAffectingFrame(frame(type, event))).toEqual({
      frameType: type,
      actionType,
    });
  });

  it('fails closed for an unknown runtime discriminator', () => {
    expect(() =>
      classifyHostAffectingFrame(frame('trigger.unknown', {})),
    ).toThrow('Unhandled host-affecting frame variant');
  });

  it('keeps authority-neutral monitor commands outside host-affecting classification', () => {
    const neutralFrame = {
      type: 'trigger.monitor_command',
      timestamp: new Date().toISOString(),
      organizationId: 'org-1',
      projectId: 'project-1',
      envelope: {
        machineId: 'machine-1',
        userId: 'user-1',
        nonce: 'nonce-1',
        timestampMs: 1,
        signature: 'signature',
        protocolVersion: 2,
        event: {
          kind: 'task_monitor_authority_neutral',
          command: { cause: 'GUIDANCE_CHANGED' },
        },
      },
    } as HostAffectingFrame;

    expect(() => classifyHostAffectingFrame(neutralFrame)).toThrow(
      'Authority-neutral Task Monitor input is not host-affecting.',
    );
  });
});
