/**
 * Submission tools for the feature-sync EXTERNAL_AGENT nodes.
 *
 * These declarations mirror the server-side action contract declared in
 * `api/src/flows/nodes/feature-sync/schemas.ts`. The server re-validates
 * incoming agent-authored completion messages with Zod against that same
 * contract, so any drift here (action name, payload field names, required
 * fields) is caught at the engine boundary — but keeping both sides aligned
 * avoids needless rejection loops.
 *
 * Action keys are deliberately exported as a plain `as const` map so tests
 * and handlers can reference them by name rather than stringly-typed literals.
 */

import {
  SubmissionToolCorrectableError,
  type SubmissionToolDeclaration,
  type SubmissionToolInputSchema,
} from '../submission-tools/types';
import { implementationReadinessDispositionSchema } from '../implementation-readiness/session-context';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';

export const FEATURE_SYNC_ACTIONS = {
  NO_DISCREPANCY: 'NO_DISCREPANCY',
  DISCREPANCY: 'DISCREPANCY',
  RESOLVED: 'RESOLVED',
  REVISED: 'REVISED',
  READINESS_CLEAR: 'READINESS_CLEAR',
  READINESS_REVIEW_REQUIRED: 'READINESS_REVIEW_REQUIRED',
} as const;

/**
 * JSON Schema for the discrepancy-list payload, matching
 * `discrepancyListPayloadSchema` on the server. Kept verbose (one `const`
 * rather than inlined) so both DISCREPANCY and REVISED tools share the same
 * literal shape and cannot drift independently.
 */
const discrepancyItemSchema = {
  type: 'object',
  required: ['summary', 'rationale'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 },
    summary: { type: 'string', minLength: 1 },
    rationale: { type: 'string', minLength: 1 },
    entityType: {
      type: 'string',
      enum: ['FEATURE', 'TASK', 'DESIGN_DOC', 'SERVICE', 'OTHER'],
    },
    entityId: { type: 'string' },
    proposal: { type: 'string' },
  },
} as const;

const discrepancyListInputSchema: SubmissionToolInputSchema = {
  type: 'object',
  required: ['discrepancies'],
  additionalProperties: false,
  properties: {
    discrepancies: {
      type: 'array',
      minItems: 1,
      items: discrepancyItemSchema,
    },
  },
};

const planShapingRevisedListInputSchema: SubmissionToolInputSchema = {
  type: 'object',
  required: ['discrepancies'],
  additionalProperties: false,
  properties: {
    discrepancies: {
      type: 'array',
      items: discrepancyItemSchema,
    },
  },
};

const emptyInputSchema: SubmissionToolInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

const readinessResolutionInputSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { const: 'NONE' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'runId', 'sourceRevision', 'resolvedAt'],
      properties: {
        kind: { type: 'string', enum: ['DISMISSED'] },
        runId: { type: 'string', minLength: 1 },
        sourceRevision: { type: 'string', minLength: 1 },
        resolvedAt: { type: 'string', format: 'date-time' },
      },
    },
  ],
} as const;

const readinessFindingInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'affectedSourceContext',
    'unresolvedDecision',
    'consequentialInventionRisk',
    'boundedEvidence',
    'answerKind',
  ],
  properties: {
    affectedSourceContext: { type: 'string', minLength: 1 },
    unresolvedDecision: { type: 'string', minLength: 1 },
    consequentialInventionRisk: { type: 'string', minLength: 1 },
    boundedEvidence: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'statement'],
        properties: {
          category: {
            type: 'string',
            enum: [
              'behavior',
              'ownership',
              'data_lifecycle',
              'authority',
              'security',
              'isolation',
              'integration',
            ],
          },
          statement: { type: 'string', minLength: 1 },
          sourceRef: { type: 'string', minLength: 1 },
        },
      },
    },
    answerKind: { type: 'string', minLength: 1 },
  },
} as const;

