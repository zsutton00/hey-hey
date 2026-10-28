import { BadRequestException } from '@nestjs/common';
import { toEvalRunCaseInput } from '../eval-case-input.mapper';

const FOCAL = '11111111-1111-4111-8111-111111111111';
const SUPPORT = '22222222-2222-4222-8222-222222222222';

const section = (key: string, materializedMarkdown: string | null) => ({
  key,
  materializedMarkdown,
});

const completeCase = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Mobile view needs a mockup',
  sections: [
    section('situation', 'A feature with no mobile layout.'),
    section('request', 'Add a mobile view to the settings page.'),
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
      initiatingRequest: 'Add a mobile view to the settings page.',
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
        entry.key === 'request' ? section('request', request) : entry,
      ),
    });
    expect(input.target.initiatingRequest).toBe(request);
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

  it('rejects a case that cannot be run', () => {
    expect(() =>
      toEvalRunCaseInput({
        ...completeCase,
        sections: completeCase.sections.filter(
          (candidate) => candidate.key !== 'request',
        ),
      }),
    ).toThrow(BadRequestException);
  });
});
