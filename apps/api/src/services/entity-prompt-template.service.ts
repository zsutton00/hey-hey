import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityPromptTemplateLifecycleState as PrismaLifecycleState,
  EntityPromptTemplateOwnershipScope as PrismaOwnershipScope,
  EntityPromptTemplateValidationStatus as PrismaValidationStatus,
  Prisma,
} from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import type {
  EntityPromptTemplateDraftValidationRequestDto,
  EntityPromptTemplateDraftValidationResultDto,
  EntityPromptTemplateCatalogDto,
  EntityPromptTemplateCatalogEntryDto,
  EntityPromptTemplateEffectiveDto,
  EntityPromptTemplateLanguageDto,
  EntityPromptTemplateProjectRevisionDto,
  EntityPromptTemplateProposalUpdatesPayload,
  EntityPromptTemplateRevisionDto,
  EntityPromptTemplateSelectorDto,
  EntityPromptTemplateSyntaxVersion,
  EntityPromptTemplateUpsertUpdatesPayload,
  EntityPromptTemplateValidationIssueDto,
  EntityPromptTemplateValidationMetadataDto,
} from '../generated';
import {
  ENTITY_PROMPT_TEMPLATE_LANGUAGES,
  type EntityPromptTemplateLanguage,
} from '../generated/entity-prompt-template-language';
import type { OrganizationId, ProjectId } from '../types';
import { PrismaService, AnyTransactionClient } from '../prisma/prisma.service';
import { WORK_ITEM_TYPE_KEYS } from './tasks/work-item-type-keys';
import {
  entityPromptTemplateProposalUpdatesSchema,
  entityPromptTemplateSelectorSchema,
  entityPromptTemplateSyntaxVersionSchema,
  entityPromptTemplateKeyForWorkItemType,
  workItemTypeKeyFromEntityPromptTemplateKey,
} from './entity-prompt-template.contract';

export const ENTITY_PROMPT_TEMPLATE_KEYS = [
  'entity_context.project',
  'entity_context.work_item.plan',
  'entity_context.work_item.plan_stage',
  'entity_context.design_doc',
  'entity_context.agent_session',
  'entity_context.work_item.standard',
  'entity_context.work_item.feature',
  'entity_context.work_item.goal',
  'entity_context.work_item.bug',
  'entity_context.work_item.contract',
  'entity_context.work_item.task_monitor',
  'entity_context.work_item.mode',
  'entity_context.work_item.workflow',
  'entity_context.work_item.workflow_step',
  'entity_context.work_item.diagram',
  'entity_context.work_item.diagram_element',
  'entity_context.work_item.eval',
  'entity_context.work_item.eval_case',
  'entity_context.work_item.decision',
] as const;
export type EntityPromptTemplateKey = string;

export const ENTITY_PROMPT_TEMPLATE_SELECTOR_BY_KEY: Readonly<
  Record<
    (typeof ENTITY_PROMPT_TEMPLATE_KEYS)[number],
    EntityPromptTemplateSelectorDto
  >
> = {
  'entity_context.project': { entityType: 'PROJECT' },
  'entity_context.work_item.plan': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: 'PLAN',
  },
  'entity_context.work_item.plan_stage': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: 'PLAN_STAGE',
  },
  'entity_context.design_doc': { entityType: 'DESIGN_DOC' },
  'entity_context.agent_session': { entityType: 'AGENT_SESSION' },
  'entity_context.work_item.standard': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: 'STANDARD',
  },
  'entity_context.work_item.feature': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: 'FEATURE',
  },
  'entity_context.work_item.goal': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: 'GOAL',
  },
  'entity_context.work_item.bug': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: 'BUG',
  },
  'entity_context.work_item.contract': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: WORK_ITEM_TYPE_KEYS.Contract,
  },
  'entity_context.work_item.task_monitor': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: WORK_ITEM_TYPE_KEYS.TaskMonitor,
  },
  'entity_context.work_item.mode': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: WORK_ITEM_TYPE_KEYS.Mode,
  },
  'entity_context.work_item.workflow': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: WORK_ITEM_TYPE_KEYS.Workflow,
  },
  'entity_context.work_item.workflow_step': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: WORK_ITEM_TYPE_KEYS.WorkflowStep,
  },
  'entity_context.work_item.diagram': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: WORK_ITEM_TYPE_KEYS.Diagram,
  },
  'entity_context.work_item.diagram_element': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: WORK_ITEM_TYPE_KEYS.DiagramElement,
  },
  'entity_context.work_item.eval': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: WORK_ITEM_TYPE_KEYS.Eval,
  },
  'entity_context.work_item.eval_case': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: WORK_ITEM_TYPE_KEYS.EvalCase,
  },
  'entity_context.work_item.decision': {
    entityType: 'WORK_ITEM',
    workItemTypeKey: WORK_ITEM_TYPE_KEYS.Decision,
  },
};

type LegacyDraftRequest = Pick<
  EntityPromptTemplateUpsertUpdatesPayload,
  'content'
>;

export type EntityPromptTemplateLifecycleMutationResult = {
  revision: EntityPromptTemplateProjectRevisionDto;
  effective: EntityPromptTemplateEffectiveDto;
};

export const ENTITY_PROMPT_TEMPLATE_VALIDATOR_VERSION =
  'entity-prompt-template-v1';

const entityPromptTemplateLanguage = ENTITY_PROMPT_TEMPLATE_LANGUAGES.V1;
export const ENTITY_PROMPT_TEMPLATE_LANGUAGE_CATALOG: EntityPromptTemplateLanguageDto =
  {
    authoring: entityPromptTemplateLanguage.authoring,
    syntaxVersion: entityPromptTemplateLanguage.syntaxVersion,
    supportedPaths: [...entityPromptTemplateLanguage.supportedPaths],
    pathFamilies: entityPromptTemplateLanguage.pathFamilies.map((family) => ({
      template: family.template,
      pattern: family.pattern,
    })),
    missingPathBehavior: entityPromptTemplateLanguage.missingPathBehavior,
    malformedSubstitutionBehavior:
      entityPromptTemplateLanguage.malformedSubstitutionBehavior,
    malformedSubstitutions: [
      ...entityPromptTemplateLanguage.malformedSubstitutions,
    ],
  };

const TEMPLATE_INPUT_PATH_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

const isSupportedTemplateInputPath = (
  inputPath: string,
  language: EntityPromptTemplateLanguage,
): boolean =>
  TEMPLATE_INPUT_PATH_PATTERN.test(inputPath) &&
  (language.supportedPaths.includes(inputPath) ||
    language.pathFamilies.some((family) =>
      new RegExp(family.pattern, 'u').test(inputPath),
    ));

