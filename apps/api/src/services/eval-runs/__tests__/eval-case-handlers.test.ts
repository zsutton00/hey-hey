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

const SERVICE = '44444444-4444-4444-8444-444444444444';
const SHA = 'a'.repeat(40);
const coding = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    serviceId: SERVICE,
    pinnedCommit: { sha: SHA, shortMessage: 'Add settings page' },
    testCommands: ['pnpm test settings'],
    knownGoodDiff: 'diff --git good',
    knownBadDiff: 'diff --git bad',
    ...overrides,
  });
const withCoding = (handler: string, content?: string) => ({
  name: 'A case',
  sections: [
    { key: 'handler', content: handler },
    { key: 'consumerHandler', content: '' },
    ...(content === undefined ? [] : [{ key: 'coding', content }]),
  ],
});
const serviceExists = async (id: string) => id === SERVICE;

describe('assertApprovedEvalCaseHandlers', () => {
  it.each([
    ['an entity conversation case', 'entity_conversation', ''],
    [
      'a Project Assistant case with its consumer',
      'project_assistant',
      'entity_conversation',
    ],
  ])('approves %s', async (_name, handler, consumer) => {
    await expect(
      assertApprovedEvalCaseHandlers(
        projected(handler, consumer),
        serviceExists,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['an unevaluable handler', 'run_eval', ''],
    ['a Project Assistant case with no consumer', 'project_assistant', ''],
  ])(
    'rejects %s before the case becomes runnable',
    async (_name, handler, consumer) => {
      await expect(
        assertApprovedEvalCaseHandlers(
          projected(handler, consumer),
          serviceExists,
        ),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('does not check a case that is leaving the runnable state', async () => {
    await expect(
      assertApprovedEvalCaseHandlers(
        projected('run_eval', '', 'ARCHIVED'),
        serviceExists,
      ),
    ).resolves.toBeUndefined();
  });

  describe('Coding section', () => {
    it('approves a free-form coding case with a valid Coding section', async () => {
      await expect(
        assertApprovedEvalCaseHandlers(
          withCoding('free_form', coding()),
          serviceExists,
        ),
      ).resolves.toBeUndefined();
    });

    it.each([
      ['a free-form case without a Coding section', withCoding('free_form')],
      [
        'another handler with a Coding section',
        withCoding('entity_conversation', coding()),
      ],
      [
        'a Coding section naming an unknown Service',
        withCoding('free_form', coding({ serviceId: crypto.randomUUID() })),
      ],
      [
        'a malformed commit',
        withCoding(
          'free_form',
          coding({ pinnedCommit: { sha: 'abc123', shortMessage: 'x' } }),
        ),
      ],
    ])('rejects %s', async (_name, item) => {
      await expect(
        assertApprovedEvalCaseHandlers(item, serviceExists),
      ).rejects.toThrow(BadRequestException);
    });
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

  it('judges the recorded changes, not the reply, for a free-form coding case', () => {
    expect(
      resolveEvalExecution(
        { targetHandler: 'free_form' } as Parameters<
          typeof resolveEvalExecution
        >[0],
        undefined,
      ),
    ).toMatchObject({ assessedOutput: 'CODE_CHANGES' });
  });

  it('never has Project Assistant prepare a handler that declares no policy', () => {
    expect(
      resolveEvalExecution(entityConversationCase, { handler: 'agent_search' }),
    ).toMatchObject({ projectAssistantPrepares: false });
  });
});
