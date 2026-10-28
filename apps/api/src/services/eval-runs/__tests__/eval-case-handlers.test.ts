import { BadRequestException } from '@nestjs/common';
import { assertApprovedEvalCaseHandlers } from '../eval-case-handlers';

const projected = (
  handler: string,
  consumer: string,
  status?: 'ACTIVE' | 'ARCHIVED',
) => ({
  name: 'A case',
  ...(status ? { status } : {}),
  sections: [
    { key: 'handler', content: handler },
    { key: 'consumerHandler', content: consumer },
  ],
});

describe('assertApprovedEvalCaseHandlers', () => {
  it.each([
    ['an entity conversation case', 'entity_conversation', ''],
    [
      'a Project Assistant case with its consumer',
      'project_assistant',
      'entity_conversation',
    ],
  ])('approves %s', (_name, handler, consumer) => {
    expect(() =>
      assertApprovedEvalCaseHandlers(projected(handler, consumer)),
    ).not.toThrow();
  });

  it.each([
    ['an unevaluable handler', 'run_eval', ''],
    ['a Project Assistant case with no consumer', 'project_assistant', ''],
  ])(
    'rejects %s before the case becomes runnable',
    (_name, handler, consumer) => {
      expect(() =>
        assertApprovedEvalCaseHandlers(projected(handler, consumer)),
      ).toThrow(BadRequestException);
    },
  );

  it('does not check a case that is leaving the runnable state', () => {
    expect(() =>
      assertApprovedEvalCaseHandlers(projected('run_eval', '', 'ARCHIVED')),
    ).not.toThrow();
  });
});
