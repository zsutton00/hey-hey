import { z } from 'zod';
import type { JevClient } from '../../jev/client';
import type { Focal, FocalParent } from '../../jev/scenarios';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { ServerLogger } from '../../server/logger';
import type { LoadedEntityPromptContext } from '../entity-context/types';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import {
  readNearestParentFeature,
  readParentPlan,
  type NearestParentFeatureRequest,
} from '../project-assistant/nearest-parent-feature';
import { allSectionsText, workItemFocal } from './entity-focal';
import { GetContextTrimmer, type JevResponseCache } from './context-trimmer';

/** The handlers whose `get_context` results are trimmed: Project Assistant and Feature Sync. */
const TRIMMED_PROMPT_TYPES: ReadonlySet<string> = new Set([
  LocalPromptType.ProjectAssistant,
  LocalPromptType.FeatureSyncAnalyze,
  LocalPromptType.FeatureSyncIterate,
]);

const userMessageSchema = z.object({ userMessage: z.string() });

type TrimmingDeps = Pick<PromptTypeHandlerDeps, 'auth' | 'apiBaseUrl' | 'logger'>;

/** The feature directly above the focal, else the plan it belongs to, else none. */
const resolveParent = async (
  request: NearestParentFeatureRequest,
  deps: TrimmingDeps,
): Promise<FocalParent | undefined> => {
  const feature = await readNearestParentFeature(request, deps);
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
): Promise<Focal | null> => {
  if (loaded?.kind === 'entity' && 'type' in loaded.entity && 'sections' in loaded.entity) {
    const { entity } = loaded;
    return workItemFocal(
      entity,
      () =>
        resolveParent(
          {
            organizationId: entity.organizationId,
            projectId: entity.projectId,
            context: loaded.context,
          },
          deps,
        ),
      deps,
    );
  }
  return userMessage ? { kind: 'question', text: userMessage } : null;
};

export interface CreateContextTrimmerInput {
  promptType: string;
  /** Null without a TypeSafe key: results are then never trimmed. */
  jevClient: JevClient | undefined;
  cache: JevResponseCache;
  loadedEntityContext: LoadedEntityPromptContext | null;
  payload: unknown;
  deps: TrimmingDeps;
  logger: ServerLogger;
}

/**
 * The trimmer for one Turn, or undefined when the Turn's `get_context` results stay as the
 * platform sent them: no Jev client, another handler, or no focal work to rank against.
 */
export const createContextTrimmer = async (
  input: CreateContextTrimmerInput,
): Promise<GetContextTrimmer | undefined> => {
  if (!input.jevClient || !TRIMMED_PROMPT_TYPES.has(input.promptType)) return undefined;
  const loaded = input.loadedEntityContext;
  if (!loaded) {
    input.logger.warn('local.platform_mcp_proxy.get_context_trim.disabled', {
      reason: 'focal_context_not_loaded',
    });
    return undefined;
  }
  const userMessage = userMessageSchema.safeParse(input.payload).data?.userMessage.trim();
  let focal: Focal | null;
  try {
    focal = await resolveFocal(loaded, userMessage, input.deps);
  } catch (error) {
    input.logger.warn('local.platform_mcp_proxy.get_context_trim.disabled', {
      reason: 'focal_unavailable',
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
  if (focal === null) {
    input.logger.warn('local.platform_mcp_proxy.get_context_trim.disabled', {
      reason: 'no_focal_work',
    });
    return undefined;
  }
  return new GetContextTrimmer({
    client: input.jevClient,
    focal,
    focalEntityId: loaded.focalEntity.entityId,
    cache: input.cache,
    logger: input.logger,
  });
};