export function validateEntityPromptTemplateContent(
  content: string,
  syntaxVersion: EntityPromptTemplateSyntaxVersion = 'V1',
): EntityPromptTemplateValidationIssueDto[] {
  const issues: EntityPromptTemplateValidationIssueDto[] = [];

  if (
    !entityPromptTemplateSyntaxVersionSchema.safeParse(syntaxVersion).success
  ) {
    issues.push({
      code: 'UNSUPPORTED_SYNTAX_VERSION',
      path: 'syntaxVersion',
      message: `Unsupported entity prompt-template syntax version: ${syntaxVersion}.`,
    });
    return issues;
  }

  const language = ENTITY_PROMPT_TEMPLATE_LANGUAGES[syntaxVersion];

  if (content.length === 0) {
    issues.push({
      code: 'EMPTY_CONTENT',
      path: 'content',
      message: 'Template content must not be empty.',
    });
    return issues;
  }

  let cursor = 0;
  while (cursor < content.length) {
    const openingIndex = content.indexOf('{{', cursor);
    const closingIndex = content.indexOf('}}', cursor);

    if (
      closingIndex !== -1 &&
      (openingIndex === -1 || closingIndex < openingIndex)
    ) {
      issues.push({
        code: 'UNMATCHED_CLOSING_DELIMITER',
        path: 'content',
        message: 'Template input expressions must start with {{.',
      });
      cursor = closingIndex + 2;
      continue;
    }

    if (openingIndex === -1) {
      break;
    }

    const expressionEnd = content.indexOf('}}', openingIndex + 2);
    if (expressionEnd === -1) {
      issues.push({
        code: 'UNMATCHED_OPENING_DELIMITER',
        path: 'content',
        message: 'Template input expressions must end with }}.',
      });
      break;
    }

    const inputPath = content.slice(openingIndex + 2, expressionEnd).trim();
    if (!TEMPLATE_INPUT_PATH_PATTERN.test(inputPath)) {
      issues.push({
        code: 'INVALID_INPUT_SYNTAX',
        path: 'content',
        message:
          'Template inputs must be dotted paths containing letters, numbers, underscores, hyphens, or periods.',
      });
    } else if (!isSupportedTemplateInputPath(inputPath, language)) {
      issues.push({
        code: 'UNSUPPORTED_INPUT',
        path: 'content',
        message: `Template input ${inputPath} is not supported for entity prompt templates.`,
      });
    }

    cursor = expressionEnd + 2;
  }

  return issues;
}

type RevisionRow = Prisma.EntityPromptTemplateRevisionGetPayload<{}>;

type AdvisoryLockClient = {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
};

type RevisionReadClient = Pick<
  AnyTransactionClient,
  'entityPromptTemplateRevision'
>;

@Injectable()
export class EntityPromptTemplateService {
  private readonly logger = new Logger(EntityPromptTemplateService.name);

  public constructor(private readonly prisma: PrismaService) {}

  public async validateDraft(
    organizationId: OrganizationId,
    projectId: ProjectId,
    templateKey: string,
    request: EntityPromptTemplateDraftValidationRequestDto,
  ): Promise<EntityPromptTemplateDraftValidationResultDto> {
    const effective = await this.getEffectiveTemplate(
      organizationId,
      projectId,
      templateKey,
    );
    if (!isDeepStrictEqual(effective.selector, request.selector)) {
      throw new BadRequestException(
        'Template selector does not match the effective template',
      );
    }
    const issues = validateEntityPromptTemplateContent(
      request.content,
      request.syntaxVersion,
    );
    return { status: issues.length === 0 ? 'VALID' : 'INVALID', issues };
  }

