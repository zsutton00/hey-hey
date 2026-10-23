/**
 * `plan_shaping_feature_sync_analyze` prompt-type handler.
 *
 * Invoked by the CLI when the plan-shaping flow's analyze EXTERNAL_AGENT node
 * is active — the pre-check that runs before plan stages are proposed. Unlike
 * the task-seeded feature-sync analyze handler, this one anchors on the plan
 * and its design doc: the design doc is the authoritative statement of the
 * work about to happen, and the walk compares it against the feature tree the
 * plan's parent task hangs from.
 *
 * The clean-pass path calls `submit_no_discrepancy`; the flagged path first
 * persists a FEATURE_SYNC_DECISION report carrying the discrepancy rows and
 * reconciliation options, then calls `submit_discrepancies` with the full
 * discrepancies list on the same turn as the findings table. No `prepare` is
 * needed — `get_full_entity`, `get_feature_sync_context`, and
 * `search_features` are all in the base provider tool list.
 * `edit_work_item` is also in that base list, but the analyze contract
 * forbids using it: this turn flags and suggests (remediations travel as
 * text in the verdict payload), it never authors proposals.
 *
 * Analyze and iterate are distinct logical agents. A transition between them
 * mints iterate's own provider session and tool surface.
 */

import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { LocalPlanShapingFeatureSyncAnalyzePromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import { ReportAudience, ReportType } from '../../shared/api/index';
import { turnUserMessageBlock, type UserLaunchablePromptTypeHandler } from '../prompt-type-handler';
import { buildPlanShapingAnalyzePrompt } from './prompts';
import { structuralAnalyzeSubmissionTools } from '../feature-sync/submission-tools';

export const planShapingFeatureSyncAnalyzeHandler: UserLaunchablePromptTypeHandler<LocalPlanShapingFeatureSyncAnalyzePromptPayload> =
  {
    id: LocalPromptType.PlanShapingFeatureSyncAnalyze,
    promptType: LocalPromptType.PlanShapingFeatureSyncAnalyze,
    service: 'optional',
    launchEntity: 'required',
    implementationReadiness: 'none',
    expectedResponseTypes: ['plan_shaping_feature_sync_analyze_v1'],
    projectAssistant: {
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'all',
    },
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [
      {
        reportType: ReportType.FeatureSyncDecision,
        audience: ReportAudience.ProjectVisible,
        required: false,
      },
    ],
    additionalAllowedTools: ['get_report_schema'],

    submissionTools: [...structuralAnalyzeSubmissionTools],

    addUserMessage: (payload) => turnUserMessageBlock(payload.userMessage),

    buildPrompt(payload: LocalPlanShapingFeatureSyncAnalyzePromptPayload): string {
      return buildPlanShapingAnalyzePrompt({
        planId: payload.planId,
        designDocId: payload.designDocId,
      });
    },

    buildStartingMessage(): string | null {
      return 'Double-checking the product structure before we lay out the stages...';
    },
  };
