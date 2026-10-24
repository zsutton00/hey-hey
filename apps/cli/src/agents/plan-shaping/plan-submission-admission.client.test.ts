import { AxiosHeaders } from 'axios';
import { createSubmitPhaseBreakdownTool } from './submission-tools';
import { describe, expect, it, vi } from 'vitest';
import { PlanSubmissionAdmissionClient } from './plan-submission-admission.client';
import { SubmissionToolAuth } from '../submission-tools/submission-tool-auth';
import { createTestRun } from '../../run/run.test-support';
import { Turn } from '../../turn/turn';
import { NOOP_LOGGER } from '../../server/logger';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { PlansApi, PlanSubmissionAdmissionResponse } from '../../shared/api/generated/api';
import { taskIdFromSession } from '../run-entity';

function fixture(
  payload: object = { planId: 'runtime-plan' },
  triggerMessageId: string | null = 'turn-trigger',
) {
  const run = createTestRun();
  run.session.entity = null;
  run.setActiveTurn(
    new Turn({
    effectiveRole: 'implementation',
      turnId: 'turn',
      runId: run.runId,
      resolvedPrompt: '',
      payload,
      handler: {
        id: 'phase',
        promptType: LocalPromptType.PlanShapingPhaseBreakdown,
        service: 'optional',
        launchEntity: 'required',
        implementationReadiness: 'none',
        reports: [],
        runnerKind: 'provider_session',
        providerSessionCountsForContext: true,
        buildPrompt: () => '',
      },
      externalAgentNodeId: 'phase-node',
      triggerMessageId,
      runner: { run: async () => undefined },
      platformMcpProxy: null,
      abortController: new AbortController(),
      logger: NOOP_LOGGER,
      owner: run,
      effectiveModel: null,
      effectiveReasoningEffort: null,
    }),
  );
  const auth = Object.create(SubmissionToolAuth.prototype) as SubmissionToolAuth;
  vi.spyOn(auth, 'getAccessToken').mockResolvedValue('token');
  const response = {
    status: 'accepted',
    advisories: [],
    submission: { stageIdx: 0, phaseIdx: 0, plan: { steps: [] } },
  } satisfies PlanSubmissionAdmissionResponse;
  const admitPlanSubmission = vi.fn<PlansApi['admitPlanSubmission']>().mockResolvedValue({
    data: response,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
  const client = new PlanSubmissionAdmissionClient({
    auth,
    apiBaseUrl: '',
    createClient: () => ({ admitPlanSubmission }),
  });
  return { run, client, admitPlanSubmission };
}
const request = {
  kind: 'phase_breakdown' as const,
  submission: { stageIdx: 0, phaseIdx: 0, plan: { steps: [] } },
};

describe('PlanSubmissionAdmissionClient runtime identity', () => {
  it('uses the prompt Plan and exact turn trigger when the task-only session lookup is absent', async () => {
    const { run, client, admitPlanSubmission } = fixture();
    expect(taskIdFromSession(run.session)).toBeNull();
    run.setTriggerContext({ externalAgentNodeId: 'other-node', triggerMessageId: 'other-trigger' });
    await expect(client.admit(run, request)).resolves.toMatchObject({ status: 'accepted' });
    expect(admitPlanSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'runtime-plan',
        planSubmissionAdmissionRequest: {
          ...request,
          conversationId: run.conversationId,
          triggerMessageId: 'turn-trigger',
        },
      }),
    );
  });
  it('submits a grounded phase through real admission using runtime identities', async () => {
    const { run, client, admitPlanSubmission } = fixture();
    vi.spyOn(run, 'readReportChain').mockReturnValue([
      {
        createdAt: '2026-09-10T00:00:00Z',
        phase: LocalPromptType.PlanShapingPhaseBreakdown,
        reportId: 'grounding',
        reportType: 'PHASE_GROUNDING',
        summary: 'Grounded',
        audience: 'EXTERNAL',
        touchPoints: [{ file: 'src/example.ts', expectedOutcome: 'Fix identity' }],
      },
    ]);
    const result = await createSubmitPhaseBreakdownTool(client).execute({
      run,
      runId: run.runId,
      triggerMessageId: 'turn-trigger',
      args: {
        stageIdx: 0,
        phaseIdx: 0,
        plan: {
          steps: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              stageId: '11111111-1111-4111-8111-111111111111',
              title: 'Fix admission identity',
              description: 'Use runtime plan context.',
              implementation: 'Update src/example.ts to use the runtime Plan.',
              type: 'TASK',
              sequenceOrder: 0,
              dependsOnStepIds: ['33333333-3333-4333-8333-333333333333'],
              designDocMotivation: 'Preserve runtime ownership.',
              acceptanceCriteria: 'Admission receives the Plan identity.',
            },
          ],
        },
      },
    });
    expect(result).toMatchObject({ action: 'DONE' });
    expect(
      admitPlanSubmission.mock.calls[0]?.[0].planSubmissionAdmissionRequest.submission.plan.steps[0]
        ?.dependsOnStepIds,
    ).toEqual(['33333333-3333-4333-8333-333333333333']);
    expect(admitPlanSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'runtime-plan' }),
    );
  });
  it.each([
    [{}, 'turn-trigger', 'active turn payload.planId'],
    [{ planId: 'runtime-plan' }, null, 'active turn triggerMessageId'],
  ] as const)('identifies the actual missing prerequisite', async (payload, trigger, missing) => {
    const { run, client, admitPlanSubmission } = fixture(payload, trigger);
    await expect(client.admit(run, request)).rejects.toThrow(
      `Plan submission admission requires ${missing}.`,
    );
    expect(admitPlanSubmission).not.toHaveBeenCalled();
  });
});