  public async getProjectCatalog(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<EntityPromptTemplateCatalogDto> {
    await this.requireProject(organizationId, projectId);
    const rows = await this.loadRows(projectId);

    const candidateKeys = [
      ...new Set<string>([
        ...ENTITY_PROMPT_TEMPLATE_KEYS.filter((templateKey) =>
          rows.some((row) => row.templateKey === templateKey),
        ),
        ...rows
          .map((row) => row.templateKey)
          .filter(
            (templateKey) =>
              !(ENTITY_PROMPT_TEMPLATE_KEYS as readonly string[]).includes(
                templateKey,
              ),
          ),
      ]),
    ];
    const catalogKeys = candidateKeys.filter((templateKey) => {
      const effective = this.selectEffectiveRevision(templateKey, rows);
      if (effective) return true;

      this.logger.debug(
        'Omitting entity prompt-template history without an effective revision',
        {
          projectId,
          templateKey,
          revisionCount: rows.filter((row) => row.templateKey === templateKey)
            .length,
        },
      );
      return false;
    });

    this.logger.debug('Loaded entity prompt-template catalog candidates', {
      projectId,
      candidateCount: rows.length,
      templateCount: catalogKeys.length,
    });

    const templates = catalogKeys.map((templateKey) =>
      this.buildCatalogEntry(templateKey, rows),
    );

    return {
      projectId,
      language: ENTITY_PROMPT_TEMPLATE_LANGUAGE_CATALOG,
      templates,
    } satisfies EntityPromptTemplateCatalogDto;
  }

  public async getEffectiveTemplate(
    organizationId: OrganizationId,
    projectId: ProjectId,
    templateKey: string,
  ): Promise<EntityPromptTemplateEffectiveDto> {
    await this.requireProject(organizationId, projectId);
    await this.requireSupportedKey(projectId, templateKey);

    const rows = await this.loadRows(projectId, templateKey);
    const effective = this.selectEffectiveRevision(templateKey, rows);

    if (!effective) {
      this.logger.warn('No eligible entity prompt-template revision found', {
        projectId,
        templateKey,
        candidateCount: rows.length,
      });
      throw new NotFoundException(
        `No eligible entity prompt template exists for ${templateKey}`,
      );
    }

    this.logger.debug('Selected effective entity prompt-template revision', {
      projectId,
      templateKey,
      candidateCount: rows.length,
      ownershipScope: effective.ownershipScope,
      revisionId: effective.id,
      revisionNumber: effective.revisionNumber,
      usedProjectOverride:
        effective.ownershipScope === PrismaOwnershipScope.PROJECT,
    });

    return this.toEffectiveDto(effective);
  }

  public async createProjectEntityPromptTemplateDraft(
    organizationId: OrganizationId,
    projectId: ProjectId,
    templateKey: string,
    request: LegacyDraftRequest,
  ): Promise<
    NonNullable<EntityPromptTemplateCatalogEntryDto['projectOverride']>
  > {
    await this.requireProject(organizationId, projectId);
    await this.requireSupportedKey(projectId, templateKey);

    if (
      !request ||
      typeof request.content !== 'string' ||
      request.content.length < 1
    ) {
      throw new BadRequestException(
        'Entity prompt-template content is required',
      );
    }

    this.logger.debug('Resolved project template draft scope', {
      projectId,
      templateKey,
      contentLength: request.content.length,
    });

    const created = await this.prisma.db.$transaction(async (tx) => {
      await this.lockRevisionScope(tx, projectId, templateKey);

      const latest = await tx.entityPromptTemplateRevision.findFirst({
        where: {
          ownershipScope: PrismaOwnershipScope.PROJECT,
          projectId,
          templateKey,
        },
        orderBy: { revisionNumber: 'desc' },
        select: {
          revisionNumber: true,
          selector: true,
          syntaxVersion: true,
        },
      });
      const metadata =
        latest ??
        (await tx.entityPromptTemplateRevision.findFirst({
          where: {
            ownershipScope: PrismaOwnershipScope.CANONICAL,
            projectId: null,
            templateKey,
            lifecycleState: PrismaLifecycleState.PUBLISHED,
            validationStatus: PrismaValidationStatus.VALID,
          },
          orderBy: { revisionNumber: 'desc' },
          select: {
            revisionNumber: true,
            selector: true,
            syntaxVersion: true,
          },
        }));
      if (!metadata) {
        throw new NotFoundException(
          `No authoritative entity prompt-template metadata exists for ${templateKey}`,
        );
      }
      const revisionNumber = (latest?.revisionNumber ?? 0) + 1;

      this.logger.debug('Allocated project template revision number', {
        projectId,
        templateKey,
        revisionNumber,
        previousRevisionNumber: latest?.revisionNumber ?? null,
      });

      const revision = await tx.entityPromptTemplateRevision.create({
        data: {
          templateKey,
          revisionNumber,
          content: request.content,
          selector: metadata.selector as Prisma.InputJsonValue,
          syntaxVersion: metadata.syntaxVersion,
          ownershipScope: PrismaOwnershipScope.PROJECT,
          projectId,
          lifecycleState: PrismaLifecycleState.DRAFT,
          validationStatus: PrismaValidationStatus.UNVALIDATED,
          validationIssues: [],
        },
      });

      this.logger.debug('Persisted project template draft revision', {
        projectId,
        templateKey,
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        lifecycleState: revision.lifecycleState,
        validationStatus: revision.validationStatus,
      });

      return revision;
    });

    return this.toProjectRevisionDto(created);
  }

  public async validateProjectEntityPromptTemplateRevision(
    organizationId: OrganizationId,
    projectId: ProjectId,
    templateKey: string,
    revisionId: string,
  ): Promise<
    NonNullable<EntityPromptTemplateCatalogEntryDto['projectOverride']>
  > {
    await this.requireProject(organizationId, projectId);
    await this.requireSupportedKey(projectId, templateKey);

    this.logger.debug('Resolved project template validation scope', {
      projectId,
      templateKey,
      revisionId,
    });

    const validated = await this.prisma.db.$transaction(async (tx) => {
      const revision = await tx.entityPromptTemplateRevision.findFirst({
        where: {
          id: revisionId,
          ownershipScope: PrismaOwnershipScope.PROJECT,
          projectId,
          templateKey,
        },
      });

      if (!revision) {
        this.logger.warn('Project template validation target was not found', {
          projectId,
          templateKey,
          revisionId,
        });
        throw new NotFoundException(
          `Project-owned entity prompt template revision ${revisionId} was not found for ${templateKey}`,
        );
      }

      const issues = validateEntityPromptTemplateContent(
        revision.content,
        this.parseSyntaxVersion(revision.syntaxVersion),
      );
      const validationStatus =
        issues.length > 0
          ? PrismaValidationStatus.INVALID
          : PrismaValidationStatus.VALID;
      const validatedAt = new Date();

      this.logger.debug('Evaluated project template validation branch', {
        projectId,
        templateKey,
        revisionId,
        revisionNumber: revision.revisionNumber,
        issueCount: issues.length,
        validationStatus,
      });

      const updateResult = await tx.entityPromptTemplateRevision.updateMany({
        where: {
          id: revisionId,
          ownershipScope: PrismaOwnershipScope.PROJECT,
          projectId,
          templateKey,
        },
        data: {
          validationStatus,
          validationIssues: issues,
          validatedAt,
          validatorVersion: ENTITY_PROMPT_TEMPLATE_VALIDATOR_VERSION,
        },
      });

      this.logger.debug('Applied guarded project template validation write', {
        projectId,
        templateKey,
        revisionId,
        updatedCount: updateResult.count,
      });

      if (updateResult.count !== 1) {
        throw new NotFoundException(
          `Project-owned entity prompt template revision ${revisionId} was not found for ${templateKey}`,
        );
      }

      const updated = await tx.entityPromptTemplateRevision.findFirst({
        where: {
          id: revisionId,
          ownershipScope: PrismaOwnershipScope.PROJECT,
          projectId,
          templateKey,
        },
      });

      if (!updated) {
        throw new NotFoundException(
          `Project-owned entity prompt template revision ${revisionId} was not found for ${templateKey}`,
        );
      }

      return updated;
    });

    this.logger.debug(
      'Preserved effective entity prompt-template selection after validation',
      {
        projectId,
        templateKey,
        revisionId,
        lifecycleState: validated.lifecycleState,
        validationStatus: validated.validationStatus,
      },
    );

    return this.toProjectRevisionDto(validated);
  }

  public async publishProjectEntityPromptTemplateRevision(
    organizationId: OrganizationId,
    projectId: ProjectId,
    templateKey: string,
    revisionId: string,
  ): Promise<EntityPromptTemplateLifecycleMutationResult> {
    await this.requireProject(organizationId, projectId);
    await this.requireSupportedKey(projectId, templateKey);

    this.logger.debug('Resolved project template publication scope', {
      organizationId,
      projectId,
      templateKey,
      revisionId,
    });

    try {
      const result = await this.prisma.db.$transaction(async (tx) => {
        this.logger.debug(
          'Beginning project template publication transaction',
          {
            projectId,
            templateKey,
            revisionId,
          },
        );
        await this.lockRevisionScope(tx, projectId, templateKey);

        const target = await tx.entityPromptTemplateRevision.findFirst({
          where: {
            id: revisionId,
            ownershipScope: PrismaOwnershipScope.PROJECT,
            projectId,
            templateKey,
          },
        });

        if (!target) {
          this.logger.warn(
            'Project template publication target was not found',
            {
              projectId,
              templateKey,
              revisionId,
            },
          );
          throw new NotFoundException(
            `Project-owned entity prompt template revision ${revisionId} was not found for ${templateKey}`,
          );
        }

        const isPublishableLifecycle =
          target.lifecycleState === PrismaLifecycleState.DRAFT ||
          target.lifecycleState === PrismaLifecycleState.UNPUBLISHED;
        if (
          !isPublishableLifecycle ||
          target.validationStatus !== PrismaValidationStatus.VALID
        ) {
          this.logger.warn('Project template publication eligibility failed', {
            projectId,
            templateKey,
            revisionId,
            lifecycleState: target.lifecycleState,
            validationStatus: target.validationStatus,
          });
          throw new ConflictException(
            `Project-owned entity prompt template revision ${revisionId} is not eligible for publication`,
          );
        }

        const previousPublished =
          await tx.entityPromptTemplateRevision.findFirst({
            where: {
              ownershipScope: PrismaOwnershipScope.PROJECT,
              projectId,
              templateKey,
              lifecycleState: PrismaLifecycleState.PUBLISHED,
            },
            orderBy: { publishedAt: 'desc' },
          });
        const transitionAt = new Date();

        if (previousPublished) {
          this.logger.debug(
            'Guarding retirement of previous project template publication',
            {
              projectId,
              templateKey,
              previousRevisionId: previousPublished.id,
              targetRevisionId: revisionId,
            },
          );
          const retiredPrevious =
            await tx.entityPromptTemplateRevision.updateMany({
              where: {
                id: previousPublished.id,
                ownershipScope: PrismaOwnershipScope.PROJECT,
                projectId,
                templateKey,
                lifecycleState: PrismaLifecycleState.PUBLISHED,
              },
              data: {
                lifecycleState: PrismaLifecycleState.RETIRED,
                retiredAt: transitionAt,
              },
            });

          if (retiredPrevious.count !== 1) {
            this.logger.warn(
              'Previous project template retirement conflicted',
              {
                projectId,
                templateKey,
                previousRevisionId: previousPublished.id,
                updatedCount: retiredPrevious.count,
              },
            );
            throw new ConflictException(
              'The current project template publication changed concurrently',
            );
          }

          this.logger.debug('Retired previous project template publication', {
            projectId,
            templateKey,
            previousRevisionId: previousPublished.id,
          });
        }

        const publishedTarget =
          await tx.entityPromptTemplateRevision.updateMany({
            where: {
              id: revisionId,
              ownershipScope: PrismaOwnershipScope.PROJECT,
              projectId,
              templateKey,
              lifecycleState: target.lifecycleState,
              validationStatus: PrismaValidationStatus.VALID,
            },
            data: {
              lifecycleState: PrismaLifecycleState.PUBLISHED,
              publishedAt: transitionAt,
              retiredAt: null,
            },
          });

        this.logger.debug('Applied guarded project template publication', {
          projectId,
          templateKey,
          revisionId,
          updatedCount: publishedTarget.count,
        });

        if (publishedTarget.count !== 1) {
          throw new ConflictException(
            'The project template revision changed concurrently',
          );
        }

        const transitioned = await tx.entityPromptTemplateRevision.findFirst({
          where: {
            id: revisionId,
            ownershipScope: PrismaOwnershipScope.PROJECT,
            projectId,
            templateKey,
            lifecycleState: PrismaLifecycleState.PUBLISHED,
          },
        });
        if (!transitioned) {
          throw new ConflictException(
            'The published project template revision could not be reloaded',
          );
        }

        const rows = await this.loadRows(projectId, templateKey, tx);
        const effective = this.selectEffectiveRevision(templateKey, rows);
        if (!effective) {
          this.logger.warn(
            'Project template publication produced no effective revision',
            {
              projectId,
              templateKey,
              revisionId,
            },
          );
          throw new ConflictException(
            `No eligible entity prompt template exists for ${templateKey}`,
          );
        }

        this.logger.debug(
          'Recomputed effective project template after publication',
          {
            projectId,
            templateKey,
            revisionId,
            effectiveRevisionId: effective.id,
            effectiveOwnershipScope: effective.ownershipScope,
          },
        );

        return {
          revision: this.toProjectRevisionDto(transitioned),
          effective: this.toEffectiveDto(effective),
        } satisfies EntityPromptTemplateLifecycleMutationResult;
      });

      this.logger.debug('Committed project template publication transaction', {
        projectId,
        templateKey,
        revisionId,
        effectiveRevisionId: result.effective.revisionId,
      });
      return result;
    } catch (error) {
      this.throwLifecyclePersistenceConflict(error, {
        operation: 'publication',
        projectId,
        templateKey,
        revisionId,
      });
      throw error;
    }
  }

  public async retireProjectEntityPromptTemplateOverride(
    organizationId: OrganizationId,
    projectId: ProjectId,
    templateKey: string,
  ): Promise<EntityPromptTemplateLifecycleMutationResult> {
    await this.requireProject(organizationId, projectId);
    await this.requireSupportedKey(projectId, templateKey);

    this.logger.debug('Resolved project template retirement scope', {
      organizationId,
      projectId,
      templateKey,
    });

    try {
      const result = await this.prisma.db.$transaction(async (tx) => {
        this.logger.debug('Beginning project template retirement transaction', {
          projectId,
          templateKey,
        });
        await this.lockRevisionScope(tx, projectId, templateKey);

        const rowsBefore = await this.loadRows(projectId, templateKey, tx);
        const canonical = this.findCanonicalRevision(templateKey, rowsBefore);
        if (!canonical) {
          this.logger.warn(
            'Canonical project template fallback is unavailable',
            {
              projectId,
              templateKey,
            },
          );
          throw new ConflictException(
            `No published canonical entity prompt template exists for ${templateKey}`,
          );
        }

        this.logger.debug(
          'Verified canonical project template fallback before retirement',
          {
            projectId,
            templateKey,
            canonicalRevisionId: canonical.id,
          },
        );

        const active = await tx.entityPromptTemplateRevision.findFirst({
          where: {
            ownershipScope: PrismaOwnershipScope.PROJECT,
            projectId,
            templateKey,
            lifecycleState: PrismaLifecycleState.PUBLISHED,
          },
          orderBy: { publishedAt: 'desc' },
        });

        if (!active) {
          this.logger.warn(
            'Active project template retirement target was not found',
            {
              projectId,
              templateKey,
            },
          );
          throw new ConflictException(
            `No active project entity prompt template exists for ${templateKey}`,
          );
        }

        const retiredAt = new Date();
        const retired = await tx.entityPromptTemplateRevision.updateMany({
          where: {
            id: active.id,
            ownershipScope: PrismaOwnershipScope.PROJECT,
            projectId,
            templateKey,
            lifecycleState: PrismaLifecycleState.PUBLISHED,
          },
          data: {
            lifecycleState: PrismaLifecycleState.RETIRED,
            retiredAt,
          },
        });

        this.logger.debug('Applied guarded project template retirement', {
          projectId,
          templateKey,
          revisionId: active.id,
          updatedCount: retired.count,
        });

        if (retired.count !== 1) {
          throw new ConflictException(
            'The active project template publication changed concurrently',
          );
        }

        const transitioned = await tx.entityPromptTemplateRevision.findFirst({
          where: {
            id: active.id,
            ownershipScope: PrismaOwnershipScope.PROJECT,
            projectId,
            templateKey,
            lifecycleState: PrismaLifecycleState.RETIRED,
          },
        });
        if (!transitioned) {
          throw new ConflictException(
            'The retired project template revision could not be reloaded',
          );
        }

        const rowsAfter = await this.loadRows(projectId, templateKey, tx);
        const effective = this.selectEffectiveRevision(templateKey, rowsAfter);
        if (!effective || effective.id !== canonical.id) {
          this.logger.warn(
            'Canonical project template fallback was not effective after retirement',
            {
              projectId,
              templateKey,
              canonicalRevisionId: canonical.id,
              effectiveRevisionId: effective?.id ?? null,
            },
          );
          throw new ConflictException(
            `Canonical entity prompt template ${templateKey} could not be selected after retirement`,
          );
        }

        this.logger.debug(
          'Recomputed canonical effective project template after retirement',
          {
            projectId,
            templateKey,
            revisionId: active.id,
            effectiveRevisionId: effective.id,
          },
        );

        return {
          revision: this.toProjectRevisionDto(transitioned),
          effective: this.toEffectiveDto(effective),
        } satisfies EntityPromptTemplateLifecycleMutationResult;
      });

      this.logger.debug('Committed project template retirement transaction', {
        projectId,
        templateKey,
        revisionId: result.revision.revisionId,
        effectiveRevisionId: result.effective.revisionId,
      });
      return result;
    } catch (error) {
      this.throwLifecyclePersistenceConflict(error, {
        operation: 'retirement',
        projectId,
        templateKey,
      });
      throw error;
    }
  }

  /**
   * Enact the only normal template authoring path. The caller supplies an
   * already-open proposal transaction so proposal approval and template
   * publication/retirement commit or roll back together.
   */
  public async enactProposalInTransaction(
    tx: AnyTransactionClient,
    projectId: ProjectId,
    templateKey: string,
    updates: EntityPromptTemplateProposalUpdatesPayload,
  ): Promise<EntityPromptTemplateLifecycleMutationResult> {
    const dynamicWorkItemTypeKey = await this.requireSupportedKey(
      projectId,
      templateKey,
      tx,
    );

    const parsed = entityPromptTemplateProposalUpdatesSchema.safeParse(updates);
    if (!parsed.success) {
      throw new BadRequestException(
        'Entity prompt-template proposal payload is invalid',
      );
    }
    const payload = parsed.data;

    if (payload.projectId !== projectId) {
      throw new ConflictException(
        'Entity prompt-template proposal is not applicable to this project',
      );
    }

    const selector = payload.selector;
    const expected = payload.expectedEffectiveRevision;
    const syntaxVersion =
      payload.operation === 'UPSERT' ? payload.syntaxVersion : 'V1';

    if (payload.operation === 'UPSERT') {
      const issues = validateEntityPromptTemplateContent(
        payload.content,
        syntaxVersion,
      );
      if (issues.length > 0) {
        throw new BadRequestException({
          message: 'Entity prompt-template content is invalid',
          issues,
        });
      }
    }

    this.assertSelectorMatchesTemplateKey(
      templateKey,
      selector,
      dynamicWorkItemTypeKey,
    );
    await this.lockRevisionScope(tx, projectId, templateKey);

    const rowsBefore = await this.loadRows(projectId, templateKey, tx);
    const effectiveBefore = this.selectEffectiveRevision(
      templateKey,
      rowsBefore,
    );
    if (!effectiveBefore) {
      throw new ConflictException(
        `No effective entity prompt template exists for ${templateKey}`,
      );
    }
    if (
      effectiveBefore.id !== expected.revisionId ||
      effectiveBefore.revisionNumber !== expected.revisionNumber
    ) {
      throw new ConflictException(
        'Entity prompt-template proposal is no longer applicable to the current effective revision',
      );
    }
    if (
      !isDeepStrictEqual(this.parseSelector(effectiveBefore.selector), selector)
    ) {
      throw new ConflictException(
        'Entity prompt-template proposal selector does not match the current effective revision',
      );
    }

    if (payload.operation === 'RETIRE') {
      const active = rowsBefore.find(
        (row) =>
          row.ownershipScope === PrismaOwnershipScope.PROJECT &&
          row.lifecycleState === PrismaLifecycleState.PUBLISHED &&
          row.validationStatus === PrismaValidationStatus.VALID,
      );
      if (!active) {
        throw new ConflictException(
          `No active project entity prompt template exists for ${templateKey}`,
        );
      }

      const retiredAt = new Date();
      const retired = await tx.entityPromptTemplateRevision.updateMany({
        where: {
          id: active.id,
          ownershipScope: PrismaOwnershipScope.PROJECT,
          projectId,
          templateKey,
          lifecycleState: PrismaLifecycleState.PUBLISHED,
          validationStatus: PrismaValidationStatus.VALID,
        },
        data: {
          lifecycleState: PrismaLifecycleState.RETIRED,
          retiredAt,
        },
      });
      if (retired.count !== 1) {
        throw new ConflictException(
          'Entity prompt-template proposal is no longer applicable to the current effective revision',
        );
      }

      const transitioned = await tx.entityPromptTemplateRevision.findUnique({
        where: { id: active.id },
      });
      if (!transitioned) {
        throw new ConflictException(
          'Retired entity prompt-template revision could not be reloaded',
        );
      }

      const rowsAfter = await this.loadRows(projectId, templateKey, tx);
      const effectiveAfter = this.selectEffectiveRevision(
        templateKey,
        rowsAfter,
      );
      if (
        !effectiveAfter ||
        effectiveAfter.ownershipScope !== PrismaOwnershipScope.CANONICAL
      ) {
        throw new ConflictException(
          `Canonical entity prompt template ${templateKey} could not be selected after retirement`,
        );
      }

      return {
        revision: this.toProjectRevisionDto(transitioned),
        effective: this.toEffectiveDto(effectiveAfter),
      };
    }

    const previousPublished = rowsBefore.find(
      (row) =>
        row.ownershipScope === PrismaOwnershipScope.PROJECT &&
        row.lifecycleState === PrismaLifecycleState.PUBLISHED &&
        row.validationStatus === PrismaValidationStatus.VALID,
    );
    const transitionAt = new Date();
    if (previousPublished) {
      const retired = await tx.entityPromptTemplateRevision.updateMany({
        where: {
          id: previousPublished.id,
          ownershipScope: PrismaOwnershipScope.PROJECT,
          projectId,
          templateKey,
          lifecycleState: PrismaLifecycleState.PUBLISHED,
          validationStatus: PrismaValidationStatus.VALID,
        },
        data: {
          lifecycleState: PrismaLifecycleState.RETIRED,
          retiredAt: transitionAt,
        },
      });
      if (retired.count !== 1) {
        throw new ConflictException(
          'Entity prompt-template proposal is no longer applicable to the current effective revision',
        );
      }
    }

    const latest = await tx.entityPromptTemplateRevision.findFirst({
      where: {
        ownershipScope: PrismaOwnershipScope.PROJECT,
        projectId,
        templateKey,
      },
      orderBy: { revisionNumber: 'desc' },
      select: { revisionNumber: true },
    });
    const revision = await tx.entityPromptTemplateRevision.create({
      data: {
        templateKey,
        selector: selector as Prisma.InputJsonValue,
        syntaxVersion,
        revisionNumber: (latest?.revisionNumber ?? 0) + 1,
        content: payload.content,
        ownershipScope: PrismaOwnershipScope.PROJECT,
        projectId,
        lifecycleState: PrismaLifecycleState.PUBLISHED,
        validationStatus: PrismaValidationStatus.VALID,
        validationIssues: [],
        validatedAt: transitionAt,
        validatorVersion: ENTITY_PROMPT_TEMPLATE_VALIDATOR_VERSION,
        publishedAt: transitionAt,
      },
    });

    const rowsAfter = await this.loadRows(projectId, templateKey, tx);
    const effectiveAfter = this.selectEffectiveRevision(templateKey, rowsAfter);
    if (!effectiveAfter || effectiveAfter.id !== revision.id) {
      throw new ConflictException(
        `Published entity prompt template ${templateKey} could not be selected`,
      );
    }

    return {
      revision: this.toProjectRevisionDto(revision),
      effective: this.toEffectiveDto(effectiveAfter),
    };
  }

  public async provisionCustomWorkItemTypeTemplateInTransaction(
    tx: AnyTransactionClient,
    projectId: ProjectId,
    workItemTypeKey: string,
  ): Promise<void> {
    const templateKey = entityPromptTemplateKeyForWorkItemType(workItemTypeKey);
    await this.requireSupportedKey(projectId, templateKey, tx);
    await this.lockRevisionScope(tx, projectId, templateKey);

    const existing = await tx.entityPromptTemplateRevision.findFirst({
      where: {
        ownershipScope: PrismaOwnershipScope.PROJECT,
        projectId,
        templateKey,
        lifecycleState: PrismaLifecycleState.PUBLISHED,
      },
      select: { id: true, selector: true, validationStatus: true },
    });
    const selector = {
      entityType: 'WORK_ITEM' as const,
      workItemTypeKey,
    };
    if (
      existing?.validationStatus === PrismaValidationStatus.VALID &&
      isDeepStrictEqual(existing.selector, selector)
    ) {
      return;
    }

    const standardKey = entityPromptTemplateKeyForWorkItemType('STANDARD');
    const standard = this.selectEffectiveRevision(
      standardKey,
      await this.loadRows(projectId, standardKey, tx),
    );
    if (!standard) {
      throw new NotFoundException(
        'No effective published STANDARD entity prompt template exists',
      );
    }

    const syntaxVersion = this.parseSyntaxVersion(standard.syntaxVersion);
    const issues = validateEntityPromptTemplateContent(
      standard.content,
      syntaxVersion,
    );
    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'Effective STANDARD entity prompt-template content is invalid',
        issues,
      });
    }

    const latest = await tx.entityPromptTemplateRevision.findFirst({
      where: {
        ownershipScope: PrismaOwnershipScope.PROJECT,
        projectId,
        templateKey,
      },
      orderBy: { revisionNumber: 'desc' },
      select: { revisionNumber: true },
    });
    const now = new Date();
    if (existing) {
      await tx.entityPromptTemplateRevision.updateMany({
        where: {
          id: existing.id,
          lifecycleState: PrismaLifecycleState.PUBLISHED,
        },
        data: {
          lifecycleState: PrismaLifecycleState.RETIRED,
          publishedAt: null,
          retiredAt: now,
        },
      });
    }
    await tx.entityPromptTemplateRevision.create({
      data: {
        templateKey,
        selector,
        syntaxVersion,
        revisionNumber: (latest?.revisionNumber ?? 0) + 1,
        content: standard.content,
        ownershipScope: PrismaOwnershipScope.PROJECT,
        projectId,
        lifecycleState: PrismaLifecycleState.PUBLISHED,
        validationStatus: PrismaValidationStatus.VALID,
        validationIssues: [],
        validatedAt: now,
        validatorVersion: ENTITY_PROMPT_TEMPLATE_VALIDATOR_VERSION,
        publishedAt: now,
      },
    });
  }

  private async requireProject(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<void> {
    const project = await this.prisma.db.project.findFirst({
      where: {
        id: projectId,
        organizationId,
      },
      select: { id: true },
    });

    if (!project) {
      this.logger.warn('Entity prompt-template project scope was not found', {
        organizationId,
        projectId,
      });
      throw new NotFoundException(
        `Project ${projectId} not found in organization ${organizationId}`,
      );
    }

    this.logger.debug('Resolved entity prompt-template project scope', {
      organizationId,
      projectId,
    });
  }

  private async lockRevisionScope(
    tx: AdvisoryLockClient,
    projectId: ProjectId,
    templateKey: EntityPromptTemplateKey,
  ): Promise<void> {
    const lockKey = `entity-prompt-template:${projectId}:${templateKey}`;
    this.logger.debug('Acquiring project template revision allocation lock', {
      projectId,
      templateKey,
    });
    await tx.$queryRaw(
      Prisma.sql`
        WITH revision_scope_lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        )
        SELECT 1::integer AS "acquired"
        FROM revision_scope_lock
      `,
    );
    this.logger.debug('Acquired project template revision allocation lock', {
      projectId,
      templateKey,
    });
  }

  private async loadRows(
    projectId: ProjectId,
    templateKey?: EntityPromptTemplateKey,
    db: RevisionReadClient = this.prisma.db,
  ): Promise<RevisionRow[]> {
    return db.entityPromptTemplateRevision.findMany({
      where: {
        ...(templateKey ? { templateKey } : {}),
        OR: [
          {
            ownershipScope: PrismaOwnershipScope.CANONICAL,
            projectId: null,
          },
          {
            ownershipScope: PrismaOwnershipScope.PROJECT,
            projectId,
          },
        ],
      },
      orderBy: [
        { templateKey: 'asc' },
        { revisionNumber: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  private throwLifecyclePersistenceConflict(
    error: unknown,
    scope: {
      operation: 'publication' | 'retirement';
      projectId: ProjectId;
      templateKey: EntityPromptTemplateKey;
      revisionId?: string;
    },
  ): void {
    if (!this.isLifecyclePersistenceConflict(error)) {
      return;
    }

    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : 'unknown';
    this.logger.warn('Project template lifecycle persistence conflict', {
      ...scope,
      code,
    });
    throw new ConflictException(
      `Project template ${scope.operation} conflicted with a concurrent transition`,
    );
  }

  private isLifecyclePersistenceConflict(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
      return false;
    }

    return error.code === 'P2002' || error.code === 'P2034';
  }

  private buildCatalogEntry(
    templateKey: EntityPromptTemplateKey,
    rows: RevisionRow[],
  ): EntityPromptTemplateCatalogEntryDto {
    const templateRows = rows.filter((row) => row.templateKey === templateKey);
    const canonical = this.findCanonicalRevision(templateKey, templateRows);
    const effective = this.selectEffectiveRevision(templateKey, templateRows);

    this.logger.debug('Resolved entity prompt-template catalog entry', {
      templateKey,
      revisionCount: templateRows.length,
      canonicalRevisionId: canonical?.id ?? null,
      effectiveRevisionId: effective?.id ?? null,
      effectiveOwnershipScope: effective?.ownershipScope ?? null,
      revisions: templateRows.map((row) => ({
        revisionId: row.id,
        revisionNumber: row.revisionNumber,
        ownershipScope: row.ownershipScope,
        projectId: row.projectId,
        lifecycleState: row.lifecycleState,
        validationStatus: row.validationStatus,
        selector: row.selector,
      })),
    });

    if (!effective) {
      this.logger.warn('No eligible entity prompt-template catalog entry', {
        templateKey,
        revisionCount: templateRows.length,
        revisions: templateRows.map((row) => ({
          revisionId: row.id,
          revisionNumber: row.revisionNumber,
          ownershipScope: row.ownershipScope,
          projectId: row.projectId,
          lifecycleState: row.lifecycleState,
          validationStatus: row.validationStatus,
          selector: row.selector,
        })),
      });
      throw new NotFoundException(
        `No eligible entity prompt template exists for ${templateKey}`,
      );
    }

    const projectOverride = templateRows.find(
      (row) =>
        row.ownershipScope === PrismaOwnershipScope.PROJECT &&
        row.lifecycleState === PrismaLifecycleState.PUBLISHED &&
        row.validationStatus === PrismaValidationStatus.VALID,
    );

    return {
      templateKey,
      ...(canonical
        ? { canonicalDefault: this.toCanonicalRevisionDto(canonical) }
        : {}),
      ...(projectOverride
        ? { projectOverride: this.toProjectRevisionDto(projectOverride) }
        : {}),
      revisionHistory: templateRows.map((row) => this.toRevisionDto(row)),
      effective: this.toEffectiveDto(effective),
    } satisfies EntityPromptTemplateCatalogEntryDto;
  }

  private findCanonicalRevision(
    templateKey: string,
    rows: RevisionRow[],
  ): RevisionRow | undefined {
    return rows.find(
      (row) =>
        row.templateKey === templateKey &&
        row.ownershipScope === PrismaOwnershipScope.CANONICAL &&
        row.lifecycleState === PrismaLifecycleState.PUBLISHED &&
        row.validationStatus === PrismaValidationStatus.VALID,
    );
  }

  public selectEffectiveRevision(
    templateKey: string,
    rows: RevisionRow[],
  ): RevisionRow | undefined {
    return (
      rows.find(
        (row) =>
          row.templateKey === templateKey &&
          row.ownershipScope === PrismaOwnershipScope.PROJECT &&
          row.lifecycleState === PrismaLifecycleState.PUBLISHED &&
          row.validationStatus === PrismaValidationStatus.VALID,
      ) ?? this.findCanonicalRevision(templateKey, rows)
    );
  }

  private toRevisionDto(row: RevisionRow): EntityPromptTemplateRevisionDto {
    return {
      templateKey: row.templateKey,
      selector: this.parseSelector(row.selector),
      syntaxVersion: this.parseSyntaxVersion(row.syntaxVersion),
      revisionId: row.id,
      revisionNumber: row.revisionNumber,
      content: row.content,
      ownershipScope: this.toOwnershipScope(row),
      lifecycleState: row.lifecycleState,
      validation: this.toValidationMetadata(row),
      ...(row.createdAt ? { createdAt: row.createdAt.toISOString() } : {}),
      ...(row.publishedAt
        ? { publishedAt: row.publishedAt.toISOString() }
        : {}),
      ...(row.retiredAt ? { retiredAt: row.retiredAt.toISOString() } : {}),
    } satisfies EntityPromptTemplateRevisionDto;
  }

  private toCanonicalRevisionDto(
    row: RevisionRow,
  ): EntityPromptTemplateCatalogEntryDto['canonicalDefault'] {
    if (
      row.ownershipScope !== PrismaOwnershipScope.CANONICAL ||
      row.lifecycleState !== PrismaLifecycleState.PUBLISHED ||
      row.validationStatus !== PrismaValidationStatus.VALID
    ) {
      throw new Error('Canonical default is not published and valid');
    }

    return {
      templateKey: row.templateKey,
      selector: this.parseSelector(row.selector),
      syntaxVersion: this.parseSyntaxVersion(row.syntaxVersion),
      revisionId: row.id,
      revisionNumber: row.revisionNumber,
      content: row.content,
      ownershipScope: { scope: 'CANONICAL' },
      lifecycleState: 'PUBLISHED',
      validation: this.toValidValidationMetadata(row),
      ...(row.createdAt ? { createdAt: row.createdAt.toISOString() } : {}),
      ...(row.publishedAt
        ? { publishedAt: row.publishedAt.toISOString() }
        : {}),
      ...(row.retiredAt ? { retiredAt: row.retiredAt.toISOString() } : {}),
    } satisfies EntityPromptTemplateCatalogEntryDto['canonicalDefault'];
  }

  private toProjectRevisionDto(
    row: RevisionRow,
  ): NonNullable<EntityPromptTemplateCatalogEntryDto['projectOverride']> {
    if (
      row.ownershipScope !== PrismaOwnershipScope.PROJECT ||
      row.projectId === null
    ) {
      throw new Error('Project override is missing project ownership');
    }

    return {
      templateKey: row.templateKey,
      selector: this.parseSelector(row.selector),
      syntaxVersion: this.parseSyntaxVersion(row.syntaxVersion),
      revisionId: row.id,
      revisionNumber: row.revisionNumber,
      content: row.content,
      ownershipScope: {
        scope: 'PROJECT',
        projectId: row.projectId as ProjectId,
      },
      lifecycleState: row.lifecycleState,
      validation: this.toValidationMetadata(row),
      ...(row.createdAt ? { createdAt: row.createdAt.toISOString() } : {}),
      ...(row.publishedAt
        ? { publishedAt: row.publishedAt.toISOString() }
        : {}),
      ...(row.retiredAt ? { retiredAt: row.retiredAt.toISOString() } : {}),
    } satisfies NonNullable<
      EntityPromptTemplateCatalogEntryDto['projectOverride']
    >;
  }

  private toEffectiveDto(row: RevisionRow): EntityPromptTemplateEffectiveDto {
    if (
      row.lifecycleState !== PrismaLifecycleState.PUBLISHED ||
      row.validationStatus !== PrismaValidationStatus.VALID ||
      row.publishedAt === null
    ) {
      throw new Error('Effective template is not published and valid');
    }

    return {
      templateKey: row.templateKey,
      selector: this.parseSelector(row.selector),
      syntaxVersion: this.parseSyntaxVersion(row.syntaxVersion),
      content: row.content,
      ownershipSource: this.toOwnershipScope(row),
      revisionId: row.id,
      revisionNumber: row.revisionNumber,
      lifecycleState: 'PUBLISHED',
      validationStatus: 'VALID',
      publishedAt: row.publishedAt.toISOString(),
    } satisfies EntityPromptTemplateEffectiveDto;
  }

  private toOwnershipScope(
    row: RevisionRow,
  ): EntityPromptTemplateRevisionDto['ownershipScope'] {
    if (row.ownershipScope === PrismaOwnershipScope.CANONICAL) {
      return { scope: 'CANONICAL' };
    }

    if (row.projectId === null) {
      throw new Error('Project-owned prompt template is missing project ID');
    }

    return { scope: 'PROJECT', projectId: row.projectId as ProjectId };
  }

  private toValidationMetadata(
    row: RevisionRow,
  ): EntityPromptTemplateValidationMetadataDto {
    const issues = this.parseValidationIssues(row.validationIssues);
    return {
      status: row.validationStatus,
      issues,
      ...(row.validatedAt
        ? { validatedAt: row.validatedAt.toISOString() }
        : {}),
      ...(row.validatorVersion
        ? { validatorVersion: row.validatorVersion }
        : {}),
    } satisfies EntityPromptTemplateValidationMetadataDto;
  }

  private toValidValidationMetadata(
    row: RevisionRow,
  ): NonNullable<
    EntityPromptTemplateCatalogEntryDto['canonicalDefault']
  >['validation'] {
    const metadata = this.toValidationMetadata(row);
    if (metadata.status !== 'VALID') {
      throw new Error('Canonical default validation status is not VALID');
    }
    return {
      ...metadata,
      status: 'VALID',
    } satisfies NonNullable<
      EntityPromptTemplateCatalogEntryDto['canonicalDefault']
    >['validation'];
  }

  private parseValidationIssues(
    value: Prisma.JsonValue,
  ): EntityPromptTemplateValidationIssueDto[] {
    if (!Array.isArray(value)) {
      throw new Error(
        'Entity prompt template validation issues must be an array',
      );
    }

    return value.map((issue) => {
      if (
        typeof issue !== 'object' ||
        issue === null ||
        Array.isArray(issue) ||
        typeof issue.code !== 'string' ||
        typeof issue.path !== 'string' ||
        typeof issue.message !== 'string'
      ) {
        throw new Error('Entity prompt template validation issue is malformed');
      }

      return {
        code: issue.code,
        path: issue.path,
        message: issue.message,
      } satisfies EntityPromptTemplateValidationIssueDto;
    });
  }

  private isSupportedKey(value: string): value is EntityPromptTemplateKey {
    return (
      value === 'entity_context' ||
      (ENTITY_PROMPT_TEMPLATE_KEYS as readonly string[]).includes(value)
    );
  }

  private async requireSupportedKey(
    projectId: ProjectId,
    value: string,
    client: AnyTransactionClient = this.prisma.db,
  ): Promise<string | undefined> {
    if (this.isSupportedKey(value)) return undefined;

    const keySuffix = workItemTypeKeyFromEntityPromptTemplateKey(value);
    const customTypes = keySuffix
      ? await client.workItemType.findMany({
          where: {
            projectId,
            lifecycleStatus: 'active',
          },
          select: { typeKey: true },
        })
      : [];
    const customType = customTypes.find(
      ({ typeKey }: { typeKey: string }) =>
        entityPromptTemplateKeyForWorkItemType(typeKey) === value,
    );
    if (!customType) {
      this.logger.warn('Rejected unsupported entity prompt-template key', {
        templateKey: value,
      });
      throw new NotFoundException(
        `Entity prompt template ${value} is not supported`,
      );
    }
    return customType.typeKey;
  }

  private parseSelector(
    value: Prisma.JsonValue,
  ): EntityPromptTemplateSelectorDto {
    const result = entityPromptTemplateSelectorSchema.safeParse(value);
    if (!result.success) {
      throw new Error('Entity prompt-template selector is malformed');
    }
    return result.data;
  }

  private assertSelectorMatchesTemplateKey(
    templateKey: string,
    selector: EntityPromptTemplateSelectorDto,
    dynamicWorkItemTypeKey?: string,
  ): void {
    const expectedSelector =
      ENTITY_PROMPT_TEMPLATE_SELECTOR_BY_KEY[
        templateKey as keyof typeof ENTITY_PROMPT_TEMPLATE_SELECTOR_BY_KEY
      ];
    const expected =
      expectedSelector ??
      (dynamicWorkItemTypeKey
        ? {
            entityType: 'WORK_ITEM' as const,
            workItemTypeKey: dynamicWorkItemTypeKey,
          }
        : undefined);
    if (expected && !isDeepStrictEqual(expected, selector)) {
      throw new BadRequestException(
        `Entity prompt-template selector does not match template key ${templateKey}`,
      );
    }
  }

  private parseSyntaxVersion(value: string): EntityPromptTemplateSyntaxVersion {
    const result = entityPromptTemplateSyntaxVersionSchema.safeParse(value);
    if (!result.success) {
      throw new Error(
        `Unsupported entity prompt-template syntax version: ${value}`,
      );
    }
    return result.data;
  }
}
