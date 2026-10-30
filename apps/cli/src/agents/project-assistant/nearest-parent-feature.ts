import { isAxiosError } from 'axios';

import {
  Configuration,
  TasksApi,
  type FullEntityContextDto,
  type MaterializedWorkItemSection,
  type TaskResponseDto,
} from '../../shared/api/generated';
import type { LoadedEntityPromptContext } from '../entity-context/types';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import {
  recordJevCalls,
  writeAttemptRecord,
  type ParentRequirementsAttemptRecord,
} from './parent-requirements-attempt-log';
import {
  EXPECTED_UNFILTERED_REASONS,
  filterParentRequirements,
  ParentRequirementsUnfiltered,
  REQUIREMENTS_SECTION_KEY,
  type ParentRequirementsFilter,
} from './parent-requirements';

export interface NearestParentFeatureRequest {
  organizationId: string;
  projectId: string;
  context: FullEntityContextDto;
}

/** Project Assistant cannot run without its parent feature; the Run must stop visibly. */
export class ProjectAssistantPreparationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ProjectAssistantPreparationError';
  }
}

/**
 * The focal context carries only a short preview of each ancestor
 * feature. Project Assistant needs the nearest one in full, so the CLI reads
 * it here instead of relying on the agent to.
 */
export const findNearestParentFeatureId = (context: FullEntityContextDto): string | null =>
  context.featureHierarchy?.find(
    (entry) =>
      entry.relationshipType === 'structural' &&
      entry.relationship === 'ancestor' &&
      entry.distance === 1,
  )?.id ?? null;

const readParentTask = async (
  request: NearestParentFeatureRequest,
  parent: 'feature' | 'plan',
  taskId: string,
  deps: Pick<PromptTypeHandlerDeps, 'auth' | 'apiBaseUrl' | 'logger'>,
): Promise<TaskResponseDto | undefined> => {
  const accessToken = await deps.auth.getAccessToken();
  const client = new TasksApi(new Configuration({ accessToken, basePath: deps.apiBaseUrl }));
  try {
    const response = await client.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet({
      organizationId: request.organizationId,
      projectId: request.projectId,
      taskId,
    });
    return response.data.data;
  } catch (error) {
    if (!isAxiosError(error)) throw error;
    const status = error.response?.status ?? null;
    const path = error.config?.url ?? null;
    deps.logger.error(`project_assistant.prepare.parent_${parent}.read_failed`, {
      taskId,
      status,
      path,
      body: String(error.response?.data ?? '').slice(0, 500),
    });
    throw new ProjectAssistantPreparationError(
      `Project Assistant could not read parent ${parent} ${taskId}: HTTP ${status ?? 'no response'} from ${path ?? 'unknown path'}.`,
    );
  }
};

/**
 * The plan a planned task belongs to, read in full; null when the focal is not in a plan. Plans
 * are canonical Tasks, so the plan context's reference reads through the Tasks API.
 */
export const readParentPlan = async (
  request: NearestParentFeatureRequest,
  deps: Pick<PromptTypeHandlerDeps, 'auth' | 'apiBaseUrl' | 'logger'>,
): Promise<(TaskResponseDto & { sections: MaterializedWorkItemSection[] }) | null> => {
  const planId = request.context.planContext?.parentPlan?.id;
  if (!planId) return null;
  const plan = await readParentTask(request, 'plan', planId, deps);
  if (plan?.id !== planId || plan.type !== 'PLAN' || !plan.sections) {
    deps.logger.error('project_assistant.prepare.parent_plan.malformed', {
      planId,
      receivedId: plan?.id ?? null,
      receivedType: plan?.type ?? null,
      hasSections: Boolean(plan?.sections),
    });
    throw new ProjectAssistantPreparationError(
      `Project Assistant received a malformed parent plan ${planId}.`,
    );
  }
  return { ...plan, sections: plan.sections };
};

/** Null when the focal entity has no parent feature. */
export const readNearestParentFeature = async (
  request: NearestParentFeatureRequest,
  deps: Pick<PromptTypeHandlerDeps, 'auth' | 'apiBaseUrl' | 'logger'>,
): Promise<(TaskResponseDto & { sections: MaterializedWorkItemSection[] }) | null> => {
  const featureId = findNearestParentFeatureId(request.context);
  if (featureId === null) {
    deps.logger.debug('project_assistant.prepare.parent_feature.none', {
      entityId: request.context.entityId,
    });
    return null;
  }

  const feature = await readParentTask(request, 'feature', featureId, deps);
  if (feature?.id !== featureId || feature.type !== 'FEATURE' || !feature.sections) {
    deps.logger.error('project_assistant.prepare.parent_feature.malformed', {
      featureId,
      receivedId: feature?.id ?? null,
      receivedType: feature?.type ?? null,
      hasSections: Boolean(feature?.sections),
    });
    throw new ProjectAssistantPreparationError(
      `Project Assistant received a malformed parent feature ${featureId}.`,
    );
  }
  return { ...feature, sections: feature.sections };
};

