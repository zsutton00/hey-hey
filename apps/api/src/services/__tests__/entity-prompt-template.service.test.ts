import {
  EntityPromptTemplateLifecycleState,
  EntityPromptTemplateOwnershipScope,
  EntityPromptTemplateValidationStatus,
  Prisma,
} from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  ENTITY_PROMPT_TEMPLATE_KEYS,
  ENTITY_PROMPT_TEMPLATE_LANGUAGE_CATALOG,
  ENTITY_PROMPT_TEMPLATE_SELECTOR_BY_KEY,
  EntityPromptTemplateService,
  validateEntityPromptTemplateContent,
} from '../entity-prompt-template.service';
import { OrganizationId, ProjectId } from '../../types';
import { WORK_ITEM_TYPE_KEYS } from '../tasks/work-item-type-keys';

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
const createdAt = new Date('2026-08-18T00:00:00.000Z');
const publishedAt = new Date('2026-08-18T01:00:00.000Z');

type RevisionRow = Prisma.EntityPromptTemplateRevisionGetPayload<{}>;

const makeRevision = (overrides: Partial<RevisionRow> = {}): RevisionRow => ({
  id: 'revision-id',
  templateKey: 'entity_context',
  selector: { entityType: 'PROJECT' },
  syntaxVersion: 'V1',
  revisionNumber: 1,
  content: 'canonical content',
  ownershipScope: EntityPromptTemplateOwnershipScope.CANONICAL,
  projectId: null,
  lifecycleState: EntityPromptTemplateLifecycleState.PUBLISHED,
  validationStatus: EntityPromptTemplateValidationStatus.VALID,
  validationIssues: [],
  validatedAt: createdAt,
  validatorVersion: 'validator-v1',
  createdAt,
  publishedAt,
  retiredAt: null,
  ...overrides,
});

const createSubject = (rows: RevisionRow[]) => {
  const projectFindFirst = jest.fn().mockResolvedValue({ id: projectId });
  const workItemTypeFindMany = jest
    .fn()
    .mockResolvedValue([{ typeKey: 'EXPERIMENT' }]);
  const revisionFindMany = jest.fn().mockResolvedValue(rows);
  const subject = new EntityPromptTemplateService({
    db: {
      project: { findFirst: projectFindFirst },
      workItemType: { findMany: workItemTypeFindMany },
      entityPromptTemplateRevision: { findMany: revisionFindMany },
    },
  } as never);

  return { subject, projectFindFirst, revisionFindMany, workItemTypeFindMany };
};

const createWriteSubject = (rows: RevisionRow[]) => {
  const projectFindFirst = jest.fn().mockResolvedValue({ id: projectId });
  const workItemTypeFindMany = jest
    .fn()
    .mockResolvedValue([{ typeKey: 'EXPERIMENT' }]);
  const revisionFindMany = jest.fn().mockResolvedValue(rows);
  const revisionFindFirst = jest.fn().mockImplementation(({ where }) => {
    const candidates = rows.filter((row) =>
      Object.entries(where).every(
        ([key, value]) => row[key as keyof RevisionRow] === value,
      ),
    );
    return Promise.resolve(
      [...candidates].sort(
        (left, right) => right.revisionNumber - left.revisionNumber,
      )[0] ?? null,
    );
  });
  const revisionCreate = jest.fn().mockImplementation(({ data }) => {
    const revision = makeRevision({
      id: `created-revision-${rows.length + 1}`,
      createdAt: new Date('2026-08-18T02:00:00.000Z'),
      publishedAt: null,
      ...data,
    } as Partial<RevisionRow>);
    rows.push(revision);
    return Promise.resolve(revision);
  });
  const revisionUpdateMany = jest.fn().mockImplementation(({ where, data }) => {
    const revision = rows.find((row) =>
      Object.entries(where).every(
        ([key, value]) => row[key as keyof RevisionRow] === value,
      ),
    );
    if (!revision) {
      return Promise.resolve({ count: 0 });
    }
    Object.assign(revision, data);
    return Promise.resolve({ count: 1 });
  });
  const queryRaw = jest.fn().mockResolvedValue([]);
  const txMock = {
    $queryRaw: queryRaw,
    workItemType: { findMany: workItemTypeFindMany },
    entityPromptTemplateRevision: {
      findFirst: revisionFindFirst,
      findMany: revisionFindMany,
      create: revisionCreate,
      updateMany: revisionUpdateMany,
    },
  };
  let transactionTail: Promise<void> = Promise.resolve();
  const transaction = jest.fn((callback: (tx: unknown) => Promise<unknown>) => {
    const result = transactionTail.then(() => callback(txMock));
    transactionTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  });
  const subject = new EntityPromptTemplateService({
    db: {
      project: { findFirst: projectFindFirst },
      workItemType: { findMany: workItemTypeFindMany },
      entityPromptTemplateRevision: {
        findMany: revisionFindMany,
        findFirst: revisionFindFirst,
        create: revisionCreate,
        updateMany: revisionUpdateMany,
      },
      $transaction: transaction,
    },
  } as never);

  return {
    subject,
    projectFindFirst,
    revisionFindMany,
    revisionFindFirst,
    revisionCreate,
    revisionUpdateMany,
    queryRaw,
    transaction,
    workItemTypeFindMany,
    txMock,
  };
};

