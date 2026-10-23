import { describe, expect, it } from 'vitest';
import {
  EntityType,
  EntityPromptTemplateSyntaxVersion,
  TaskSource,
  WorkStatus,
  type FullEntityContextDto,
  type TaskResponseDto,
} from '../shared/api/generated/api';
import { ENTITY_PROMPT_TEMPLATE_LANGUAGES } from '../shared/api/generated/entity-prompt-template-language';
import {
  EntityPromptTemplateRenderError,
  renderEntityPromptTemplate,
  type EntityPromptTemplateRenderInput,
} from './entity-prompt-template-renderer';

const entity = (): TaskResponseDto => ({
  id: 'task-1',
  name: 'Task $& \\path',
  type: 'STANDARD',
  organizationId: 'organization-1',
  projectId: 'project-1',
  status: WorkStatus.Active,
  source: TaskSource.User,
  sections: [
    {
      id: 'section-acceptance',
      key: 'acceptanceCriteria',
      order: -1,
      materializedMarkdown: 'Acceptance $& \\{{literal}}',
      materializedProposalId: '11111111-1111-4111-8111-111111111111',
      crdtSnapshotSeq: 7,
    },
    {
      id: 'section-description',
      key: 'description',
      order: 0,
      materializedMarkdown: 'Authoritative description {{literal}}',
      materializedProposalId: '11111111-1111-4111-8111-111111111111',
    },
  ],
});

const context = (): FullEntityContextDto => ({
  entityId: 'task-1',
  entityType: EntityType.Task,
  taskType: 'STANDARD',
  displayName: 'Task $& \\path',
  createdAt: '2026-08-20T00:00:00.000Z',
  content: {
    sections: {
      description: 'Authoritative description {{literal}}',
      requirements: 'Requirements',
    },
    status: 'ACTIVE',
    priority: 'HIGH',
    dueDate: '2026-08-21',
  },
  relatedEntities: [
    {
      entityId: 'related-z',
      entityType: 'TASK',
      displayName: 'Related $& \\{{literal}}',
      relationship: 'related-to',
    },
    {
      entityId: 'related-a',
      entityType: 'PLAN',
      displayName: 'Related A',
      relationship: 'depends-on',
      via: [
        {
          entityId: 'pivot-z',
          entityType: 'TASK',
          displayName: 'Pivot Z',
          relationship: 'parent',
        },
      ],
    },
  ],
  featureHierarchy: [
    {
      id: 'feature-z',
      name: 'Feature Z',
      relationshipType: 'structural',
      distance: 2,
    },
    {
      id: 'feature-a',
      name: 'Feature A',
      relationshipType: 'structural',
      distance: 1,
    },
  ],
  proposals: [
    {
      id: 'proposal-early',
      organizationId: 'organization-1',
      projectId: 'project-1',
      type: 'SINGLE',
      action: 'UPDATE',
      status: 'DRAFT',
      targetEntityId: 'task-1',
      targetEntityType: 'TASK',
      updates: {},
      requestorId: 'user-1',
      requiredApprovals: 1,
      approvals: [],
      outOfDateStatus: 'NOT_APPLICABLE',
      reviewedFuture: null,
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    },
    {
      id: 'proposal-late',
      organizationId: 'organization-1',
      projectId: 'project-1',
      type: 'SINGLE',
      action: 'UPDATE',
      status: 'DRAFT',
      targetEntityId: 'task-1',
      targetEntityType: 'TASK',
      updates: { zeta: 'last', alpha: 'first' },
      eli5: 'Explains the proposed change.',
      requestorId: 'user-1',
      requiredApprovals: 1,
      approvals: [],
      outOfDateStatus: 'NOT_APPLICABLE',
      reviewedFuture: null,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    },
  ],
  agentSessions: [
    {
      entityId: 'session-z',
      entityType: 'AGENT_SESSION',
      displayName: 'Session Z',
    },
    {
      entityId: 'session-a',
      entityType: 'AGENT_SESSION',
      displayName: 'Session A',
      status: 'ACTIVE',
    },
  ],
});

const input = (): EntityPromptTemplateRenderInput => ({
  entity: entity(),
  context: context(),
});

