import { WorkflowName } from '../../../../../packages/ui-common/src/api/index';
import { LocalPromptType } from '../../../../../packages/ui-common/src/api/index';
import { getMethodConfig } from '../../../../../packages/ui-common/src/agents/coordination/sessionMethodRegistry';
import type { SessionMethod } from '../../../../../packages/ui-common/src/agents/coordination/types';

const NODE_PROMPT_TYPE: Partial<Record<WorkflowName, Record<string, LocalPromptType>>> = {
  [WorkflowName.FeatureSync]: {
    'feature-sync-analyze': LocalPromptType.FeatureSyncAnalyze,
    'feature-sync-iterate': LocalPromptType.FeatureSyncIterate,
  },
  [WorkflowName.PlanFromDesignDoc]: {
    'plan-shaping-proposed-stages': LocalPromptType.PlanShapingProposedStages,
    'plan-shaping-finalize': LocalPromptType.PlanShapingFinalize,
  },
};

/**
 * Per-method fallback prompt type for cases where no current node mapping
 * applies. Reads the handler-arm `handlerPromptType` from the registry;
 * workflow-arm methods have no static handler so they fall through to
 * `null` — the live workflow drives prompt selection in that case.
 */
function fallbackPromptTypeForMethod(sessionMethod: SessionMethod): LocalPromptType | null {
  const dispatch = getMethodConfig(sessionMethod).dispatch;
  return dispatch.kind === 'handler' ? dispatch.handlerPromptType : null;
}

export function resolveNodePromptType(
  workflowName: WorkflowName | null,
  currentNodeId: string | null,
  sessionMethod?: SessionMethod,
): LocalPromptType | null {
  if (workflowName && currentNodeId) {
    const mapped = NODE_PROMPT_TYPE[workflowName]?.[currentNodeId];
    if (mapped) return mapped;
  }
  if (sessionMethod) {
    return fallbackPromptTypeForMethod(sessionMethod);
  }
  return null;
}
