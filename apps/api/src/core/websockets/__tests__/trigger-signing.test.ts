import * as crypto from 'crypto';
import {
  AgentTrigger,
  AgentTriggerStartRun,
  RunCreatePayloadWorkflowKickoff,
  MachineRevocationReductionBodyDto,
  SignedConversationTriggerEnvelope,
} from '../../../generated';
import { ConversationId, MachineId, UserId } from '../../../types';
import { ServerSigningKeyService } from '../../server-signing/server-signing-key.service';
import { canonicalizeJcs } from '../trigger-canonicalization';
import {
  ConversationControlBody,
  TriggerEnvelopeSigner,
} from '../trigger-envelope-signer.service';

describe('canonicalizeJcs', () => {
  it('is deterministic regardless of object key insertion order', () => {
    const a = { b: 1, a: 2, c: { z: 'z', y: 'y' } };
    const b = { c: { y: 'y', z: 'z' }, a: 2, b: 1 };

    expect(canonicalizeJcs(a)).toBe(canonicalizeJcs(b));
  });

  it('sorts object members lexicographically by UTF-16 code unit', () => {
    expect(canonicalizeJcs({ event: 1, machineId: 2, userId: 3 })).toBe(
      '{"event":1,"machineId":2,"userId":3}',
    );
  });

  it('emits arrays in order and drops undefined object members', () => {
    expect(canonicalizeJcs({ keep: [3, 1, 2], drop: undefined })).toBe(
      '{"keep":[3,1,2]}',
    );
  });

  it('rejects non-finite numbers rather than emitting null', () => {
    expect(() => canonicalizeJcs({ n: Number.NaN })).toThrow();
  });
});

