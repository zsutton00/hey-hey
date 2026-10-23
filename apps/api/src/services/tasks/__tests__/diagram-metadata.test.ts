import type { Prisma } from '@prisma/client';
import {
  canonicalDiagramType,
  diagramMetadataSchema,
  diagramElementMetadataSchema,
  validateDiagramSections,
  withDiagramDefaults,
} from '../diagram-metadata';
import type { WorkItemTypeSectionDefinition } from '../../../generated/model/workItemTypeSectionDefinition';

const targetId = '11111111-1111-4111-8111-111111111111';
const definitions: WorkItemTypeSectionDefinition[] = [
  {
    key: 'diagramElementMetadata',
    label: 'Element metadata',
    kind: 'json',
    schemaRef: '#/components/schemas/DiagramElementMetadata',
    diagramElementPolicy: {
      roles: [
        { key: 'GENERIC', label: 'Generic', notation: 'box' },
        { key: 'PERSON', label: 'Person', notation: 'person' },
        { key: 'AGENT', label: 'Agent', notation: 'box' },
        { key: 'START', label: 'Start', notation: 'box' },
        { key: 'END', label: 'End', notation: 'box' },
        {
          key: 'DIAGRAM_REFERENCE',
          label: 'Diagram reference',
          notation: 'frame',
        },
        { key: 'QUEUE', label: 'Queue', notation: 'box' },
      ],
      referenceTargets: [
        { entityType: 'TASK', workItemTypeKeys: ['DIAGRAM', 'FEATURE'] },
        { entityType: 'SERVICE' },
      ],
    },
  },
];

describe('Diagram semantic boundaries', () => {
  const taskFind = jest.fn();
  const serviceFind = jest.fn();
  const db = {
    task: { findFirst: taskFind },
    service: { findFirst: serviceFind },
  } as unknown as Prisma.TransactionClient;
  const validate = (content: unknown) =>
    validateDiagramSections({
      db,
      organizationId: 'organization',
      projectId: 'project',
      type: 'DIAGRAM_ELEMENT',
      definitions,
      sections: [{ key: 'diagramElementMetadata', content }],
    });
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('persists explicit defaults in generic section transport without replacing authored values', () => {
    expect(withDiagramDefaults('DIAGRAM')).toEqual([
      {
        key: 'diagramMetadata',
        content: { kind: 'GENERAL', level: 'OVERVIEW' },
      },
    ]);
    const sections = withDiagramDefaults('DIAGRAM_ELEMENT');
    expect(sections).toEqual([
      { key: 'diagramElementMetadata', content: { role: 'GENERIC' } },
    ]);
    expect(withDiagramDefaults('DIAGRAM_ELEMENT', sections)).toBe(sections);
  });

  it.each(['GENERAL', 'PROCESS', 'DYNAMIC', 'DEPLOYMENT'])(
    'rejects C4 levels on %s',
    (kind) => {
      expect(
        diagramMetadataSchema.safeParse({ kind, level: 'COMPONENT' }).success,
      ).toBe(false);
      expect(
        diagramMetadataSchema.safeParse({ kind, level: 'OVERVIEW' }).success,
      ).toBe(true);
    },
  );

  it('round trips a canonical reference as JSON section content', async () => {
    taskFind.mockResolvedValue({ type: 'DIAGRAM' });
    const content = {
      role: 'DIAGRAM_REFERENCE',
      canonicalReference: { entityType: 'TASK', entityId: targetId },
    };
    expect(
      diagramElementMetadataSchema.parse(JSON.parse(JSON.stringify(content))),
    ).toEqual(content);
    await expect(validate(JSON.stringify(content))).resolves.toBeUndefined();
    expect(taskFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: targetId,
          organizationId: 'organization',
          projectId: 'project',
          archivedAt: null,
          status: { not: 'ARCHIVED' },
        },
      }),
    );
  });

  it.each(['START', 'END', 'AGENT', 'PERSON', 'GENERIC'])(
    'round trips %s through metadata validation and authored defaults',
    async (role) => {
      const content = { role };
      const sections = [{ key: 'diagramElementMetadata', content }];
      expect(withDiagramDefaults('DIAGRAM_ELEMENT', sections)).toBe(sections);
      expect(
        diagramElementMetadataSchema.parse(JSON.parse(JSON.stringify(content))),
      ).toEqual(content);
      await expect(validate(JSON.stringify(content))).resolves.toBeUndefined();
    },
  );

  it('validates both directions of the Diagram role/reference constraint', async () => {
    taskFind.mockResolvedValue({ type: 'DIAGRAM' });
    await expect(
      validate({
        role: 'GENERIC',
        canonicalReference: { entityType: 'TASK', entityId: targetId },
      }),
    ).rejects.toThrow('require each other');
    taskFind.mockResolvedValue({ type: 'FEATURE' });
    await expect(
      validate({
        role: 'DIAGRAM_REFERENCE',
        canonicalReference: { entityType: 'TASK', entityId: targetId },
      }),
    ).rejects.toThrow('require each other');
    await expect(
      validate({ role: 'DIAGRAM_REFERENCE', canonicalReference: null }),
    ).rejects.toThrow('requires a Diagram');
    await expect(
      validate({ role: 'GENERIC', canonicalReference: null }),
    ).resolves.toBeUndefined();
  });

  it('accepts governed role extensions and service identity without inferring a work-item type', async () => {
    serviceFind.mockResolvedValue({ id: targetId });
    await expect(
      validate({
        role: 'QUEUE',
        canonicalReference: { entityType: 'SERVICE', entityId: targetId },
      }),
    ).resolves.toBeUndefined();
    await expect(validate({ role: 'PRESENTATION_ONLY' })).rejects.toThrow(
      'not declared',
    );
  });

  it('rejects unavailable, archived and disallowed targets', async () => {
    taskFind.mockResolvedValue(null);
    await expect(
      validate({
        role: 'GENERIC',
        canonicalReference: { entityType: 'TASK', entityId: targetId },
      }),
    ).rejects.toThrow('unavailable');
    taskFind.mockResolvedValue({ type: 'BUG' });
    await expect(
      validate({
        role: 'GENERIC',
        canonicalReference: { entityType: 'TASK', entityId: targetId },
      }),
    ).rejects.toThrow('not allowed');
  });

  it('normalizes historical discriminators without treating DIAGRAM as an entity category', () => {
    expect(canonicalDiagramType('workflow')).toBe('DIAGRAM');
    expect(canonicalDiagramType('WORKFLOW_STEP')).toBe('DIAGRAM_ELEMENT');
    expect(
      diagramElementMetadataSchema.safeParse({
        role: 'DIAGRAM_REFERENCE',
        canonicalReference: { entityType: 'DIAGRAM', entityId: targetId },
      }).success,
    ).toBe(false);
  });
});
