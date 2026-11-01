import { SessionRole } from '../../../generated/model/sessionRole';
import type { WorkItemType } from '@prisma/client';
import { InMemoryMessageBus } from '../../../core/events/in-memory-message-bus.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import { WorkItemTypeLifecycleStatus } from '../../../generated/model/workItemTypeLifecycleStatus';
import { WorkItemTypeRole } from '../../../generated/model/workItemTypeRole';
import { WorkItemTypeGuidancePurpose } from '../../../generated/model/workItemTypeGuidancePurpose';
import { WorkStatus } from '../../../generated/model/workStatus';
import { WorkItemTypeRegistryService } from '../work-item-type-registry.service';

/**
 * Coverage for the definition read surface (getDefinitions / getDefinition)
 * that backs the /work-item-types endpoints. These reads project the rich,
 * type-key-based columns (name, section definitions, parent type keys,
 * edge targets) plus the lean closed-enum scalar axes (required/forbidden) into
 * the public WorkItemTypeSummaryDto — distinct from the lean config snapshot the
 * per-type accessors read.
 */

const PROJECT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PROJECT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** Minimal lean axes shared by every fixture row (irrelevant to the summary). */
const LEAN_AXES = {
  initialStatusPolicy: {
    initialStatus: WorkStatus.Backlog,
    hasSetInitialStatus: false,
  },
  sections: [],
  requiredScalars: [],
  forbiddenScalars: [],
  parentage: { allowedParentEntityTypes: [] },
  tracking: {
    allowedSourceEntityTypes: [],
    allowedSourceTaskTypes: [],
  },
  allowedEdgeTargetEntityTypes: [],
  agentSettableStatuses: [WorkStatus.Active],
  anchorableReportTypes: [],
  writingStandards: { create: 'c', edit: 'e' },
  requiresParent: false,
  planEligible: true,
  capabilities: {},
  createdAt: new Date('2026-06-13T00:00:00.000Z'),
  updatedAt: new Date('2026-06-13T00:00:00.000Z'),
};

interface RowOverrides {
  typeKey: string;
  isSystem: boolean;
  projectId: string | null;
  lifecycleStatus?: 'active' | 'archived';
  name?: string | null;
  sectionDefinitions?: unknown;
  requiredScalars?: unknown;
  forbiddenScalars?: unknown;
  capabilities?: unknown;
  graphConfiguration?: unknown;
  role?: WorkItemTypeRole;
  acceptedConfigKinds?: unknown;
}

function buildRow(o: RowOverrides): WorkItemType {
  return {
    id: `id-${o.typeKey}-${o.projectId ?? 'system'}`,
    typeKey: o.typeKey,
    isSystem: o.isSystem,
    projectId: o.projectId,
    lifecycleStatus: o.lifecycleStatus ?? 'active',
    name: o.name === undefined ? `${o.typeKey} name` : o.name,
    role: o.role ?? WorkItemTypeRole.WorkItem,
    acceptedConfigKinds: o.acceptedConfigKinds ?? [],
    description: 'desc',
    sectionDefinitions:
      o.sectionDefinitions === undefined
        ? [{ key: 'description', label: 'Description' }]
        : o.sectionDefinitions,
    allowedParentTypes: ['STANDARD'],
    edgeTargets: [{ edgeType: 'RELATED_TO', targetTypeKeys: [] }],
    allowedStatuses: [WorkStatus.Active],
    ...LEAN_AXES,
    // The summary projects these closed-enum scalar axes from the lean columns.
    ...(o.requiredScalars === undefined
      ? {}
      : { requiredScalars: o.requiredScalars }),
    ...(o.forbiddenScalars === undefined
      ? {}
      : { forbiddenScalars: o.forbiddenScalars }),
    capabilities: o.capabilities ?? {},
    graphConfiguration: o.graphConfiguration ?? null,
  } as unknown as WorkItemType;
}

function projectRow(
  typeKey: string,
  projectId: string,
  overrides: Partial<RowOverrides> = {},
): WorkItemType {
  return buildRow({
    typeKey,
    isSystem: false,
    projectId,
    ...overrides,
  });
}

