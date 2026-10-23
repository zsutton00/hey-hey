import type { VerifyFeaturePromptPayload } from '../../shared/agent-bridge-contract/generated';
import { verifyFeatureCompletionPrompt } from '../completion-reconciliation/prompts/common';
import type { LoadedEntityPromptContext } from '../entity-context/types';
import { graphResearchGuidance } from '../prompts/graph-research';
import { focalContextOrientation, lifecycleAwareTaskEditSafety } from '../prompts/common';

const featureName = (loadedEntityContext?: LoadedEntityPromptContext): string | null =>
  loadedEntityContext?.kind === 'entity' && 'name' in loadedEntityContext.entity
    ? loadedEntityContext.entity.name
    : null;

/** The handler's parsed payload: `impactedEntities` is defaulted to [] when omitted. */
type ParsedVerifyFeaturePromptPayload = VerifyFeaturePromptPayload &
  Required<Pick<VerifyFeaturePromptPayload, 'impactedEntities'>>;

export const buildVerifyFeaturePromptSegments = (
  payload: ParsedVerifyFeaturePromptPayload,
  loadedEntityContext?: LoadedEntityPromptContext,
) => {
  const stableInstructions = [
    `You are verifying one flagged concern about a feature. Investigate only that concern. Start from it, not from a general review of the feature, and do not widen the scope to other discrepancies you happen to notice.

${focalContextOrientation}

## How to investigate

1. Read the parent session with \`get_agent_session\`, paging back from the latest messages, to see what was actually done and said.
2. Read what Project Assistant found for that conversation and, if a Feature Sync ran, what it did: call \`list_reports_by_entity\` on the parent session, then \`get_report_body\` on the relevant reports.
3. Compare that evidence with the feature, its tasks, and any governing Diagram, Mockup, Contract or design doc. Keep what you inspected separate from what you infer.
4. If the concern is real, propose the feature, task, Diagram or Mockup updates it warrants. If it is not, explain specifically what you checked and why no update is needed. Never answer "nothing is wrong" without that evidence.

Do not start or request another Feature Sync.`,
    graphResearchGuidance,
    lifecycleAwareTaskEditSafety,
    verifyFeatureCompletionPrompt,
  ].join('\n\n');

  const name = featureName(loadedEntityContext);
  const dynamicContext = [
    `## Flagged concern`,
    `Feature${name ? `: ${name}` : ''}`,
    `Raised after work in agent session \`${payload.parentAgentSessionId}\`:`,
    payload.concern,
    `## Starting points`,
    payload.impactedEntities.length > 0
      ? `The session that raised this concern named these entities as possibly impacted. Start your investigation here, then follow the graph beyond them: that session could not know where the impact ends. Stay on the one flagged concern; only your search for what it touched widens.\n\n${payload.impactedEntities
          .map((entity) => `- ${entity.entityType} \`${entity.entityId}\``)
          .join('\n')}`
      : 'No starting points were named; start from the feature and follow the graph from there.',
  ].join('\n\n');

  return { stableInstructions, dynamicContext };
};

export const buildVerifyFeaturePrompt = (
  payload: ParsedVerifyFeaturePromptPayload,
  loadedEntityContext?: LoadedEntityPromptContext,
): string => {
  const segments = buildVerifyFeaturePromptSegments(payload, loadedEntityContext);
  return `${segments.stableInstructions}\n\n${segments.dynamicContext}`;
};