describe('TriggerEnvelopeSigner', () => {
  const machineId = 'machine-abc' as MachineId;
  const userId = 'user-xyz' as UserId;

  const agentTrigger = {
    promptType: 'implement',
    nodeId: 'node-1',
  } as unknown as AgentTrigger;

  function makeSigner(): { signer: TriggerEnvelopeSigner } {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const configService = { get: jest.fn().mockReturnValue(pem) };
    const signingKeyService = new ServerSigningKeyService(
      configService as never,
    );
    return {
      signer: new TriggerEnvelopeSigner(signingKeyService),
    };
  }

  it('produces a signature that verifies against the signing public key', () => {
    const { signer } = makeSigner();

    const envelope = signer.signConversationTrigger(
      agentTrigger,
      machineId,
      userId,
    );

    const { signature, ...signedFields } = envelope;
    const canonical = canonicalizeJcs(signedFields);
    const verified = crypto.verify(
      null,
      Buffer.from(canonical, 'utf8'),
      signer.getPublicKey(),
      Buffer.from(signature, 'base64'),
    );

    expect(verified).toBe(true);
  });

  it('binds the signature to the body — tampering invalidates it', () => {
    const { signer } = makeSigner();

    const envelope = signer.signConversationTrigger(
      agentTrigger,
      machineId,
      userId,
    );

    const tampered: Omit<SignedConversationTriggerEnvelope, 'signature'> = {
      machineId: envelope.machineId,
      userId: envelope.userId,
      nonce: envelope.nonce,
      timestampMs: envelope.timestampMs,
      event: { ...envelope.event, nodeId: 'node-EVIL' } as AgentTrigger,
    };

    const verified = crypto.verify(
      null,
      Buffer.from(canonicalizeJcs(tampered), 'utf8'),
      signer.getPublicKey(),
      Buffer.from(envelope.signature, 'base64'),
    );

    expect(verified).toBe(false);
  });

  it('protocol-2 signatures cover protocol, addressing, body, and complete authorization', () => {
    const { signer } = makeSigner();
    const authorization = {
      kind: 'bounded_grant' as const,
      grantId: 'grant-1',
      target: {
        kind: 'AGENT_SESSION' as const,
        id: 'session-1',
        revision: null,
      },
      agentSessionId: 'session-1',
      authorizedTurnId: null,
      taskMonitorId: null,
    };
    const envelope = signer.signConversationTriggerAuthorized(
      agentTrigger,
      machineId,
      userId,
      authorization,
    );
    const { signature, ...signedFields } = envelope;

    expect(
      crypto.verify(
        null,
        Buffer.from(canonicalizeJcs(signedFields), 'utf8'),
        signer.getPublicKey(),
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(true);

    expect(
      crypto.verify(
        null,
        Buffer.from(
          canonicalizeJcs({
            ...signedFields,
            authorization: { ...authorization, grantId: 'grant-other' },
          }),
          'utf8',
        ),
        signer.getPublicKey(),
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(false);
  });

  it('signs the complete machine-authority reduction envelope', () => {
    const { signer } = makeSigner();
    const reduction = {
      version: 2,
      kind: 'machine_revocation_reduction',
      action: 'MACHINE_REVOKE',
      machineId,
      revokedAt: new Date().toISOString(),
      executionReadiness: 'MACHINE_REVOKED',
    } satisfies MachineRevocationReductionBodyDto;

    const envelope = signer.signMachineRevocationReduction(
      reduction,
      machineId,
      userId,
    );
    const { signature, ...signedFields } = envelope;

    expect(
      crypto.verify(
        null,
        Buffer.from(canonicalizeJcs(signedFields), 'utf8'),
        signer.getPublicKey(),
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(true);
  });

  it('covers the workflow focal entity in the signed start-run envelope', () => {
    const { signer } = makeSigner();
    const workflowPayload: RunCreatePayloadWorkflowKickoff = {
      promptType:
        RunCreatePayloadWorkflowKickoff.PromptTypeEnum.WorkflowKickoff,
      entity: {
        entityType: 'TASK',
        entityId: '11111111-1111-4111-8111-111111111111',
      },
      userMessage: 'Plan this task.',
    };
    const workflowStartTrigger: AgentTriggerStartRun = {
      operationId: '55555555-5555-4555-8555-555555555555',
      operationFingerprint: '0'.repeat(64),
      promptType: AgentTriggerStartRun.PromptTypeEnum.StartRun,
      triggerMessageId: '22222222-2222-4222-8222-222222222222',
      payload: {
        workflowName: 'plan-from-design-doc',
        payload: workflowPayload,
        model: 'gpt-5.6-luna',
        reasoningEffort: 'high',
        provider: 'codex',
        contextMetadata: {
          capturedAt: '2026-07-17T00:00:00.000Z',
          organizationId: '33333333-3333-4333-8333-333333333333',
          projectId: '44444444-4444-4444-8444-444444444444',
          agentSessionId: '55555555-5555-4555-8555-555555555555',
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
        agentSessionId: '55555555-5555-4555-8555-555555555555',
      },
    };

    const envelope = signer.signConversationTrigger(
      workflowStartTrigger,
      machineId,
      userId,
    );
    const { signature, ...signedFields } = envelope;

    expect(
      crypto.verify(
        null,
        Buffer.from(canonicalizeJcs(signedFields), 'utf8'),
        signer.getPublicKey(),
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(true);
    expect(envelope.event).toEqual(workflowStartTrigger);

    const tamperedEvent: AgentTriggerStartRun = {
      ...workflowStartTrigger,
      payload: {
        ...workflowStartTrigger.payload,
        payload: {
          ...workflowPayload,
          entity: {
            ...workflowPayload.entity!,
            entityId: '66666666-6666-4666-8666-666666666666',
          },
        },
      },
    };
    const tamperedSignedFields: Omit<
      SignedConversationTriggerEnvelope,
      'signature'
    > = {
      ...signedFields,
      event: tamperedEvent,
    };

    expect(
      crypto.verify(
        null,
        Buffer.from(canonicalizeJcs(tamperedSignedFields), 'utf8'),
        signer.getPublicKey(),
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(false);
  });

  it('mints a fresh nonce per envelope', () => {
    const { signer } = makeSigner();

    const first = signer.signConversationTrigger(
      agentTrigger,
      machineId,
      userId,
    );
    const second = signer.signConversationTrigger(
      agentTrigger,
      machineId,
      userId,
    );

    expect(first.nonce).not.toBe(second.nonce);
  });

  it('signs conversation-control stop_run envelopes with the same verifiable contract', () => {
    const { signer } = makeSigner();

    const controlBody: ConversationControlBody = {
      kind: 'stop_run',
      conversationId: '550e8400-e29b-41d4-a716-446655440003' as ConversationId,
      runId: '550e8400-e29b-41d4-a716-446655440099',
    };

    const envelope = signer.signConversationControl(
      controlBody,
      machineId,
      userId,
    );

    const { signature, ...signedFields } = envelope;
    const verified = crypto.verify(
      null,
      Buffer.from(canonicalizeJcs(signedFields), 'utf8'),
      signer.getPublicKey(),
      Buffer.from(signature, 'base64'),
    );

    expect(verified).toBe(true);
    expect(envelope.event).toEqual(controlBody);
  });

  it('signs conversation-control compact_run envelopes with the same verifiable contract', () => {
    const { signer } = makeSigner();

    const controlBody: ConversationControlBody = {
      kind: 'compact_run',
      agentSessionId: '550e8400-e29b-41d4-a716-446655440099',
      conversationId: '550e8400-e29b-41d4-a716-446655440003' as ConversationId,
      runId: '550e8400-e29b-41d4-a716-446655440099',
    };

    const envelope = signer.signConversationControl(
      controlBody,
      machineId,
      userId,
    );

    const { signature, ...signedFields } = envelope;
    const verified = crypto.verify(
      null,
      Buffer.from(canonicalizeJcs(signedFields), 'utf8'),
      signer.getPublicKey(),
      Buffer.from(signature, 'base64'),
    );

    expect(verified).toBe(true);
    expect(envelope.event).toEqual(controlBody);
  });
});
