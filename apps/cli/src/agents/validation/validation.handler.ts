/**
 * `validation_walkthrough` prompt-type handler.
 *
 * The validation agent reads prior plan and implement reports for the
 * in-scope entity (a task, a parent task with split children, or a plan
 * stage) and authors a single VALIDATION_WALKTHROUGH report describing the
 * ordered steps a human or follow-up agent can replay to confirm the work
 * behaves as intended.
 *
 * The turn terminates naturally when the agent calls `create_report` via the
 * run-scoped submission tool wrapper. There is no submission tool, no Bash,
 * no HTTP — the handler exposes only the read-only platform MCP tools the
 * prompt mentions; `create_report` is provided by the base submission tools.
 */

import {
  LocalPromptType,
  type LocalValidationWalkthroughPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import { ReportAudience, ReportType } from '../../shared/api/index';
import type { PromptTypeHandler } from '../prompt-type-handler';
import { buildValidationWalkthroughPrompt } from './prompts';

export const validationWalkthroughHandler: PromptTypeHandler<LocalValidationWalkthroughPromptPayload> =
  {
    id: 'validation_walkthrough',
    promptType: LocalPromptType.ValidationWalkthrough,
    service: 'required',
    launchEntity: 'required',
    implementationReadiness: 'none',
    projectAssistant: {
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'all',
    },
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [
      {
        reportType: ReportType.ValidationWalkthrough,
        audience: ReportAudience.ProjectVisible,
        required: true,
      },
    ],
    additionalAllowedTools: [
      'list_reports_by_entity',
      'get_report_body',
      'get_report_schema',
      'get_context',
      'get_full_entity',
    ],

    buildPrompt(payload: LocalValidationWalkthroughPromptPayload): string {
      return buildValidationWalkthroughPrompt({
        scope: payload.scope,
        entityId: payload.entityId,
      });
    },

    buildStartingMessage(): string | null {
      return 'Mapping out how to validate the work...';
    },
  };
