import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthClient } from '../../auth/index';

const { listMock, projectMock, hintsEnabledMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  projectMock: vi.fn(),
  hintsEnabledMock: vi.fn(),
}));

vi.mock('./hint-availability', () => ({ readHintsEnabled: hintsEnabledMock }));

vi.mock('../../shared/api/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/api/index')>();
  class MockWorkItemTypesApi {
    organizationsOrganizationIdProjectsProjectIdWorkItemTypesGet = listMock;
  }
  class MockProjectsApi {
    findOneProject = projectMock;
  }
  return { ...actual, WorkItemTypesApi: MockWorkItemTypesApi, ProjectsApi: MockProjectsApi };
});

import {
  DiagramElementRoleDefinitionNotationEnum,
  DiagramReferenceTargetRuleEntityTypeEnum,
  WorkItemConfigKind,
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  WorkStatus,
} from '../../shared/api/index';
import type {
  DiagramElementPolicy,
  WorkItemTypeDefinitionDto,
  WorkItemTypeGraphCapability,
  WorkItemTypeSectionDefinition,
} from '../../shared/api/index';
import { readActiveWorkItemTypeDefinitions } from './work-item-type-registry';
import { readSessionStartContext } from './session-start-context';
import { MachineOptionsStore } from '../../options/machine-options-store';
import { buildPlatformSystemPrompt } from './common';
import workItemTypesFixture from './__fixtures__/work-item-types.fixture';

let sessionDir: string;
let previousSessionDir: string | undefined;

beforeEach(async () => {
  projectMock.mockResolvedValue({ data: { data: { maturity: 'ESTABLISHED' } } });
  hintsEnabledMock.mockResolvedValue(false);
  previousSessionDir = process.env['HEYHEY_SESSION_DIR'];
  sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-start-context-'));
  process.env['HEYHEY_SESSION_DIR'] = sessionDir;
});

afterEach(async () => {
  if (previousSessionDir === undefined) delete process.env['HEYHEY_SESSION_DIR'];
  else process.env['HEYHEY_SESSION_DIR'] = previousSessionDir;
  await fs.rm(sessionDir, { recursive: true, force: true });
});

describe('Diagram group identity writing standards', () => {
  it('preserves create and edit palette guidance through the effective registry', async () => {
    const diagram = workItemTypesFixture.find((type) => type.definition.key === 'DIAGRAM')!;
    listMock.mockResolvedValue({ data: { data: [diagram] } });
    const definitions = await readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID);
    for (const mode of ['create', 'edit'] as const) {
      const guidance = definitions[0]?.writingStandards?.[mode];
      expect(guidance).toContain('blue, green, orange, purple, red, or teal');
      expect(guidance).toContain('same thing share a color');
      expect(guidance).toContain('do not persist automatic colors');
      expect(guidance).toContain('existing hex-color behavior');
    }
    expect(definitions[0]?.writingStandards?.edit).toContain('Preserve authored colors');
  });
});

const ORG_ID = 'org-123';
const PROJECT_ID = 'project-456';

/** Builds a JWT whose payload base64url-decodes to the given claims. */
const makeToken = (payload: Record<string, unknown>): string => {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
};

const TOKEN = makeToken({ organizationId: ORG_ID });

const featureSection = {
  key: 'summary',
  label: 'Summary',
  kind: 'markdown',
  required: false,
} satisfies WorkItemTypeSectionDefinition;

const taskSection = {
  key: 'overview',
  label: 'Overview',
  writingStandard: 'Describe the work.',
  kind: 'markdown',
  schemaRef: null,
  required: true,
} satisfies WorkItemTypeSectionDefinition;

