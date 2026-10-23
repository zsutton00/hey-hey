import {
  EvalOutputAdmissionService,
  ORDINARY_EVAL_OUTPUT_STAMP,
} from '../eval-output-admission.service';

const ORG = 'org-1' as never;
const PROJECT = 'project-1' as never;
const SESSION = 'session-1';

function build(attempt: unknown) {
  const findFirst = jest.fn().mockResolvedValue(attempt);
  const tx = { report: { findFirst } };
  return {
    service: new EvalOutputAdmissionService(),
    tx: tx as never,
    findFirst,
  };
}

describe('EvalOutputAdmissionService', () => {
  it('treats output from the target session of an in-flight attempt as eval output', async () => {
    const { service, tx, findFirst } = build({ id: 'attempt-1' });
    await expect(
      service.resolve(tx, {
        organizationId: ORG,
        projectId: PROJECT,
        writingSessionId: SESSION,
      }),
    ).resolves.toEqual({
      ragEnabled: false,
      applicationEligible: false,
      isEvalOutput: true,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG,
          projectId: PROJECT,
          reportType: 'EVAL_ATTEMPT',
          AND: expect.arrayContaining([
            {
              payload: { path: ['targetSessionId'], equals: SESSION },
            },
            {
              OR: expect.arrayContaining([
                { payload: { path: ['status'], equals: 'RUNNING' } },
              ]),
            },
          ]),
        }),
      }),
    );
  });

  it('stores output ordinarily when no in-flight attempt names the writing session', async () => {
    const { service, tx } = build(null);
    await expect(
      service.resolve(tx, {
        organizationId: ORG,
        projectId: PROJECT,
        writingSessionId: SESSION,
      }),
    ).resolves.toEqual(ORDINARY_EVAL_OUTPUT_STAMP);
  });

  it('returns the ordinary stamp without a lookup when the writer has no session', async () => {
    const { service, tx, findFirst } = build(null);
    await expect(
      service.resolve(tx, { organizationId: ORG, projectId: PROJECT }),
    ).resolves.toEqual(ORDINARY_EVAL_OUTPUT_STAMP);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