describe('EntityPromptTemplateService', () => {
  it('selects an exact custom-type project revision without a canonical revision', async () => {
    const custom = makeRevision({
      id: 'custom-revision-id',
      templateKey: 'entity_context.work_item.experiment',
      selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'EXPERIMENT' },
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
    });
    const { subject, workItemTypeFindMany } = createSubject([custom]);

    await expect(
      subject.getEffectiveTemplate(
        organizationId,
        projectId,
        'entity_context.work_item.experiment',
      ),
    ).resolves.toMatchObject({
      templateKey: 'entity_context.work_item.experiment',
      selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'EXPERIMENT' },
      revisionId: 'custom-revision-id',
      ownershipSource: { scope: 'PROJECT', projectId },
    });
    expect(workItemTypeFindMany).toHaveBeenCalledWith({
      where: {
        projectId,
        lifecycleStatus: 'active',
      },
      select: { typeKey: true },
    });
  });

  it('preserves a lower-case custom selector while validating its derived key', async () => {
    const custom = makeRevision({
      id: 'mockup-revision-id',
      templateKey: 'entity_context.work_item.mockup',
      selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'mockup' },
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
    });
    const fixture = createSubject([custom]);
    fixture.workItemTypeFindMany.mockResolvedValue([{ typeKey: 'mockup' }]);

    await expect(
      fixture.subject.getEffectiveTemplate(
        organizationId,
        projectId,
        'entity_context.work_item.mockup',
      ),
    ).resolves.toMatchObject({
      revisionId: 'mockup-revision-id',
      selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'mockup' },
    });
  });

  it('includes a project-only custom template in the catalog without fabricating a canonical revision', async () => {
    const custom = makeRevision({
      id: 'mockup-revision-id',
      templateKey: 'entity_context.work_item.mockup',
      selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'mockup' },
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
    });

    await expect(
      createSubject([custom]).subject.getProjectCatalog(
        organizationId,
        projectId,
      ),
    ).resolves.toMatchObject({
      templates: [
        {
          templateKey: 'entity_context.work_item.mockup',
          projectOverride: { revisionId: 'mockup-revision-id' },
          effective: {
            revisionId: 'mockup-revision-id',
            selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'mockup' },
          },
        },
      ],
    });
    const catalog = await createSubject([custom]).subject.getProjectCatalog(
      organizationId,
      projectId,
    );
    expect(catalog.templates[0]).not.toHaveProperty('canonicalDefault');
  });

  it('omits retired-only template history from the catalog after a type cutover', async () => {
    const feature = makeRevision({
      id: 'feature-revision-id',
      templateKey: 'entity_context.work_item.feature',
      selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'FEATURE' },
    });
    const retiredWorkflow = makeRevision({
      id: 'retired-workflow-revision-id',
      templateKey: 'entity_context.work_item.workflow',
      selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'workflow' },
      lifecycleState: EntityPromptTemplateLifecycleState.RETIRED,
      publishedAt: null,
      retiredAt: publishedAt,
    });
    const retiredWorkflowStep = makeRevision({
      id: 'retired-workflow-step-revision-id',
      templateKey: 'entity_context.work_item.workflow_step',
      selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'workflow_step' },
      lifecycleState: EntityPromptTemplateLifecycleState.RETIRED,
      publishedAt: null,
      retiredAt: publishedAt,
    });

    const catalog = await createSubject([
      feature,
      retiredWorkflow,
      retiredWorkflowStep,
    ]).subject.getProjectCatalog(organizationId, projectId);

    expect(catalog.templates.map(({ templateKey }) => templateKey)).toEqual([
      'entity_context.work_item.feature',
    ]);
  });

  it('provisions a published exact-key custom revision from effective STANDARD content', async () => {
    const standard = makeRevision({
      id: 'standard-id',
      templateKey: 'entity_context.work_item.standard',
      selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'STANDARD' },
      content: 'Use {{entity.id}} for the work item.',
    });
    const rows = [standard];
    const { subject, revisionCreate, txMock } = createWriteSubject(rows);

    await subject.provisionCustomWorkItemTypeTemplateInTransaction(
      txMock as never,
      projectId,
      'EXPERIMENT',
    );

    expect(revisionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateKey: 'entity_context.work_item.experiment',
        selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'EXPERIMENT' },
        content: standard.content,
        ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
        lifecycleState: EntityPromptTemplateLifecycleState.PUBLISHED,
        validationStatus: EntityPromptTemplateValidationStatus.VALID,
        validatorVersion: 'entity-prompt-template-v1',
      }),
    });
  });

  it('retires an invalid published custom revision before provisioning its repair', async () => {
    const standard = makeRevision({
      id: 'standard-id',
      templateKey: 'entity_context.work_item.standard',
      selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'STANDARD' },
      content: 'Use {{entity.id}} for the work item.',
    });
    const invalidCustom = makeRevision({
      id: 'invalid-custom-id',
      templateKey: 'entity_context.work_item.experiment',
      selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'WRONG' },
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      validationStatus: EntityPromptTemplateValidationStatus.INVALID,
    });
    const { subject, revisionCreate, revisionUpdateMany, txMock } =
      createWriteSubject([invalidCustom, standard]);

    await subject.provisionCustomWorkItemTypeTemplateInTransaction(
      txMock as never,
      projectId,
      'EXPERIMENT',
    );

    expect(revisionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'invalid-custom-id',
        lifecycleState: EntityPromptTemplateLifecycleState.PUBLISHED,
      },
      data: expect.objectContaining({
        lifecycleState: EntityPromptTemplateLifecycleState.RETIRED,
        publishedAt: null,
      }),
    });
    expect(revisionCreate).toHaveBeenCalled();
  });

  it.each([
    ['entity_context.work_item.contract', WORK_ITEM_TYPE_KEYS.Contract],
    ['entity_context.work_item.task_monitor', WORK_ITEM_TYPE_KEYS.TaskMonitor],
    ['entity_context.work_item.mode', WORK_ITEM_TYPE_KEYS.Mode],
    ['entity_context.work_item.eval', WORK_ITEM_TYPE_KEYS.Eval],
    ['entity_context.work_item.eval_case', WORK_ITEM_TYPE_KEYS.EvalCase],
    ['entity_context.work_item.decision', WORK_ITEM_TYPE_KEYS.Decision],
    ['entity_context.work_item.workflow', WORK_ITEM_TYPE_KEYS.Workflow],
    [
      'entity_context.work_item.workflow_step',
      WORK_ITEM_TYPE_KEYS.WorkflowStep,
    ],
  ] as const)(
    'registers %s as a canonical work-item prompt-template selector',
    (templateKey, workItemTypeKey) => {
      expect(ENTITY_PROMPT_TEMPLATE_KEYS).toContain(templateKey);
      expect(ENTITY_PROMPT_TEMPLATE_SELECTOR_BY_KEY[templateKey]).toEqual({
        entityType: 'WORK_ITEM',
        workItemTypeKey,
      });
    },
  );

  describe('canonical MODE selector', () => {
    const modeSelector = {
      entityType: 'WORK_ITEM',
      workItemTypeKey: WORK_ITEM_TYPE_KEYS.Mode,
    };
    const canonicalMode = makeRevision({
      id: 'mode-canonical-id',
      templateKey: 'entity_context.work_item.mode',
      selector: modeSelector,
      content: 'canonical MODE content',
    });
    const canonicalTaskMonitor = makeRevision({
      id: 'task-monitor-canonical-id',
      templateKey: 'entity_context.work_item.task_monitor',
      selector: {
        entityType: 'WORK_ITEM',
        workItemTypeKey: WORK_ITEM_TYPE_KEYS.TaskMonitor,
      },
      content: 'canonical Task Monitor content',
    });

    it('returns the canonical MODE revision when no project override exists', async () => {
      const { subject } = createSubject([canonicalTaskMonitor, canonicalMode]);

      await expect(
        subject.getEffectiveTemplate(
          organizationId,
          projectId,
          'entity_context.work_item.mode',
        ),
      ).resolves.toMatchObject({
        templateKey: 'entity_context.work_item.mode',
        selector: modeSelector,
        revisionId: 'mode-canonical-id',
        ownershipSource: { scope: 'CANONICAL' },
      });
    });

    it('does not fall back to another work-item type without a MODE revision', async () => {
      const { subject } = createSubject([canonicalTaskMonitor]);

      await expect(
        subject.getEffectiveTemplate(
          organizationId,
          projectId,
          'entity_context.work_item.mode',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('prefers a published project MODE override over the canonical revision', async () => {
      const override = makeRevision({
        id: 'mode-override-id',
        templateKey: 'entity_context.work_item.mode',
        selector: modeSelector,
        ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
        projectId,
        revisionNumber: 2,
        content: 'project MODE content',
      });
      const { subject } = createSubject([canonicalMode, override]);

      await expect(
        subject.getEffectiveTemplate(
          organizationId,
          projectId,
          'entity_context.work_item.mode',
        ),
      ).resolves.toMatchObject({
        revisionId: 'mode-override-id',
        ownershipSource: { scope: 'PROJECT', projectId },
      });
    });

    it('lists MODE in the catalog with its canonical default', async () => {
      const { subject } = createSubject([canonicalMode]);
      const catalog = await subject.getProjectCatalog(
        organizationId,
        projectId,
      );

      expect(
        catalog.templates.find(
          (template) =>
            template.templateKey === 'entity_context.work_item.mode',
        ),
      ).toMatchObject({
        canonicalDefault: { selector: modeSelector },
        effective: { revisionId: 'mode-canonical-id' },
      });
    });
  });

  it('projects canonical Contract and workflow-step revisions through the catalog lifecycle', async () => {
    const contract = makeRevision({
      id: 'contract-canonical-id',
      templateKey: 'entity_context.work_item.contract',
      selector: {
        entityType: 'WORK_ITEM',
        workItemTypeKey: WORK_ITEM_TYPE_KEYS.Contract,
      },
      content: 'canonical Contract content',
    });
    const workflowStep = makeRevision({
      id: 'workflow-step-canonical-id',
      templateKey: 'entity_context.work_item.workflow_step',
      selector: {
        entityType: 'WORK_ITEM',
        workItemTypeKey: WORK_ITEM_TYPE_KEYS.WorkflowStep,
      },
      content: 'canonical workflow-step content',
    });
    const { subject } = createSubject([contract, workflowStep]);

    await expect(
      subject.getProjectCatalog(organizationId, projectId),
    ).resolves.toMatchObject({
      templates: [
        {
          templateKey: 'entity_context.work_item.contract',
          canonicalDefault: {
            selector: {
              entityType: 'WORK_ITEM',
              workItemTypeKey: WORK_ITEM_TYPE_KEYS.Contract,
            },
            lifecycleState: EntityPromptTemplateLifecycleState.PUBLISHED,
          },
          effective: {
            revisionId: 'contract-canonical-id',
            ownershipSource: { scope: 'CANONICAL' },
          },
        },
        {
          templateKey: 'entity_context.work_item.workflow_step',
          canonicalDefault: {
            selector: {
              entityType: 'WORK_ITEM',
              workItemTypeKey: WORK_ITEM_TYPE_KEYS.WorkflowStep,
            },
            lifecycleState: EntityPromptTemplateLifecycleState.PUBLISHED,
          },
          effective: {
            revisionId: 'workflow-step-canonical-id',
            ownershipSource: { scope: 'CANONICAL' },
          },
        },
      ],
    });
  });

  it('returns a project-scoped catalog and selects the eligible project revision', async () => {
    const canonical = makeRevision({ id: 'canonical-id' });
    const projectDraft = makeRevision({
      id: 'project-draft-id',
      revisionNumber: 1,
      content: 'draft override',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      lifecycleState: EntityPromptTemplateLifecycleState.DRAFT,
      validationStatus: EntityPromptTemplateValidationStatus.INVALID,
      validationIssues: [
        { code: 'DRAFT_ONLY', path: 'content', message: 'draft only' },
      ],
      publishedAt: null,
    });
    const projectPublished = makeRevision({
      id: 'project-published-id',
      revisionNumber: 2,
      content: 'published override',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
    });
    const { subject, projectFindFirst, revisionFindMany } = createSubject([
      projectPublished,
      projectDraft,
      canonical,
    ]);

    await expect(
      subject.getProjectCatalog(organizationId, projectId),
    ).resolves.toMatchObject({
      projectId,
      templates: [
        {
          templateKey: 'entity_context',
          canonicalDefault: { content: 'canonical content' },
          projectOverride: { content: 'published override', revisionNumber: 2 },
          effective: {
            content: 'published override',
            ownershipSource: { scope: 'PROJECT', projectId },
            revisionId: 'project-published-id',
          },
          revisionHistory: [
            { revisionId: 'project-published-id' },
            { revisionId: 'project-draft-id' },
            { revisionId: 'canonical-id' },
          ],
        },
      ],
    });
    expect(projectFindFirst).toHaveBeenCalledWith({
      where: { id: projectId, organizationId },
      select: { id: true },
    });
    expect(revisionFindMany).toHaveBeenCalledTimes(1);
  });

  it('publishes a proposal payload atomically without creating a draft row', async () => {
    const canonical = makeRevision({
      id: '33333333-3333-4333-8333-333333333333',
    });
    const {
      subject,
      revisionFindFirst,
      revisionFindMany,
      revisionCreate,
      revisionUpdateMany,
    } = createWriteSubject([canonical]);

    const result = await subject.enactProposalInTransaction(
      {
        $queryRaw: jest.fn().mockResolvedValue([]),
        entityPromptTemplateRevision: {
          findMany: revisionFindMany,
          findFirst: revisionFindFirst,
          create: revisionCreate,
          updateMany: revisionUpdateMany,
        },
      } as never,
      projectId,
      'entity_context',
      {
        operation: 'UPSERT',
        projectId,
        selector: { entityType: 'PROJECT' },
        syntaxVersion: 'V1',
        content: 'Use {{entity.id}} in the approved project context.',
        expectedEffectiveRevision: {
          revisionId: canonical.id,
          revisionNumber: canonical.revisionNumber,
        },
      },
    );

    expect(revisionUpdateMany).not.toHaveBeenCalled();
    expect(revisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lifecycleState: EntityPromptTemplateLifecycleState.PUBLISHED,
          validationStatus: EntityPromptTemplateValidationStatus.VALID,
          selector: { entityType: 'PROJECT' },
          syntaxVersion: 'V1',
        }),
      }),
    );
    expect(result.revision.lifecycleState).toBe('PUBLISHED');
  });

  it('rejects a stale proposal applicability token before writing template state', async () => {
    const canonical = makeRevision({
      id: '33333333-3333-4333-8333-333333333333',
    });
    const {
      subject,
      revisionFindFirst,
      revisionFindMany,
      revisionCreate,
      revisionUpdateMany,
    } = createWriteSubject([canonical]);

    await expect(
      subject.enactProposalInTransaction(
        {
          $queryRaw: jest.fn().mockResolvedValue([]),
          entityPromptTemplateRevision: {
            findMany: revisionFindMany,
            findFirst: revisionFindFirst,
            create: revisionCreate,
            updateMany: revisionUpdateMany,
          },
        } as never,
        projectId,
        'entity_context',
        {
          operation: 'UPSERT',
          projectId,
          selector: { entityType: 'PROJECT' },
          syntaxVersion: 'V1',
          content: 'Use {{entity.id}} in the approved project context.',
          expectedEffectiveRevision: {
            revisionId: '44444444-4444-4444-8444-444444444444',
            revisionNumber: canonical.revisionNumber,
          },
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(revisionCreate).not.toHaveBeenCalled();
    expect(revisionUpdateMany).not.toHaveBeenCalled();
  });

  it('falls back to the canonical revision when the project override is ineligible', async () => {
    const canonical = makeRevision({ id: 'canonical-id' });
    const projectDraft = makeRevision({
      id: 'project-draft-id',
      content: 'draft override',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      lifecycleState: EntityPromptTemplateLifecycleState.DRAFT,
      publishedAt: null,
    });
    const { subject } = createSubject([projectDraft, canonical]);

    await expect(
      subject.getEffectiveTemplate(organizationId, projectId, 'entity_context'),
    ).resolves.toMatchObject({
      content: 'canonical content',
      ownershipSource: { scope: 'CANONICAL' },
      revisionId: 'canonical-id',
    });
  });

  it('fails fast when persisted validation issues are malformed', async () => {
    const { subject } = createSubject([
      makeRevision({ validationIssues: [{ path: 42, message: 'invalid' }] }),
    ] as unknown as RevisionRow[]);

    await expect(
      subject.getProjectCatalog(organizationId, projectId),
    ).rejects.toThrow('validation issue is malformed');
  });

  it('rejects unsupported template keys without querying revisions', async () => {
    const { subject, revisionFindMany } = createSubject([]);

    await expect(
      subject.getEffectiveTemplate(organizationId, projectId, 'unknown'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(revisionFindMany).not.toHaveBeenCalled();
  });

  it('validates template syntax and supported input paths', () => {
    expect(
      validateEntityPromptTemplateContent(
        'Use {{entity.name}} and {{context.entityId}}',
      ),
    ).toEqual([]);
    expect(
      validateEntityPromptTemplateContent('Use {{context.projectId}}'),
    ).toEqual([
      expect.objectContaining({ code: 'UNSUPPORTED_INPUT', path: 'content' }),
    ]);
    expect(validateEntityPromptTemplateContent('Use {{entity.name}')).toEqual([
      expect.objectContaining({
        code: 'UNMATCHED_OPENING_DELIMITER',
        path: 'content',
      }),
    ]);
  });

  it('publishes the generated structured V1 catalog to project catalog consumers', async () => {
    const structuredPaths = [
      'entity.sections',
      'context.relatedEntities',
      'context.featureHierarchy',
      'context.proposals',
      'context.agentSessions',
    ];

    for (const path of structuredPaths) {
      expect(ENTITY_PROMPT_TEMPLATE_LANGUAGE_CATALOG.supportedPaths).toContain(
        path,
      );
      expect(validateEntityPromptTemplateContent(`Use {{${path}}}`)).toEqual(
        [],
      );
    }

    await expect(
      createSubject([makeRevision()]).subject.getProjectCatalog(
        organizationId,
        projectId,
      ),
    ).resolves.toMatchObject({
      language: {
        syntaxVersion: 'V1',
        supportedPaths: expect.arrayContaining(structuredPaths),
        missingPathBehavior: 'ERROR',
        malformedSubstitutionBehavior: 'ERROR',
      },
    });
  });

  it('allocates monotonic project revisions atomically and leaves prior content immutable', async () => {
    const existing = makeRevision({
      id: 'existing-project-revision',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      revisionNumber: 4,
      content: 'existing content',
      lifecycleState: EntityPromptTemplateLifecycleState.DRAFT,
      validationStatus: EntityPromptTemplateValidationStatus.UNVALIDATED,
      validatedAt: null,
      validatorVersion: null,
      publishedAt: null,
    });
    const rows = [existing];
    const { subject, revisionCreate, queryRaw } = createWriteSubject(rows);

    const [first, second] = await Promise.all([
      subject.createProjectEntityPromptTemplateDraft(
        organizationId,
        projectId,
        'entity_context',
        { content: 'first draft' },
      ),
      subject.createProjectEntityPromptTemplateDraft(
        organizationId,
        projectId,
        'entity_context',
        { content: 'second draft' },
      ),
    ]);

    expect([first.revisionNumber, second.revisionNumber].sort()).toEqual([
      5, 6,
    ]);
    expect([first.content, second.content].sort()).toEqual([
      'first draft',
      'second draft',
    ]);
    expect(first).toMatchObject({
      lifecycleState: 'DRAFT',
      validation: { status: 'UNVALIDATED', issues: [] },
    });
    expect(second).toMatchObject({
      lifecycleState: 'DRAFT',
      validation: { status: 'UNVALIDATED', issues: [] },
    });
    expect(existing.content).toBe('existing content');
    expect(revisionCreate).toHaveBeenCalledTimes(2);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    const lockQuery = queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
    expect(lockQuery.strings.join(' ')).toContain(
      'SELECT 1::integer AS "acquired"',
    );
  });

  it('persists valid and invalid validation outcomes and supports repeat validation', async () => {
    const validRevision = makeRevision({
      id: 'valid-project-revision',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      lifecycleState: EntityPromptTemplateLifecycleState.DRAFT,
      validationStatus: EntityPromptTemplateValidationStatus.UNVALIDATED,
      validationIssues: [],
      content: 'Use {{entity.name}}',
      publishedAt: null,
      validatedAt: null,
      validatorVersion: null,
    });
    const invalidRevision = makeRevision({
      id: 'invalid-project-revision',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      revisionNumber: 2,
      lifecycleState: EntityPromptTemplateLifecycleState.DRAFT,
      validationStatus: EntityPromptTemplateValidationStatus.UNVALIDATED,
      validationIssues: [],
      content: 'Use {{unknown.value}}',
      publishedAt: null,
      validatedAt: null,
      validatorVersion: null,
    });
    const rows = [validRevision, invalidRevision];
    const { subject, revisionUpdateMany } = createWriteSubject(rows);

    await expect(
      subject.validateProjectEntityPromptTemplateRevision(
        organizationId,
        projectId,
        'entity_context',
        validRevision.id,
      ),
    ).resolves.toMatchObject({
      revisionId: validRevision.id,
      content: 'Use {{entity.name}}',
      lifecycleState: 'DRAFT',
      validation: { status: 'VALID', issues: [] },
    });

    const invalidResult =
      await subject.validateProjectEntityPromptTemplateRevision(
        organizationId,
        projectId,
        'entity_context',
        invalidRevision.id,
      );
    expect(invalidResult).toMatchObject({
      revisionId: invalidRevision.id,
      content: 'Use {{unknown.value}}',
      lifecycleState: 'DRAFT',
      validation: {
        status: 'INVALID',
        issues: [expect.objectContaining({ code: 'UNSUPPORTED_INPUT' })],
      },
    });

    const contentBeforeRepeat = invalidRevision.content;
    await subject.validateProjectEntityPromptTemplateRevision(
      organizationId,
      projectId,
      'entity_context',
      invalidRevision.id,
    );
    expect(invalidRevision.content).toBe(contentBeforeRepeat);
    expect(revisionUpdateMany).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['foreign project', { projectId: '33333333-3333-4333-8333-333333333333' }],
    ['mismatched key', { templateKey: 'other_template' }],
  ])(
    'rejects %s revision access without a guarded write',
    async (_label, overrides) => {
      const revision = makeRevision({
        id: 'mismatch-revision',
        ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
        projectId,
        lifecycleState: EntityPromptTemplateLifecycleState.DRAFT,
        validationStatus: EntityPromptTemplateValidationStatus.UNVALIDATED,
        validationIssues: [],
        publishedAt: null,
        ...overrides,
      });
      const { subject, revisionUpdateMany } = createWriteSubject([revision]);

      await expect(
        subject.validateProjectEntityPromptTemplateRevision(
          organizationId,
          projectId,
          'entity_context',
          revision.id,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(revisionUpdateMany).not.toHaveBeenCalled();
    },
  );

  it('preserves the effective project selection when validation is invalid', async () => {
    const canonical = makeRevision({ id: 'canonical-id' });
    const publishedOverride = makeRevision({
      id: 'published-override-id',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      revisionNumber: 2,
      content: 'published override',
    });
    const draft = makeRevision({
      id: 'draft-id',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      revisionNumber: 3,
      content: 'Use {{unknown.value}}',
      lifecycleState: EntityPromptTemplateLifecycleState.DRAFT,
      validationStatus: EntityPromptTemplateValidationStatus.UNVALIDATED,
      validationIssues: [],
      publishedAt: null,
      validatedAt: null,
      validatorVersion: null,
    });
    const rows = [publishedOverride, draft, canonical];
    const { subject } = createWriteSubject(rows);

    const before = await subject.getEffectiveTemplate(
      organizationId,
      projectId,
      'entity_context',
    );
    await subject.validateProjectEntityPromptTemplateRevision(
      organizationId,
      projectId,
      'entity_context',
      draft.id,
    );
    const after = await subject.getEffectiveTemplate(
      organizationId,
      projectId,
      'entity_context',
    );

    expect(after).toEqual(before);
  });

  it('publishes a valid project revision atomically and returns project provenance', async () => {
    const canonical = makeRevision({ id: 'canonical-id' });
    const previousPublished = makeRevision({
      id: 'previous-published-id',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      revisionNumber: 2,
      content: 'previous override',
    });
    const target = makeRevision({
      id: 'target-id',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      revisionNumber: 3,
      content: 'target override',
      lifecycleState: EntityPromptTemplateLifecycleState.DRAFT,
      validationStatus: EntityPromptTemplateValidationStatus.VALID,
      publishedAt: null,
      validatedAt: createdAt,
    });
    const rows = [target, previousPublished, canonical];
    const { subject, revisionUpdateMany, queryRaw } = createWriteSubject(rows);

    const result = await subject.publishProjectEntityPromptTemplateRevision(
      organizationId,
      projectId,
      'entity_context',
      target.id,
    );

    expect(result).toMatchObject({
      revision: {
        revisionId: 'target-id',
        content: 'target override',
        lifecycleState: 'PUBLISHED',
        ownershipScope: { scope: 'PROJECT', projectId },
      },
      effective: {
        content: 'target override',
        revisionId: 'target-id',
        ownershipSource: { scope: 'PROJECT', projectId },
      },
    });
    expect(previousPublished.lifecycleState).toBe(
      EntityPromptTemplateLifecycleState.RETIRED,
    );
    expect(target.lifecycleState).toBe(
      EntityPromptTemplateLifecycleState.PUBLISHED,
    );
    expect(
      rows.filter(
        (row) =>
          row.ownershipScope === EntityPromptTemplateOwnershipScope.PROJECT &&
          row.lifecycleState === EntityPromptTemplateLifecycleState.PUBLISHED,
      ),
    ).toHaveLength(1);
    expect(revisionUpdateMany).toHaveBeenCalledTimes(2);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'unvalidated',
      {
        validationStatus: EntityPromptTemplateValidationStatus.UNVALIDATED,
      },
    ],
    [
      'invalid',
      { validationStatus: EntityPromptTemplateValidationStatus.INVALID },
    ],
    [
      'already published',
      {
        lifecycleState: EntityPromptTemplateLifecycleState.PUBLISHED,
        validationStatus: EntityPromptTemplateValidationStatus.VALID,
      },
    ],
    [
      'retired',
      {
        lifecycleState: EntityPromptTemplateLifecycleState.RETIRED,
        validationStatus: EntityPromptTemplateValidationStatus.VALID,
      },
    ],
  ])(
    'rejects %s publication without changing the effective revision',
    async (_label, overrides) => {
      const canonical = makeRevision({ id: 'canonical-id' });
      const targetLifecycleState =
        'lifecycleState' in overrides
          ? overrides.lifecycleState
          : EntityPromptTemplateLifecycleState.DRAFT;
      const target = makeRevision({
        id: 'target-id',
        ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
        projectId,
        content: 'ineligible override',
        lifecycleState: EntityPromptTemplateLifecycleState.DRAFT,
        publishedAt:
          targetLifecycleState === EntityPromptTemplateLifecycleState.PUBLISHED
            ? publishedAt
            : null,
        ...overrides,
      });
      const { subject, revisionUpdateMany } = createWriteSubject([
        target,
        canonical,
      ]);

      await expect(
        subject.publishProjectEntityPromptTemplateRevision(
          organizationId,
          projectId,
          'entity_context',
          target.id,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(revisionUpdateMany).not.toHaveBeenCalled();
      await expect(
        subject.getEffectiveTemplate(
          organizationId,
          projectId,
          'entity_context',
        ),
      ).resolves.toMatchObject({
        revisionId:
          targetLifecycleState === EntityPromptTemplateLifecycleState.PUBLISHED
            ? 'target-id'
            : 'canonical-id',
      });
    },
  );

  it.each([
    ['canonical revision', makeRevision({ id: 'canonical-id' })],
    [
      'foreign project revision',
      makeRevision({
        id: 'foreign-id',
        ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
        projectId: '33333333-3333-4333-8333-333333333333' as ProjectId,
        lifecycleState: EntityPromptTemplateLifecycleState.DRAFT,
        validationStatus: EntityPromptTemplateValidationStatus.VALID,
        publishedAt: null,
      }),
    ],
    [
      'mismatched key revision',
      makeRevision({
        id: 'mismatched-key-id',
        templateKey: 'other_template',
        ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
        projectId,
        lifecycleState: EntityPromptTemplateLifecycleState.DRAFT,
        validationStatus: EntityPromptTemplateValidationStatus.VALID,
        publishedAt: null,
      }),
    ],
  ])(
    'rejects %s publication as missing scope without a guarded write',
    async (_label, target) => {
      const canonical = makeRevision({ id: 'canonical-id' });
      const { subject, revisionUpdateMany } = createWriteSubject([
        target,
        canonical,
      ]);

      await expect(
        subject.publishProjectEntityPromptTemplateRevision(
          organizationId,
          projectId,
          'entity_context',
          target.id,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(revisionUpdateMany).not.toHaveBeenCalled();
    },
  );

  it('retires the active override only after verifying canonical fallback', async () => {
    const canonical = makeRevision({ id: 'canonical-id' });
    const active = makeRevision({
      id: 'active-id',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      revisionNumber: 2,
      content: 'active override',
    });
    const rows = [active, canonical];
    const { subject, revisionUpdateMany, queryRaw } = createWriteSubject(rows);

    const result = await subject.retireProjectEntityPromptTemplateOverride(
      organizationId,
      projectId,
      'entity_context',
    );

    expect(result).toMatchObject({
      revision: {
        revisionId: 'active-id',
        lifecycleState: 'RETIRED',
        content: 'active override',
      },
      effective: {
        revisionId: 'canonical-id',
        content: 'canonical content',
        ownershipSource: { scope: 'CANONICAL' },
      },
    });
    expect(active.lifecycleState).toBe(
      EntityPromptTemplateLifecycleState.RETIRED,
    );
    expect(revisionUpdateMany).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    await expect(
      subject.retireProjectEntityPromptTemplateOverride(
        organizationId,
        projectId,
        'entity_context',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revisionUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('leaves the active override unchanged when canonical fallback is unavailable', async () => {
    const active = makeRevision({
      id: 'active-id',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      content: 'active override',
    });
    const { subject, revisionUpdateMany } = createWriteSubject([active]);

    await expect(
      subject.retireProjectEntityPromptTemplateOverride(
        organizationId,
        projectId,
        'entity_context',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(active.lifecycleState).toBe(
      EntityPromptTemplateLifecycleState.PUBLISHED,
    );
    expect(revisionUpdateMany).not.toHaveBeenCalled();
  });

  it('leaves the active override unchanged when guarded retirement loses a race', async () => {
    const canonical = makeRevision({ id: 'canonical-id' });
    const active = makeRevision({
      id: 'active-id',
      ownershipScope: EntityPromptTemplateOwnershipScope.PROJECT,
      projectId,
      content: 'active override',
    });
    const { subject, revisionUpdateMany } = createWriteSubject([
      active,
      canonical,
    ]);
    revisionUpdateMany.mockImplementationOnce(() =>
      Promise.resolve({ count: 0 }),
    );

    await expect(
      subject.retireProjectEntityPromptTemplateOverride(
        organizationId,
        projectId,
        'entity_context',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(active.lifecycleState).toBe(
      EntityPromptTemplateLifecycleState.PUBLISHED,
    );
  });
});

describe('non-persisting template draft validation', () => {
  it.each([
    '{{ entity.name }}\r\n\t',
    '{{entity.sections.details}}',
    '{{unsupported}}',
    '{{entity.name',
    '',
  ])(
    'uses authoritative validation without mutations for %j',
    async (content) => {
      const rows = [makeRevision()];
      const before = structuredClone(rows);
      const { subject, revisionCreate, revisionUpdateMany, transaction } =
        createWriteSubject(rows);
      const issues = validateEntityPromptTemplateContent(content, 'V1');
      await expect(
        subject.validateDraft(organizationId, projectId, 'entity_context', {
          selector: { entityType: 'PROJECT' },
          syntaxVersion: 'V1',
          content,
        }),
      ).resolves.toEqual({
        status: issues.length ? 'INVALID' : 'VALID',
        issues,
      });
      expect(rows).toEqual(before);
      expect(revisionCreate).not.toHaveBeenCalled();
      expect(revisionUpdateMany).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('rejects unauthorized projects and mismatched selectors', async () => {
    const { subject, projectFindFirst, revisionFindMany } = createSubject([
      makeRevision(),
    ]);
    const request = {
      selector: { entityType: 'WORK_ITEM' as const, workItemTypeKey: 'PLAN' },
      syntaxVersion: 'V1' as const,
      content: 'draft',
    };
    await expect(
      subject.validateDraft(
        organizationId,
        projectId,
        'entity_context',
        request,
      ),
    ).rejects.toThrow('selector');
    revisionFindMany.mockClear();
    projectFindFirst.mockResolvedValue(null);
    await expect(
      subject.validateDraft(
        organizationId,
        projectId,
        'entity_context',
        request,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(revisionFindMany).not.toHaveBeenCalled();
  });
});