const taskDefinition = {
  key: 'TASK',
  name: 'Task',
  role: 'work-item',
  iconKey: 'task',
  description: 'A unit of implementation work.',
  sections: [taskSection],
  requiredScalars: ['tag'],
  allowedStatuses: [WorkStatus.Active, WorkStatus.Completed],
  allowedParentTypes: ['FEATURE'],
  tracking: {
    allowedSourceEntityTypes: ['TASK'],
    allowedSourceTaskTypes: ['GOAL'],
  },
  writingStandards: { create: 'Create prose.', edit: 'Edit prose.' },
  capabilities: { requiresParent: true },
} satisfies WorkItemTypeDefinitionDto;

const featureDefinition = {
  key: 'FEATURE',
  name: 'Feature',
  role: 'project-info',
  sections: [featureSection],
  allowedStatuses: [WorkStatus.Active],
} satisfies WorkItemTypeDefinitionDto;

const diagramElementPolicy = {
  roles: [
    {
      key: 'AGENT',
      label: 'Agent',
      notation: DiagramElementRoleDefinitionNotationEnum.Box,
    },
    {
      key: 'PERSON',
      label: 'Person',
      notation: DiagramElementRoleDefinitionNotationEnum.Person,
    },
    {
      key: 'GENERIC',
      label: 'Generic',
      notation: DiagramElementRoleDefinitionNotationEnum.Box,
    },
    {
      key: 'DIAGRAM_REFERENCE',
      label: 'Diagram reference',
      notation: DiagramElementRoleDefinitionNotationEnum.Frame,
    },
  ],
  referenceTargets: [
    {
      entityType: DiagramReferenceTargetRuleEntityTypeEnum.Task,
      workItemTypeKeys: ['DIAGRAM'],
    },
    { entityType: DiagramReferenceTargetRuleEntityTypeEnum.Service },
  ],
} satisfies DiagramElementPolicy;

const graphCapability = {
  nodeChildType: 'workflow_step',
  layout: {
    sectionKey: 'graphLayout',
    schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
  },
  layoutPreference: {
    sectionKey: 'graphLayoutPreference',
    schemaRef: '#/components/schemas/WorkItemGraphLayoutPreferenceValue',
  },
  groups: {
    sectionKey: 'diagramGroups',
    schemaRef: '#/components/schemas/DiagramGroupsValue',
  },
  readableRelationships: [
    {
      edgeType: 'STANDARD',
      category: 'flow',
      sourceEndpoint: { role: 'graphRoot', entityTypes: ['TASK'] },
      targetEndpoint: {
        role: 'graphNode',
        entityTypes: ['TASK'],
        workItemTypeKeys: ['workflow_step'],
      },
      direction: { required: true, allowedDirections: ['forward'] },
      metadataSchemaRef: null,
    },
  ],
  editableRelationships: [],
  searchableMetaLinkTargets: [],
  rendererKey: 'work-item-graph',
  editorKey: 'work-item-graph-editor',
  supportedActions: ['viewGraph'],
  readExpansions: [
    {
      key: 'dependencies',
      seed: 'graphRoot',
      path: [
        {
          relationshipType: 'DEPENDS_ON',
          direction: 'OUTGOING',
          target: { entityTypes: ['TASK'], workItemTypeKeys: ['workflow_step'] },
        },
      ],
      projectionKind: 'workItemReference',
      deduplicateBy: 'entityId',
      excludeRoot: true,
      limit: 50,
    },
  ],
} satisfies WorkItemTypeGraphCapability;

const summary = (definition: unknown) => ({
  id: 'type-row-1',
  definition,
  status: WorkItemTypeLifecycleStatus.Active,
  projectId: PROJECT_ID,
  effectiveSource: WorkItemTypeEffectiveSource.Canonical,
});

beforeEach(() => {
  listMock.mockReset();
});

