import { describe, expect, it, vi } from 'vitest';
import {
  AgentSessionCurrentState,
  AgentSessionStatus,
  AgentSessionType,
  EntityPromptTemplateEffectiveDtoLifecycleStateEnum,
  EntityPromptTemplateEffectiveDtoValidationStatusEnum,
  EntityPromptTemplateSelectorEntityType,
  EntityPromptTemplateSyntaxVersion,
  EntityType,
  TaskSource,
  WorkStatus,
  type AgentSessionDto,
  type EntityPromptTemplateSelectorDto,
  type FullEntityContextDto,
  type TaskResponseDto,
} from '../shared/api/generated/api';
import {
  LocalPromptTaskType,
  RunEntityReferenceEntityTypeEnum,
  type RunEntityReference,
} from '../shared/agent-bridge-contract/generated/api';
import { createTestOAuthClient } from '../auth/oauth-client.test-support';
import { NOOP_LOGGER } from '../server/logger';
import { SubmissionToolAuth } from '../agents/submission-tools/submission-tool-auth';
import { EntityContextLoader } from '../agents/entity-context/entity-context-loader';
import type {
  ExistingLoadedEntityPromptContext,
  LoadedEntityPromptContext,
} from '../agents/entity-context/types';
import type { EntityPromptTemplatesApiClient } from './agent-startup-prompt-input';
import {
  AgentStartupPromptInput,
  entityPromptTemplateSelectorFor,
} from './agent-startup-prompt-input';

const runEntity = (
  entityType: RunEntityReference['entityType'] = RunEntityReferenceEntityTypeEnum.Task,
): RunEntityReference => ({ entityType, entityId: 'entity-1' });

const workItem = (type = 'CUSTOM_REVIEW'): TaskResponseDto => ({
  id: 'entity-1',
  name: 'Authoritative work item',
  type,
  organizationId: 'organization-1',
  projectId: 'project-1',
  status: WorkStatus.Active,
  source: TaskSource.User,
  sections: [
    {
      id: 'section-description',
      key: 'description',
      order: 0,
      materializedMarkdown: 'Authoritative task description',
      materializedProposalId: '11111111-1111-4111-8111-111111111111',
    },
  ],
});

const canonicalContext = (
  entityType: FullEntityContextDto['entityType'] = EntityType.Task,
  taskType: string | undefined = 'CUSTOM_REVIEW',
): FullEntityContextDto => ({
  entityId: 'entity-1',
  entityType,
  ...(taskType ? { taskType } : {}),
  displayName: 'Authoritative work item',
  createdAt: '2026-08-20T00:00:00.000Z',
  content: {
    sections: {
      description: 'Authoritative task description',
      acceptanceCriteria: 'Authoritative acceptance criteria',
    },
  },
});

const loadedWorkItem = (type = 'CUSTOM_REVIEW'): ExistingLoadedEntityPromptContext => ({
  kind: 'entity',
  focalEntity: runEntity(),
  entity: workItem(type),
  context: canonicalContext(EntityType.Task, type),
});

const agentSession = (): AgentSessionDto => ({
  id: 'entity-1',
  organizationId: 'organization-1',
  projectId: 'project-1',
  userId: 'user-1',
  status: AgentSessionStatus.InProgress,
  currentState: AgentSessionCurrentState.Idle,
  conversationId: 'conversation-1',
  sessionDate: '2026-08-20T00:00:00.000Z',
  title: 'Authoritative session',
  hasUnsyncedChanges: false,
  monitoringEnabled: false,
  autoDecide: false,
  type: AgentSessionType.EntityConversation,
});

const loadedAgentSession = (): LoadedEntityPromptContext => ({
  kind: 'agent_session',
  focalEntity: runEntity(RunEntityReferenceEntityTypeEnum.AgentSession),
  entity: agentSession(),
  context: canonicalContext(EntityType.AgentSession, undefined),
  agentSession: agentSession(),
  conversationId: 'conversation-1',
  transcript: [],
});

