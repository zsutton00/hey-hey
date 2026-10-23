import {
  AgentSessionId,
  ConversationId,
  MachineId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../../types';
import { HostActionTargetKind } from '../../../generated';
import { ExternalAgentTriggerError } from '../../../types/flow-internal.types';
import { TriggerEmitter } from '../trigger-emitter.service';

describe('TriggerEmitter', () => {
  const conversationId = 'conv-1' as ConversationId;
  const messageId = 'msg-1' as MessageId;
  const organizationId = 'org-1' as OrganizationId;
  const agentSessionId = 'session-1' as AgentSessionId;

  const recipient = {
    machineId: 'machine-1',
    userId: 'user-1',
    agentSessionId: 'session-1',
    projectId: 'project-1',
  };
  const signedEnvelope = { signature: 'sig', nonce: 'n' };

  function makeEmitter(messageData: unknown) {
    const messageFindUnique = jest
      .fn()
      .mockResolvedValue(
        messageData === undefined ? null : { data: messageData },
      );
    const prisma = { db: { message: { findUnique: messageFindUnique } } };

    const resolver = {
      resolveConversationRecipient: jest.fn().mockResolvedValue(recipient),
      resolveExactConversationRecipient: jest.fn().mockResolvedValue({
        resolved: true,
        recipient,
      }),
      resolveMachineForUser: jest.fn().mockResolvedValue(recipient),
    };
    const signer: any = {
      signConversationTrigger: jest.fn().mockReturnValue(signedEnvelope),
      signConversationControl: jest.fn().mockReturnValue(signedEnvelope),
      signConversationReduction: jest.fn((...args) =>
        signer.signConversationControl(...args.slice(0, 3)),
      ),
      signConversationTriggerAuthorized: jest.fn((event, machine, user) =>
        signer.signConversationTrigger(event, machine, user),
      ),
      signConversationControlAuthorized: jest.fn((event, machine, user) =>
        signer.signConversationControl(event, machine, user),
      ),
    };
    const gateway = {
      emitConversationTrigger: jest.fn(),
      emitConversationControl: jest.fn(),
      emitConversationReduction: jest.fn(),
    };
    const executableFrameAuthorization = {
      resolveSelectedAuthorization: jest.fn().mockResolvedValue({
        kind: 'bounded_grant',
        grantId: 'grant-1',
      }),
      resolveBoundedGrant: jest.fn().mockResolvedValue({
        kind: 'bounded_grant',
        grantId: 'grant-1',
        target: { kind: 'AGENT_SESSION', id: 'session-1', revision: null },
        agentSessionId: 'session-1',
        authorizedTurnId: messageId,
        taskMonitorId: null,
      }),
    };

    const emitter = new TriggerEmitter(
      prisma as never,
      resolver as never,
      signer as never,
      gateway as never,
      executableFrameAuthorization as never,
    );
    return {
      emitter,
      resolver,
      signer,
      gateway,
      messageFindUnique,
      executableFrameAuthorization,
    };
  }

  it('emits a trigger.conversation frame on a first-entry trigger and signs the body carrying triggerMessageId === messageId', async () => {
    const triggersAgent = {
      promptType: 'implement',
      nodeId: 'node-1',
      triggerMessageId: messageId,
    };
    const { emitter, signer, gateway } = makeEmitter({ triggersAgent });

    await emitter.emitConversationTriggerForMessage({
      conversationId,
      messageId,
      organizationId,
    });

    expect(signer.signConversationTrigger).toHaveBeenCalledWith(
      triggersAgent,
      recipient.machineId,
      recipient.userId,
    );
    const signedBody = signer.signConversationTrigger.mock.calls.at(
      -1,
    )?.[0] as Record<string, unknown>;
    expect(signedBody?.triggerMessageId).toBe(messageId);
    expect(gateway.emitConversationTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trigger.conversation',
        conversationId,
        userId: recipient.userId,
        envelope: signedEnvelope,
      }),
    );
  });

  it('signs a self-loop re-trigger on the same node with the new message id', async () => {
    const selfLoopMessageId = 'msg-self-loop' as MessageId;
    const triggersAgent = {
      promptType: 'feature_sync_iterate',
      nodeId: 'feature-sync-iterate',
      triggerMessageId: selfLoopMessageId,
      payload: { iteration: 2 },
    };
    const { emitter, signer } = makeEmitter({ triggersAgent });

    await emitter.emitConversationTriggerForMessage({
      conversationId,
      messageId: selfLoopMessageId,
      organizationId,
    });

    const signedBody = signer.signConversationTrigger.mock.calls.at(
      -1,
    )?.[0] as Record<string, unknown>;
    expect(signedBody?.triggerMessageId).toBe(selfLoopMessageId);
    expect(signedBody?.nodeId).toBe('feature-sync-iterate');
  });

  it('signs a re-emission after a plain USER message on an acceptsUserMessages node with the new id', async () => {
    const reEmitMessageId = 'msg-after-user' as MessageId;
    const triggersAgent = {
      promptType: 'feature_tree_conversation',
      nodeId: 'feature-tree-conversation',
      triggerMessageId: reEmitMessageId,
      payload: { resumeFromUser: true },
    };
    const { emitter, signer } = makeEmitter({ triggersAgent });

    await emitter.emitConversationTriggerForMessage({
      conversationId,
      messageId: reEmitMessageId,
      organizationId,
    });

    const signedBody = signer.signConversationTrigger.mock.calls.at(
      -1,
    )?.[0] as Record<string, unknown>;
    expect(signedBody?.triggerMessageId).toBe(reEmitMessageId);
  });

  it('signs and dispatches a sibling SYSTEM trigger authored from a USER turn, addressed to the resolved machine', async () => {
    const systemMessageId = 'msg-user-turn-sibling' as MessageId;
    const triggersAgent = {
      promptType: 'coding_freeform',
      nodeId: 'iterate',
      triggerMessageId: systemMessageId,
    };
    const { emitter, resolver, signer, gateway } = makeEmitter({
      triggersAgent,
    });

    await emitter.emitConversationTriggerForMessage({
      conversationId,
      messageId: systemMessageId,
      organizationId,
    });

    expect(resolver.resolveConversationRecipient).toHaveBeenCalledWith(
      conversationId,
    );
    expect(signer.signConversationTrigger).toHaveBeenCalledWith(
      triggersAgent,
      recipient.machineId,
      recipient.userId,
    );
    const signedBody = signer.signConversationTrigger.mock.calls.at(
      -1,
    )?.[0] as Record<string, unknown>;
    expect(signedBody?.triggerMessageId).toBe(systemMessageId);
    expect(signedBody?.promptType).toBe('coding_freeform');
    expect(gateway.emitConversationTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trigger.conversation',
        conversationId,
        userId: recipient.userId,
        envelope: signedEnvelope,
      }),
    );
  });

  it('throws ExternalAgentTriggerError with reason missing_trigger_message_id when triggersAgent omits the id', async () => {
    const { emitter, gateway } = makeEmitter({
      triggersAgent: { promptType: 'implement', nodeId: 'node-1' },
    });

    await expect(
      emitter.emitConversationTriggerForMessage({
        conversationId,
        messageId,
        organizationId,
      }),
    ).rejects.toMatchObject({
      name: 'ExternalAgentTriggerError',
      reason: 'missing_trigger_message_id',
      messageId,
      nodeId: 'node-1',
    });
    expect(gateway.emitConversationTrigger).not.toHaveBeenCalled();
  });

  it('throws ExternalAgentTriggerError with reason trigger_message_id_mismatch when the stamped id does not match the row id', async () => {
    const { emitter, gateway } = makeEmitter({
      triggersAgent: {
        promptType: 'implement',
        nodeId: 'node-1',
        triggerMessageId: 'msg-someone-else',
      },
    });

    await expect(
      emitter.emitConversationTriggerForMessage({
        conversationId,
        messageId,
        organizationId,
      }),
    ).rejects.toBeInstanceOf(ExternalAgentTriggerError);
    expect(gateway.emitConversationTrigger).not.toHaveBeenCalled();
  });

  it('does not emit when the persisted message has no triggersAgent', async () => {
    const { emitter, resolver, gateway } = makeEmitter({
      someOtherField: true,
    });

    await emitter.emitConversationTriggerForMessage({
      conversationId,
      messageId,
      organizationId,
    });

    expect(resolver.resolveConversationRecipient).not.toHaveBeenCalled();
    expect(gateway.emitConversationTrigger).not.toHaveBeenCalled();
  });

  it('skips emission when no recipient can be resolved', async () => {
    const { emitter, resolver, gateway } = makeEmitter({
      triggersAgent: {
        promptType: 'implement',
        nodeId: 'node-1',
        triggerMessageId: messageId,
      },
    });
    resolver.resolveConversationRecipient.mockResolvedValue(null);

    await emitter.emitConversationTriggerForMessage({
      conversationId,
      messageId,
      organizationId,
    });

    expect(gateway.emitConversationTrigger).not.toHaveBeenCalled();
  });

  describe('emitStopRunControl', () => {
    const runId = '550e8400-e29b-41d4-a716-446655440099';

    it('signs and emits a trigger.control frame addressed to the conversation owner', async () => {
      const { emitter, resolver, signer, gateway } = makeEmitter(undefined);

      const result = await emitter.emitStopRunControl({
        runId,
        conversationId,
        actingUserId: 'user-1' as UserId,
        organizationId,
      });

      expect(result.emitted).toBe(true);
      expect(resolver.resolveConversationRecipient).toHaveBeenCalledWith(
        conversationId,
      );
      expect(signer.signConversationControl).toHaveBeenCalledWith(
        { kind: 'stop_run', conversationId, runId },
        recipient.machineId,
        recipient.userId,
      );
      expect(gateway.emitConversationReduction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'trigger.control_reduction',
          conversationId,
          userId: recipient.userId,
          envelope: signedEnvelope,
        }),
      );
    });

    it('rejects cross-user attempts before signing', async () => {
      const { emitter, signer, gateway } = makeEmitter(undefined);

      const result = await emitter.emitStopRunControl({
        runId,
        conversationId,
        actingUserId: 'other-user' as UserId,
        organizationId,
      });

      expect(result).toEqual({ emitted: false, reason: 'owner_mismatch' });
      expect(signer.signConversationControl).not.toHaveBeenCalled();
      expect(gateway.emitConversationControl).not.toHaveBeenCalled();
    });

    it('returns { emitted: false, reason: "no_recipient" } when the conversation has no resolvable owner', async () => {
      const { emitter, resolver, signer, gateway } = makeEmitter(undefined);
      resolver.resolveConversationRecipient.mockResolvedValueOnce(null);

      const result = await emitter.emitStopRunControl({
        runId,
        conversationId,
        actingUserId: 'user-1' as UserId,
        organizationId,
      });

      expect(result).toEqual({ emitted: false, reason: 'no_recipient' });
      expect(signer.signConversationControl).not.toHaveBeenCalled();
      expect(gateway.emitConversationControl).not.toHaveBeenCalled();
    });
  });

  describe('emitCompactRunControl', () => {
    const runId = '550e8400-e29b-41d4-a716-446655440099';

    it('signs and emits a trigger.control compact_run frame addressed to the conversation owner', async () => {
      const { emitter, resolver, signer, gateway } = makeEmitter(undefined);

      const result = await emitter.emitCompactRunControl({
        agentSessionId: runId,
        runId,
        conversationId,
        actingUserId: 'user-1' as UserId,
        organizationId,
      });

      expect(result.emitted).toBe(true);
      expect(resolver.resolveConversationRecipient).toHaveBeenCalledWith(
        conversationId,
      );
      expect(signer.signConversationControl).toHaveBeenCalledWith(
        { kind: 'compact_run', agentSessionId: runId, conversationId, runId },
        recipient.machineId,
        recipient.userId,
      );
      expect(gateway.emitConversationControl).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'trigger.control',
          conversationId,
          userId: recipient.userId,
          envelope: signedEnvelope,
        }),
      );
    });

    it('rejects cross-user attempts before signing', async () => {
      const { emitter, signer, gateway } = makeEmitter(undefined);

      const result = await emitter.emitCompactRunControl({
        agentSessionId: runId,
        runId,
        conversationId,
        actingUserId: 'other-user' as UserId,
        organizationId,
      });

      expect(result).toEqual({ emitted: false, reason: 'owner_mismatch' });
      expect(signer.signConversationControl).not.toHaveBeenCalled();
      expect(gateway.emitConversationControl).not.toHaveBeenCalled();
    });

    it('returns { emitted: false, reason: "no_recipient" } when the conversation has no resolvable owner', async () => {
      const { emitter, resolver, signer, gateway } = makeEmitter(undefined);
      resolver.resolveConversationRecipient.mockResolvedValueOnce(null);

      const result = await emitter.emitCompactRunControl({
        agentSessionId: runId,
        runId,
        conversationId,
        actingUserId: 'user-1' as UserId,
        organizationId,
      });

      expect(result).toEqual({ emitted: false, reason: 'no_recipient' });
      expect(signer.signConversationControl).not.toHaveBeenCalled();
      expect(gateway.emitConversationControl).not.toHaveBeenCalled();
    });
  });

  describe('emitPermissionDecisionControl', () => {
    const decisionParams = {
      decision: 'approve' as const,
      requestId: 'req-1',
      sessionId: 'provider-session-1',
      agentType: 'claude' as const,
      reason: 'looks safe',
      idempotencyToken: 'idem-1',
    };

    it('signs and emits a trigger.control permission_decision frame addressed to the conversation owner', async () => {
      const { emitter, resolver, signer, gateway } = makeEmitter(undefined);

      const result = await emitter.emitPermissionDecisionControl({
        agentSessionId: recipient.agentSessionId,
        conversationId,
        actingUserId: 'user-1' as UserId,
        organizationId,
        ...decisionParams,
      });

      expect(result.emitted).toBe(true);
      expect(resolver.resolveConversationRecipient).toHaveBeenCalledWith(
        conversationId,
      );
      expect(signer.signConversationControl).toHaveBeenCalledWith(
        {
          kind: 'permission_decision',
          agentSessionId: recipient.agentSessionId,
          decision: 'approve',
          requestId: 'req-1',
          sessionId: 'provider-session-1',
          agentType: 'claude',
          reason: 'looks safe',
          idempotencyToken: 'idem-1',
        },
        recipient.machineId,
        recipient.userId,
      );
      expect(gateway.emitConversationControl).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'trigger.control',
          conversationId,
          userId: recipient.userId,
          envelope: signedEnvelope,
        }),
      );
    });

    it('rejects cross-user attempts before signing', async () => {
      const { emitter, signer, gateway } = makeEmitter(undefined);

      const result = await emitter.emitPermissionDecisionControl({
        agentSessionId: recipient.agentSessionId,
        conversationId,
        actingUserId: 'other-user' as UserId,
        organizationId,
        ...decisionParams,
      });

      expect(result).toEqual({ emitted: false, reason: 'owner_mismatch' });
      expect(signer.signConversationControl).not.toHaveBeenCalled();
      expect(gateway.emitConversationControl).not.toHaveBeenCalled();
    });

    it('returns { emitted: false, reason: "no_recipient" } when the conversation has no resolvable owner', async () => {
      const { emitter, resolver, signer, gateway } = makeEmitter(undefined);
      resolver.resolveConversationRecipient.mockResolvedValueOnce(null);

      const result = await emitter.emitPermissionDecisionControl({
        agentSessionId: recipient.agentSessionId,
        conversationId,
        actingUserId: 'user-1' as UserId,
        organizationId,
        ...decisionParams,
      });

      expect(result).toEqual({ emitted: false, reason: 'no_recipient' });
      expect(signer.signConversationControl).not.toHaveBeenCalled();
      expect(gateway.emitConversationControl).not.toHaveBeenCalled();
    });
  });

  describe('emitQuestionAnswerControl', () => {
    const answerParams = {
      requestId: 'question-1',
      sessionId: 'provider-session-1',
      agentType: 'claude' as const,
      answers: { 'Which database?': 'Postgres, Redis' },
      idempotencyToken: 'idem-q1',
    };

    it('signs and emits a trigger.control question_answer frame addressed to the conversation owner', async () => {
      const { emitter, signer, gateway } = makeEmitter(undefined);

      const result = await emitter.emitQuestionAnswerControl({
        agentSessionId: recipient.agentSessionId,
        conversationId,
        actingUserId: 'user-1' as UserId,
        organizationId,
        ...answerParams,
      });

      expect(result.emitted).toBe(true);
      expect(signer.signConversationControl).toHaveBeenCalledWith(
        {
          kind: 'question_answer',
          agentSessionId: recipient.agentSessionId,
          ...answerParams,
        },
        recipient.machineId,
        recipient.userId,
      );
      expect(gateway.emitConversationControl).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'trigger.control',
          conversationId,
          envelope: signedEnvelope,
        }),
      );
    });

    it('rejects cross-user attempts before signing', async () => {
      const { emitter, signer, gateway } = makeEmitter(undefined);

      const result = await emitter.emitQuestionAnswerControl({
        agentSessionId: recipient.agentSessionId,
        conversationId,
        actingUserId: 'other-user' as UserId,
        organizationId,
        ...answerParams,
      });

      expect(result).toEqual({ emitted: false, reason: 'owner_mismatch' });
      expect(signer.signConversationControl).not.toHaveBeenCalled();
      expect(gateway.emitConversationControl).not.toHaveBeenCalled();
    });
  });

  describe('emitConversationTriggerWithAck', () => {
    const operationId = '11111111-1111-4111-8111-111111111111';
    const operationFingerprint = 'a'.repeat(64);
    const acceptedAck = {
      acknowledged: true as const,
      acknowledgement: {
        status: 'ACCEPTED' as const,
        operationId,
        operationFingerprint,
        replayed: false,
      },
    };

    function makeEmitterWithAck(
      messageData: unknown,
      ackResult:
        | typeof acceptedAck
        | { acknowledged: false; reason: string } = acceptedAck,
    ) {
      const messageFindUnique = jest
        .fn()
        .mockResolvedValue(
          messageData === undefined ? null : { data: messageData },
        );
      const agentSessionFindFirst = jest.fn().mockResolvedValue(null);
      const machineFindFirst = jest.fn().mockResolvedValue(null);
      const prisma = {
        db: {
          message: { findUnique: messageFindUnique },
          agentSession: { findFirst: agentSessionFindFirst },
          machine: { findFirst: machineFindFirst },
        },
      };

      const resolver = {
        resolveConversationRecipient: jest.fn().mockResolvedValue(recipient),
        resolveExactConversationRecipient: jest.fn().mockResolvedValue({
          resolved: true,
          recipient,
        }),
        resolveMachineForUser: jest.fn().mockResolvedValue(recipient),
      };
      const signer: any = {
        signConversationTrigger: jest.fn().mockReturnValue(signedEnvelope),
        signConversationControl: jest.fn().mockReturnValue(signedEnvelope),
        signConversationReduction: jest.fn((...args) =>
          signer.signConversationControl(...args.slice(0, 3)),
        ),
        signConversationTriggerAuthorized: jest.fn((event, machine, user) =>
          signer.signConversationTrigger(event, machine, user),
        ),
        signConversationControlAuthorized: jest.fn((event, machine, user) =>
          signer.signConversationControl(event, machine, user),
        ),
      };
      const gateway = {
        emitConversationTrigger: jest.fn(),
        emitConversationControl: jest.fn(),
        emitConversationReduction: jest.fn(),
        emitConversationTriggerWithAck: jest.fn().mockResolvedValue(ackResult),
      };
      const executableFrameAuthorization = {
        resolveSelectedAuthorization: jest.fn().mockResolvedValue({
          kind: 'bounded_grant',
          grantId: 'grant-1',
        }),
        resolveBoundedGrant: jest.fn().mockResolvedValue({
          kind: 'bounded_grant',
          grantId: 'grant-1',
          target: { kind: 'AGENT_SESSION', id: 'session-1', revision: null },
          agentSessionId: 'session-1',
          authorizedTurnId: messageId,
          taskMonitorId: null,
        }),
      };

      const emitter = new TriggerEmitter(
        prisma as never,
        resolver as never,
        signer as never,
        gateway as never,
        executableFrameAuthorization as never,
      );
      return {
        emitter,
        resolver,
        signer,
        gateway,
        executableFrameAuthorization,
        agentSessionFindFirst,
        machineFindFirst,
      };
    }

    const triggersAgent = {
      promptType: 'start_run',
      operationId,
      operationFingerprint,
      triggerMessageId: messageId,
    };

    it('delegates to gateway.emitConversationTriggerWithAck and returns { acknowledged: true } on success', async () => {
      const { emitter, signer, gateway } = makeEmitterWithAck(
        { triggersAgent },
        acceptedAck,
      );

      const result = await emitter.emitConversationTriggerWithAck({
        conversationId,
        messageId,
        organizationId,
      });

      expect(result).toEqual({
        acknowledged: true,
        machineId: 'machine-1',
        acknowledgement: {
          status: 'ACCEPTED',
          operationId: '11111111-1111-4111-8111-111111111111',
          operationFingerprint: 'a'.repeat(64),
          replayed: false,
        },
      });
      expect(signer.signConversationTrigger).toHaveBeenCalledWith(
        triggersAgent,
        recipient.machineId,
        recipient.userId,
      );
      expect(gateway.emitConversationTriggerWithAck).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'trigger.conversation',
          conversationId,
          userId: recipient.userId,
          envelope: signedEnvelope,
        }),
        4000,
      );
    });

    it('accepts a replayed acknowledgement for a workflow trigger with nested input execution identity', async () => {
      const workflowTrigger = {
        promptType: 'implement',
        nodeId: 'feature-sync-implement',
        triggerMessageId: messageId,
        inputExecution: {
          operationId,
          operationFingerprint,
          messageId,
        },
      };
      const acknowledgement = {
        ...acceptedAck,
        acknowledgement: { ...acceptedAck.acknowledgement, replayed: true },
      };
      const { emitter } = makeEmitterWithAck(
        { triggersAgent: workflowTrigger },
        acknowledgement,
      );

      await expect(
        emitter.emitConversationTriggerWithAck({
          conversationId,
          messageId,
          organizationId,
        }),
      ).resolves.toEqual({
        acknowledged: true,
        machineId: recipient.machineId,
        acknowledgement: acknowledgement.acknowledgement,
      });
    });

    it('rejects a workflow acknowledgement with a different operation identity', async () => {
      const workflowTrigger = {
        promptType: 'startup_session',
        nodeId: 'feature-sync-coding-plan',
        triggerMessageId: messageId,
        inputExecution: {
          operationId,
          operationFingerprint,
          messageId,
        },
      };
      const mismatchedAck = {
        ...acceptedAck,
        acknowledgement: {
          ...acceptedAck.acknowledgement,
          operationFingerprint: 'b'.repeat(64),
          replayed: true,
        },
      };
      const { emitter } = makeEmitterWithAck(
        { triggersAgent: workflowTrigger },
        mismatchedAck,
      );

      await expect(
        emitter.emitConversationTriggerWithAck({
          conversationId,
          messageId,
          organizationId,
        }),
      ).resolves.toEqual({
        acknowledged: false,
        reason: 'acknowledgement_identity_mismatch',
      });
    });

    it('propagates { acknowledged: false, reason: "timeout" } when gateway returns timeout', async () => {
      const { emitter } = makeEmitterWithAck(
        { triggersAgent },
        { acknowledged: false, reason: 'timeout' },
      );

      const result = await emitter.emitConversationTriggerWithAck({
        conversationId,
        messageId,
        organizationId,
      });

      expect(result).toEqual({ acknowledged: false, reason: 'timeout' });
    });

    it('returns { acknowledged: false, reason: "no_recipient" } when resolveConversationRecipient returns null', async () => {
      const { emitter, resolver, gateway } = makeEmitterWithAck({
        triggersAgent,
      });
      resolver.resolveConversationRecipient.mockResolvedValueOnce(null);

      const result = await emitter.emitConversationTriggerWithAck({
        conversationId,
        messageId,
        organizationId,
      });

      expect(result).toEqual({ acknowledged: false, reason: 'no_recipient' });
      expect(gateway.emitConversationTriggerWithAck).not.toHaveBeenCalled();
    });

    it('passes the caller-supplied timeoutMs to the gateway', async () => {
      const { emitter, gateway } = makeEmitterWithAck({ triggersAgent });

      await emitter.emitConversationTriggerWithAck({
        conversationId,
        messageId,
        organizationId,
        timeoutMs: 7000,
      });

      expect(gateway.emitConversationTriggerWithAck).toHaveBeenCalledWith(
        expect.anything(),
        7000,
      );
    });

    it('revalidates compact reuse against the current Agent Session and Conversation', async () => {
      const { emitter, executableFrameAuthorization } = makeEmitterWithAck({
        triggersAgent,
      });

      await emitter.emitConversationTriggerWithAck({
        conversationId,
        messageId,
        organizationId,
        projectId: 'project-1' as ProjectId,
        authorizationId: 'authorization-1',
        grantId: 'grant-1',
        envelopeAuthorization: {
          kind: 'bounded_grant',
          grantId: 'grant-1',
        },
        preferPersistedActivation: false,
      });

      expect(
        executableFrameAuthorization.resolveSelectedAuthorization,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId,
          agentSessionId: 'session-1',
          target: {
            kind: HostActionTargetKind.AgentSession,
            id: 'session-1',
            revision: null,
          },
          authorizationId: 'authorization-1',
          grantId: 'grant-1',
          envelopeAuthorization: {
            kind: 'bounded_grant',
            grantId: 'grant-1',
          },
          preferPersistedActivation: false,
        }),
      );
    });

    it('propagates a persisted exact-machine binding contradiction', async () => {
      const callerMachineId = 'caller-machine-1' as MachineId;
      const { emitter, resolver, gateway } = makeEmitterWithAck(
        { triggersAgent },
        acceptedAck,
      );
      resolver.resolveExactConversationRecipient.mockResolvedValueOnce({
        resolved: false,
        reason: 'machine_binding_missing',
      });

      const result = await emitter.emitConversationTriggerWithAck({
        conversationId,
        messageId,
        organizationId,
        machineId: callerMachineId,
        agentSessionId,
      });

      expect(result).toEqual({
        acknowledged: false,
        reason: 'machine_binding_missing',
      });
      expect(resolver.resolveExactConversationRecipient).toHaveBeenCalledWith(
        conversationId,
        callerMachineId,
        agentSessionId,
      );
      expect(gateway.emitConversationTriggerWithAck).not.toHaveBeenCalled();
    });

    it('preserves an exact-machine foreign-owner reason', async () => {
      const foreignMachineId = 'foreign-machine' as MachineId;
      const { emitter, resolver, gateway } = makeEmitterWithAck({
        triggersAgent,
      });
      resolver.resolveExactConversationRecipient.mockResolvedValueOnce({
        resolved: false,
        reason: 'exact_machine_foreign',
      });

      const result = await emitter.emitConversationTriggerWithAck({
        conversationId,
        messageId,
        organizationId,
        machineId: foreignMachineId,
      });

      expect(result).toEqual({
        acknowledged: false,
        reason: 'exact_machine_foreign',
      });
      expect(gateway.emitConversationTriggerWithAck).not.toHaveBeenCalled();
    });

    it('preserves an exact-machine revoked reason', async () => {
      const revokedMachineId = 'revoked-machine' as MachineId;
      const { emitter, resolver, gateway } = makeEmitterWithAck({
        triggersAgent,
      });
      resolver.resolveExactConversationRecipient.mockResolvedValueOnce({
        resolved: false,
        reason: 'exact_machine_revoked',
      });

      const result = await emitter.emitConversationTriggerWithAck({
        conversationId,
        messageId,
        organizationId,
        machineId: revokedMachineId,
      });

      expect(result).toEqual({
        acknowledged: false,
        reason: 'exact_machine_revoked',
      });
      expect(gateway.emitConversationTriggerWithAck).not.toHaveBeenCalled();
    });
  });
});
