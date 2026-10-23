import {
  DIAGRAM_GROUPS_SCHEMA_REF,
  DIAGRAM_GROUPS_SCHEMA_VERSION,
  type DiagramGroupsValue,
  materializeDiagramGroupMembers,
  parseDiagramGroupsContent,
  reconcileDiagramGroups,
  validateDiagramGroups,
} from '../diagram-groups';
import { TaskSectionSchemaValidatorRegistry } from '../task-section-schema-validator.registry';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const persisted = (workItemId: string) => ({
  kind: 'persistedWorkItem' as const,
  workItemId,
});

function awsGcp(): DiagramGroupsValue {
  return {
    schemaVersion: DIAGRAM_GROUPS_SCHEMA_VERSION,
    groups: [
      { id: 'aws', label: 'AWS', meaning: 'DEPLOYMENT_BOUNDARY', members: [] },
      {
        id: 'aws-us-east-1',
        label: 'us-east-1',
        meaning: 'DEPLOYMENT_BOUNDARY',
        parentGroupId: 'aws',
        members: [persisted(A)],
      },
      { id: 'gcp', label: 'GCP', meaning: 'DEPLOYMENT_BOUNDARY', members: [] },
      {
        id: 'gcp-europe-west1',
        label: 'europe-west1',
        meaning: 'DEPLOYMENT_BOUNDARY',
        parentGroupId: 'gcp',
        members: [persisted(B)],
      },
      {
        id: 'checkout',
        label: 'Checkout path',
        meaning: 'VISUAL_ASSOCIATION',
        members: [persisted(A), persisted(B)],
      },
    ],
  };
}