const responseEnvelope = <T>(data: T) => ({
  success: true,
  message: 'OK',
  data,
  timestamp: '2026-08-20T00:00:00.000Z',
  statusCode: 200,
});

const effectiveResponse = (
  templateKey: string,
  selector: EntityPromptTemplateSelectorDto,
  ownershipSource: { scope: 'CANONICAL' } | { scope: 'PROJECT'; projectId: string },
  content: string,
  revisionNumber: number,
) =>
  responseEnvelope({
    templateKey,
    selector,
    syntaxVersion: EntityPromptTemplateSyntaxVersion.V1,
    content,
    ownershipSource,
    revisionId: `revision-${String(revisionNumber)}`,
    revisionNumber,
    lifecycleState: EntityPromptTemplateEffectiveDtoLifecycleStateEnum.Published,
    validationStatus: EntityPromptTemplateEffectiveDtoValidationStatusEnum.Valid,
    publishedAt: '2026-08-20T00:00:00.000Z',
  });

const catalogResponse = (templateKey: string, selector: EntityPromptTemplateSelectorDto) =>
  responseEnvelope({
    projectId: 'project-1',
    templates: [
      { templateKey, effective: { selector } },
      {
        templateKey: 'entity_context.work_item.mockup',
        projectOverride: { revisionId: 'project-only-revision' },
        effective: {
          selector: {
            entityType: EntityPromptTemplateSelectorEntityType.WorkItem,
            workItemTypeKey: 'mockup',
          },
        },
      },
    ],
  });

const createOwner = (
  loaded: LoadedEntityPromptContext,
  selector: EntityPromptTemplateSelectorDto,
  response: object,
  templateKey = 'work-item-custom-review',
) => {
  const auth = new SubmissionToolAuth(createTestOAuthClient());
  const loader = new EntityContextLoader({
    auth,
    apiBaseUrl: 'https://api.test.local',
    logger: NOOP_LOGGER,
  });
  const load = vi.spyOn(loader, 'load').mockResolvedValue(loaded);
  const readCatalog = vi.fn().mockResolvedValue({ data: catalogResponse(templateKey, selector) });
  const readEffectiveTemplate = vi.fn().mockResolvedValue({ data: response });
  const client = {
    getProjectEntityPromptTemplateCatalog: readCatalog,
    getEffectiveEntityPromptTemplate: readEffectiveTemplate,
  } as EntityPromptTemplatesApiClient;
  const owner = new AgentStartupPromptInput({
    auth,
    apiBaseUrl: 'https://api.test.local',
    logger: NOOP_LOGGER,
    entityContextLoader: loader,
    createClient: () => client,
  });
  return { owner, load, readCatalog, readEffectiveTemplate };
};

describe('entityPromptTemplateSelectorFor', () => {
  it.each([
    [RunEntityReferenceEntityTypeEnum.Project, EntityPromptTemplateSelectorEntityType.Project],
    [RunEntityReferenceEntityTypeEnum.DesignDoc, EntityPromptTemplateSelectorEntityType.DesignDoc],
    [
      RunEntityReferenceEntityTypeEnum.AgentSession,
      EntityPromptTemplateSelectorEntityType.AgentSession,
    ],
  ] as const)('builds the generated fixed selector for %s', (entityType, expected) => {
    const loaded: LoadedEntityPromptContext = {
      ...loadedWorkItem(),
      focalEntity: runEntity(entityType),
    };
    expect(entityPromptTemplateSelectorFor(loaded)).toEqual({ entityType: expected });
  });

  it('uses the PLAN work-item type key for a canonical TASK identity', () => {
    expect(entityPromptTemplateSelectorFor(loadedWorkItem('PLAN'))).toEqual({
      entityType: EntityPromptTemplateSelectorEntityType.WorkItem,
      workItemTypeKey: 'PLAN',
    });
  });
  it('uses the authoritative generated task.type for project-defined Work Items', () => {
    expect(entityPromptTemplateSelectorFor(loadedWorkItem('CUSTOM_REVIEW'))).toEqual({
      entityType: EntityPromptTemplateSelectorEntityType.WorkItem,
      workItemTypeKey: 'CUSTOM_REVIEW',
    });
  });
});

