import { BadRequestException } from '@nestjs/common';
import {
  assertApprovedEvalCaseHandlers,
  resolveEvalExecution,
} from '../eval-case-handlers';

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

describe('resolveEvalExecution', () => {
  const entityConversationCase = {
    targetHandler: 'entity_conversation',
  } as const;
  const researchCase = {
    targetHandler: 'project_assistant',
    consumerHandler: 'feature_refiner',
  } as const;

  it('keeps the case handler when the run chooses none', () => {
    expect(resolveEvalExecution(researchCase, undefined)).toEqual({
      handler: 'project_assistant',
      consumerHandler: 'feature_refiner',
      projectAssistantPrepares: false,
      assessedOutput: 'RESEARCH_REPORT',
    });
  });

  it('replaces the case handler with the run handler, prepared by Project Assistant by default', () => {
    expect(
      resolveEvalExecution(researchCase, { handler: 'entity_conversation' }),
    ).toEqual({
      handler: 'entity_conversation',
      projectAssistantPrepares: true,
      assessedOutput: 'HANDLER_REPLY',
    });
  });

  it('runs the handler alone when the setup turns Project Assistant off', () => {
    expect(
      resolveEvalExecution(entityConversationCase, {
        handler: 'feature_sync_analyze',
        projectAssistant: { enabled: false },
      }),
    ).toMatchObject({ projectAssistantPrepares: false });
  });

  it('runs Project Assistant alone under entity conversation policy, whatever the case names', () => {
    expect(
      resolveEvalExecution(researchCase, {
        handler: 'project_assistant',
        projectAssistant: { enabled: false },
      }),
    ).toEqual({
      handler: 'project_assistant',
      consumerHandler: 'entity_conversation',
      projectAssistantPrepares: false,
      assessedOutput: 'RESEARCH_REPORT',
    });
  });

  it('never has Project Assistant prepare a handler that declares no policy', () => {
    expect(
      resolveEvalExecution(entityConversationCase, { handler: 'agent_search' }),
    ).toMatchObject({ projectAssistantPrepares: false });
  });
});
