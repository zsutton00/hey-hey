import { z } from 'zod';
import type { Focal, FocalParent } from '../../jev/scenarios';
import { LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import type { ServerLogger } from '../../server/logger';
import type { LoadedEntityPromptContext } from '../entity-context/types';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import {
  readNearestParentFeature,
  readParentPlan,
  type NearestParentFeatureRequest,
} from '../project-assistant/nearest-parent-feature';
import { allSectionsText, workItemFocal } from './entity-focal';
import { GetContextTrimmer, type DecisionModel } from './context-trimmer';
import { writeGraphResultAttemptRecord } from './get-context-attempt-log';

/** The handlers whose `get_context` results are trimmed: Project Assistant and Feature Sync. */
const TRIMMED_PROMPT_TYPES: ReadonlySet<string> = new Set([
  LocalPromptType.ProjectAssistant,
  LocalPromptType.FeatureSyncAnalyze,
  LocalPromptType.FeatureSyncIterate,
]);

const userMessageSchema = z.object({ userMessage: z.string() });

type TrimmingDeps = Pick<
  PromptTypeHandlerDeps,
  'auth' | 'apiBaseUrl' | 'logger' | 'readRestriction'
>;

type ParentFeature = NonNullable<Awaited<ReturnType<typeof readNearestParentFeature>>>;

/** The feature directly above the focal, else the plan it belongs to, else none. */
const resolveParent = async (
  request: NearestParentFeatureRequest,
  deps: TrimmingDeps,
  readFeature?: ParentFeature,
): Promise<FocalParent | undefined> => {
  const feature = readFeature ?? (await readNearestParentFeature(request, deps));
  if (feature) {
    return { kind: 'feature', name: feature.name, description: allSectionsText(feature.sections) };
  }
  const plan = await readParentPlan(request, deps);
  if (plan) return { kind: 'plan', name: plan.name, description: allSectionsText(plan.sections) };
  return undefined;
};

/**
 * What relevance is judged against: the focal task, feature, mockup or diagram, with its parent when
 * it has one, or the user's message when no work item is loaded. Null when the Run has neither.
 */
export const resolveFocal = async (
  loaded: LoadedEntityPromptContext | null,
  userMessage: string | undefined,
  deps: TrimmingDeps,
  /** The nearest parent feature when the caller has already read it, so it is not read again. */
  readFeature?: ParentFeature,
): Promise<Focal | null> => {
  if (loaded?.kind === 'entity' && 'type' in loaded.entity && 'sections' in loaded.entity) {
    const { entity } = loaded;
    const focal = await workItemFocal(
      entity,
      () =>
        resolveParent(
          {
            organizationId: entity.organizationId,
            projectId: entity.projectId,
            context: loaded.context,
            readRestriction: deps.readRestriction,
          },
          deps,
          readFeature,
        ),
      deps,
    );
    return userMessage ? { ...focal, ask: userMessage } : focal;
  }
  return userMessage ? { kind: 'question', text: userMessage } : null;
};

export interface CreateContextTrimmerInput {
  promptType: string;
  decisionModel: DecisionModel | undefined;
  isDecisionModelEnabled: (() => Promise<boolean>) | undefined;
  loadedEntityContext: LoadedEntityPromptContext | null;
  payload: unknown;
  deps: TrimmingDeps;
  logger: ServerLogger;
  /** Where get_context attempts write development traces; null or absent writes none. */
  attemptLogDir?: string | null;
  /** Where get_edges attempts write development traces; null or absent writes none. */
  edgesAttemptLogDir?: string | null;
}

/**
 * Why a Turn whose `get_context` results could be narrowed never narrows them. Logged and, with
 * an attempt directory, written as a development trace; a trace that cannot be written only warns.
 */
const recordNotStarted = async (
  input: CreateContextTrimmerInput,
  event: string,
  reason: string,
  fields: Record<string, unknown> = {},
): Promise<undefined> => {
  input.logger.warn(event, { reason, ...fields });
  if (!input.attemptLogDir) {
    return undefined;
  }

  try {
    await writeGraphResultAttemptRecord(input.attemptLogDir, {
      outcome: 'not_started',
      at: new Date().toISOString(),
      promptType: input.promptType,
      focalEntityId: input.loadedEntityContext?.focalEntity.entityId ?? null,
      reason,
      fields: {
        ...fields,
        focalEntityType: input.loadedEntityContext?.focalEntity.entityType ?? null,
      },
    });
  } catch (error) {
    input.logger.warn('local.platform_mcp_proxy.get_context_trim.attempt_log_failed', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
  }
  return undefined;
};

/**
 * The trimmer for one Turn, or undefined when the Turn's `get_context` results stay as the
 * platform sent them: no Jev client, another handler, or no focal work to rank against.
 */
export const createContextTrimmer = async (
  input: CreateContextTrimmerInput,
): Promise<GetContextTrimmer | undefined> => {
  if (
    !input.decisionModel ||
    !input.isDecisionModelEnabled ||
    !TRIMMED_PROMPT_TYPES.has(input.promptType)
  ) {
    return undefined;
  }

  let decisionModelEnabled = false;
  try {
    decisionModelEnabled = await input.isDecisionModelEnabled();
  } catch (error) {
    return recordNotStarted(
      input,
      'local.platform_mcp_proxy.context_selection.disabled',
      'option_unavailable',
      { errorName: error instanceof Error ? error.name : 'unknown' },
    );
  }
  if (!decisionModelEnabled) {
    return undefined;
  }

  const loaded = input.loadedEntityContext;
  if (!loaded) {
    return recordNotStarted(
      input,
      'local.platform_mcp_proxy.get_context_trim.disabled',
      'focal_context_not_loaded',
    );
  }

  const userMessage = userMessageSchema.safeParse(input.payload).data?.userMessage.trim();
  let focal: Focal | null;
  try {
    focal = await resolveFocal(loaded, userMessage, input.deps);
  } catch (error) {
    return recordNotStarted(
      input,
      'local.platform_mcp_proxy.get_context_trim.disabled',
      'focal_unavailable',
      { errorName: error instanceof Error ? error.name : 'unknown' },
    );
  }
  if (focal === null) {
    return recordNotStarted(
      input,
      'local.platform_mcp_proxy.get_context_trim.disabled',
      'no_focal_work',
      { hasUserMessage: Boolean(userMessage) },
    );
  }

  return new GetContextTrimmer({
    decisionModel: input.decisionModel,
    focal,
    focalEntityId: loaded.focalEntity.entityId,
    ancestorEntityIds: new Set(
      (loaded.context.featureHierarchy ?? [])
        .filter((entry) => entry.relationship === 'ancestor')
        .map((entry) => entry.id),
    ),
    logger: input.logger,
    ...(input.attemptLogDir ? { attemptLogDir: input.attemptLogDir } : {}),
    ...(input.edgesAttemptLogDir ? { edgesAttemptLogDir: input.edgesAttemptLogDir } : {}),
  });
};
