import { TaskSectionSchemaValidatorRegistry } from '../task-section-schema-validator.registry';
import {
  EVAL_CASE_INPUTS_SCHEMA_REF,
  validateEvalCaseInputsContent,
} from '../eval-case-inputs.validator';
import { collectWorkItemMentionContent } from '../../mentions/work-item-mention-content';
import { WORK_ITEM_TYPE_KEYS } from '../work-item-type-keys';

const ID = '11111111-1111-4111-8111-111111111111';

describe('Eval Case inputs section', () => {
  it.each([
    ['one message', { inputs: [{ kind: 'text_message', text: 'Hi' }] }],
    [
      'several messages as a JSON string',
      JSON.stringify({
        inputs: [
          { kind: 'text_message', text: 'First\n"quoted"' },
          { kind: 'text_message', text: `Second @[task:${ID}|Item]` },
        ],
      }),
    ],
  ])('accepts %s', (_name, content) => {
    expect(validateEvalCaseInputsContent(content).success).toBe(true);
  });

  it.each([
    ['an empty list', { inputs: [] }],
    ['an unknown kind', { inputs: [{ kind: 'image', text: 'x' }] }],
    ['blank text', { inputs: [{ kind: 'text_message', text: ' ' }] }],
    ['a missing list', {}],
    ['a bare array', [{ kind: 'text_message', text: 'x' }]],
    ['an extra key', { inputs: [{ kind: 'text_message', text: 'x' }], a: 1 }],
    ['non-JSON text', 'not json'],
  ])('rejects %s at authoring', (_name, content) => {
    const registry = new TaskSectionSchemaValidatorRegistry();
    expect(
      registry.validateSchema(EVAL_CASE_INPUTS_SCHEMA_REF, content).success,
    ).toBe(false);
  });

  it('scans only message text for mentions', () => {
    const content = collectWorkItemMentionContent(
      WORK_ITEM_TYPE_KEYS.EvalCase,
      [
        {
          key: 'inputs',
          kind: 'json',
          label: 'Inputs',
          schemaRef: EVAL_CASE_INPUTS_SCHEMA_REF,
        },
      ],
      [
        {
          key: 'inputs',
          materializedMarkdown: JSON.stringify({
            inputs: [{ kind: 'text_message', text: `See @[task:${ID}|Item]` }],
          }),
        },
      ],
    );
    expect(content).toBe(`See @[task:${ID}|Item]`);
  });
});