describe('readActiveWorkItemTypeDefinitions', () => {
  it.each([
    undefined,
    {},
    { implementation: '  Build advice  ', research: '', planning: 'Plan' },
    { review: 'Review' },
  ])('preserves role advice as optional registry data: %j', async (sessionRoleGuidance) => {
    listMock.mockResolvedValue({
      data: {
        data: [
          summary({
            ...taskDefinition,
            ...(sessionRoleGuidance === undefined ? {} : { sessionRoleGuidance }),
          }),
        ],
      },
    });
    const definitions = await readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID);
    expect(definitions[0]?.sessionRoleGuidance).toEqual(sessionRoleGuidance);
    expect(Object.hasOwn(definitions[0]!, 'sessionRoleGuidance')).toBe(
      sessionRoleGuidance !== undefined,
    );
  });

  it('unwraps validated summaries into typed definitions', async () => {
    const taskDefinitionWithAcceptedConfigKinds = {
      ...taskDefinition,
      acceptedConfigKinds: [WorkItemConfigKind.InitialWorktree],
    } satisfies WorkItemTypeDefinitionDto;
    listMock.mockResolvedValue({
      data: {
        data: [
          summary(taskDefinitionWithAcceptedConfigKinds),
          summary({ ...featureDefinition, capabilities: { graph: graphCapability } }),
        ],
      },
    });

    const definitions = await readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID);

    expect(definitions).toEqual([
      taskDefinitionWithAcceptedConfigKinds,
      { ...featureDefinition, capabilities: { graph: graphCapability } },
    ]);
  });

  it('accepts presentation-only html/css size profiles returned by the registry', async () => {
    const definition = {
      ...featureDefinition,
      sections: [
        {
          key: 'preview',
          label: 'Preview',
          kind: 'html/css',
          sizeProfiles: [
            {
              key: 'responsive',
              label: 'Responsive',
              breakpoints: [
                {
                  minContainerWidth: 0,
                  inline: { width: 320, height: 240 },
                  page: { width: 1280, height: 720 },
                },
              ],
            },
          ],
          defaultSizeKey: 'responsive',
        },
      ],
    };
    listMock.mockResolvedValue({ data: { data: [summary(definition)] } });

    await expect(readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID)).resolves.toEqual([
      {
        ...featureDefinition,
        sections: [{ key: 'preview', label: 'Preview', kind: 'html/css' }],
      },
    ]);
  });

  it('accepts a valid Diagram element policy without projecting it into the prompt definition', async () => {
    const definition = {
      ...featureDefinition,
      sections: [
        {
          ...featureSection,
          diagramElementPolicy,
        },
      ],
    } satisfies WorkItemTypeDefinitionDto;
    listMock.mockResolvedValue({ data: { data: [summary(definition)] } });

    const definitions = await readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID);

    expect(definitions).toEqual([featureDefinition]);
  });

  it.each([
    {
      name: 'invalid role notation',
      policy: {
        ...diagramElementPolicy,
        roles: [{ key: 'GENERIC', label: 'Generic', notation: 'hexagon' }],
      },
    },
    {
      name: 'malformed role definition',
      policy: {
        ...diagramElementPolicy,
        roles: [{ key: 'GENERIC', notation: DiagramElementRoleDefinitionNotationEnum.Box }],
      },
    },
    {
      name: 'invalid reference target entity type',
      policy: {
        ...diagramElementPolicy,
        referenceTargets: [{ entityType: 'PROJECT' }],
      },
    },
    {
      name: 'malformed reference target work-item filters',
      policy: {
        ...diagramElementPolicy,
        referenceTargets: [
          {
            entityType: DiagramReferenceTargetRuleEntityTypeEnum.Task,
            workItemTypeKeys: [42],
          },
        ],
      },
    },
    {
      name: 'unknown policy property',
      policy: { ...diagramElementPolicy, extra: true },
    },
  ])('rejects malformed Diagram element policy: $name', async ({ policy }) => {
    const definition = {
      ...featureDefinition,
      sections: [{ ...featureSection, diagramElementPolicy: policy }],
    };
    listMock.mockResolvedValue({ data: { data: [summary(definition)] } });

    await expect(readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID)).rejects.toThrow();
  });

  it('assembles a fresh shared session prompt from a multi-entry effective snapshot', async () => {
    const oauthClient = new OAuthClient();
    vi.spyOn(oauthClient, 'getAccessToken').mockResolvedValue({ success: true, data: TOKEN });
    listMock.mockResolvedValue({
      data: {
        data: [
          summary({
            ...taskDefinition,
            sections: [{ ...taskSection, diagramElementPolicy }],
          } satisfies WorkItemTypeDefinitionDto),
          {
            ...summary(featureDefinition),
            effectiveSource: WorkItemTypeEffectiveSource.CanonicalOverride,
          },
        ],
      },
    });

    const context = await readSessionStartContext({ oauthClient, projectId: PROJECT_ID });
    const prompt = buildPlatformSystemPrompt(context.workItemTypeDefinitions);

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(context.workItemTypeDefinitions).toHaveLength(2);
    expect(prompt).toContain('**Task** (`TASK`)');
    expect(prompt).toContain('**Feature** (`FEATURE`)');
    expect(prompt).not.toContain('DIAGRAM_REFERENCE');
    expect(prompt).not.toContain('`get_work_item_type_guidance`');
    expect(prompt).toContain('`get_work_item_type_guidance_batch`');
    expect(prompt).toContain('typeKeys: [key]');
    expect(prompt).toContain('deduplicated array of 1–10 relevant encountered keys');
    expect(prompt).toContain('same purpose and session role');
    expect(prompt).toContain('request order');
  });

  it('lists only active types for the token org and session project', async () => {
    listMock.mockResolvedValue({ data: { data: [summary(featureDefinition)] } });

    await readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID);

    expect(listMock).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      status: WorkItemTypeLifecycleStatus.Active,
    });
  });

  it('throws when the access token carries no organization id', async () => {
    await expect(
      readActiveWorkItemTypeDefinitions(makeToken({ sub: 'user-1' }), PROJECT_ID),
    ).rejects.toThrow(/organization id/u);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('surfaces a failed read as a throw', async () => {
    listMock.mockRejectedValue(new Error('network down'));

    await expect(readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID)).rejects.toThrow(
      'network down',
    );
  });

  it('throws when the envelope carries no data array', async () => {
    listMock.mockResolvedValue({ data: { success: true } });

    await expect(readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID)).rejects.toThrow();
  });

  it('rejects a wrapper missing its definition', async () => {
    listMock.mockResolvedValue({
      data: {
        data: [
          {
            id: 'type-row-1',
            status: WorkItemTypeLifecycleStatus.Active,
            projectId: PROJECT_ID,
            effectiveSource: WorkItemTypeEffectiveSource.Canonical,
          },
        ],
      },
    });

    await expect(readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID)).rejects.toThrow();
  });

  it('rejects a mis-shaped definition payload', async () => {
    listMock.mockResolvedValue({
      data: { data: [summary({ key: 'TASK', name: 'Task' })] },
    });

    await expect(readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID)).rejects.toThrow();
  });

  it('rejects retired summary revision metadata', async () => {
    listMock.mockResolvedValue({
      data: {
        data: [
          {
            ...summary(featureDefinition),
            acceptedTemplateRevision: 1,
          },
        ],
      },
    });

    await expect(readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID)).rejects.toThrow();
  });

  it('rejects source-owned tracking fields', async () => {
    listMock.mockResolvedValue({
      data: {
        data: [
          summary({
            ...featureDefinition,
            tracking: {
              isTrackingSource: true,
              allowedTargetEntityTypes: ['TASK'],
              allowedTargetTaskTypes: ['STANDARD'],
            },
          }),
        ],
      },
    });

    await expect(readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID)).rejects.toThrow();
  });

  it('rejects retired parent and child capability flags', async () => {
    listMock.mockResolvedValue({
      data: {
        data: [
          summary({
            ...featureDefinition,
            capabilities: { canHaveParent: true, canHaveChildren: true },
          }),
        ],
      },
    });

    await expect(readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID)).rejects.toThrow();
  });

  it('rejects the removed hierarchy capability', async () => {
    listMock.mockResolvedValue({
      data: {
        data: [
          summary({
            ...featureDefinition,
            capabilities: { isHierarchyNode: true },
          }),
        ],
      },
    });

    await expect(readActiveWorkItemTypeDefinitions(TOKEN, PROJECT_ID)).rejects.toThrow();
  });
});