describe('renderEntityPromptTemplate', () => {
  it('renders supported paths deterministically and preserves substituted data', () => {
    const template =
      'Name={{entity.name}}; Description={{context.content.sections.description}}; ' +
      'Escaped=\\{{entity.name}}';

    const first = renderEntityPromptTemplate(
      template,
      EntityPromptTemplateSyntaxVersion.V1,
      input(),
    );
    const second = renderEntityPromptTemplate(
      template,
      EntityPromptTemplateSyntaxVersion.V1,
      input(),
    );

    expect(first).toBe(second);
    expect(first).toBe(
      'Name=Task $& \\path; Description=Authoritative description {{literal}}; ' +
        'Escaped={{entity.name}}',
    );
  });

  it('renders each structured identifier as stable JSON with deterministic ordering', () => {
    const structuredPaths = [
      'entity.sections',
      'context.relatedEntities',
      'context.featureHierarchy',
      'context.proposals',
      'context.agentSessions',
    ] as const;

    for (const path of structuredPaths) {
      expect(ENTITY_PROMPT_TEMPLATE_LANGUAGES.V1.supportedPaths).toContain(path);
      const first = renderEntityPromptTemplate(
        `{{${path}}}`,
        EntityPromptTemplateSyntaxVersion.V1,
        input(),
      );
      const second = renderEntityPromptTemplate(
        `{{${path}}}`,
        EntityPromptTemplateSyntaxVersion.V1,
        input(),
      );

      expect(first).toBe(second);
      expect(Array.isArray(JSON.parse(first))).toBe(true);
    }

    expect(JSON.parse(renderEntityPromptTemplate('{{entity.sections}}', 'V1', input()))).toEqual([
      {
        id: 'section-acceptance',
        key: 'acceptanceCriteria',
        order: -1,
        materializedMarkdown: 'Acceptance $& \\{{literal}}',
        crdtSnapshotSeq: 7,
      },
      {
        id: 'section-description',
        key: 'description',
        order: 0,
        materializedMarkdown: 'Authoritative description {{literal}}',
      },
    ]);
    expect(
      JSON.parse(renderEntityPromptTemplate('{{context.relatedEntities}}', 'V1', input())),
    ).toEqual([
      {
        entityId: 'related-z',
        entityType: 'TASK',
        displayName: 'Related $& \\{{literal}}',
        relationship: 'related-to',
      },
      {
        entityId: 'related-a',
        entityType: 'PLAN',
        displayName: 'Related A',
        relationship: 'depends-on',
        via: [
          {
            entityId: 'pivot-z',
            entityType: 'TASK',
            displayName: 'Pivot Z',
            relationship: 'parent',
          },
        ],
      },
    ]);
    expect(
      JSON.parse(renderEntityPromptTemplate('{{context.featureHierarchy}}', 'V1', input())),
    ).toEqual([
      { id: 'feature-a', name: 'Feature A', relationshipType: 'structural', distance: 1 },
      { id: 'feature-z', name: 'Feature Z', relationshipType: 'structural', distance: 2 },
    ]);
    expect(JSON.parse(renderEntityPromptTemplate('{{context.proposals}}', 'V1', input()))).toEqual([
      {
        id: 'proposal-late',
        organizationId: 'organization-1',
        projectId: 'project-1',
        type: 'SINGLE',
        action: 'UPDATE',
        status: 'DRAFT',
        targetEntityId: 'task-1',
        targetEntityType: 'TASK',
        updates: { alpha: 'first', zeta: 'last' },
        eli5: 'Explains the proposed change.',
        requestorId: 'user-1',
        requiredApprovals: 1,
        approvals: [],
        createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T00:00:00.000Z',
      },
      {
        id: 'proposal-early',
        organizationId: 'organization-1',
        projectId: 'project-1',
        type: 'SINGLE',
        action: 'UPDATE',
        status: 'DRAFT',
        targetEntityId: 'task-1',
        targetEntityType: 'TASK',
        updates: {},
        requestorId: 'user-1',
        requiredApprovals: 1,
        approvals: [],
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T00:00:00.000Z',
      },
    ]);
    expect(
      JSON.parse(renderEntityPromptTemplate('{{context.agentSessions}}', 'V1', input())),
    ).toEqual([
      {
        entityId: 'session-z',
        entityType: 'AGENT_SESSION',
        displayName: 'Session Z',
      },
      {
        entityId: 'session-a',
        entityType: 'AGENT_SESSION',
        displayName: 'Session A',
        status: 'ACTIVE',
      },
    ]);
  });

  it('takes the authoritative newest five sessions without reordering them', () => {
    const renderInput = input();
    renderInput.context.agentSessions = Array.from({ length: 7 }, (_, index) => ({
      entityId: `session-${7 - index}`,
      entityType: 'AGENT_SESSION',
      displayName: `Session ${7 - index}`,
    }));

    const rendered = JSON.parse(
      renderEntityPromptTemplate('{{context.agentSessions}}', 'V1', renderInput),
    );
    expect(rendered.map((entry: { entityId: string }) => entry.entityId)).toEqual([
      'session-7',
      'session-6',
      'session-5',
      'session-4',
      'session-3',
    ]);
  });

  it('prioritizes semantic, parent, then pivot-derived entities and bounds via provenance', () => {
    const renderInput = input();
    renderInput.context.relatedEntities = [
      {
        entityId: 'pivot',
        entityType: 'TASK',
        displayName: 'Pivot',
        relationship: 'sibling-via-parent',
        via: Array.from({ length: 7 }, (_, index) => ({
          entityId: `via-${index}`,
          entityType: 'TASK',
          displayName: `Via ${index}`,
          relationship: 'parent' as const,
        })),
      },
      { entityId: 'parent', entityType: 'TASK', displayName: 'Parent', relationship: 'parent' },
      {
        entityId: 'semantic',
        entityType: 'TASK',
        displayName: 'Semantic',
        relationship: 'depends-on',
        source: 'agent',
        reasoning: 'Required first',
        status: 'ACTIVE',
        taskType: 'STANDARD',
      },
    ];

    const rendered = JSON.parse(
      renderEntityPromptTemplate('{{context.relatedEntities}}', 'V1', renderInput),
    );
    expect(rendered.map((entry: { entityId: string }) => entry.entityId)).toEqual([
      'semantic',
      'parent',
      'pivot',
    ]);
    expect(rendered[0]).toMatchObject({
      source: 'agent',
      reasoning: 'Required first',
      status: 'ACTIVE',
      taskType: 'STANDARD',
    });
    expect(rendered[2].via).toHaveLength(5);
  });

  it('keeps non-proposal collections within 32 KiB as valid UTF-8 JSON arrays of whole entries', () => {
    const renderInput = input();
    renderInput.context.relatedEntities = Array.from({ length: 20 }, (_, index) => ({
      entityId: `related-${String(index).padStart(2, '0')}`,
      entityType: 'TASK',
      displayName: `Entity ${index} ${'🙂'.repeat(700)}`,
      relationship: 'related-to' as const,
    }));

    const rendered = renderEntityPromptTemplate('{{context.relatedEntities}}', 'V1', renderInput);
    const parsed = JSON.parse(rendered);
    expect(Buffer.byteLength(rendered, 'utf8')).toBeLessThanOrEqual(32 * 1024);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.length).toBeLessThan(20);
    expect(rendered).not.toContain('\uFFFD');
  });

  it('drops an individually oversized multibyte entry without splitting it', () => {
    const renderInput = input();
    renderInput.context.relatedEntities = [
      {
        entityId: 'oversized',
        entityType: 'TASK',
        displayName: '🙂'.repeat(9_000),
        relationship: 'related-to',
      },
    ];

    expect(renderEntityPromptTemplate('{{context.relatedEntities}}', 'V1', renderInput)).toBe('[]');
  });

  it('shares the 128 KiB allowance across repeated structured substitutions in template order', () => {
    const renderInput = input();
    renderInput.context.relatedEntities = Array.from({ length: 30 }, (_, index) => ({
      entityId: `related-${String(index).padStart(2, '0')}`,
      entityType: 'TASK',
      displayName: `Entity ${index} ${'x'.repeat(1400)}`,
      relationship: 'related-to' as const,
    }));
    const separator = '\n---collection---\n';
    const rendered = renderEntityPromptTemplate(
      Array(5).fill('{{context.relatedEntities}}').join(separator),
      'V1',
      renderInput,
    );
    const collections = rendered.split(separator);
    expect(collections).toHaveLength(5);
    expect(collections.every((value) => Array.isArray(JSON.parse(value)))).toBe(true);
    expect(
      collections.reduce((total, value) => total + Buffer.byteLength(value, 'utf8'), 0),
    ).toBeLessThanOrEqual(128 * 1024);
    expect(JSON.parse(collections[4] ?? 'null').length).toBeLessThan(
      JSON.parse(collections[0] ?? 'null').length,
    );
  });

  it('fails closed when complete empty arrays cannot fit in the aggregate allowance', () => {
    const template = Array(65_537).fill('{{context.relatedEntities}}').join('');
    const renderInput = input();
    renderInput.context.relatedEntities = [];

    expect(() => renderEntityPromptTemplate(template, 'V1', renderInput)).toThrow(
      'structured substitutions exceed the aggregate byte limit',
    );
  });

  it('preserves summary proposal changes without inventing full proposal updates', () => {
    const renderInput = input();
    const original = renderInput.context.proposals![0]!;
    if (!('updates' in original)) throw new Error('Expected a full proposal fixture.');
    const { updates: _updates, ...summary } = original;
    renderInput.context.proposals = [
      {
        ...summary,
        eli5: 'Summarizes a historical change.',
        changes: [
          {
            path: 'sections.description.content',
            type: 'markdown',
            diff: '@@ -1,1 +1,1 @@\n-Earlier description\n+Current description',
            diffTruncated: false,
            diffOmittedCharacters: 0,
          },
        ],
      },
    ];
    const [rendered] = JSON.parse(
      renderEntityPromptTemplate('{{context.proposals}}', 'V1', renderInput),
    );
    expect(rendered).not.toHaveProperty('updates');
    expect(rendered.eli5).toBe('Summarizes a historical change.');
    const proposal = renderInput.context.proposals[0]!;
    if (!('changes' in proposal)) throw new Error('Expected a summary proposal fixture.');
    expect(rendered.changes).toEqual(proposal.changes);
  });

  it('renders present empty structured collections and fails closed for missing ones', () => {
    const emptyInput = input();
    emptyInput.context.relatedEntities = [];
    expect(
      renderEntityPromptTemplate(
        '{{context.relatedEntities}}',
        EntityPromptTemplateSyntaxVersion.V1,
        emptyInput,
      ),
    ).toBe('[]');

    const missingInput = input();
    const missingContext = { ...missingInput.context };
    delete missingContext.relatedEntities;
    missingInput.context = missingContext;
    expect(() =>
      renderEntityPromptTemplate(
        '{{context.relatedEntities}}',
        EntityPromptTemplateSyntaxVersion.V1,
        missingInput,
      ),
    ).toThrow(/missing/);
  });

  it('rejects unsupported paths, missing values, and malformed syntax', () => {
    expect(() =>
      renderEntityPromptTemplate(
        '{{entity.constructor}}',
        EntityPromptTemplateSyntaxVersion.V1,
        input(),
      ),
    ).toThrow(EntityPromptTemplateRenderError);
    expect(() =>
      renderEntityPromptTemplate(
        '{{startup.task.description}}',
        EntityPromptTemplateSyntaxVersion.V1,
        input(),
      ),
    ).toThrow(EntityPromptTemplateRenderError);
    expect(() =>
      renderEntityPromptTemplate(
        '{{context.relatedEntities.displayName}}',
        EntityPromptTemplateSyntaxVersion.V1,
        input(),
      ),
    ).toThrow(EntityPromptTemplateRenderError);
    expect(() =>
      renderEntityPromptTemplate(
        '{{context.content.sections.acceptanceCriteria}}',
        EntityPromptTemplateSyntaxVersion.V1,
        input(),
      ),
    ).toThrow(/missing/);
  });

  it('rejects every malformed substitution in the generated V1 conformance metadata', () => {
    for (const malformed of ENTITY_PROMPT_TEMPLATE_LANGUAGES.V1.malformedSubstitutions) {
      expect(() =>
        renderEntityPromptTemplate(malformed, EntityPromptTemplateSyntaxVersion.V1, input()),
      ).toThrow(EntityPromptTemplateRenderError);
    }
  });

  it('rejects unsupported syntax versions without interpreting their content', () => {
    expect(() =>
      renderEntityPromptTemplate(
        '{{entity.name}}',
        'V2' as EntityPromptTemplateSyntaxVersion,
        input(),
      ),
    ).toThrow(/syntax version "V2" is not supported/);
  });
});
