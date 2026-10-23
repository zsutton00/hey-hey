import { describe, expect, it, vi } from 'vitest';
import type { Run } from '../../../run/run';
import { SubmissionToolCorrectableError } from '../../submission-tools/types';
import { submitCodingConversationReadinessTool } from '../submit-readiness-tool';

const disposition = {
  state: 'REVIEW_REQUIRED',
  sourceSnapshot: {
    runId: 'run-1',
    focalEntityId: 'task-1',
    focalEntityType: 'TASK',
    sourceRevision: 'sha256:source',
    capturedAt: '2026-09-17T19:00:00.000Z',
  },
  finding: {
    affectedSourceContext: 'Task context',
    unresolvedDecision: 'Who owns the write?',
    consequentialInventionRisk: 'The implementation would invent ownership.',
    boundedEvidence: [{ category: 'ownership', statement: 'The task leaves ownership open.' }],
    answerKind: 'Name the owner.',
  },
  resolution: { kind: 'NONE' },
};

describe('coding-conversation readiness submission', () => {
  it('reports agent-authored DISMISSED as a correctable tool error', async () => {
    const run = { validateImplementationReadinessFromAgentResponse: vi.fn() } as unknown as Run;
    await expect(
      submitCodingConversationReadinessTool.execute({
        runId: 'run-1',
        args: { disposition: { ...disposition, state: 'DISMISSED' } },
        run,
      }),
    ).rejects.toBeInstanceOf(SubmissionToolCorrectableError);
    expect(run.validateImplementationReadinessFromAgentResponse).not.toHaveBeenCalled();
  });

  it('records an accepted CLEAR on the Run so the turn can continue', async () => {
    const run = {
      persistImplementationReadinessFromAgentResponse: vi.fn().mockResolvedValue(undefined),
      validateImplementationReadinessFromAgentResponse: vi.fn(),
    } as unknown as Run;
    const clear = { ...disposition, state: 'CLEAR', finding: null };

    await expect(
      submitCodingConversationReadinessTool.execute({
        runId: 'run-1',
        args: { disposition: clear },
        run,
      }),
    ).resolves.toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining('recorded as CLEAR') }],
    });
    expect(run.persistImplementationReadinessFromAgentResponse).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'CLEAR', finding: null }),
    );
    expect(run.validateImplementationReadinessFromAgentResponse).not.toHaveBeenCalled();
  });

  it('reports a CLEAR against an already resolved gate as a correctable error', async () => {
    const run = {
      persistImplementationReadinessFromAgentResponse: vi
        .fn()
        .mockRejectedValue(new Error('Implementation readiness is already complete for this Run.')),
    } as unknown as Run;

    await expect(
      submitCodingConversationReadinessTool.execute({
        runId: 'run-1',
        args: { disposition: { ...disposition, state: 'CLEAR', finding: null } },
        run,
      }),
    ).rejects.toMatchObject({
      name: 'SubmissionToolCorrectableError',
      reason: expect.stringContaining('already complete'),
    });
  });

  it('returns a source-binding error to the agent and accepts a corrected retry', async () => {
    const validate = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Implementation-readiness submission does not match this Run context.');
      })
      .mockReturnValue(disposition);
    const run = { validateImplementationReadinessFromAgentResponse: validate } as unknown as Run;
    const input = { runId: 'run-1', args: { disposition }, run };

    await expect(submitCodingConversationReadinessTool.execute(input)).rejects.toMatchObject({
      name: 'SubmissionToolCorrectableError',
      findings: [expect.objectContaining({ field: '/disposition/sourceSnapshot' })],
    });
    await expect(submitCodingConversationReadinessTool.execute(input)).resolves.toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining('validated') }],
    });
  });
});
