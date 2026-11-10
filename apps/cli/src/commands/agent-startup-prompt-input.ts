import type { ReadRestriction, ReportDto } from '@hey-hey/contracts/api/models';
import { z } from 'zod';
import { EntityPromptTemplatesApiFactory } from '@hey-hey/contracts/api';
import {
  EntityPromptTemplateFixedEntitySelectorDtoEntityTypeEnum,
  EntityPromptTemplateSelectorEntityType,
  EntityPromptTemplateSyntaxVersion,
  EntityPromptTemplateWorkItemSelectorDtoEntityTypeEnum,
  EntityPromptTemplateEffectiveDtoLifecycleStateEnum,
  EntityPromptTemplateEffectiveDtoValidationStatusEnum,
  EntityPromptTemplateCanonicalOwnershipScopeDtoScopeEnum,
  EntityPromptTemplateProjectOwnershipScopeDtoScopeEnum,
  type EntityPromptTemplateEffectiveDtoOwnershipSource,
  type EntityPromptTemplateSelectorDto,
} from '@hey-hey/contracts/api/models';
import { Configuration } from '@hey-hey/contracts/api/configuration';
import type { LocalPromptStartupInput, LocalPromptTaskType } from '@hey-hey/contracts/agent-bridge';
import {
  LocalPromptTaskType as PromptTaskType,
  RunEntityReferenceEntityTypeEnum as RunEntityType,
  type RunEntityReference,
} from '@hey-hey/contracts/agent-bridge';
import type { ServerLogger } from '../server/logger';
import type { SubmissionToolAuth } from '../agents/submission-tools/submission-tool-auth';
import { EntityContextLoader } from '../agents/entity-context/entity-context-loader';
import type { LoadedEntityPromptContext } from '../agents/entity-context/types';
import {
  entityPromptTemplateLanguageFor,
  EntityPromptTemplateRenderError,
  renderEntityPromptTemplate,
  type EntityPromptTemplateRenderInput,
} from './entity-prompt-template-renderer';
import {
  buildReportValue,
  collectReferencedReportTypes,
  selectNewestReport,
  TEMPLATE_EXCLUDED_REPORT_TYPES,
  type EntityPromptTemplateReports,
  type EntityPromptTemplateReportValue,
  type SelectableReport,
} from './entity-prompt-template-reports';
import { EntityReportReader, type EntityReportReadScope } from './entity-report-reader';
import { parseEntityPromptTemplate } from '../shared/api/generated/entity-prompt-template-language';
import type { ReportChainEntry } from '../run/types';
import { toOpenApiProjectId } from '../shared/api/identifierAdapters';

export type EntityPromptTemplatesApiClient = Pick<
  ReturnType<typeof EntityPromptTemplatesApiFactory>,
  'getEffectiveEntityPromptTemplate' | 'getProjectEntityPromptTemplateCatalog'
>;

export interface AgentStartupPromptInputOptions {
  auth: SubmissionToolAuth;
  apiBaseUrl: string;
  logger: ServerLogger;
  entityContextLoader: EntityContextLoader;
  createClient?: (accessToken: string) => EntityPromptTemplatesApiClient;
  reportReader?: EntityReportReader;
}

export interface AgentStartupPromptInputRequest {
  runEntity: RunEntityReference;
  organizationId: string;
  projectId: string;
  /** The Run's read restriction, carried into the startup context's platform reads. */
  readRestriction?: ReadRestriction | undefined;
  /**
   * The Run's report chain at this moment. Reports saved on the focal task by
   * earlier Runs and reports added in this Run both reach templates through it.
   */
  reportChain?: ReadonlyArray<Readonly<ReportChainEntry>>;
}

export interface AgentStartupPromptTemplateProvenance {
  templateKey: string;
  ownershipSource: EntityPromptTemplateEffectiveDtoOwnershipSource;
  revisionId: string;
  revisionNumber: number;
}

/**
 * Stable effective-template configuration. The template is safe to retain
 * across provider-session remints; its rendered output is not, because that
 * output contains the entity and Context loaded for one session.
 */
export interface AgentStartupPromptTemplate {
  templateKey: string;
  selector: EntityPromptTemplateSelectorDto;
  syntaxVersion: EntityPromptTemplateSyntaxVersion;
  content: string;
  provenance: AgentStartupPromptTemplateProvenance;
}