describe('readSessionStartContext maturity stage', () => {
  const makeOauthClient = () => {
    const oauthClient = new OAuthClient();
    vi.spyOn(oauthClient, 'getAccessToken').mockResolvedValue({ success: true, data: TOKEN });
    return oauthClient;
  };

  beforeEach(() => {
    listMock.mockResolvedValue({ data: { data: [] } });
  });

  it.each(['TAKING_SHAPE', 'ESTABLISHED'] as const)('carries the %s stage', async (maturity) => {
    projectMock.mockClear();
    projectMock.mockResolvedValueOnce({ data: { data: { maturity } } });

    const context = await readSessionStartContext({
      oauthClient: makeOauthClient(),
      projectId: PROJECT_ID,
    });

    expect(context.maturity).toBe(maturity);
    expect(projectMock).toHaveBeenCalledTimes(1);
  });

  it('aborts session start when the project has no valid stage', async () => {
    projectMock.mockResolvedValueOnce({ data: { data: {} } });

    await expect(
      readSessionStartContext({ oauthClient: makeOauthClient(), projectId: PROJECT_ID }),
    ).rejects.toThrow('required maturity stage');
  });
});

describe('readSessionStartContext hints switch', () => {
  it.each([true, false])('carries hintsEnabled=%s from the platform tool list', async (enabled) => {
    listMock.mockResolvedValue({ data: { data: [] } });
    hintsEnabledMock.mockResolvedValueOnce(enabled);
    const oauthClient = new OAuthClient();
    vi.spyOn(oauthClient, 'getAccessToken').mockResolvedValue({ success: true, data: TOKEN });

    const context = await readSessionStartContext({ oauthClient, projectId: PROJECT_ID });

    expect(context.hintsEnabled).toBe(enabled);
    expect(hintsEnabledMock).toHaveBeenCalledWith(TOKEN, PROJECT_ID);
  });
});