describe('Diagram groups', () => {
  it.each(['blue', 'green', 'orange', 'purple', 'red', 'teal'] as const)(
    'preserves %s through parsing, reconciliation and materialization',
    (color) => {
      const value = awsGcp();
      value.groups[1]!.color = color;
      value.groups[1]!.members = [
        { kind: 'temporaryWorkItem', temporaryRef: 'api' },
      ];
      const parsed = parseDiagramGroupsContent(JSON.stringify(value));
      expect(parsed.success).toBe(true);
      if (!parsed.success) throw new Error(parsed.message);
      expect(parsed.value.groups[1]!.color).toBe(color);
      const reconciled = reconcileDiagramGroups(parsed.value);
      expect(reconciled.groups[1]!.color).toBe(color);
      expect(
        materializeDiagramGroupMembers(reconciled, () => A).groups[1],
      ).toMatchObject({
        color,
        parentGroupId: 'aws',
        members: [persisted(A)],
      });
    },
  );

  it.each(['cyan', '#123456', '', null])(
    'rejects invalid group color %s at the section boundary',
    (color) => {
      const value = awsGcp();
      const content = { ...value, groups: [{ ...value.groups[0], color }] };
      const registry = new TaskSectionSchemaValidatorRegistry();
      expect(
        registry.validate(
          {
            key: 'diagramGroups',
            label: 'Groups',
            kind: 'json',
            schemaRef: DIAGRAM_GROUPS_SCHEMA_REF,
          },
          content,
        ).success,
      ).toBe(false);
      expect(parseDiagramGroupsContent(content).success).toBe(false);
    },
  );
  it('accepts nested deployment boundaries with overlapping visual association', () => {
    expect(
      validateDiagramGroups(
        awsGcp(),
        new Set([`existing:${A}`, `existing:${B}`]),
      ),
    ).toEqual([]);
  });

  it('parses JSON strings and canonicalizes key order', () => {
    const parsed = parseDiagramGroupsContent(
      JSON.stringify({
        groups: [
          { members: [], meaning: 'VISUAL_ASSOCIATION', label: 'L', id: 'g' },
        ],
        schemaVersion: DIAGRAM_GROUPS_SCHEMA_VERSION,
      }),
    );
    expect(parsed.success && JSON.stringify(parsed.value)).toBe(
      '{"schemaVersion":"diagram-groups.v1","groups":[{"id":"g","label":"L","meaning":"VISUAL_ASSOCIATION","members":[]}]}',
    );
  });

  it('rejects unknown meanings, coordinates and label-only groups', () => {
    for (const group of [
      { id: 'g', label: 'L', meaning: 'CONTAINER', members: [] },
      { id: 'g', label: 'L', meaning: 'VISUAL_ASSOCIATION', members: [], x: 1 },
      { label: 'L', meaning: 'VISUAL_ASSOCIATION', members: [] },
    ]) {
      expect(
        parseDiagramGroupsContent({
          schemaVersion: DIAGRAM_GROUPS_SCHEMA_VERSION,
          groups: [group],
        }).success,
      ).toBe(false);
    }
  });

  it.each([
    [
      'dangling member',
      (value: DiagramGroupsValue) => {
        value.groups[1]!.members.push(persisted(C));
      },
      'dangling_group_member',
    ],
    [
      'unknown parent',
      (value: DiagramGroupsValue) => {
        value.groups[1]!.parentGroupId = 'azure';
      },
      'unknown_parent_group',
    ],
    [
      'cycle',
      (value: DiagramGroupsValue) => {
        value.groups[0]!.parentGroupId = 'aws-us-east-1';
      },
      'group_cycle',
    ],
    [
      'factual boundary inside visual association',
      (value: DiagramGroupsValue) => {
        value.groups[0]!.parentGroupId = 'checkout';
      },
      'factual_boundary_inside_visual_group',
    ],
    [
      'element directly inside two factual boundaries',
      (value: DiagramGroupsValue) => {
        value.groups[3]!.members.push(persisted(A));
      },
      'multiple_factual_boundaries',
    ],
    [
      'duplicate group id',
      (value: DiagramGroupsValue) => {
        value.groups[2]!.id = 'aws';
      },
      'duplicate_group_id',
    ],
  ])('rejects %s', (_name, mutate, code) => {
    const value = awsGcp();
    mutate(value);
    expect(
      validateDiagramGroups(
        value,
        new Set([`existing:${A}`, `existing:${B}`]),
      ).map((issue) => issue.code),
    ).toContain(code);
  });

  it('prunes removed members and re-parents children of removed groups to the surviving ancestor', () => {
    const previous = awsGcp();
    previous.groups.push({
      id: 'aws-az-a',
      label: 'az-a',
      meaning: 'DEPLOYMENT_BOUNDARY',
      parentGroupId: 'aws-us-east-1',
      members: [],
    });
    const next = {
      ...previous,
      groups: previous.groups.filter((group) => group.id !== 'aws-us-east-1'),
    };
    const reconciled = reconcileDiagramGroups(next, {
      previous,
      removedMemberKeys: new Set([`existing:${B}`]),
    });
    expect(
      reconciled.groups.find((g) => g.id === 'aws-az-a')?.parentGroupId,
    ).toBe('aws');
    expect(reconciled.groups.find((g) => g.id === 'checkout')?.members).toEqual(
      [persisted(A)],
    );
    expect(validateDiagramGroups(reconciled)).toEqual([]);
  });

  it('moves orphans to the top level without prior state', () => {
    const value = awsGcp();
    value.groups = value.groups.filter((group) => group.id !== 'aws');
    expect(
      reconcileDiagramGroups(value).groups.find((g) => g.id === 'aws-us-east-1')
        ?.parentGroupId,
    ).toBeUndefined();
  });

  it('materializes temporary members to persisted IDs', () => {
    const value: DiagramGroupsValue = {
      schemaVersion: DIAGRAM_GROUPS_SCHEMA_VERSION,
      groups: [
        {
          id: 'region',
          label: 'Region',
          meaning: 'DEPLOYMENT_BOUNDARY',
          members: [{ kind: 'temporaryWorkItem', temporaryRef: 'api' }],
        },
      ],
    };
    expect(
      materializeDiagramGroupMembers(value, (ref) => (ref === 'api' ? A : C))
        .groups[0]!.members,
    ).toEqual([persisted(A)]);
  });

  it('is registered with the shared section validator', () => {
    const registry = new TaskSectionSchemaValidatorRegistry();
    const definition = {
      key: 'diagramGroups',
      label: 'Diagram Groups',
      kind: 'json' as const,
      schemaRef: DIAGRAM_GROUPS_SCHEMA_REF,
    };
    expect(registry.validate(definition, awsGcp()).success).toBe(true);
    const cyclic = awsGcp();
    cyclic.groups[0]!.parentGroupId = 'aws-us-east-1';
    expect(registry.validate(definition, cyclic).success).toBe(false);
  });
});
