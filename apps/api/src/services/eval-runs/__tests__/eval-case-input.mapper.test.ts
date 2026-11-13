import { BadRequestException } from '@nestjs/common';
import {
  readEvalCaseTarget,
  toEvalRunCaseInput,
} from '../eval-case-input.mapper';

const FOCAL = '11111111-1111-4111-8111-111111111111';
const SUPPORT = '22222222-2222-4222-8222-222222222222';

const section = (key: string, materializedMarkdown: string | null) => ({
  key,
  materializedMarkdown,
});

const inputsSection = (...texts: string[]) =>
  section(
    'inputs',
    JSON.stringify({
      inputs: texts.map((text) => ({ kind: 'text_message', text })),
    }),
  );

const completeCase = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Mobile view needs a mockup',
  sections: [
    section('situation', 'A feature with no mobile layout.'),
    inputsSection('Add a mobile view to the settings page.'),
    section(
      'items',
      `- @[task:${FOCAL}|Settings] is the focal item\n- @[task:${SUPPORT}|Mockup] supports it\n- @[task:${FOCAL}|Settings] again`,
    ),
    section('handler', 'entity_conversation'),
    section('expectations', 'Recognizes a mockup is needed.'),
    section(
      'checks',
      '1. A mockup proposal exists\n2. No unrelated edits\n   to other features',
    ),
    section(
      'rubric',
      '- **Grounding**: cites the real feature\n- Usefulness - changes are actionable',
    ),
  ],
};

const withHandlers = (handler: string, consumer: string) => ({
  ...completeCase,
  sections: [
    ...completeCase.sections.filter((candidate) => candidate.key !== 'handler'),
    section('handler', handler),
    section('consumerHandler', consumer),
  ],
});