export interface AgentStartupPromptInputResolveOptions {
  cachedTemplate?: AgentStartupPromptTemplate | null;
}

export interface AgentStartupPromptInputResult {
  startupInput: LocalPromptStartupInput;
  renderedInput: string;
  loadedEntityContext: LoadedEntityPromptContext;
  /** Present for projections produced by AgentStartupPromptInput itself. */
  template?: AgentStartupPromptTemplate;
  provenance: AgentStartupPromptTemplateProvenance;
}

export type AgentStartupPromptInputFailureBoundary =
  | 'focal_type_mapping'
  | 'entity_context_loader'
  | 'effective_template_auth'
  | 'effective_template_read'
  | 'effective_template_response'
  | 'effective_template_render'
  | 'report_read';

export class AgentStartupPromptInputError extends Error {
  public constructor(
    message: string,
    public readonly boundary: AgentStartupPromptInputFailureBoundary,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AgentStartupPromptInputError';
  }
}

/** The failure's cause for the log line: error type and message only, never template or Context content. */
const describeCause = (error: unknown): { causeName: string; causeMessage: string } => {
  if (error instanceof Error) {
    return { causeName: error.name, causeMessage: error.message };
  }

  return { causeName: typeof error, causeMessage: String(error) };
};

/** Schema failures for the log line: where and what code, never the received values. */
const describeSchemaIssues = (error: z.ZodError): { issues: string[] } => ({
  issues: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`),
});

const canonicalOwnershipSourceSchema = z
  .object({
    scope: z.literal(EntityPromptTemplateCanonicalOwnershipScopeDtoScopeEnum.Canonical),
  })
  .strict();

const projectOwnershipSourceSchema = z
  .object({
    scope: z.literal(EntityPromptTemplateProjectOwnershipScopeDtoScopeEnum.Project),
    projectId: z.string().min(1),
  })
  .strict();

const effectiveTemplateSchema = z
  .object({
    templateKey: z.string().min(1),
    selector: z.discriminatedUnion('entityType', [
      z.object({
        entityType: z.literal(EntityPromptTemplateFixedEntitySelectorDtoEntityTypeEnum.Project),
      }),
      z.object({
        entityType: z.literal(EntityPromptTemplateFixedEntitySelectorDtoEntityTypeEnum.DesignDoc),
      }),
      z.object({
        entityType: z.literal(
          EntityPromptTemplateFixedEntitySelectorDtoEntityTypeEnum.AgentSession,
        ),
      }),
      z.object({
        entityType: z.literal(EntityPromptTemplateWorkItemSelectorDtoEntityTypeEnum.WorkItem),
        workItemTypeKey: z.string().min(1),
      }),
    ]),
    syntaxVersion: z.nativeEnum(EntityPromptTemplateSyntaxVersion),
    content: z.string().min(1),
    ownershipSource: z.union([canonicalOwnershipSourceSchema, projectOwnershipSourceSchema]),
    revisionId: z.string().min(1),
    revisionNumber: z.number().int().positive(),
    lifecycleState: z.literal(EntityPromptTemplateEffectiveDtoLifecycleStateEnum.Published),
    validationStatus: z.literal(EntityPromptTemplateEffectiveDtoValidationStatusEnum.Valid),
    publishedAt: z.string().datetime({ offset: true }),
  })
  .strict();

const catalogResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      projectId: z.string().min(1),
      templates: z.array(
        z
          .object({
            templateKey: z.string().min(1),
            // Catalog discovery must tolerate selectors this CLI does not consume.
            // The selected effective template still uses the full contract above.
            effective: z
              .object({
                selector: z.object({
                  entityType: z.string().min(1),
                  workItemTypeKey: z.string().optional(),
                }),
              })
              .passthrough(),
          })
          .passthrough(),
      ),
    }),
  })
  .passthrough();

const effectiveTemplateResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string().min(1),
    data: effectiveTemplateSchema,
    timestamp: z.string().datetime({ offset: true }),
    statusCode: z.number().int(),
    path: z.string().optional(),
  })
  .strict();

export const entityPromptTemplateSelectorFor = (
  loaded: LoadedEntityPromptContext,
): EntityPromptTemplateSelectorDto => {
  switch (loaded.focalEntity.entityType) {
    case RunEntityType.Project:
      return { entityType: EntityPromptTemplateSelectorEntityType.Project };
    case RunEntityType.DesignDoc:
      return { entityType: EntityPromptTemplateSelectorEntityType.DesignDoc };
    case RunEntityType.AgentSession:
      return { entityType: EntityPromptTemplateSelectorEntityType.AgentSession };
    default:
      if (!('type' in loaded.entity) || typeof loaded.entity.type !== 'string') {
        throw new AgentStartupPromptInputError(
          'Agent startup prompt input requires an authoritative Work Item type.',
          'focal_type_mapping',
        );
      }
      return {
        entityType: EntityPromptTemplateSelectorEntityType.WorkItem,
        workItemTypeKey: loaded.entity.type,
      };
  }
};

export const isEntityPromptTemplateFocalType = (
  entityType: RunEntityReference['entityType'],
): boolean =>
  entityType === RunEntityType.Project ||
  entityType === RunEntityType.DesignDoc ||
  entityType === RunEntityType.AgentSession ||
  entityType === RunEntityType.Task;

const sameSelector = (
  left: EntityPromptTemplateSelectorDto,
  right: EntityPromptTemplateSelectorDto,
): boolean =>
  left.entityType === right.entityType &&
  (left.entityType !== EntityPromptTemplateSelectorEntityType.WorkItem ||
    (right.entityType === EntityPromptTemplateSelectorEntityType.WorkItem &&
      left.workItemTypeKey === right.workItemTypeKey));

const MAX_LOGGED_CATALOG_ENTRIES = 50;
const MAX_LOGGED_CATALOG_VALUE_LENGTH = 128;

const truncateCatalogLogValue = (value: string): string =>
  value.length > MAX_LOGGED_CATALOG_VALUE_LENGTH
    ? `${value.slice(0, MAX_LOGGED_CATALOG_VALUE_LENGTH)}…`
    : value;

const taskTypeForWorkItemType = (workItemType: string | undefined): LocalPromptTaskType => {
  switch (workItemType) {
    case PromptTaskType.Bug:
      return PromptTaskType.Bug;
    case PromptTaskType.Feature:
      return PromptTaskType.Feature;
    case PromptTaskType.Goal:
      return PromptTaskType.Goal;
    case PromptTaskType.Eval:
      return PromptTaskType.Eval;
    default:
      return PromptTaskType.Standard;
  }
};

const taskTypeFor = (
  entityType: RunEntityReference['entityType'],
  authoritativeWorkItemType?: string,
): LocalPromptTaskType => {
  switch (entityType) {
    case RunEntityType.Task:
      return taskTypeForWorkItemType(authoritativeWorkItemType);
    default:
      return PromptTaskType.Standard;
  }
};

const buildStartupInput = (
  request: AgentStartupPromptInputRequest,
  loadedContext: LoadedEntityPromptContext,
): LocalPromptStartupInput => {
  const authoritativeWorkItemType =
    'type' in loadedContext.entity && typeof loadedContext.entity.type === 'string'
      ? loadedContext.entity.type
      : undefined;
  return {
    task: {
      id: request.runEntity.entityId,
      taskType: taskTypeFor(request.runEntity.entityType, authoritativeWorkItemType),
      description: '',
    },
    focalEntity: request.runEntity,
    adjacentScopeTasks: [],
    evidenceItems: [],
  };
};

/**
 * Render the effective template over one loaded Context. Used by the startup load and by
 * callers re-rendering a replacement Context with the template already selected for the Run.
 */
export const renderStartupPromptTemplate = (
  template: AgentStartupPromptTemplate,
  loadedContext: Pick<LoadedEntityPromptContext, 'entity' | 'context'>,
  reports: EntityPromptTemplateReports,
  logger: ServerLogger,
): string => {
  const renderInput: EntityPromptTemplateRenderInput = {
    entity: loadedContext.entity,
    context: loadedContext.context,
    reports,
  };
  const fields = {
    templateKey: template.templateKey,
    ownershipSource: template.provenance.ownershipSource.scope,
    revisionId: template.provenance.revisionId,
    revisionNumber: template.provenance.revisionNumber,
    boundary: 'effective_template_render',
  };
  logger.debug('agent_startup_prompt_input.template_render_started', fields);

  let renderedInput: string;
  try {
    renderedInput = renderEntityPromptTemplate(
      template.content,
      template.syntaxVersion,
      renderInput,
    );
  } catch (error) {
    logger.error('agent_startup_prompt_input.template_render_failed', {
      ...fields,
      ...describeCause(error),
      ...(error instanceof EntityPromptTemplateRenderError
        ? { renderBoundary: error.boundary }
        : {}),
    });
    throw new AgentStartupPromptInputError(
      'Agent startup prompt input effective template render failed.',
      'effective_template_render',
      { cause: error },
    );
  }

  logger.debug('agent_startup_prompt_input.template_render_completed', {
    ...fields,
    renderedLength: renderedInput.length,
  });
  return renderedInput;
};

/** Owns authoritative entity startup-input resolution for a coding Run. */
export class AgentStartupPromptInput {
  private readonly auth: SubmissionToolAuth;
  private readonly apiBaseUrl: string;
  private readonly logger: ServerLogger;
  private readonly entityContextLoader: EntityContextLoader;
  private readonly createClient: (accessToken: string) => EntityPromptTemplatesApiClient;
  private readonly reportReader: EntityReportReader;

  public constructor(options: AgentStartupPromptInputOptions) {
    this.auth = options.auth;
    this.apiBaseUrl = options.apiBaseUrl;
    this.logger = options.logger;
    this.entityContextLoader = options.entityContextLoader;
    this.reportReader =
      options.reportReader ??
      new EntityReportReader({ apiBaseUrl: options.apiBaseUrl, logger: options.logger });
    this.createClient =
      options.createClient ??
      ((accessToken: string): EntityPromptTemplatesApiClient =>
        EntityPromptTemplatesApiFactory(
          new Configuration({ accessToken, basePath: this.apiBaseUrl }),
        ));
  }

  public async resolve(
    request: AgentStartupPromptInputRequest,
    options: AgentStartupPromptInputResolveOptions = {},
  ): Promise<AgentStartupPromptInputResult> {
    this.logger.debug('agent_startup_prompt_input.entity_context_started', {
      focalEntityType: request.runEntity.entityType,
    });
    let loadedContext: Awaited<ReturnType<EntityContextLoader['load']>>;
    try {
      loadedContext = await this.entityContextLoader.load({
        runEntity: request.runEntity,
        organizationId: request.organizationId,
        projectId: request.projectId,
        readRestriction: request.readRestriction,
      });
    } catch (error) {
      this.logger.error('agent_startup_prompt_input.entity_context_failed', {
        focalEntityType: request.runEntity.entityType,
        ...describeCause(error),
        boundary: 'entity_context_loader',
      });
      throw new AgentStartupPromptInputError(
        'Agent startup prompt input could not load authoritative entity Context.',
        'entity_context_loader',
      );
    }

    this.logger.debug('agent_startup_prompt_input.entity_context_loaded', {
      focalEntityType: request.runEntity.entityType,
      focalEntityId: request.runEntity.entityId,
      contextEntityId: loadedContext.context.entityId,
      contextEntityType: loadedContext.context.entityType,
      boundary: 'entity_context_loader',
    });

    const selector = entityPromptTemplateSelectorFor(loadedContext);

    const cachedTemplate = options.cachedTemplate ?? null;
    const cachedTemplateIsValid =
      cachedTemplate !== null &&
      sameSelector(cachedTemplate.selector, selector) &&
      (cachedTemplate.provenance.ownershipSource.scope ===
        EntityPromptTemplateCanonicalOwnershipScopeDtoScopeEnum.Canonical ||
        (cachedTemplate.provenance.ownershipSource.scope ===
          EntityPromptTemplateProjectOwnershipScopeDtoScopeEnum.Project &&
          cachedTemplate.provenance.ownershipSource.projectId === request.projectId));

    let template: AgentStartupPromptTemplate;
    if (cachedTemplateIsValid) {
      template = cachedTemplate;
      this.logger.debug('agent_startup_prompt_input.template_revision_reused', {
        templateKey: template.templateKey,
        selector: template.selector,
        ownershipSource: template.provenance.ownershipSource.scope,
        revisionId: template.provenance.revisionId,
        revisionNumber: template.provenance.revisionNumber,
        boundary: 'effective_template_read',
      });
    } else {
      if (cachedTemplate !== null) {
        this.logger.debug('agent_startup_prompt_input.template_cache_invalid', {
          cachedTemplateKey: cachedTemplate.templateKey,
          cachedSelector: cachedTemplate.selector,
          selector,
          boundary: 'effective_template_response',
        });
      }

      let accessToken: string;
      try {
        accessToken = await this.auth.getAccessToken();
      } catch (error) {
        this.logger.error('agent_startup_prompt_input.template_auth_failed', {
          selector,
          ...describeCause(error),
          boundary: 'effective_template_auth',
        });
        throw new AgentStartupPromptInputError(
          'Agent startup prompt input could not authenticate its template read.',
          'effective_template_auth',
        );
      }

      const client = this.createClient(accessToken);
      let catalogResponse: Awaited<
        ReturnType<EntityPromptTemplatesApiClient['getProjectEntityPromptTemplateCatalog']>
      >;
      this.logger.debug('agent_startup_prompt_input.catalog_read_started', { selector });
      try {
        catalogResponse = await client.getProjectEntityPromptTemplateCatalog({
          organizationId: request.organizationId,
          projectId: request.projectId,
        });
      } catch (error) {
        this.logger.error('agent_startup_prompt_input.catalog_read_failed', {
          selector,
          ...describeCause(error),
          boundary: 'effective_template_read',
        });
        throw new AgentStartupPromptInputError(
          'Agent startup prompt input template catalog read failed.',
          'effective_template_read',
        );
      }

      const parsedCatalog = catalogResponseSchema.safeParse(catalogResponse.data);
      if (!parsedCatalog.success) {
        this.logger.error('agent_startup_prompt_input.catalog_response_malformed', {
          selector,
          issues: parsedCatalog.error.issues.map((issue) => ({
            path: issue.path,
            code: issue.code,
          })),
          boundary: 'effective_template_response',
        });
        throw new AgentStartupPromptInputError(
          'Agent startup prompt input received a malformed template catalog.',
          'effective_template_response',
        );
      }
      const catalogEntriesWithParsedSelectors = parsedCatalog.data.data.templates.map((entry) => ({
        entry,
        parsedSelector: effectiveTemplateSchema.shape.selector.safeParse(entry.effective.selector),
      }));
      const matchingCatalogEntries = catalogEntriesWithParsedSelectors
        .filter(
          ({ parsedSelector }) =>
            parsedSelector.success && sameSelector(parsedSelector.data, selector),
        )
        .map(({ entry }) => entry);
      if (
        parsedCatalog.data.data.projectId !== request.projectId ||
        matchingCatalogEntries.length !== 1
      ) {
        const catalogEntrySummaries = catalogEntriesWithParsedSelectors
          .slice(0, MAX_LOGGED_CATALOG_ENTRIES)
          .map(({ entry, parsedSelector }) => {
            const { entityType, workItemTypeKey } = entry.effective.selector;
            const truncatedFields = [
              ...(entry.templateKey.length > MAX_LOGGED_CATALOG_VALUE_LENGTH
                ? ['templateKey']
                : []),
              ...(entityType.length > MAX_LOGGED_CATALOG_VALUE_LENGTH
                ? ['selector.entityType']
                : []),
              ...(workItemTypeKey !== undefined &&
              workItemTypeKey.length > MAX_LOGGED_CATALOG_VALUE_LENGTH
                ? ['selector.workItemTypeKey']
                : []),
            ];
            return {
              templateKey: truncateCatalogLogValue(entry.templateKey),
              selector: {
                entityType: truncateCatalogLogValue(entityType),
                ...(workItemTypeKey !== undefined
                  ? { workItemTypeKey: truncateCatalogLogValue(workItemTypeKey) }
                  : {}),
              },
              selectorAcceptedByCli: parsedSelector.success,
              ...(parsedSelector.success
                ? {}
                : {
                    selectorIssueCodes: parsedSelector.error.issues.map((issue) => issue.code),
                    selectorExtraKeys: Object.keys(entry.effective.selector)
                      .filter((key) => key !== 'entityType' && key !== 'workItemTypeKey')
                      .slice(0, 10),
                  }),
              ...(truncatedFields.length > 0 ? { truncatedFields } : {}),
            };
          });
        this.logger.error('agent_startup_prompt_input.catalog_response_invalid', {
          selector,
          matchingEntryCount: matchingCatalogEntries.length,
          projectMatches: parsedCatalog.data.data.projectId === request.projectId,
          catalogEntryCount: catalogEntriesWithParsedSelectors.length,
          catalogEntries: catalogEntrySummaries,
          catalogEntriesTruncated:
            catalogEntriesWithParsedSelectors.length > MAX_LOGGED_CATALOG_ENTRIES,
          boundary: 'effective_template_response',
        });
        throw new AgentStartupPromptInputError(
          'Agent startup prompt input could not resolve exactly one template catalog selector.',
          'effective_template_response',
        );
      }
      const [matchingCatalogEntry] = matchingCatalogEntries;
      if (!matchingCatalogEntry) {
        throw new AgentStartupPromptInputError(
          'Agent startup prompt input could not resolve its template catalog entry.',
          'effective_template_response',
        );
      }
      const templateKey = matchingCatalogEntry.templateKey;

      let response: Awaited<
        ReturnType<EntityPromptTemplatesApiClient['getEffectiveEntityPromptTemplate']>
      >;
      this.logger.debug('agent_startup_prompt_input.template_read_started', {
        templateKey,
        boundary: 'effective_template_read',
      });
      try {
        response = await client.getEffectiveEntityPromptTemplate({
          organizationId: request.organizationId,
          projectId: request.projectId,
          templateKey,
        });
      } catch (error) {
        this.logger.error('agent_startup_prompt_input.template_read_failed', {
          templateKey,
          ...describeCause(error),
          boundary: 'effective_template_read',
        });
        throw new AgentStartupPromptInputError(
          'Agent startup prompt input effective template read failed.',
          'effective_template_read',
        );
      }

      const parsedResponse = effectiveTemplateResponseSchema.safeParse(response.data);
      if (!parsedResponse.success) {
        this.logger.error('agent_startup_prompt_input.template_response_malformed', {
          ...describeSchemaIssues(parsedResponse.error),
          templateKey,
          boundary: 'effective_template_response',
        });
        throw new AgentStartupPromptInputError(
          'Agent startup prompt input received a malformed effective template.',
          'effective_template_response',
        );
      }

      const effectiveTemplate = parsedResponse.data.data;
      this.logger.debug('agent_startup_prompt_input.template_response_validated', {
        templateKey: effectiveTemplate.templateKey,
        ownershipSource: effectiveTemplate.ownershipSource.scope,
        revisionId: effectiveTemplate.revisionId,
        revisionNumber: effectiveTemplate.revisionNumber,
        boundary: 'effective_template_response',
      });
      if (effectiveTemplate.templateKey !== templateKey) {
        this.logger.error('agent_startup_prompt_input.template_key_mismatch', {
          templateKey,
          ownershipSource: effectiveTemplate.ownershipSource.scope,
          revisionId: effectiveTemplate.revisionId,
          revisionNumber: effectiveTemplate.revisionNumber,
          boundary: 'effective_template_response',
        });
        throw new AgentStartupPromptInputError(
          'Agent startup prompt input effective template key did not match the request.',
          'effective_template_response',
        );
      }
      if (!sameSelector(effectiveTemplate.selector, selector)) {
        this.logger.error('agent_startup_prompt_input.template_selector_mismatch', {
          templateKey,
          requestedSelector: selector,
          receivedSelector: effectiveTemplate.selector,
          boundary: 'effective_template_response',
        });
        throw new AgentStartupPromptInputError(
          'Agent startup prompt input effective template selector did not match the focal entity.',
          'effective_template_response',
        );
      }
      if (
        effectiveTemplate.ownershipSource.scope ===
          EntityPromptTemplateProjectOwnershipScopeDtoScopeEnum.Project &&
        effectiveTemplate.ownershipSource.projectId !== request.projectId
      ) {
        this.logger.error('agent_startup_prompt_input.template_scope_mismatch', {
          templateKey,
          ownershipSource: effectiveTemplate.ownershipSource.scope,
          revisionId: effectiveTemplate.revisionId,
          revisionNumber: effectiveTemplate.revisionNumber,
          boundary: 'effective_template_response',
        });
        throw new AgentStartupPromptInputError(
          'Agent startup prompt input effective template scope did not match the project.',
          'effective_template_response',
        );
      }

      const provenance: AgentStartupPromptTemplateProvenance = {
        templateKey,
        ownershipSource:
          effectiveTemplate.ownershipSource.scope ===
          EntityPromptTemplateProjectOwnershipScopeDtoScopeEnum.Project
            ? {
                ...effectiveTemplate.ownershipSource,
                projectId: toOpenApiProjectId(effectiveTemplate.ownershipSource.projectId),
              }
            : effectiveTemplate.ownershipSource,
        revisionId: effectiveTemplate.revisionId,
        revisionNumber: effectiveTemplate.revisionNumber,
      };
      template = {
        templateKey,
        selector: effectiveTemplate.selector,
        syntaxVersion: effectiveTemplate.syntaxVersion,
        content: effectiveTemplate.content,
        provenance,
      };
    }

    const reports = await this.loadReports(request, template);
    const renderedInput = renderStartupPromptTemplate(
      template,
      loadedContext,
      reports,
      this.logger,
    );
    this.logger.info('agent_startup_prompt_input.resolved', {
      templateKey: template.templateKey,
      ownershipSource: template.provenance.ownershipSource.scope,
      revisionId: template.provenance.revisionId,
      revisionNumber: template.provenance.revisionNumber,
    });

    return {
      startupInput: buildStartupInput(request, loadedContext),
      renderedInput,
      loadedEntityContext: loadedContext,
      template,
      provenance: template.provenance,
    };
  }

  /**
   * Read the newest saved report of each type the template references, and no
   * others. A template without report references performs no report reads. A
   * failed read stops startup; it is never mistaken for an absent report.
   */
  private async loadReports(
    request: AgentStartupPromptInputRequest,
    template: AgentStartupPromptTemplate,
  ): Promise<EntityPromptTemplateReports> {
    const language = entityPromptTemplateLanguageFor(template.syntaxVersion);
    const referencedTypes = collectReferencedReportTypes(
      parseEntityPromptTemplate(template.content, language).nodes,
    );
    if (referencedTypes.size === 0) {
      return {};
    }

    const fields = { templateKey: template.templateKey, boundary: 'report_read' };
    try {
      const accessToken = await this.auth.getAccessToken();
      const scope = {
        organizationId: request.organizationId,
        projectId: request.projectId,
        accessToken,
        readRestriction: request.readRestriction,
      };
      const reports: Record<string, EntityPromptTemplateReportValue> = {};
      for (const reportType of referencedTypes) {
        if (TEMPLATE_EXCLUDED_REPORT_TYPES.has(reportType)) {
          continue;
        }

        const newest = await this.newestEligibleReport(scope, request, reportType);
        if (newest !== null) {
          reports[reportType] = buildReportValue(newest.report, newest.body.payload);
        }
      }

      this.logger.debug('agent_startup_prompt_input.reports_loaded', {
        ...fields,
        reportTypes: Object.keys(reports),
      });
      return reports;
    } catch (error) {
      this.logger.error('agent_startup_prompt_input.reports_failed', {
        ...fields,
        ...describeCause(error),
      });
      throw new AgentStartupPromptInputError(
        'Agent startup prompt input could not read saved reports referenced by its template.',
        'report_read',
      );
    }
  }

  /**
   * The platform list only returns reports eligible as project knowledge. A
   * report known solely from the Run's chain is checked against its stored
   * eligibility before it can win, so an excluded newer report never displaces
   * an eligible older one.
   */
  private async newestEligibleReport(
    scope: EntityReportReadScope,
    request: AgentStartupPromptInputRequest,
    reportType: string,
  ): Promise<{ report: SelectableReport; body: ReportDto } | null> {
    const stored = await this.reportReader.listNewest(scope, request.runEntity, reportType);
    const verifiedIds = new Set(stored.map((report) => report.reportId));
    let remaining = [...stored, ...this.chainCandidates(request, reportType)];

    for (;;) {
      const newest = selectNewestReport(remaining);
      if (newest === null) {
        return null;
      }

      const body = await this.reportReader.readBody(scope, newest.reportId);
      if (verifiedIds.has(newest.reportId) || body.ragEnabled !== false) {
        return { report: newest, body };
      }

      remaining = remaining.filter((candidate) => candidate.reportId !== newest.reportId);
    }
  }

  /**
   * The Run's chain belongs to its task, so it only speaks for a task focal
   * entity; any other focal entity reads its own reports from the platform.
   */
  private chainCandidates(
    request: AgentStartupPromptInputRequest,
    reportType: string,
  ): SelectableReport[] {
    if (request.runEntity.entityType !== RunEntityType.Task) {
      return [];
    }

    return (request.reportChain ?? [])
      .filter((entry) => entry.reportType === reportType)
      .map((entry) => ({
        reportId: entry.reportId,
        reportType: entry.reportType,
        createdAt: entry.createdAt,
      }));
  }
}