describe('AgentStartupPromptInput', () => {
  it.each([
    ['canonical default', { scope: 'CANONICAL' as const }, 3],
    ['project override', { scope: 'PROJECT' as const, projectId: 'project-1' }, 8],
  ])(
    'resolves the %s by generated selector and retains immutable provenance',
    async (_label, ownershipSource, revisionNumber) => {
      const loaded = loadedWorkItem();
      const selector = entityPromptTemplateSelectorFor(loaded);
      const templateKey = 'work-item-custom-review';
      const { owner, load, readCatalog, readEffectiveTemplate } = createOwner(
        loaded,
        selector,
        effectiveResponse(
          templateKey,
          selector,
          ownershipSource,
          'Title={{context.displayName}}; Body={{entity.sections.description}}',
          revisionNumber,
        ),
        templateKey,
      );

      const result = await owner.resolve({
        runEntity: runEntity(),
        organizationId: 'organization-1',
        projectId: 'project-1',
      });

      expect(load).toHaveBeenCalledWith({
        runEntity: runEntity(),
        organizationId: 'organization-1',
        projectId: 'project-1',
      });
      expect(readCatalog).toHaveBeenCalledTimes(1);
      expect(readEffectiveTemplate).toHaveBeenCalledTimes(1);
      expect(readEffectiveTemplate).toHaveBeenCalledWith({
        organizationId: 'organization-1',
        projectId: 'project-1',
        templateKey,
      });
      expect(result.renderedInput).toBe(
        'Title=Authoritative work item; Body=Authoritative task description',
      );
      expect(result.loadedEntityContext).toBe(loaded);
      expect(result.provenance).toEqual({
        templateKey,
        ownershipSource,
        revisionId: `revision-${String(revisionNumber)}`,
        revisionNumber,
      });
      expect(result.startupInput.task).toEqual({
        id: 'entity-1',
        taskType: LocalPromptTaskType.Standard,
        description: '',
      });
      expect(result.startupInput.focalEntity).toEqual(runEntity());
      expect(result.startupInput.task).not.toHaveProperty('title');
      expect(result.startupInput.task).not.toHaveProperty('acceptanceCriteria');
    },
  );

  it('derives a generic task subtype from the authoritative work-item read', async () => {
    const loaded = loadedWorkItem(LocalPromptTaskType.Bug);
    const selector = entityPromptTemplateSelectorFor(loaded);
    const templateKey = 'work-item-custom-review';
    const { owner } = createOwner(
      loaded,
      selector,
      effectiveResponse(
        templateKey,
        selector,
        { scope: 'CANONICAL' },
        'Canonical task projection',
        1,
      ),
      templateKey,
    );

    const result = await owner.resolve({
      runEntity: runEntity(),
      organizationId: 'organization-1',
      projectId: 'project-1',
    });

    expect(result.startupInput.task).toEqual({
      id: 'entity-1',
      taskType: LocalPromptTaskType.Bug,
      description: '',
    });
  });

  it('resolves a canonical PLAN Task through its WORK_ITEM selector and rejects legacy PLAN selectors', async () => {
    const loaded = loadedWorkItem('PLAN');
    const selector = entityPromptTemplateSelectorFor(loaded);
    const templateKey = 'work-item-plan';
    const { owner, readCatalog, readEffectiveTemplate } = createOwner(
      loaded,
      selector,
      effectiveResponse(
        templateKey,
        selector,
        { scope: 'CANONICAL' },
        'Plan={{context.displayName}}',
        1,
      ),
      templateKey,
    );

    const result = await owner.resolve({
      runEntity: runEntity(),
      organizationId: 'organization-1',
      projectId: 'project-1',
    });

    expect(selector).toEqual({
      entityType: EntityPromptTemplateSelectorEntityType.WorkItem,
      workItemTypeKey: 'PLAN',
    });
    expect(result.startupInput.focalEntity).toEqual(runEntity());
    expect(result.renderedInput).toBe('Plan=Authoritative work item');
    expect(readCatalog).toHaveBeenCalledOnce();
    expect(readEffectiveTemplate).toHaveBeenCalledWith({
      organizationId: 'organization-1',
      projectId: 'project-1',
      templateKey,
    });

    const legacy = createOwner(
      loaded,
      selector,
      effectiveResponse(templateKey, selector, { scope: 'CANONICAL' }, 'Unused', 1),
      templateKey,
    );
    legacy.readCatalog.mockResolvedValue({
      data: responseEnvelope({
        projectId: 'project-1',
        templates: [{ templateKey, effective: { selector: { entityType: 'PLAN' } } }],
      }),
    });

    await expect(
      legacy.owner.resolve({
        runEntity: runEntity(),
        organizationId: 'organization-1',
        projectId: 'project-1',
      }),
    ).rejects.toThrow(/catalog selector/);
    expect(legacy.readEffectiveTemplate).not.toHaveBeenCalled();
  });

  it('reloads entity Context while reusing a valid effective template revision', async () => {
    const firstLoaded = loadedWorkItem();
    const refreshedEntity = workItem();
    refreshedEntity.name = 'Refreshed work item';
    refreshedEntity.sections = [
      {
        id: 'section-description',
        key: 'description',
        order: 0,
        materializedMarkdown: 'Refreshed task description',
        materializedProposalId: '11111111-1111-4111-8111-111111111111',
      },
    ];
    const refreshedLoaded: LoadedEntityPromptContext = {
      ...loadedWorkItem(),
      entity: refreshedEntity,
      context: {
        ...canonicalContext(),
        displayName: 'Refreshed work item',
        content: {
          sections: {
            description: 'Refreshed task description',
            acceptanceCriteria: 'Refreshed acceptance criteria',
          },
        },
      },
    };
    const selector = entityPromptTemplateSelectorFor(firstLoaded);
    const templateKey = 'work-item-custom-review';
    const { owner, load, readCatalog, readEffectiveTemplate } = createOwner(
      firstLoaded,
      selector,
      effectiveResponse(
        templateKey,
        selector,
        { scope: 'CANONICAL' },
        'Title={{context.displayName}}; Body={{entity.sections.description}}',
        4,
      ),
      templateKey,
    );
    load.mockReset();
    load.mockResolvedValueOnce(firstLoaded).mockResolvedValueOnce(refreshedLoaded);

    const request = {
      runEntity: runEntity(),
      organizationId: 'organization-1',
      projectId: 'project-1',
    };
    const first = await owner.resolve(request);
    expect(first.template).toBeDefined();
    if (!first.template) throw new Error('Expected the resolved effective template.');

    const refreshed = await owner.resolve(request, { cachedTemplate: first.template });

    expect(load).toHaveBeenCalledTimes(2);
    expect(readCatalog).toHaveBeenCalledTimes(1);
    expect(readEffectiveTemplate).toHaveBeenCalledTimes(1);
    expect(refreshed.loadedEntityContext).toBe(refreshedLoaded);
    expect(refreshed.renderedInput).toBe(
      'Title=Refreshed work item; Body=Refreshed task description',
    );
    expect(refreshed.template).toBe(first.template);
    expect(refreshed.provenance).toEqual(first.provenance);
  });

  it('renders an Agent Session through its authoritative read and canonical Context', async () => {
    const loaded = loadedAgentSession();
    const selector = entityPromptTemplateSelectorFor(loaded);
    const templateKey = 'agent-session';
    const { owner } = createOwner(
      loaded,
      selector,
      effectiveResponse(
        templateKey,
        selector,
        { scope: 'CANONICAL' },
        'Session={{entity.title}}; Context={{context.displayName}}',
        2,
      ),
      templateKey,
    );

    await expect(
      owner.resolve({
        runEntity: runEntity(RunEntityReferenceEntityTypeEnum.AgentSession),
        organizationId: 'organization-1',
        projectId: 'project-1',
      }),
    ).resolves.toMatchObject({
      renderedInput: 'Session=Authoritative session; Context=Authoritative work item',
      provenance: { templateKey, revisionId: 'revision-2', revisionNumber: 2 },
    });
  });

  it.each(['PLAN', 'FUTURE_ENTITY'])(
    'ignores unrelated %s catalog selectors for STANDARD startup',
    async (entityType) => {
      const loaded = loadedWorkItem('STANDARD');
      const selector = entityPromptTemplateSelectorFor(loaded);
      const templateKey = 'entity_context.work_item.standard';
      const { owner, readCatalog, readEffectiveTemplate } = createOwner(
        loaded,
        selector,
        effectiveResponse(templateKey, selector, { scope: 'CANONICAL' }, 'Standard prompt', 1),
        templateKey,
      );
      const catalog = catalogResponse(templateKey, selector);
      readCatalog.mockResolvedValue({
        data: {
          ...catalog,
          data: {
            ...catalog.data,
            templates: [
              { templateKey: 'unrelated', effective: { selector: { entityType } } },
              ...catalog.data.templates,
            ],
          },
        },
      });

      await expect(
        owner.resolve({
          runEntity: runEntity(),
          organizationId: 'organization-1',
          projectId: 'project-1',
        }),
      ).resolves.toMatchObject({ renderedInput: 'Standard prompt' });
      expect(readEffectiveTemplate).toHaveBeenCalledExactlyOnceWith({
        organizationId: 'organization-1',
        projectId: 'project-1',
        templateKey,
      });
    },
  );

  it.each(['duplicate', 'wrong-project', 'malformed'] as const)(
    'rejects a %s catalog before reading an effective template',
    async (failure) => {
      const loaded = loadedWorkItem('STANDARD');
      const selector = entityPromptTemplateSelectorFor(loaded);
      const templateKey = 'entity_context.work_item.standard';
      const { owner, readCatalog, readEffectiveTemplate } = createOwner(
        loaded,
        selector,
        effectiveResponse(templateKey, selector, { scope: 'CANONICAL' }, 'Unused', 1),
        templateKey,
      );
      const catalog = catalogResponse(templateKey, selector);
      readCatalog.mockResolvedValue({
        data: {
          ...catalog,
          data: {
            projectId: failure === 'wrong-project' ? 'another-project' : 'project-1',
            templates:
              failure === 'malformed'
                ? null
                : [
                    ...catalog.data.templates,
                    ...(failure === 'duplicate'
                      ? [{ templateKey: 'duplicate', effective: { selector } }]
                      : []),
                  ],
          },
        },
      });
      await expect(
        owner.resolve({
          runEntity: runEntity(),
          organizationId: 'organization-1',
          projectId: 'project-1',
        }),
      ).rejects.toThrow(
        failure === 'malformed' ? /malformed template catalog/ : /catalog selector/,
      );
      expect(readEffectiveTemplate).not.toHaveBeenCalled();
    },
  );

  it('fails closed for an unknown catalog selector or mismatched effective selector', async () => {
    const loaded = loadedWorkItem();
    const selector = entityPromptTemplateSelectorFor(loaded);
    const unknown = createOwner(
      loaded,
      { entityType: EntityPromptTemplateSelectorEntityType.Project },
      effectiveResponse('project', selector, { scope: 'CANONICAL' }, 'Unused', 1),
      'project',
    );
    await expect(
      unknown.owner.resolve({
        runEntity: runEntity(),
        organizationId: 'organization-1',
        projectId: 'project-1',
      }),
    ).rejects.toThrow(/catalog selector/);

    const mismatched = createOwner(
      loaded,
      selector,
      effectiveResponse(
        'work-item-custom-review',
        { entityType: EntityPromptTemplateSelectorEntityType.Project },
        { scope: 'CANONICAL' },
        'Unused',
        1,
      ),
    );
    await expect(
      mismatched.owner.resolve({
        runEntity: runEntity(),
        organizationId: 'organization-1',
        projectId: 'project-1',
      }),
    ).rejects.toThrow(/selector did not match/);
  });
});
