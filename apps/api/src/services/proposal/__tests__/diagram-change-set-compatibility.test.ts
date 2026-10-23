import { normalizeDiagramChangeSet } from '../diagram-change-set-compatibility';
import { workItemChangeSetValidationRequestSchema } from '../work-item-change-set.schema';

it('compiles historical creation into recoverable canonical operations without changing evidence or identities', () => {
  const evidence = workItemChangeSetValidationRequestSchema.parse({
    root: { refType: 'temporary', tempId: 'root' },
    operations: [
      {
        op: 'workItem.create',
        ref: { refType: 'temporary', tempId: 'root' },
        name: 'Historical graph',
        type: 'workflow',
      },
      {
        op: 'workItem.create',
        ref: { refType: 'temporary', tempId: 'element' },
        name: 'Step',
        type: 'workflow_step',
        parent: { refType: 'temporary', tempId: 'root' },
      },
    ],
  });
  const original = JSON.stringify(evidence);
  const durable = normalizeDiagramChangeSet(evidence);
  expect(JSON.stringify(evidence)).toBe(original);
  expect(durable.operations[0]).toMatchObject({
    type: 'DIAGRAM',
    ref: evidence.root,
  });
  expect(durable.operations[1]).toMatchObject({
    type: 'DIAGRAM_ELEMENT',
    parent: evidence.root,
  });
  expect(durable.operations).toContainEqual({
    op: 'section.replace',
    ref: evidence.root,
    key: 'diagramMetadata',
    content: { kind: 'GENERAL', level: 'OVERVIEW' },
  });
  const recovered = workItemChangeSetValidationRequestSchema.parse(
    JSON.parse(JSON.stringify(durable)),
  );
  expect(recovered).toEqual(durable);
  expect(normalizeDiagramChangeSet(recovered)).toEqual(durable);
});