const registries: WorkItemTypeRegistryService[] = [];
afterEach(async () => {
  await Promise.all(
    registries.splice(0).map((registry) => registry.onModuleDestroy()),
  );
});

function makeService(
  rows: WorkItemType[],
  templates: Array<Record<string, unknown>> = [],
  projectIds = [...new Set(rows.map((row) => row.projectId))],
): WorkItemTypeRegistryService {
  const prisma = {
    project: {
      findMany: jest.fn().mockResolvedValue(projectIds.map((id) => ({ id }))),
    },
    workItemType: { findMany: jest.fn().mockResolvedValue(rows) },
    workItemTypeTemplate: {
      findMany: jest.fn().mockResolvedValue(templates),
    },
  } as unknown as PrismaService;
  const registry = new WorkItemTypeRegistryService(
    prisma,
    new InMemoryMessageBus(),
  );
  registries.push(registry);
  return registry;
}

describe('WorkItemTypeRegistryService — definition reads', () => {
  it('publishes optional canonical Goal dates without weakening project-owned definitions', async () => {
    const canonical = buildRow({
      typeKey: 'GOAL',
      isSystem: true,
      projectId: null,
      requiredScalars: [],
    });
    const override = buildRow({
      typeKey: 'GOAL',
      isSystem: false,
      projectId: PROJECT_B,
      requiredScalars: ['dueDate'],
    });
    const service = makeService(
      [override],
      [canonical],
      [PROJECT_A, PROJECT_B],
    );
    await service.refresh();
    expect(
      service.getDefinition(PROJECT_A, 'GOAL')?.definition.requiredScalars,
    ).toEqual([]);
    expect(
      service.getDefinition(PROJECT_B, 'GOAL')?.definition.requiredScalars,
    ).toEqual(['dueDate']);
  });

  it('exposes canonical Agent policy without merging it into complete project overrides', async () => {
    const person = { key: 'PERSON', label: 'Person', notation: 'person' };
    const agent = { key: 'AGENT', label: 'Agent', notation: 'box' };
    const existingRoles = [
      { key: 'GENERIC', label: 'Generic', notation: 'box' },
      {
        key: 'DIAGRAM_REFERENCE',
        label: 'Diagram reference',
        notation: 'frame',
      },
      person,
    ];
    const section = {
      key: 'diagramElementMetadata',
      label: 'Element metadata',
      kind: 'json',
      schemaRef: '#/components/schemas/DiagramElementMetadata',
      diagramElementPolicy: {
        roles: [...existingRoles, agent],
        referenceTargets: [],
      },
    };
    const override = {
      ...section,
      diagramElementPolicy: { roles: existingRoles, referenceTargets: [] },
    };
    const service = makeService(
      [
        projectRow('DIAGRAM_ELEMENT', PROJECT_B, {
          sectionDefinitions: [override],
        }),
      ],
      [
        buildRow({
          typeKey: 'DIAGRAM_ELEMENT',
          projectId: null,
          isSystem: true,
          sectionDefinitions: [section],
        }),
      ],
      [PROJECT_A, PROJECT_B],
    );
    await service.refresh();
    expect(service.getSectionDefinitions('DIAGRAM_ELEMENT', PROJECT_A)).toEqual(
      [section],
    );
    expect(service.getSectionDefinitions('DIAGRAM_ELEMENT', PROJECT_B)).toEqual(
      [override],
    );
  });

  it('round trips effective role extensions and stable notation through definition reads', async () => {
    const section = {
      key: 'diagramElementMetadata',
      label: 'Element metadata',
      kind: 'json',
      schemaRef: '#/components/schemas/DiagramElementMetadata',
      diagramElementPolicy: {
        roles: [
          { key: 'GENERIC', label: 'Generic', notation: 'box' },
          {
            key: 'DIAGRAM_REFERENCE',
            label: 'Diagram reference',
            notation: 'frame',
          },
          { key: 'QUEUE', label: 'Queue', notation: 'cylinder' },
        ],
        referenceTargets: [{ entityType: 'SERVICE' }],
      },
    };
    const service = makeService([
      projectRow('DIAGRAM_ELEMENT', PROJECT_A, {
        sectionDefinitions: [section],
      }),
    ]);
    await service.refresh();
    expect(service.getSectionDefinitions('DIAGRAM_ELEMENT', PROJECT_A)).toEqual(
      [section],
    );
    const invalid = makeService([
      projectRow('DIAGRAM_ELEMENT', PROJECT_A, {
        sectionDefinitions: [
          {
            ...section,
            diagramElementPolicy: {
              ...section.diagramElementPolicy,
              roles: [
                ...section.diagramElementPolicy.roles,
                section.diagramElementPolicy.roles[0],
              ],
            },
          },
        ],
      }),
    ]);
    await expect(invalid.refresh()).rejects.toThrow('must be unique');
  });

  const obsoleteTaskMonitorCapabilities = {
    requiresParent: true,
    planEligible: false,
    hasSetInitialStatus: false,
    rendersInline: false,
    canOwnReports: false,
    canOwnAgentSessions: false,
    supportsJsonSections: true,
    participatesInFeatureHierarchy: false,
  };

  it.each([
    ['project-owned row', false],
    ['canonical template', true],
  ])(
    'fails warmup for obsolete capabilities in a %s',
    async (_label, template) => {
      const taskMonitor = buildRow({
        typeKey: 'TASK_MONITOR',
        projectId: template ? null : PROJECT_A,
        isSystem: template,
        capabilities: obsoleteTaskMonitorCapabilities,
      });
      const service = makeService(
        template ? [] : [taskMonitor],
        template ? [taskMonitor] : [],
        [PROJECT_A],
      );

      await expect(service.refresh()).rejects.toThrow(
        /Unrecognized key\(s\) in object/,
      );
    },
  );

  it('serves a corrected Task Monitor definition through the public list snapshot', async () => {
    const taskMonitor = buildRow({
      typeKey: 'TASK_MONITOR',
      projectId: null,
      isSystem: true,
      capabilities: {
        requiresParent: true,
        planEligible: false,
        hasSetInitialStatus: false,
        rendersInline: false,
      },
    });
    const service = makeService([], [taskMonitor], [PROJECT_A]);

    await service.refresh();

    expect(service.getDefinitions(PROJECT_A)).toEqual([
      expect.objectContaining({
        definition: expect.objectContaining({
          key: 'TASK_MONITOR',
          capabilities: {
            requiresParent: true,
            planEligible: false,
            hasSetInitialStatus: false,
            rendersInline: false,
          },
        }),
      }),
    ]);
  });

  it('falls back to canonical definitions and overlays a complete project override', async () => {
    const canonical = {
      ...buildRow({
        typeKey: 'STANDARD',
        projectId: PROJECT_A,
        isSystem: true,
      }),
      id: 'canonical-standard',
      typeKey: 'STANDARD',
    };
    const override = projectRow('STANDARD', PROJECT_A, {
      name: 'Project Standard',
    });
    const service = makeService(
      [override],
      [canonical],
      [PROJECT_A, PROJECT_B],
    );
    await service.refresh();
    expect(service.getDefinition(PROJECT_A, 'STANDARD')).toMatchObject({
      effectiveSource: 'CANONICAL_OVERRIDE',
      definition: { name: 'Project Standard' },
    });
    expect(service.getDefinition(PROJECT_B, 'STANDARD')).toMatchObject({
      effectiveSource: 'CANONICAL',
      definition: { name: canonical.name },
    });
  });

  it('projects the explicit accepted launch-config policy from the effective definition', async () => {
    const canonical = buildRow({
      typeKey: 'STANDARD',
      projectId: null,
      isSystem: true,
      acceptedConfigKinds: ['INITIAL_WORKTREE'],
    });
    const override = projectRow('STANDARD', PROJECT_A, {
      acceptedConfigKinds: [],
    });
    const service = makeService(
      [override],
      [canonical],
      [PROJECT_A, PROJECT_B],
    );

    await service.refresh();

    expect(
      service.getDefinition(PROJECT_A, 'STANDARD')?.definition
        .acceptedConfigKinds,
    ).toEqual([]);
    expect(
      service.getDefinition(PROJECT_B, 'STANDARD')?.definition
        .acceptedConfigKinds,
    ).toEqual(['INITIAL_WORKTREE']);
  });

  it('propagates canonical Contract prose without overwriting a complete override', async () => {
    const providerOwnedDescription =
      'A Contract records one durable promise made by an identified provider at an owned interaction point: when stated conditions are met, the provider guarantees a stated, observable delivery. Every part of the promise must be within the provider’s control or enforced by its owned boundary.';
    const providerOwnedStandards = {
      create:
        'Write the promise as: When <conditions>, <provider> guarantees <observable delivery>. Every sentence must distinguish fulfillment from breach. After the provider-owned promise is complete, record topology separately. The structural parent is the owning feature; use Contract RELATED_TO only for other directly providing, consuming, or enforcing features, and workflow_step DEPENDS_ON Contract only for authoring or enforcing steps.',
      edit: 'Preserve one provider-owned promise. Remove UX, downstream use, implementation detail, and unowned third-party behavior. Every sentence must distinguish fulfillment from breach. After the provider-owned promise is complete, record topology separately.',
    };
    const canonical = {
      ...buildRow({
        typeKey: 'CONTRACT',
        projectId: null,
        isSystem: true,
        sectionDefinitions: [
          { key: 'description', label: 'Description', kind: 'markdown' },
        ],
        requiredScalars: ['tag'],
        forbiddenScalars: ['dueDate'],
        capabilities: {
          requiresParent: true,
          planEligible: false,
          hasSetInitialStatus: false,
          rendersInline: false,
        },
      }),
      name: 'Contract',
      description: providerOwnedDescription,
      allowedParentTypes: ['FEATURE'],
      edgeTargets: [{ edgeType: 'DEPENDS_ON', targetTypeKeys: ['CONTRACT'] }],
      writingStandards: providerOwnedStandards,
    } as unknown as WorkItemType;
    const projectOverride = {
      ...buildRow({
        typeKey: 'CONTRACT',
        projectId: PROJECT_B,
        isSystem: false,
        sectionDefinitions: [
          {
            key: 'description',
            label: 'Project Description',
            kind: 'markdown',
          },
        ],
        requiredScalars: [],
        forbiddenScalars: ['tag'],
        capabilities: {
          requiresParent: false,
          planEligible: true,
          hasSetInitialStatus: false,
          rendersInline: false,
        },
      }),
      name: 'Project Contract',
      description: 'Project-owned Contract wording.',
      allowedParentTypes: ['STANDARD'],
      edgeTargets: [{ edgeType: 'RELATED_TO', targetTypeKeys: ['FEATURE'] }],
      writingStandards: {
        create: 'Project-owned create guidance.',
        edit: 'Project-owned edit guidance.',
      },
    } as unknown as WorkItemType;
    const service = makeService(
      [projectOverride],
      [canonical as unknown as Record<string, unknown>],
      [PROJECT_A, PROJECT_B],
    );

    await service.refresh();

    const canonicalEffective = service.getDefinition(PROJECT_A, 'CONTRACT');
    expect(canonicalEffective).toMatchObject({
      effectiveSource: 'CANONICAL',
      definition: {
        key: 'CONTRACT',
        name: 'Contract',
        description: providerOwnedDescription,
        sections: [
          { key: 'description', label: 'Description', kind: 'markdown' },
        ],
        requiredScalars: ['tag'],
        forbiddenScalars: ['dueDate'],
        allowedStatuses: [WorkStatus.Active],
        allowedParentTypes: ['FEATURE'],
        edgeTargets: [{ edgeType: 'DEPENDS_ON', targetTypeKeys: ['CONTRACT'] }],
        writingStandards: providerOwnedStandards,
        capabilities: {
          requiresParent: true,
          planEligible: false,
          hasSetInitialStatus: false,
          rendersInline: false,
        },
      },
    });
    const effectiveStandards = canonicalEffective?.definition.writingStandards;
    if (!effectiveStandards) {
      throw new Error('Expected canonical Contract writing standards');
    }
    expect(effectiveStandards.create).toContain(
      'When <conditions>, <provider> guarantees <observable delivery>',
    );
    expect(effectiveStandards.create).toContain(
      'Every sentence must distinguish fulfillment from breach',
    );
    expect(effectiveStandards.create).toContain(
      'After the provider-owned promise is complete, record topology separately',
    );
    expect(effectiveStandards.create).toContain(
      'The structural parent is the owning feature',
    );
    expect(effectiveStandards.create).toContain(
      'workflow_step DEPENDS_ON Contract only for authoring or enforcing steps',
    );
    expect(effectiveStandards.edit).toContain('unowned third-party behavior');

    expect(service.getDefinition(PROJECT_B, 'CONTRACT')).toEqual({
      id: `id-CONTRACT-${PROJECT_B}`,
      projectId: PROJECT_B,
      status: WorkItemTypeLifecycleStatus.Active,
      effectiveSource: 'CANONICAL_OVERRIDE',
      definition: {
        key: 'CONTRACT',
        name: 'Project Contract',
        role: WorkItemTypeRole.WorkItem,
        acceptedConfigKinds: [],
        iconKey: undefined,
        description: 'Project-owned Contract wording.',
        sections: [
          {
            key: 'description',
            label: 'Project Description',
            kind: 'markdown',
          },
        ],
        requiredScalars: [],
        forbiddenScalars: ['tag'],
        allowedStatuses: [WorkStatus.Active],
        allowedParentTypes: ['STANDARD'],
        edgeTargets: [{ edgeType: 'RELATED_TO', targetTypeKeys: ['FEATURE'] }],
        allowedParentEntityTypes: [],
        tracking: {
          allowedSourceEntityTypes: [],
          allowedSourceTaskTypes: [],
        },
        agentSettableStatuses: [WorkStatus.Active],
        anchorableReportTypes: [],
        writingStandards: {
          create: 'Project-owned create guidance.',
          edit: 'Project-owned edit guidance.',
        },
        capabilities: {
          requiresParent: false,
          planEligible: true,
          hasSetInitialStatus: false,
          rendersInline: false,
        },
      },
    });
  });

  it("returns only the project's own active definitions, sorted by key", async () => {
    const service = makeService([
      projectRow('STANDARD', PROJECT_A),
      projectRow('FEATURE', PROJECT_A, {
        capabilities: { showsInExplorerSidebar: true },
      }),
      buildRow({
        typeKey: 'MARKETING',
        isSystem: false,
        projectId: PROJECT_A,
        requiredScalars: ['dueDate'],
        forbiddenScalars: ['tag'],
        capabilities: { showsInExplorerSidebar: false },
      }),
      buildRow({ typeKey: 'SUPPORT', isSystem: false, projectId: PROJECT_B }),
    ]);
    await service.refresh();

    const summaries = service.getDefinitions(PROJECT_A);

    expect(summaries.map((s) => s.definition.key)).toEqual([
      'FEATURE',
      'MARKETING',
      'STANDARD',
    ]);
    // Project B's custom type is not visible to project A.
    expect(
      summaries.find((s) => s.definition.key === 'SUPPORT'),
    ).toBeUndefined();

    const marketing = summaries.find((s) => s.definition.key === 'MARKETING');
    expect(marketing).toMatchObject({
      status: WorkItemTypeLifecycleStatus.Active,
      projectId: PROJECT_A,
      definition: {
        key: 'MARKETING',
        name: 'MARKETING name',
        sections: [{ key: 'description', label: 'Description' }],
        requiredScalars: ['dueDate'],
        forbiddenScalars: ['tag'],
        edgeTargets: [{ edgeType: 'RELATED_TO', targetTypeKeys: [] }],
        capabilities: { showsInExplorerSidebar: false },
      },
    });

    const standard = summaries.find((s) => s.definition.key === 'STANDARD');
    expect(standard).toMatchObject({
      projectId: PROJECT_A,
      effectiveSource: 'PROJECT_CUSTOM',
    });
    expect(
      summaries.find((s) => s.definition.key === 'FEATURE')?.definition
        .capabilities,
    ).toEqual({ showsInExplorerSidebar: true });
  });

  it('filters by lifecycle status when a status is supplied', async () => {
    const service = makeService([
      projectRow('STANDARD', PROJECT_A),
      buildRow({
        typeKey: 'RETIRED',
        isSystem: false,
        projectId: PROJECT_A,
        lifecycleStatus: 'archived',
      }),
    ]);
    await service.refresh();

    expect(
      service
        .getDefinitions(PROJECT_A, WorkItemTypeLifecycleStatus.Active)
        .map((s) => s.definition.key),
    ).toEqual(['STANDARD']);

    expect(
      service
        .getDefinitions(PROJECT_A, WorkItemTypeLifecycleStatus.Archived)
        .map((s) => s.definition.key),
    ).toEqual(['RETIRED']);

    // No filter → both statuses.
    expect(
      service.getDefinitions(PROJECT_A).map((s) => s.definition.key),
    ).toEqual(['RETIRED', 'STANDARD']);
  });

  it('getDefinition returns a single summary regardless of status, or undefined when absent', async () => {
    const service = makeService([
      projectRow('STANDARD', PROJECT_A),
      buildRow({
        typeKey: 'RETIRED',
        isSystem: false,
        projectId: PROJECT_A,
        lifecycleStatus: 'archived',
      }),
    ]);
    await service.refresh();

    expect(service.getDefinition(PROJECT_A, 'STANDARD')?.definition.key).toBe(
      'STANDARD',
    );
    // Archived types are still retrievable by key.
    expect(service.getDefinition(PROJECT_A, 'RETIRED')?.status).toBe(
      WorkItemTypeLifecycleStatus.Archived,
    );
    expect(service.getDefinition(PROJECT_A, 'NOPE')).toBeUndefined();
    // A custom type from another project is not visible here.
    expect(service.getDefinition(PROJECT_B, 'RETIRED')).toBeUndefined();
  });

  it('rejects rows whose rich definition columns were never backfilled', async () => {
    const service = makeService([
      buildRow({
        typeKey: 'HALF',
        isSystem: false,
        projectId: PROJECT_A,
        name: null,
      }),
    ]);
    await expect(service.refresh()).rejects.toThrow(
      "Cannot load work-item type 'HALF'",
    );
    expect(service.getDefinitions(PROJECT_A)).toEqual([]);
  });

  it('preserves JSON section metadata on definition reads and rules', async () => {
    const service = makeService([
      projectRow('TASK_MONITOR', PROJECT_A, {
        sectionDefinitions: [
          { key: 'summary', label: 'Summary', kind: 'markdown' },
          {
            key: 'executionDefinition',
            label: 'Execution Definition',
            kind: 'json',
            schemaRef: '#/components/schemas/TaskMonitorExecutionDefinition',
          },
        ],
      }),
    ]);
    await service.refresh();

    expect(
      service.getDefinition(PROJECT_A, 'TASK_MONITOR')?.definition.sections,
    ).toEqual([
      { key: 'summary', label: 'Summary', kind: 'markdown' },
      {
        key: 'executionDefinition',
        label: 'Execution Definition',
        kind: 'json',
        schemaRef: '#/components/schemas/TaskMonitorExecutionDefinition',
      },
    ]);
    expect(
      service.getSectionDefinition(
        'TASK_MONITOR',
        'executionDefinition',
        PROJECT_A,
      ),
    ).toMatchObject({
      kind: 'json',
      schemaRef: '#/components/schemas/TaskMonitorExecutionDefinition',
    });
  });

  it.each([
    ['project-owned row', false],
    ['canonical template', true],
  ])(
    'preserves the optional Workflow layout-preference declaration from a %s',
    async (_label, template) => {
      const graphConfiguration = {
        nodeChildType: 'workflow_step',
        layout: {
          sectionKey: 'graphLayout',
          schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
        },
        layoutPreference: {
          sectionKey: 'graphLayoutPreference',
          schemaRef: '#/components/schemas/WorkItemGraphLayoutPreferenceValue',
        },
        readableRelationships: [],
        editableRelationships: [],
        rendererKey: 'work-item-graph',
        editorKey: 'work-item-graph-editor',
        supportedActions: ['viewGraph'],
      };
      const workflow = buildRow({
        typeKey: 'workflow',
        projectId: template ? null : PROJECT_A,
        isSystem: template,
        graphConfiguration,
      });
      const service = makeService(
        template ? [] : [workflow],
        template ? [workflow] : [],
        [PROJECT_A],
      );

      await service.refresh();

      expect(
        service.getDefinition(PROJECT_A, 'workflow')?.definition.capabilities
          ?.graph?.layoutPreference,
      ).toEqual(graphConfiguration.layoutPreference);
    },
  );
});