describe('toEvalRunCaseInput', () => {
  it('splits the case into what the target sees and what only grading sees', () => {
    const input = toEvalRunCaseInput(completeCase);

    expect(input.evalCaseId).toBe(completeCase.id);
    expect(input.target).toEqual({
      situation: 'A feature with no mobile layout.',
      focalItemId: FOCAL,
      focalItemType: 'TASK',
      supportingItemIds: [SUPPORT],
      inputs: {
        inputs: [
          {
            kind: 'text_message',
            text: 'Add a mobile view to the settings page.',
          },
        ],
      },
      targetHandler: 'entity_conversation',
    });
    expect(input.grading).toEqual({
      expectations: 'Recognizes a mockup is needed.',
      checks: [
        { id: 'check-1', description: 'A mockup proposal exists' },
        {
          id: 'check-2',
          description: 'No unrelated edits to other features',
        },
      ],
      rubric: [
        {
          key: 'grounding',
          name: 'Grounding',
          description: 'cites the real feature',
        },
        {
          key: 'usefulness',
          name: 'Usefulness',
          description: 'changes are actionable',
        },
      ],
    });
    expect(JSON.stringify(input.target)).not.toContain('mockup proposal');
  });

  it.each([
    ['feature', 'TASK'],
    ['goal', 'TASK'],
    ['project', 'PROJECT'],
    ['design-doc', 'DESIGN_DOC'],
  ])('records the canonical focal family for %s', (mentionType, entityType) => {
    const input = toEvalRunCaseInput({
      ...completeCase,
      sections: completeCase.sections.map((entry) =>
        entry.key === 'items'
          ? section('items', `- @[${mentionType}:${FOCAL}|Focal]`)
          : entry,
      ),
    });
    expect(input.target).toMatchObject({
      focalItemId: FOCAL,
      focalItemType: entityType,
    });
  });

  it('records a focal item of any work-item type as a task', () => {
    const input = toEvalRunCaseInput(
      {
        ...completeCase,
        sections: completeCase.sections.map((entry) =>
          entry.key === 'items'
            ? section('items', `- @[mockup:${FOCAL}|Fixture] — focal item`)
            : entry,
        ),
      },
      new Set([FOCAL]),
    );
    expect(input.target).toMatchObject({
      focalItemId: FOCAL,
      focalItemType: 'TASK',
    });
  });

  it('keeps a case without a focal item unscoped', () => {
    const input = toEvalRunCaseInput({
      ...completeCase,
      sections: completeCase.sections.filter((entry) => entry.key !== 'items'),
    });
    expect(input.target.focalItemId).toBeNull();
    expect(input.target.focalItemType).toBeUndefined();
  });

  it('rejects an unsupported focal family instead of launching it as a task', () => {
    expect(() =>
      toEvalRunCaseInput({
        ...completeCase,
        sections: completeCase.sections.map((entry) =>
          entry.key === 'items'
            ? section('items', `@[unknown:${FOCAL}|Unknown]`)
            : entry,
        ),
      }),
    ).toThrow(BadRequestException);
  });

  it('preserves the exact user request, including whitespace and inline attachments', () => {
    const request = `  Tell me about @[task:${SUPPORT}|Attached item].\n\n`;
    const input = toEvalRunCaseInput({
      ...completeCase,
      sections: completeCase.sections.map((entry) =>
        entry.key === 'inputs' ? inputsSection(request) : entry,
      ),
    });
    expect(input.target.inputs.inputs).toEqual([
      { kind: 'text_message', text: request },
    ]);
  });

  it.each([
    ['an empty list', '{"inputs":[]}'],
    ['an unknown kind', '{"inputs":[{"kind":"image","text":"x"}]}'],
    ['blank text', '{"inputs":[{"kind":"text_message","text":"  "}]}'],
    ['extra keys', '{"inputs":[{"kind":"text_message","text":"x"}],"extra":1}'],
    ['malformed JSON', '{"inputs":'],
  ])('rejects %s at launch', (_name, content) => {
    expect(() =>
      toEvalRunCaseInput({
        ...completeCase,
        sections: completeCase.sections.map((entry) =>
          entry.key === 'inputs' ? section('inputs', content) : entry,
        ),
      }),
    ).toThrow(BadRequestException);
  });

  it('records every message of a multi-message case and never leaks grading', () => {
    const input = toEvalRunCaseInput({
      ...completeCase,
      sections: completeCase.sections.map((entry) =>
        entry.key === 'inputs' ? inputsSection('First', 'Second') : entry,
      ),
    });
    expect(input.target.inputs.inputs).toHaveLength(2);
    expect(Object.keys(input.target).sort()).toEqual(
      [
        'focalItemId',
        'focalItemType',
        'inputs',
        'situation',
        'supportingItemIds',
        'targetHandler',
      ].sort(),
    );
  });

  it('reads a run recorded with only an initiating request as a one-message list', () => {
    const { inputs: _inputs, ...current } =
      toEvalRunCaseInput(completeCase).target;
    expect(
      readEvalCaseTarget({ ...current, initiatingRequest: 'Old request' })
        .inputs,
    ).toEqual({ inputs: [{ kind: 'text_message', text: 'Old request' }] });
  });

  it('gives every recorded case input its own id', () => {
    expect(toEvalRunCaseInput(completeCase).id).not.toBe(
      toEvalRunCaseInput(completeCase).id,
    );
  });

  it('records the consumer handler of a Project Assistant case', () => {
    const input = toEvalRunCaseInput(
      withHandlers('project_assistant', 'entity_conversation'),
    );

    expect(input.target).toMatchObject({
      targetHandler: 'project_assistant',
      consumerHandler: 'entity_conversation',
    });
  });

  it.each([
    ['an unknown handler', 'run_eval', ''],
    ['a Project Assistant case with no consumer', 'project_assistant', ''],
    [
      'a Project Assistant case with an unknown consumer',
      'project_assistant',
      'run_eval',
    ],
    [
      'a consumer on a case that is not Project Assistant',
      'entity_conversation',
      'entity_conversation',
    ],
  ])('rejects %s', (_name, handler, consumer) => {
    expect(() => toEvalRunCaseInput(withHandlers(handler, consumer))).toThrow(
      BadRequestException,
    );
  });

  it('records the Coding section of a free-form case as a copy for the run', () => {
    const content = {
      serviceId: '44444444-4444-4444-8444-444444444444',
      pinnedCommit: { sha: 'b'.repeat(40), shortMessage: 'Add settings page' },
      knownGoodDiff: 'good',
      knownBadDiff: 'bad',
    };
    const recorded = toEvalRunCaseInput({
      ...withHandlers('free_form', ''),
      sections: [
        ...withHandlers('free_form', '').sections,
        section('coding', JSON.stringify(content)),
      ],
    });

    expect(recorded.coding).toEqual(content);
    expect(recorded.target).not.toHaveProperty('coding');
  });

  it('rejects a case that cannot be run', () => {
    expect(() =>
      toEvalRunCaseInput({
        ...completeCase,
        sections: completeCase.sections.filter(
          (candidate) => candidate.key !== 'inputs',
        ),
      }),
    ).toThrow(BadRequestException);
  });
});
