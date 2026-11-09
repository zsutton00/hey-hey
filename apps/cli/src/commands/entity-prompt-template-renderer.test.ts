import {
  asOrganizationId,
  asProjectId,
  asProposalId,
  asTaskId,
  asUserId,
} from '../test-utils/contract-ids';
import { describe, expect, it } from 'vitest';
import {
  EntityType,
  EntityPromptTemplateSyntaxVersion,
  TaskSource,
  WorkStatus,
  type FullEntityContextDto,
  type TaskResponseDto,
} from '@hey-hey/contracts/api/models';
import { ENTITY_PROMPT_TEMPLATE_LANGUAGES } from '../shared/api/generated/entity-prompt-template-language';
import {
  EntityPromptTemplateRenderError,
  renderEntityPromptTemplate,
  type EntityPromptTemplateRenderInput,
} from './entity-prompt-template-renderer';

const entity = (): TaskResponseDto => ({
  id: asTaskId('task-1'),
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
      materializedProposalId: asProposalId('11111111-1111-4111-8111-111111111111'),
      crdtSnapshotSeq: 7,
    },
    {
      id: 'section-description',
      key: 'description',
      order: 0,
      materializedMarkdown: 'Authoritative description {{literal}}',
      materializedProposalId: asProposalId('11111111-1111-4111-8111-111111111111'),
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
  groupedRelatedEntities: [
    {
      entityId: 'related-z',
      entityType: 'TASK',
      displayName: 'Related $& \\{{literal}}',
      relationships: [{ relationship: 'related-to' }],
    },
    {
      entityId: 'related-a',
      entityType: 'PLAN',
      displayName: 'Related A',
      relationships: [
        { relationship: 'depends-on' },
        { relationship: 'mentions' },
        {
          relationship: 'parent',
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
      id: asProposalId('proposal-early'),
      organizationId: asOrganizationId('organization-1'),
      projectId: asProjectId('project-1'),
      type: 'SINGLE',
      action: 'UPDATE',
      status: 'DRAFT',
      targetEntityId: 'task-1',
      targetEntityType: 'TASK',
      updates: {},
      requestorId: asUserId('user-1'),
      requiredApprovals: 1,
      approvals: [],
      outOfDateStatus: 'NOT_APPLICABLE',
      reviewedFuture: null,
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    },
    {
      id: asProposalId('proposal-late'),
      organizationId: asOrganizationId('organization-1'),
      projectId: asProjectId('project-1'),
      type: 'SINGLE',
      action: 'UPDATE',
      status: 'DRAFT',
      targetEntityId: 'task-1',
      targetEntityType: 'TASK',
      updates: { zeta: 'last', alpha: 'first' },
      eli5: 'Explains the proposed change.',
      requestorId: asUserId('user-1'),
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
  reports: {},
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
      if (path !== 'entity.sections') {
        expect(Array.isArray(JSON.parse(first))).toBe(true);
      }
    }

    expect(renderEntityPromptTemplate('{{entity.sections}}', 'V1', input())).toBe(
      '### Acceptance Criteria\nAcceptance $& \\{{literal}}\n\n' +
        '### Description\nAuthoritative description {{literal}}',
    );
    expect(
      JSON.parse(renderEntityPromptTemplate('{{context.relatedEntities}}', 'V1', input())),
    ).toEqual([
      {
        entityId: 'related-a',
        entityType: 'PLAN',
        displayName: 'Related A',
        relationships: [
          { relationship: 'depends-on' },
          { relationship: 'mentions' },
          {
            relationship: 'parent',
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
      },
      {
        entityId: 'related-z',
        entityType: 'TASK',
        displayName: 'Related $& \\{{literal}}',
        relationships: [{ relationship: 'related-to' }],
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
    renderInput.context.groupedRelatedEntities = [
      {
        entityId: 'pivot',
        entityType: 'TASK',
        displayName: 'Pivot',
        relationships: [
          {
            relationship: 'sibling-via-parent',
            via: Array.from({ length: 7 }, (_, index) => ({
              entityId: `via-${index}`,
              entityType: 'TASK',
              displayName: `Via ${index}`,
              relationship: 'parent' as const,
            })),
          },
        ],
      },
      {
        entityId: 'parent',
        entityType: 'TASK',
        displayName: 'Parent',
        relationships: [{ relationship: 'parent' }],
      },
      {
        entityId: 'semantic',
        entityType: 'TASK',
        displayName: 'Semantic',
        status: 'ACTIVE',
        taskType: 'STANDARD',
        relationships: [
          { relationship: 'depends-on', source: 'agent', reasoning: 'Required first' },
          { relationship: 'mentions', source: 'system' },
        ],
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
      status: 'ACTIVE',
      taskType: 'STANDARD',
      relationships: [
        { relationship: 'depends-on', source: 'agent', reasoning: 'Required first' },
        { relationship: 'mentions', source: 'system' },
      ],
    });
    expect(rendered[2].relationships[0].via).toHaveLength(5);
  });

  it('keeps non-proposal collections within 32 KiB as valid UTF-8 JSON arrays of whole entries', () => {
    const renderInput = input();
    renderInput.context.groupedRelatedEntities = Array.from({ length: 20 }, (_, index) => ({
      entityId: `related-${String(index).padStart(2, '0')}`,
      entityType: 'TASK',
      displayName: `Entity ${index} ${'🙂'.repeat(700)}`,
      relationships: [{ relationship: 'related-to' as const }],
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
    renderInput.context.groupedRelatedEntities = [
      {
        entityId: 'oversized',
        entityType: 'TASK',
        displayName: '🙂'.repeat(9_000),
        relationships: [{ relationship: 'related-to' }],
      },
    ];

    expect(renderEntityPromptTemplate('{{context.relatedEntities}}', 'V1', renderInput)).toBe('[]');
  });

  it('shares the 128 KiB allowance across repeated structured substitutions in template order', () => {
    const renderInput = input();
    renderInput.context.groupedRelatedEntities = Array.from({ length: 30 }, (_, index) => ({
      entityId: `related-${String(index).padStart(2, '0')}`,
      entityType: 'TASK',
      displayName: `Entity ${index} ${'x'.repeat(1400)}`,
      relationships: [{ relationship: 'related-to' as const }],
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
    renderInput.context.groupedRelatedEntities = [];

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
    emptyInput.context.groupedRelatedEntities = [];
    expect(
      renderEntityPromptTemplate(
        '{{context.relatedEntities}}',
        EntityPromptTemplateSyntaxVersion.V1,
        emptyInput,
      ),
    ).toBe('[]');

    const missingInput = input();
    const missingContext = { ...missingInput.context };
    delete missingContext.groupedRelatedEntities;
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

  describe('conditional blocks', () => {
    const render = (template: string, renderInput = input()): string =>
      renderEntityPromptTemplate(template, EntityPromptTemplateSyntaxVersion.V1, renderInput);

    it('renders a block only when the value is present, and else exactly when it is not', () => {
      expect(render('[{{#if entity.name}}yes{{/if}}]')).toBe('[yes]');
      expect(render('[{{#if entity.name}}yes{{else}}no{{/if}}]')).toBe('[yes]');
      expect(render('[{{#if entity.outcome}}yes{{/if}}]')).toBe('[]');
      expect(render('[{{#if entity.outcome}}yes{{else}}no{{/if}}]')).toBe('[no]');
    });

    it('treats empty strings, lists and objects as absent without erroring', () => {
      const empty = input();
      empty.context = {
        ...empty.context,
        groupedRelatedEntities: [],
        proposals: [],
        content: { sections: { description: '' } },
      };
      const template = (path: string): string => `{{#if ${path}}}yes{{else}}no{{/if}}`;

      expect(render(template('context.relatedEntities'), empty)).toBe('no');
      expect(render(template('context.proposals'), empty)).toBe('no');
      expect(render(template('context.content.sections.description'), empty)).toBe('no');
      expect(render(template('context.content.sections.missing'), empty)).toBe('no');
      expect(render(template('context.agentSessions'), input())).toBe('yes');
    });

    it('renders nested blocks and keeps surrounding whitespace as written', () => {
      const template = 'A\n{{#if entity.name}}\nB{{#if entity.outcome}}X{{else}}Y{{/if}}\n{{/if}}C';

      expect(render(template)).toBe('A\n\nBY\nC');
    });

    it('drops padding inside an escaped substitution exactly as before', () => {
      expect(render('\\{{ entity.name }}')).toBe('{{entity.name}}');
    });

    describe('a realistic multi-paragraph template', () => {
      const template = [
        '# {{entity.name}} ({{entity.status}})',
        '',
        '{{#if entity.sections.description}}',
        '## Description',
        '{{entity.sections.description}}',
        '{{else}}',
        'No description has been written yet.',
        '{{/if}}',
        '',
        '{{#if entity.sections.acceptanceCriteria}}',
        '## Acceptance criteria',
        '{{entity.sections.acceptanceCriteria}}',
        '{{/if}}',
        '',
        '{{#if context.relatedEntities}}',
        '## Related work',
        '{{#if context.proposals}}',
        'Proposals have been recorded; review them before changing scope.',
        '{{else}}',
        'No proposals have been recorded.',
        '{{/if}}',
        '{{else}}',
        'This item is not connected to any other work.',
        '{{/if}}',
        '',
        'Escape hatch: \\{{ entity.name }} is printed literally.',
      ].join('\n');

      it('includes every optional section when the context is populated', () => {
        const populated = input();
        populated.entity = { ...entity(), name: 'Add conditional blocks' };

        expect(render(template, populated)).toBe(
          [
            '# Add conditional blocks (ACTIVE)',
            '',
            '',
            '## Description',
            'Authoritative description {{literal}}',
            '',
            '',
            '',
            '## Acceptance criteria',
            'Acceptance $& \\{{literal}}',
            '',
            '',
            '',
            '## Related work',
            '',
            'Proposals have been recorded; review them before changing scope.',
            '',
            '',
            '',
            'Escape hatch: {{entity.name}} is printed literally.',
          ].join('\n'),
        );
      });

      it('falls back or omits sections when the values are absent or empty', () => {
        const sparse = input();
        sparse.entity = { ...entity(), name: 'Add conditional blocks', sections: [] };
        sparse.context = { ...context(), groupedRelatedEntities: [], proposals: [] };

        expect(render(template, sparse)).toBe(
          [
            '# Add conditional blocks (ACTIVE)',
            '',
            '',
            'No description has been written yet.',
            '',
            '',
            '',
            '',
            '',
            'This item is not connected to any other work.',
            '',
            '',
            'Escape hatch: {{entity.name}} is printed literally.',
          ].join('\n'),
        );
      });
    });

    it('only evaluates the branch taken', () => {
      expect(render('{{#if entity.outcome}}{{entity.outcome}}{{else}}none{{/if}}')).toBe('none');
      expect(render('{{#if entity.name}}ok{{else}}{{entity.outcome}}{{/if}}')).toBe('ok');
    });

    it('still fails for plain substitution of a missing path and unsupported condition paths', () => {
      expect(() => render('{{entity.outcome}}')).toThrow(/missing/);
      expect(() => render('{{#if entity.nope}}x{{/if}}')).toThrow(/not supported/);
    });

    it.each([
      '{{#if entity.name}}x',
      '{{else}}',
      '{{/if}}',
      '{{#if entity.name}}{{else}}{{else}}{{/if}}',
    ])('rejects unbalanced block syntax %j', (template) => {
      expect(() => render(template)).toThrow(EntityPromptTemplateRenderError);
    });
  });
});

describe('saved report values', () => {
  const withReports = (): EntityPromptTemplateRenderInput => ({
    ...input(),
    reports: { CODING_RESEARCH: { latest: 'DATED RESEARCH BODY', summary: 'SHORT SUMMARY' } },
  });

  it('renders the dated body, the summary, and the branch for a saved report', () => {
    expect(
      renderEntityPromptTemplate(
        '{{#if reports.CODING_RESEARCH.latest}}{{reports.CODING_RESEARCH.latest}}|{{reports.CODING_RESEARCH.latest.summary}}{{else}}FULL{{/if}}',
        'V1',
        withReports(),
      ),
    ).toBe('DATED RESEARCH BODY|SHORT SUMMARY');
  });

  it('takes the else branch for a missing report but rejects it as a plain substitution', () => {
    expect(
      renderEntityPromptTemplate(
        '{{#if reports.CODING_RESEARCH.latest}}RESEARCH{{else}}FULL{{/if}}',
        'V1',
        input(),
      ),
    ).toBe('FULL');
    expect(() =>
      renderEntityPromptTemplate('{{reports.CODING_RESEARCH.latest}}', 'V1', input()),
    ).toThrow(/missing from the loaded input/);
  });

  it('rejects a malformed report path', () => {
    expect(() =>
      renderEntityPromptTemplate('{{reports.CODING_RESEARCH.latest.body}}', 'V1', withReports()),
    ).toThrow(/not supported/);
  });
});

describe('entity.sections as readable markdown', () => {
  const cite = (entityType: string, entityId: string, entityTitle: string) => ({
    entityType,
    entityId,
    entityTitle,
  });
  const featureWith = (sections: { key: string; order: number; markdown: string }[]) => ({
    ...entity(),
    type: 'FEATURE',
    sections: sections.map(({ key, order, markdown }) => ({
      id: `section-${key}`,
      key,
      order,
      materializedMarkdown: markdown,
      materializedProposalId: asProposalId('11111111-1111-4111-8111-111111111111'),
    })),
  });
  const render = (e: unknown) =>
    renderEntityPromptTemplate('{{entity.sections}}', 'V1', {
      ...input(),
      entity: e as TaskResponseDto,
    });
  const requirements = JSON.stringify({
    records: [
      {
        id: 'r1',
        statement: 'Ungrouped one.',
        designedBy: [cite('DESIGN_DOC', 'd1', 'Doc')],
        fulfilledBy: [cite('TASK', 't1', 'Task')],
        contracts: [cite('CONTRACT', 'c1', 'Contract')],
      },
      {
        id: 'r2',
        statement: 'Alpha one.',
        group: 'Alpha',
        designedBy: [],
        fulfilledBy: [],
        contracts: [],
      },
      { id: 'r3', statement: 'Ungrouped two.', designedBy: [], fulfilledBy: [], contracts: [] },
      {
        id: 'r4',
        statement: 'Alpha two.',
        group: 'Alpha',
        designedBy: [],
        fulfilledBy: [],
        contracts: [],
      },
    ],
  });

  it('writes requirements as grouped lines with citation mentions and no stored JSON', () => {
    const rendered = render(
      featureWith([
        { key: 'description', order: 0, markdown: 'About.' },
        { key: 'requirements', order: 1, markdown: requirements },
      ]),
    );

    expect(rendered).toBe(
      [
        '### Description\nAbout.',
        '### Requirements\nRequirement ids for edits: `get_full_entity`.',
        '- Ungrouped one. — designed by @[DESIGN_DOC:d1|Doc]; fulfilled by @[TASK:t1|Task]; contracted by @[CONTRACT:c1|Contract]\n- Ungrouped two.',
        '#### Alpha\n- Alpha one.\n- Alpha two.',
      ].join('\n\n'),
    );
    expect(rendered).not.toMatch(/[{"]/u);
  });

  it('falls back to raw text for a malformed requirements section only', () => {
    const rendered = render(
      featureWith([
        { key: 'description', order: 0, markdown: 'About.' },
        { key: 'requirements', order: 1, markdown: '{"records":[{"id":1}]}' },
      ]),
    );

    expect(rendered).toBe('### Description\nAbout.\n\n### Requirements\n{"records":[{"id":1}]}');
  });

  it('cuts an over-budget requirements section at whole lines', () => {
    const records = Array.from({ length: 600 }, (_, index) => ({
      id: `r${String(index)}`,
      statement: `Requirement number ${String(index)} ${'x'.repeat(80)}`,
      designedBy: [],
      fulfilledBy: [],
      contracts: [],
    }));
    const rendered = render(
      featureWith([{ key: 'requirements', order: 0, markdown: JSON.stringify({ records }) }]),
    );

    expect(Buffer.byteLength(rendered, 'utf8')).toBeLessThanOrEqual(32 * 1024);
    const lines = rendered.split('\n').filter((line) => line.startsWith('- '));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(600);
    for (const line of lines) {
      expect(line).toMatch(/^- Requirement number \d+ x{80}$/u);
    }
  });
});