describe('purpose-scoped guidance', () => {
  it.each(Object.values(SessionRole))(
    'uses only effective role advice for %s, including missing advice',
    async (sessionRole) => {
      const service = makeService(
        [
          { ...projectRow('GUIDED', PROJECT_B), sessionRoleGuidance: null },
          projectRow('archived', PROJECT_A, { lifecycleStatus: 'archived' }),
        ],
        [
          {
            ...projectRow('GUIDED', PROJECT_A),
            sessionRoleGuidance: { [sessionRole]: '  Canonical advice  ' },
          },
        ],
        [PROJECT_A, PROJECT_B],
      );
      await service.refresh();
      expect(
        service.getGuidance(
          PROJECT_A,
          'GUIDED',
          WorkItemTypeGuidancePurpose.Role,
          sessionRole,
        ),
      ).toEqual({
        typeKey: 'GUIDED',
        name: 'GUIDED name',
        sessionRole,
        guidance: '  Canonical advice  ',
      });
      expect(
        service.getGuidance(
          PROJECT_B,
          'GUIDED',
          WorkItemTypeGuidancePurpose.Role,
          sessionRole,
        ),
      ).toEqual({ typeKey: 'GUIDED', name: 'GUIDED name', sessionRole });
      expect(() =>
        service.getGuidance(
          PROJECT_A,
          'archived',
          WorkItemTypeGuidancePurpose.Role,
          sessionRole,
        ),
      ).toThrow('archived');
    },
  );

  it('returns only effective maintenance advice and never falls back to a canonical template', async () => {
    const service = makeService(
      [
        {
          ...projectRow('GUIDED', PROJECT_A),
          maintenanceGuidance: 'Project maintenance',
        },
        { ...projectRow('GUIDED', PROJECT_B), maintenanceGuidance: null },
      ],
      [
        {
          ...projectRow('GUIDED', PROJECT_A),
          maintenanceGuidance: 'Canonical maintenance',
        },
      ],
      [PROJECT_A, PROJECT_B],
    );
    await service.refresh();
    expect(
      service.getGuidance(
        PROJECT_A,
        'GUIDED',
        WorkItemTypeGuidancePurpose.Maintenance,
      ),
    ).toEqual({
      typeKey: 'GUIDED',
      name: 'GUIDED name',
      maintenanceGuidance: 'Project maintenance',
    });
    expect(
      service.getGuidance(
        PROJECT_B,
        'GUIDED',
        WorkItemTypeGuidancePurpose.Maintenance,
      ),
    ).toEqual({
      typeKey: 'GUIDED',
      name: 'GUIDED name',
    });
  });

  it('reads maintenance advice from a canonical definition when no project override exists', async () => {
    const service = makeService(
      [],
      [
        {
          ...projectRow('GUIDED', PROJECT_A),
          maintenanceGuidance: 'Canonical maintenance',
        },
      ],
      [PROJECT_A],
    );
    await service.refresh();
    expect(
      service.getGuidance(
        PROJECT_A,
        'GUIDED',
        WorkItemTypeGuidancePurpose.Maintenance,
      ),
    ).toEqual({
      typeKey: 'GUIDED',
      name: 'GUIDED name',
      maintenanceGuidance: 'Canonical maintenance',
    });
  });

  it.each([
    [PROJECT_A, 'missing'],
    [PROJECT_A, 'archived'],
    [PROJECT_B, 'custom'],
  ])(
    'rejects unavailable requested keys in project scope',
    async (project, key) => {
      const service = makeService(
        [
          projectRow('custom', PROJECT_A),
          projectRow('archived', PROJECT_A, { lifecycleStatus: 'archived' }),
        ],
        [],
        [PROJECT_A, PROJECT_B],
      );
      await service.refresh();
      expect(() =>
        service.getGuidance(
          project,
          key,
          WorkItemTypeGuidancePurpose.Maintenance,
        ),
      ).toThrow('unavailable in this project');
    },
  );
});