const renderSections = (
  sections: readonly MaterializedWorkItemSection[],
  markdownOf: (section: MaterializedWorkItemSection) => string = (section) =>
    section.materializedMarkdown,
): string =>
  [...sections]
    .sort((a, b) => a.order - b.order)
    .map((section) => ({ key: section.key, markdown: markdownOf(section).trim() }))
    .filter(({ markdown }) => markdown.length > 0)
    .map(({ key, markdown }) => `### ${key}\n\n${markdown}`)
    .join('\n\n');

/** With a filter, Jev picks which requirements load in full; anything that stops it keeps the full load. */
export interface ParentFeatureFilterInput {
  settings: ParentRequirementsFilter;
  loaded: LoadedEntityPromptContext;
}

export const loadNearestParentFeatureSection = async (
  request: NearestParentFeatureRequest,
  deps: Pick<PromptTypeHandlerDeps, 'auth' | 'apiBaseUrl' | 'logger'>,
  filter?: ParentFeatureFilterInput,
): Promise<string | null> => {
  const feature = await readNearestParentFeature(request, deps);
  if (feature === null) return null;

  const fullBody = renderSections(feature.sections);
  deps.logger.info('project_assistant.prepare.parent_feature.loaded', {
    featureId: feature.id,
    sectionCount: feature.sections.length,
  });
  const heading = `## Nearest parent feature\n\n@[feature:${feature.id}|${feature.name}]`;
  const fullSection = `${heading}, in full.\n\n${fullBody}`;
  if (!filter) return fullSection;

  const recorder = recordJevCalls(filter.settings.jevClient);
  const attempt = {
    at: new Date().toISOString(),
    focalEntityId: filter.loaded.focalEntity.entityId,
    parentFeatureId: feature.id,
    jevCalls: recorder.calls,
    fullLoad: fullSection,
  } satisfies Omit<ParentRequirementsAttemptRecord, 'outcome'>;
  const writeAttempt = async (record: ParentRequirementsAttemptRecord): Promise<void> => {
    try {
      const file = await writeAttemptRecord(filter.settings.attemptLogDir, record);
      deps.logger.info('project_assistant.prepare.parent_feature.attempt_logged', { file });
    } catch (error) {
      deps.logger.warn('project_assistant.prepare.parent_feature.attempt_log_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  try {
    if (!feature.sections.some((section) => section.key === REQUIREMENTS_SECTION_KEY)) {
      throw new ParentRequirementsUnfiltered('no_requirements_section');
    }
    const filtered = await filterParentRequirements(request, feature, filter.loaded, {
      ...filter.settings,
      jevClient: recorder.evaluator,
    });
    const body = renderSections(feature.sections, (section) =>
      section.key === REQUIREMENTS_SECTION_KEY
        ? filtered.requirementsMarkdown
        : section.materializedMarkdown,
    );
    const section = `${heading}: description in full, with only the requirements judged relevant to this work in full.\n\n${body}`;
    deps.logger.info('project_assistant.prepare.parent_feature.filter_stats', {
      featureId: feature.id,
      filtered: true,
      rawChars: fullSection.length,
      trimmedChars: section.length,
      requirementsInFull: filtered.fullCount,
      requirementsAsTitles: filtered.titleCount,
      jevCalled: filtered.jevCalled,
      jevDurationMs: Math.round(filtered.jevDurationMs),
      inputTokens: filtered.inputTokens,
      outputTokens: filtered.outputTokens,
    });
    await writeAttempt({ ...attempt, outcome: 'filtered', filteredLoad: section });
    return section;
  } catch (error) {
    const expected =
      error instanceof ParentRequirementsUnfiltered &&
      EXPECTED_UNFILTERED_REASONS.has(error.reason);
    deps.logger[expected ? 'info' : 'warn'](
      'project_assistant.prepare.parent_feature.filter_failed',
      {
        featureId: feature.id,
        reason: error instanceof ParentRequirementsUnfiltered ? error.reason : 'unexpected_error',
        ...(error instanceof ParentRequirementsUnfiltered
          ? error.fields
          : { error: error instanceof Error ? error.message : String(error) }),
      },
    );
    deps.logger.info('project_assistant.prepare.parent_feature.filter_stats', {
      featureId: feature.id,
      filtered: false,
      rawChars: fullSection.length,
      trimmedChars: fullSection.length,
    });
    await writeAttempt({
      ...attempt,
      outcome: 'unfiltered',
      ...(error instanceof ParentRequirementsUnfiltered
        ? { unfilteredReason: error.reason, unfilteredFields: error.fields }
        : {
            unfilteredReason: 'unexpected_error',
            error: error instanceof Error ? (error.stack ?? error.message) : String(error),
          }),
    });
    return fullSection;
  }
};
