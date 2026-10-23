/**
 * Completion tools owned by the Coding Plan handler.
 *
 * The planner owns only approval: when the latest user reply accepts the
 * plan, `submit_approved` advances the workflow with the generated APPROVED
 * action. REFINE is a user-authored answer (Continue Refining) that starts a
 * planning pass, so the planner never emits it — a revision turn persists its
 * PLAN report and leaves the node waiting for the user's next answer. The tool
 * takes no payload because the PLAN report is persisted separately.
 */

import { CodingPlanActionSchemasAPPROVEDActionEnum } from '../../shared/agent-bridge-contract/generated/api';
import type {
  ActionSubmissionToolDeclaration,
  SubmissionToolDeclaration,
  SubmissionToolInputSchema,
} from '../submission-tools/types';

export const CODING_PLAN_ACTIONS = {
  APPROVED: CodingPlanActionSchemasAPPROVEDActionEnum.Approved,
} as const;

const emptyInputSchema: SubmissionToolInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

const submitApprovedTool: ActionSubmissionToolDeclaration = {
  name: 'submit_approved',
  description:
    'After the current PLAN report is complete and the latest user reply clearly approves it, call this with no arguments. Emits the generated APPROVED completion action.',
  inputSchema: emptyInputSchema,
  execute: () => ({ action: CODING_PLAN_ACTIONS.APPROVED }),
  hidden: true,
};

export const codingPlanSubmissionTools: ReadonlyArray<SubmissionToolDeclaration> = [
  submitApprovedTool,
];
