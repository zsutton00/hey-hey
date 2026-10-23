import type { SessionMonitorPromptPayload } from '../../shared/agent-bridge-contract/generated';
import type { SessionMonitorEvaluationContext } from './session-monitor-evaluation-store';

export type SessionMonitorPromptInput =
  | SessionMonitorPromptPayload
  | { readonly evaluation: SessionMonitorEvaluationContext };

const json = (value: object): string => JSON.stringify(value, null, 2);

/** Deterministic one-shot settled-Turn evaluation prompt. */
export const buildSessionMonitorPrompt = (input: SessionMonitorPromptInput): string => {
  const view = 'evaluation' in input
    ? {
        reports: input.evaluation.reports,
        actions: input.evaluation.availableActions,
        turnId: input.evaluation.turnId,
        completedAssistantContent: input.evaluation.completedAssistantContent,
        workflow: input.evaluation.workflow,
      }
    : {
        reports: input.settledTurn.reports,
        actions: input.workflowContext.actions,
        turnId: input.settledTurn.turnId,
        completedAssistantContent: input.settledTurn.completedAssistantMessage?.content ?? null,
        workflow: {
          state: input.workflowContext.state,
          promptType: input.workflowContext.promptType,
          nodeId: input.workflowContext.nodeId,
          triggerMessageId: input.workflowContext.triggerMessageId,
        },
      };
  const { reports, actions, turnId, completedAssistantContent, workflow } = view;
  const reportReads = reports
    .map(
      ({ reportId, reportType }, index) =>
        `${String(index + 1)}. Call \`get_report_body\` with \`reportId\` = \`${reportId}\` (${reportType}).`,
    )
    .join('\n');
  const continuationRule = actions.length
    ? `CONTINUE must use { "action": <one of ${JSON.stringify(actions)}>, "response"?: "<optional text>" }.`
    : 'CONTINUE must use the response-only shape { "response": "<the exact user-like reply>" }.';

  return `You are the Session Monitor. Evaluate exactly one settled Agent Session Turn with at least one subscribed canonical Report and return one JSON decision.

## Settled Turn evidence

${json({
  turnId,
  completedAssistantContent,
})}

## Current Agent Session workflow context

${json(workflow)}

## Canonical Report reads

${reportReads}

## FEATURE_SYNC_DECISION reports

When a canonical Report read has \`reportType\` = \`FEATURE_SYNC_DECISION\`, inspect the envelope \`schemaVersion\` before choosing a response:

- For version 1 (including an omitted \`schemaVersion\`), preserve the legacy numbered behavior. Read \`payload.reconciliationOptions\`, choose one supplied option, and describe that choice as ordinary user-like response text.
- For version 2, read \`payload.decisionGroups\` as independent decisions. Even when groups have overlapping \`affectedEntities\`, evaluate every group separately and choose exactly one supplied choice per group by its stable \`group.id\` and \`choice.id\`. Do not infer or invent choices from the affected entities. When no change is appropriate, choose the producer-authored choice with \`isNoChange: true\`.
- Combine every version-2 selection into one readable response, naming each group by its \`title\` and the selected choice by its \`label\`. Keep an explicit no-change selection in that response when it is chosen.
- Version-1 options and version-2 choices are response guidance only. They do not approve proposals and must never be copied into \`continuationCompletion.action\`, including as an option number, group id, or choice id. Use \`continuationCompletion.action\` only for an action from the available workflow vocabulary; when that vocabulary is empty, use the response-only shape.

## Decision policy

- CONTINUE when you can safely supply the next workflow action or user-like response from the canonical evidence.
- DEFER when session-owned work remains but a safe continuation requires user judgment. Explain the substantive reason in \`reasoning\`.
- Treat an unreadable referenced Report or contradictory evidence as DEFER.
- Never invent an action. ${continuationRule}

\`content\` is user-visible: write one or two direct sentences without internal disposition or routing jargon.

## Output

Return exactly one JSON object and no prose, using one of these shapes:

\`\`\`json
{ "disposition": "CONTINUE", "content": "<user-visible text>", "continuationCompletion": ${
    actions.length
      ? '{ "action": "<allowed action>", "response": "<optional text>" }'
      : '{ "response": "<exact user-like reply>" }'
  } }
{ "disposition": "DEFER", "content": "<user-visible request>", "reasoning": "<durable explanation>" }
\`\`\``;
};
