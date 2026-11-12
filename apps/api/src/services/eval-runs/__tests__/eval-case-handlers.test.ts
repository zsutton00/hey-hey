import { BadRequestException } from '@nestjs/common';
import {
  assertApprovedEvalCaseHandlers,
  resolveEvalExecution,
} from '../eval-case-handlers';

const VALID_INPUTS = JSON.stringify({
  inputs: [{ kind: 'text_message', text: 'Add a mobile view.' }],
});

const projected = (
  handler: string,
  consumer: string,
  status?: 'ACTIVE' | 'ARCHIVED',
) => ({
  name: 'A case',
  ...(status ? { status } : {}),
  sections: [
    { key: 'inputs', content: VALID_INPUTS },
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
    knownGoodDiff: 'diff --git good',
    knownBadDiff: 'diff --git bad',
    ...overrides,
  });
const withCoding = (handler: string, content?: string) => ({
  name: 'A case',
  sections: [
    { key: 'inputs', content: VALID_INPUTS },
    { key: 'handler', content: handler },
    { key: 'consumerHandler', content: '' },
    ...(content === undefined ? [] : [{ key: 'coding', content }]),
  ],
});
const MOCKUP = '55555555-5555-4555-8555-555555555555';
const checklist = (overrides: Record<string, unknown> = {}) => ({
  mockupChecklist: {
    mockupId: MOCKUP,
    kind: 'NEW',
    items: [{ id: 'save', description: 'Saving shows a confirmation' }],
    ...overrides,
  },
});
const serviceExists = async (id: string) => id === SERVICE;
const mockupExists = async (id: string) => id === MOCKUP;

describe('a conversation and its handler', () => {
  const conversation = JSON.stringify({
    inputs: [
      { kind: 'text_message', text: 'Hello.' },
      { kind: 'text_message', text: 'Now find the mockup.' },
    ],
  });
  const withInputs = (handler: string, consumer: string, inputs: string) => ({
    name: 'A case',
    sections: [
      { key: 'inputs', content: inputs },
      { key: 'handler', content: handler },
      { key: 'consumerHandler', content: consumer },
    ],
  });

  it('rejects approving a multi-message case whose handler is Project Assistant, which is not interactive', async () => {
    await expect(
      assertApprovedEvalCaseHandlers(
        withInputs(
          'project_assistant',
          'entity_conversation',
          conversation,
        ) as never,
        serviceExists,
        mockupExists,
      ),
    ).rejects.toThrow(/not interactive/);
  });

  it('still approves a multi-message case on a conversational handler and a one-message Project Assistant case', async () => {
    await expect(
      assertApprovedEvalCaseHandlers(
        withInputs('entity_conversation', '', conversation) as never,
        serviceExists,
        mockupExists,
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertApprovedEvalCaseHandlers(
        withInputs(
          'project_assistant',
          'entity_conversation',
          VALID_INPUTS,
        ) as never,
        serviceExists,
        mockupExists,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('assertApprovedEvalCaseHandlers', () => {
  it.each([
    ['missing', undefined],
    ['empty', '{"inputs":[]}'],
    ['an unknown kind', '{"inputs":[{"kind":"audio","text":"x"}]}'],
  ])('rejects a case whose Inputs section is %s', async (_name, content) => {
    const sections = projected('entity_conversation', '').sections.filter(
      (section) => section.key !== 'inputs',
    );
    await expect(
      assertApprovedEvalCaseHandlers(
        {
          name: 'A case',
          sections: [
            ...sections,
            ...(content === undefined ? [] : [{ key: 'inputs', content }]),
          ],
        } as never,
        serviceExists,
        mockupExists,
      ),
    ).rejects.toThrow(BadRequestException);
  });

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
        mockupExists,
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
          mockupExists,
        ),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('does not check a case that is leaving the runnable state', async () => {
    await expect(
      assertApprovedEvalCaseHandlers(
        projected('run_eval', '', 'ARCHIVED'),
        serviceExists,
        mockupExists,
      ),
    ).resolves.toBeUndefined();
  });

  describe('Coding section', () => {
    it('approves a free-form coding case with a valid Coding section', async () => {
      await expect(
        assertApprovedEvalCaseHandlers(
          withCoding('free_form', coding()),
          serviceExists,
          mockupExists,
        ),
      ).resolves.toBeUndefined();
    });

    it('approves a Coding section with a Mockup checklist', async () => {
      await expect(
        assertApprovedEvalCaseHandlers(
          withCoding('free_form', coding(checklist())),
          serviceExists,
          mockupExists,
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
        'a Coding section that still names test commands',
        withCoding('free_form', coding({ testCommands: ['pnpm test'] })),
      ],
      [
        'a checklist naming a Mockup outside the project',
        withCoding(
          'free_form',
          coding(checklist({ mockupId: crypto.randomUUID() })),
        ),
      ],
      [
        'a checklist with no items',
        withCoding('free_form', coding(checklist({ items: [] }))),
      ],
      [
        'a checklist that repeats an item id',
        withCoding(
          'free_form',
          coding(
            checklist({
              items: [
                { id: 'a', description: 'One' },
                { id: 'a', description: 'Two' },
              ],
            }),
          ),
        ),
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
        assertApprovedEvalCaseHandlers(item, serviceExists, mockupExists),
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
