/**
 * Completion tools owned by the Coding Plan handler.
 *
 * The tool names describe the product decision the planner is making. Their
 * wire actions come from the generated Coding Plan action contract: approval
 * advances with APPROVED, while a requested revision re-enters planning with
 * REFINE. Neither tool accepts a payload because the complete PLAN report is
 * persisted separately before the completion action is posted.
 */

import {
  CodingPlanActionSchemasAPPROVEDActionEnum,
  CodingPlanActionSchemasREFINEActionEnum,
} from '../../shared/agent-bridge-contract/generated/api';
import type {
  ActionSubmissionToolDeclaration,
  SubmissionToolDeclaration,
  SubmissionToolInputSchema,
} from '../submission-tools/types';

export const CODING_PLAN_ACTIONS = {
  APPROVED: CodingPlanActionSchemasAPPROVEDActionEnum.Approved,
  REFINE: CodingPlanActionSchemasREFINEActionEnum.Refine,
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

const submitRevisedTool: ActionSubmissionToolDeclaration = {
  name: 'submit_revised',
  description:
    'After incorporating the latest user feedback and persisting the changed PLAN report, call this with no arguments. Emits the generated REFINE completion action for another planning pass.',
  inputSchema: emptyInputSchema,
  execute: () => ({ action: CODING_PLAN_ACTIONS.REFINE }),
  hidden: true,
};

export const codingPlanSubmissionTools: ReadonlyArray<SubmissionToolDeclaration> = [
  submitApprovedTool,
  submitRevisedTool,
];