export const readinessDispositionInputSchema: SubmissionToolInputSchema = {
  type: 'object',
  required: ['disposition'],
  additionalProperties: false,
  properties: {
    disposition: {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'sourceSnapshot', 'finding', 'resolution'],
      properties: {
        state: { type: 'string', enum: ['CLEAR', 'REVIEW_REQUIRED'] },
        sourceSnapshot: {
          type: 'object',
          description:
            'Copy the implementation-readiness source snapshot supplied in the prompt exactly.',
          additionalProperties: false,
          required: ['runId', 'focalEntityId', 'focalEntityType', 'sourceRevision', 'capturedAt'],
          properties: {
            runId: {
              type: 'string',
              minLength: 1,
              description:
                'Copy runId from the implementation-readiness source snapshot in the prompt. This identifies the active CLI Run; do not substitute a provider session or thread ID.',
            },
            focalEntityId: { type: 'string', minLength: 1 },
            focalEntityType: { type: 'string', enum: ['TASK', 'FEATURE', 'DESIGN_DOC', 'PLAN'] },
            sourceRevision: { type: 'string', minLength: 1 },
            capturedAt: { type: 'string', format: 'date-time' },
          },
        },
        finding: {
          anyOf: [{ type: 'null' }, readinessFindingInputSchema],
        },
        resolution: readinessResolutionInputSchema,
      },
    },
  },
};

const FRESH_RESOLUTION_CORRECTION =
  'Set /disposition/resolution to { "kind": "NONE" } — fresh CLEAR and REVIEW_REQUIRED dispositions always carry resolution { "kind": "NONE" } — then retry.';

/**
 * Fresh analysis only ever submits CLEAR or REVIEW_REQUIRED, which both
 * require `resolution: { kind: "NONE" }`. The generic schema rendering would
 * also list the DISMISSED branch, which agents must not choose.
 */
export const correctReadinessArgumentFinding: NonNullable<
  SubmissionToolDeclaration['correctArgumentFinding']
> = (finding) =>
  finding.field === '/disposition/resolution' || finding.field.startsWith('/disposition/resolution/')
    ? { ...finding, correction: FRESH_RESOLUTION_CORRECTION }
    : finding;

const jsonPointer = (path: ReadonlyArray<string | number>): string =>
  `/${['disposition', ...path]
    .map((segment) => String(segment).replace(/~/g, '~0').replace(/\//g, '~1'))
    .join('/')}`;

export const parseReadinessDispositionForSubmission = (value: unknown) => {
  const parsed = implementationReadinessDispositionSchema.safeParse(value);
  if (parsed.success && parsed.data.state !== 'DISMISSED') return parsed.data;

  if (parsed.success) {
    throw new SubmissionToolCorrectableError({
      reason: 'DISMISSED is reserved for the confirmed user-facing Dismiss action.',
      findings: [
        {
          field: '/disposition/state',
          code: 'invalid_value',
          reason: 'Fresh readiness analysis may emit only CLEAR or REVIEW_REQUIRED.',
          correction: 'Submit CLEAR or REVIEW_REQUIRED from fresh analysis.',
        },
      ],
    });
  }

  throw new SubmissionToolCorrectableError({
    reason: 'The implementation-readiness disposition is invalid and can be corrected.',
    findings: parsed.error.issues.map((issue) => {
      const field = jsonPointer(issue.path);
      return correctReadinessArgumentFinding(
        {
          field,
          code: issue.code,
          reason: issue.message,
          correction: `Correct ${field} to match the advertised readiness schema, then retry.`,
        },
        { disposition: value },
      );
    }),
  });
};

// Fail fast rather than ship an action-only payload the server would reject.
// Ordinary feature-sync also enforces a non-empty list. Plan shaping opts into
// an empty list because its user-owned review action remains the only exit.
const extractDiscrepancies = (
  toolName: string,
  args: Record<string, unknown>,
  allowEmpty = false,
): Record<string, unknown>[] => {
  const raw = args['discrepancies'];
  if (!Array.isArray(raw) || (!allowEmpty && raw.length === 0)) {
    throw new Error(`${toolName} called without a non-empty discrepancies array`);
  }
  return raw.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
  );
};

export const submitNoDiscrepancyTool: SubmissionToolDeclaration = {
  name: 'submit_no_discrepancy',
  description:
    'Call this for a clean structural pass in FEATURE verification or plan-shaping Feature Sync. Regular task pre-planning must submit a typed implementation-readiness disposition instead.',
  inputSchema: emptyInputSchema,
  execute: ({ run }) => {
    if (!run) {
      throw new Error('submit_no_discrepancy requires an active Run.');
    }
    if (
      run.entity?.entityType === 'TASK' &&
      run.workItemType !== 'FEATURE' &&
      run.session.promptType !== LocalPromptType.PlanShapingFeatureSyncAnalyze
    ) {
      throw new SubmissionToolCorrectableError({
        reason: 'Task pre-planning cannot finish through the structural no-discrepancy action.',
        findings: [
          {
            field: 'action',
            reason: 'A task readiness check must produce a typed implementation-readiness outcome.',
            correction:
              'Call submit_implementation_readiness with CLEAR or REVIEW_REQUIRED after the required reports are persisted.',
          },
        ],
      });
    }
    return { action: FEATURE_SYNC_ACTIONS.NO_DISCREPANCY };
  },
  hidden: true,
};