describe('readSessionStartContext Intent-first choice', () => {
  const makeOauthClient = () => {
    const oauthClient = new OAuthClient();
    vi.spyOn(oauthClient, 'getAccessToken').mockResolvedValue({ success: true, data: TOKEN });
    return oauthClient;
  };

  beforeEach(() => {
    listMock.mockResolvedValue({ data: { data: [] } });
  });

  it('reads Intent-first as off when nothing has been saved', async () => {
    const context = await readSessionStartContext({
      oauthClient: makeOauthClient(),
      projectId: PROJECT_ID,
    });

    expect(context.intentFirst).toBe(false);
  });

  it('returns the saved choice, and a later change shows up only in the next session start', async () => {
    const store = new MachineOptionsStore();
    await store.update({ intentFirst: true });
    const first = await readSessionStartContext({
      oauthClient: makeOauthClient(),
      projectId: PROJECT_ID,
    });

    await store.update({ intentFirst: false });
    const next = await readSessionStartContext({
      oauthClient: makeOauthClient(),
      projectId: PROJECT_ID,
    });

    expect(first.intentFirst).toBe(true);
    expect(next.intentFirst).toBe(false);
  });

  it('aborts session start when the saved options are invalid', async () => {
    await fs.writeFile(path.join(sessionDir, 'options.json'), '{"version":1,"intentFirst":"yes"}');

    await expect(
      readSessionStartContext({ oauthClient: makeOauthClient(), projectId: PROJECT_ID }),
    ).rejects.toThrow();
  });
});
