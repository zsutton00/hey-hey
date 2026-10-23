import { describe, expect, it, vi } from 'vitest';
import type { TurnAdmission } from '../shared/api/generated/api';
import type { DispatchSource } from './dispatch-source';
import type { LocalAgentService } from './local-agent-service';
import type { RunStore } from '../run-store/run-store';
import {
  SessionMessageRuntime,
  verifySessionMessageAdmission,
  type SessionMessageTargets,
} from './session-message-runtime';

const sourceSessionId = '10000000-0000-4000-8000-000000000001';
const targetSessionId = '10000000-0000-4000-8000-000000000002';
const machineId = '10000000-0000-4000-8000-000000000003';
const attemptId = '10000000-0000-4000-8000-000000000004';
const admissionId = '10000000-0000-4000-8000-000000000005';
const target = {
  organizationId: sourceSessionId,
  projectId: targetSessionId,
  targetSessionId,
  admissionId,
};

const admission = (): TurnAdmission =>
  ({
    id: admissionId,
    agentSessionId: targetSessionId,
    source: 'AGENT_INTERACTION',
    state: 'OCCUPIED',
    ordinal: 1,
    generation: 1,
    idempotencyKey: attemptId,
    authorKind: 'AGENT',
    interactionAttemptId: attemptId,
    createdAt: new Date().toISOString(),
    sessionMessageInput: {
      sourceSessionId,
      interactionId: '10000000-0000-4000-8000-000000000006',
      attemptId,
      authorKind: 'AGENT',
      objective: 'Investigate',
      authority: {
        kind: 'MACHINE_SESSION',
        machineId,
        sourceSessionId,
        targetSessionId,
        subagentCapability: 'RESEARCH',
      },
    },
  }) as TurnAdmission;

describe('verifySessionMessageAdmission', () => {
  it('accepts only the attempt and authority bound to the claimed target', () => {
    expect(verifySessionMessageAdmission(admission(), target, machineId).objective).toBe(
      'Investigate',
    );
    expect(() =>
      verifySessionMessageAdmission(
        { ...admission(), authorKind: 'HUMAN' } as TurnAdmission,
        target,
        machineId,
      ),
    ).toThrow();
    expect(() =>
      verifySessionMessageAdmission(
        { ...admission(), interactionAttemptId: sourceSessionId } as TurnAdmission,
        target,
        machineId,
      ),
    ).toThrow();
    expect(() =>
      verifySessionMessageAdmission(
        admission(),
        { ...target, targetSessionId: sourceSessionId },
        machineId,
      ),
    ).toThrow();
    expect(() => verifySessionMessageAdmission(admission(), target, sourceSessionId)).toThrow();
    const unbounded = admission();
    delete unbounded.sessionMessageInput?.authority.subagentCapability;
    expect(() => verifySessionMessageAdmission(unbounded, target, machineId)).toThrow();
    const answerWithoutText = admission();
    delete answerWithoutText.sessionMessageInput!.objective;
    answerWithoutText.sessionMessageInput!.answerReference = attemptId;
    expect(() => verifySessionMessageAdmission(answerWithoutText, target, machineId)).toThrow();
  });
});

describe('SessionMessageRuntime', () => {
  const userId = '10000000-0000-4000-8000-000000000007';
  const setup = (ownerProjectId = target.projectId) => {
    const admit = vi.fn(async () => undefined);
    const advance = vi.fn(async () => undefined);
    const runtime = new SessionMessageRuntime({
      runStore: {
        lookupByAgentSessionId: vi.fn(() => 'run'),
        getRun: vi.fn(async () => ({
          contextMetadata: {
            agentSessionId: targetSessionId,
            organizationId: target.organizationId,
            projectId: ownerProjectId,
          },
        })),
      } as unknown as RunStore,
      agentService: {
        inputAdmission: { owner: { admit }, advance },
      } as unknown as LocalAgentService,
    });
    // Delivers only when the test says so; no timers involved.
    let onWork: ((work: SessionMessageTargets) => Promise<void>) | undefined;
    const source: DispatchSource<SessionMessageTargets> = {
      subscribe(listener) {
        onWork = listener;
        return { dispose: () => (onWork = undefined) };
      },
    };
    source.subscribe((work) => runtime.receive(work));
    const deliver = () =>
      onWork!({
        machineId,
        targets: [
          { ...target, userId, admission: admission() } as SessionMessageTargets['targets'][number],
        ],
      });
    return { admit, advance, deliver };
  };

  it('admits a delivered target into the local admission owner and advances its session', async () => {
    const { admit, advance, deliver } = setup();

    await deliver();

    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: admissionId,
        agentSessionId: targetSessionId,
        runId: 'run',
        machineId,
      }),
      {
        kind: 'session_message',
        keyKind: 'operation',
        payload: expect.objectContaining({
          kind: 'session_message',
          platformAdmissionId: admissionId,
        }),
      },
      expect.any(Function),
    );
    expect(advance).toHaveBeenCalledWith(targetSessionId);
  });

  it('refuses a target whose local Run belongs to another project', async () => {
    const { admit, deliver } = setup(sourceSessionId);

    await expect(deliver()).rejects.toThrow('does not own');
    expect(admit).not.toHaveBeenCalled();
  });
});