export const submitDiscrepanciesTool: SubmissionToolDeclaration = {
  name: 'submit_discrepancies',
  description:
    'Call this when you have identified drift between the declared feature/task tree and the observed code. Provide one entry per discrepancy. Routes the flow to iterate for resolution.',
  inputSchema: discrepancyListInputSchema,
  execute: ({ args }) => ({
    action: FEATURE_SYNC_ACTIONS.DISCREPANCY,
    payload: { discrepancies: extractDiscrepancies('submit_discrepancies', args) },
  }),
  hidden: true,
};

export const submitResolvedTool: SubmissionToolDeclaration = {
  name: 'submit_resolved',
  description:
    "Call this when the user's change request has been fully addressed and no further revision is needed. Advances the flow to session startup.",
  inputSchema: emptyInputSchema,
  execute: () => ({ action: FEATURE_SYNC_ACTIONS.RESOLVED }),
  hidden: true,
};

export const submitRevisedTool: SubmissionToolDeclaration = {
  name: 'submit_revised',
  description:
    'Call this when you have produced a revised set of discrepancies. Self-loops iterate for another pass.',
  inputSchema: discrepancyListInputSchema,
  execute: ({ args }) => ({
    action: FEATURE_SYNC_ACTIONS.REVISED,
    payload: { discrepancies: extractDiscrepancies('submit_revised', args) },
  }),
  hidden: true,
};

export const submitReadinessTool: SubmissionToolDeclaration = {
  name: 'submit_implementation_readiness',
  description:
    'Record the structured implementation-readiness outcome after the project-context check. Use CLEAR when no consequential decision remains unresolved, or REVIEW_REQUIRED with the bounded finding that needs the user’s answer before planning or coding.',
  inputSchema: readinessDispositionInputSchema,
  correctArgumentFinding: correctReadinessArgumentFinding,
  execute: ({ args, run }) => {
    if (!run) {
      throw new Error('submit_implementation_readiness requires an active Run.');
    }
    const rawDisposition = args['disposition'];
    const parsedDisposition = parseReadinessDispositionForSubmission(rawDisposition);
    const disposition = run.normalizeImplementationReadinessForSubmission(parsedDisposition);
    return {
      action:
        disposition.state === 'CLEAR'
          ? FEATURE_SYNC_ACTIONS.READINESS_CLEAR
          : FEATURE_SYNC_ACTIONS.READINESS_REVIEW_REQUIRED,
      payload: { disposition },
    };
  },
  hidden: true,
};

/**
 * Plan shaping keeps advancement behind the user's review action. An empty
 * revised set therefore means "nothing remains to review", not "resolved":
 * the workflow stays parked until the user chooses Ready for Plan.
 */
export const submitPlanShapingRevisedTool: SubmissionToolDeclaration = {
  name: 'submit_revised',
  description:
    'Call this with the full revised discrepancy set. The array may be empty only when the user explicitly dismissed every remaining item; the user review action still controls advancement.',
  inputSchema: planShapingRevisedListInputSchema,
  execute: ({ args }) => ({
    action: FEATURE_SYNC_ACTIONS.REVISED,
    payload: {
      discrepancies: extractDiscrepancies('submit_revised', args, true),
    },
  }),
  hidden: true,
};

export const structuralAnalyzeSubmissionTools: ReadonlyArray<SubmissionToolDeclaration> = [
  submitNoDiscrepancyTool,
  submitDiscrepanciesTool,
];

export const analyzeSubmissionTools: ReadonlyArray<SubmissionToolDeclaration> = [
  // Keep the structural terminal available for FEATURE verification. Its
  // action guard rejects regular TASK runs so a legacy prompt cannot bypass
  // the typed readiness disposition required by the pre-planning path.
  submitNoDiscrepancyTool,
  submitDiscrepanciesTool,
  submitReadinessTool,
];

export const iterateSubmissionTools: ReadonlyArray<SubmissionToolDeclaration> = [
  submitResolvedTool,
  submitRevisedTool,
];
