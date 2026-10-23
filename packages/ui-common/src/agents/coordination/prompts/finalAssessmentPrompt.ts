import type {
  AgentWorkflowContext,
  FinalAssessmentStartupDiscrepancyContextItem,
  StartupPromptInput,
} from "../types";
import { resolveFinalAssessmentTaskNeighborhood } from "../finalAssessmentTaskNeighborhood";
import {
  formatFinalAssessmentStartupDiscrepancyContext,
  formatFinalAssessmentTaskNeighborhood,
  formatStartupPromptInput,
  jsonOnlyInstructions,
  stringifyContext,
} from "./common";

const toPlainString = (value: unknown): string =>
  typeof value === "string" ? value : "";

export const buildFinalAssessmentPrompt = async (input: {
  context: AgentWorkflowContext;
  startupInput: StartupPromptInput;
  startupDiscrepancyContext?: FinalAssessmentStartupDiscrepancyContextItem[];
  executionSummary: string;
}): Promise<string> => {
  const taskNeighborhood = await resolveFinalAssessmentTaskNeighborhood({
    organizationId: input.context.organizationId,
    projectId: input.context.projectId,
    planId: toPlainString(input.context.planId),
    taskId: toPlainString(input.context.taskId || input.startupInput.task?.id),
  });

  return `Execute the following prompt inside the <prompt></prompt> tags exactly. Return JSON only. No commentary.
<prompt>
You are producing the end-of-lifecycle assessment for a completed coding session.

Your goals:
1. Give a final verdict on task completion with explicit rationale.
2. Provide user-reviewable artifact updates with concrete, directly-applicable payload values.
3. Flag evidence items that are materially wrong or outdated.

Session context:
${stringifyContext(input.context)}

Startup inputs:
${formatStartupPromptInput(input.startupInput)}

Startup discrepancy context:
${formatFinalAssessmentStartupDiscrepancyContext(
  input.startupDiscrepancyContext ?? []
)}

Task neighborhood context:
${formatFinalAssessmentTaskNeighborhood(taskNeighborhood)}

Execution summary:
${input.executionSummary}

Return a strict JSON object with this exact structure and lowerCamel keys:
{
  "responseType": "final_assessment_v2",
  "taskAssessment": {
    "target": {
      "entityType": "task",
      "entityId": "task id or empty string if unavailable"
    },
    "verdict": "completed|partiallyCompleted|blocked|notCompleted|unknown",
    "statusRecommendation": {
      "status": "GENERATED|BACKLOG|REFINING_DESCRIPTION|REFINING_DETAILS|REFINING_ACCEPTANCE_CRITERIA|GENERATING_DESCRIPTION|GENERATING_DETAILS|GENERATING_DESCRIPTION_AND_DETAILS|GENERATING_ACCEPTANCE_CRITERIA|GENERATING_ALL|ACTIVE|ON_HOLD|VERIFYING|COMPLETED|CANCELLED|ARCHIVED",
      "reason": "one or two sentences"
    },
    "summary": "one to three sentences"
  },
  "implementationNotes": "one to five sentences describing concrete implementation changes completed in this session",
  "artifactUpdateSuggestions": [
    {
      "target": {
        "entityType": "task|designDoc|implementationHint",
        "entityId": "target id or empty string if unknown"
      },
      "updateType": "task_details|task_acceptance_criteria|design_doc_revision|implementation_hint_create|implementation_hint_update",
      "updatePayload": {},
      "reasoning": "one or two sentences",
      "sourceRefs": [
        {
          "sourceType": "evidenceItem|task|designDoc|plan|initiative|sessionOutput",
          "sourceId": "id from input or sessionOutput"
        }
      ]
    }
  ],
  "evidenceCorrections": [
    {
      "target": {
        "entityType": "evidenceItem",
        "entityId": "evidence item id"
      },
      "severity": "low|medium|high",
      "issueType": "outdated|incorrect|conflicting|missing_context",
      "reasoning": "one or two sentences",
      "suggestedReplacement": "one to three sentences",
      "sourceExcerpt": "one or two full sentences from the original evidence when possible"
    }
  ],
  "validationRecommendationsSummary": "one to three sentences summarizing the most important recommended validation checks",
  "validationRecommendations": [
    {
      "stepId": "stable id for this check within the session",
      "title": "short validation title",
      "stepDescription": "what to validate and why",
      "target": {
        "filePath": "optional file path",
        "serviceId": "optional service id",
        "endpoint": "optional endpoint, route, or command",
        "uiFlow": "optional user flow to validate"
      },
      "preconditions": [
        "required setup or precondition"
      ],
      "expectedResult": "expected observable outcome when step succeeds",
      "executionType": "manual|automated",
      "estimatedEffort": 15,
      "confidence": 0.0,
      "fileReferences": [
        {
          "filePath": "path/to/file.ts",
          "startLine": 1,
          "endLine": 12
        }
      ]
    }
  ],
  "openQuestions": [
    {
      "question": "question text",
      "reason": "why answer is needed before persisting updates"
    }
  ]
}

Rules:
- Focus on materially meaningful updates, not minor wording edits.
- Every artifactUpdateSuggestions entry must include a target and updatePayload.
- implementationNotes must summarize concrete code or behavior changes completed in this session; do not describe planned or hypothetical work.
- Assess task completion against effective acceptance criteria: the task's existing acceptanceCriteria plus any explicit user-approved adjustments recorded in startup discrepancy handling or execution summary.
- Treat startup-logged discrepancies that were explicitly acknowledged/approved as resolved context, not blockers.
- Treat startup discrepancy context as a high-priority signal for evidenceCorrections, especially when sourceRef.sourceType is evidenceItem.
- Include evidenceCorrections when startup discrepancies reveal stale or inaccurate evidence, even if the discrepancy was acknowledged.
- Treat execution-summary statements like "skipped by request", "deferred by request", or equivalent explicit user approvals as resolved for verdict purposes, not as incompleteness.
- A completed verdict is valid when effective acceptance criteria are satisfied and any remaining differences were already acknowledged/approved.
- Do not lower the verdict solely because an originally listed criterion was explicitly waived or changed by user request during this session.
- Lower the verdict only for unresolved discrepancies or new material gaps that were not previously acknowledged/approved.
- If approved discrepancy handling changed the lasting definition of done, suggest a task_acceptance_criteria update with the exact final criteria text to persist.
- Use parentTasks to verify whether discrepancy context was already known/accepted in upstream work.
- Use childTasks to identify readiness follow-ups, but do not lower completion solely because child tasks remain undone unless the active task acceptanceCriteria explicitly requires those outcomes.
- Match updatePayload shape to updateType:
  - task_details: include description and/or acceptanceCriteria.
  - task_acceptance_criteria: include acceptanceCriteria.
  - design_doc_revision: include one or more of status, summary, or sections.
  - implementation_hint_create: include description, featureName, and sourceType ("USER" or "SYSTEM").
  - implementation_hint_update: include at least one of description, featureName, sourceType, or agentSessionIds.
- Do not propose task_status artifact updates.
- taskAssessment.statusRecommendation must align to acceptanceCriteria-based completeness only.
- updatePayload must contain the final replacement content/state, not instructions about what to change.
- Do not write instructional phrasing like "update X to say..." or "change Y to...".
- For text fields (task description, acceptance criteria, design doc summary/sections, hint description), provide the exact text to persist.
- For text fields, return plain persisted content only; do not include diff markers/tags such as <ins>, <del>, <insert>, or <delete>.
- Treat task description/acceptanceCriteria as canonical artifact fields, not execution summaries.
- Do not replace task description/acceptanceCriteria with session narrative framing (for example, "this session implemented..." or "we added...") unless that phrasing already exists in the task text and you are making a minimal edit to it.
- When suggesting task/design-doc edits, make the smallest possible textual and structural changes while emulating existing wording, tone, and organization.
- Preserve existing task/design-doc text outside the directly affected portion; apply minimal-delta edits only.
- For partial implementation sessions, assess completion and recommend updates only for portions evidenced as implemented in this session; do not rewrite untouched task portions.
- For implementation_hint_create, do not use fields like title/content as replacements for featureName/sourceType.
- Scope artifactUpdateSuggestions and validationRecommendations to surfaces explicitly worked on in this coding session (based on execution summary and session outputs).
- Do not propose rewrites for untouched services/components (for example, API service updates when only ui-common was changed).
- If related cross-service work is needed but was not worked on in this session, capture it in openQuestions and do not emit it as an artifactUpdateSuggestion.
- If out-of-repo or out-of-session work is required but not implemented here, capture it in openQuestions instead of rewriting task description/acceptanceCriteria.
- In artifactUpdateSuggestions.reasoning and validationRecommendations.stepDescription, explicitly name the touched surface being updated or validated.
- Every evidenceCorrections entry must point to a specific evidence item id.
- validationRecommendationsSummary must be present even when validationRecommendations is empty.
- Every validationRecommendations entry must include stepId, title, stepDescription, target, preconditions, expectedResult, executionType, estimatedEffort, and confidence.
- Do not include provenance in validationRecommendations; provenance is system-populated downstream.
- validationRecommendations.target must include at least one of: filePath, serviceId, endpoint, uiFlow.
- confidence must be a number between 0 and 1.
- estimatedEffort is an integer number of minutes.
- fileReferences is optional; when present, each entry must include filePath, startLine, and endLine.
- If there are no artifact updates, return an empty artifactUpdateSuggestions array.
- If there are no evidence corrections, return an empty evidenceCorrections array.
- If there are no validation recommendations, return an empty validationRecommendations array.
- If there are no open questions, return an empty openQuestions array.

${jsonOnlyInstructions}
</prompt>`;
};
