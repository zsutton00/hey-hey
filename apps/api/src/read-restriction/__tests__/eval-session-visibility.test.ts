import { NotFoundException } from '@nestjs/common';
import { ReadRestriction } from '@hey-hey/contracts/api/models';
import { ReadPolicyContext, readPolicyFor } from '../read-policy';
import { ReadVisibilityService } from '../read-visibility.service';

const COORDINATOR = 'coordinator-session';
const ATTEMPT = 'attempt-session';
const JUDGE = 'judge-session';
const RUNNING_JUDGE = 'still-running-judge-session';
const ORDINARY = 'ordinary-coding-session';

/** A project whose eval run recorded a coordinator, an attempt and its judge. */
const recordedPayloads = [
  { reportType: 'EVAL_RUN', coordinatorAgentSessionId: COORDINATOR },
  {
    reportType: 'EVAL_ATTEMPT',
    targetSessionId: ATTEMPT,
    automatedAssessment: { judgeSessionId: JUDGE },
  },
  // A judge still running: its session is recorded before any assessment exists.
  {
    reportType: 'EVAL_ATTEMPT',
    targetSessionId: 'other-attempt',
    judgeSessionId: RUNNING_JUDGE,
  },
];

const serviceOverProject = () => {
  const findMany = jest.fn(() =>
    Promise.resolve(recordedPayloads.map((payload) => ({ payload }))),
  );
  const service = new ReadVisibilityService({
    db: { report: { findMany } },
  } as never);

  return { service, findMany };
};

const sessionRefs = [COORDINATOR, ATTEMPT, JUDGE, RUNNING_JUDGE, ORDINARY].map(
  (entityId) => ({
    entityType: 'AGENT_SESSION',
    entityId,
  }),
);

describe('eval sessions under a read restriction', () => {
  it('hides the run, attempt, finished judge and still-running judge sessions from an evaluated attempt but keeps ordinary sessions', async () => {
    const { service } = serviceOverProject();

    const visible = await ReadPolicyContext.run(
      readPolicyFor(ReadRestriction.EvalTarget),
      () => service.filterVisible(sessionRefs, (ref) => ref),
    );

    expect(visible.map((ref) => ref.entityId)).toEqual([ORDINARY]);
  });

  it('answers a direct read of an eval session like a session that does not exist', async () => {
    const { service } = serviceOverProject();

    await expect(
      ReadPolicyContext.run(readPolicyFor(ReadRestriction.EvalTarget), () =>
        service.assertVisible('AGENT_SESSION', ATTEMPT),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([undefined, ReadRestriction.EvalJudge])(
    'leaves sessions readable for an unrestricted or judge read (%s)',
    async (restriction) => {
      const { service, findMany } = serviceOverProject();

      const visible = await ReadPolicyContext.run(
        readPolicyFor(restriction),
        () => service.filterVisible(sessionRefs, (ref) => ref),
      );

      expect(visible).toHaveLength(sessionRefs.length);
      expect(findMany).not.toHaveBeenCalled();
    },
  );
});
