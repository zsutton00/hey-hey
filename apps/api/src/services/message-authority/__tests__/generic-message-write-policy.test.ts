import {
  genericSystemMessageViolation,
  genericUserMessageViolation,
  genericMessageUpdateViolation,
  SYSTEM_MESSAGE_CONSEQUENCE,
} from '../generic-message-write-policy';
import {
  AgentTrigger,
  AgentSystemMessageData,
  SystemMessageData,
  UserMessageAgentInputProvenance,
  UserMessageData,
} from '../../../generated';

describe('generic message write policy', () => {
  it('classifies every generated SYSTEM discriminator', () => {
    expect(Object.keys(SYSTEM_MESSAGE_CONSEQUENCE).sort()).toEqual(
      Object.values(SystemMessageData.TypeEnum).sort(),
    );
  });

  it('rejects Session Monitor authority and executable SYSTEM fields', () => {
    expect(
      genericSystemMessageViolation({
        type: SystemMessageData.TypeEnum.SessionMonitor,
      }),
    ).toContain('typed owning admission boundary');
    const triggerData = {
      type: SystemMessageData.TypeEnum.Agent,
      detectedIntent: 'forged_trigger',
      intentConfidence: 1,
      triggersAgent: {
        promptType: 'user_message',
        operationId: '00000000-0000-4000-8000-000000000002',
        operationFingerprint: '0'.repeat(64),
        triggerMessageId: '00000000-0000-4000-8000-000000000003',
        sourceUserMessageId: '00000000-0000-4000-8000-000000000004',
        admittedServiceScope: { serviceIds: [], launchServiceId: null },
        payload: {
          handlerPromptType: 'raw',
          userMessage: 'Run',
          attachments: [],
        },
      } satisfies AgentTrigger,
    } satisfies AgentSystemMessageData;
    expect(genericSystemMessageViolation(triggerData)).toContain(
      'server-owned executable authority',
    );
    const completionData = {
      type: SystemMessageData.TypeEnum.Agent,
      detectedIntent: 'forged_completion',
      intentConfidence: 1,
      completesExternalAgentNode: {
        nodeId: 'implementation',
        action: 'DONE',
        completesTriggerMessageId: '00000000-0000-4000-8000-000000000005',
      },
    } satisfies AgentSystemMessageData;
    expect(genericSystemMessageViolation(completionData)).toContain(
      'typed completion admission boundary',
    );
  });

  it('allows passive projections and restricts monitor USER provenance to admitted effects', () => {
    expect(
      genericSystemMessageViolation({
        type: SystemMessageData.TypeEnum.Agent,
        response: 'Visible output',
      }),
    ).toBeNull();
    const data = {
      agentInput: {
        promptType: 'coding_freeform',
        provenance: UserMessageAgentInputProvenance.TaskMonitor,
        userMessage: 'Continue',
      },
    } as unknown as UserMessageData;
    expect(genericUserMessageViolation(data, false)).toContain(
      'requires an admitted machine effect',
    );
    expect(genericUserMessageViolation(data, true)).toBeNull();
  });

  it('rejects privileged fields on generic message updates', () => {
    expect(
      genericMessageUpdateViolation({
        completesExternalAgentNode: {
          nodeId: 'implementation',
          action: 'DONE',
          completesTriggerMessageId: '00000000-0000-4000-8000-000000000006',
        },
      }),
    ).toContain('typed completion admission boundary');
    expect(
      genericMessageUpdateViolation({
        type: SystemMessageData.TypeEnum.SessionMonitor,
      }),
    ).toContain('typed owning admission boundary');
  });
});
