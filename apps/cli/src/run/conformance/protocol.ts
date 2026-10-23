import { z } from 'zod';

export const RUN_CONFORMANCE_PROTOCOL = 'heyhey.run-conformance/v1' as const;

const runInputSchema = z.object({
  inputId: z.string().min(1),
  prompt: z.string(),
  trigger: z
    .object({
      nodeId: z.string().min(1),
      messageId: z.string().min(1),
    })
    .nullable(),
  requiredReportTypes: z.array(z.string().min(1)).default([]),
});
export type RunConformanceInput = z.infer<typeof runInputSchema>;

const providerOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('thinking') }),
  z.object({ kind: z.literal('writing') }),
  z.object({ kind: z.literal('assistant_delta'), text: z.string() }),
  z.object({ kind: z.literal('assistant_complete'), text: z.string() }),
]);
export type RunConformanceProviderOutput = z.infer<typeof providerOutputSchema>;

const externalOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('completed'), assistantMessageId: z.string().min(1) }),
  z.object({ kind: z.literal('failed'), code: z.string().min(1) }),
  z.object({ kind: z.literal('capacity') }),
  z.object({ kind: z.literal('permission_required'), requestId: z.string().min(1) }),
  z.object({ kind: z.literal('scope_required'), requestId: z.string().min(1) }),
  z.object({ kind: z.literal('approved') }),
  z.object({ kind: z.literal('denied') }),
  z.object({ kind: z.literal('written'), evidenceId: z.string().min(1) }),
  z.object({ kind: z.literal('published') }),
  z.object({ kind: z.literal('released') }),
]);
export type RunConformanceExternalOutcome = z.infer<typeof externalOutcomeSchema>;

const interruptionBoundarySchema = z.enum([
  'admission',
  'state_persistence',
  'external_work_dispatch',
  'external_work_completion',
  'outcome_application',
  'required_evidence_settlement',
  'settled_turn_publication',
]);
export type RunConformanceInterruptionBoundary = z.infer<typeof interruptionBoundarySchema>;

const commandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start'), input: runInputSchema }),
  z.object({ kind: z.literal('admit'), input: runInputSchema }),
  z.object({ kind: z.literal('cancel') }),
  z.object({ kind: z.literal('reap_idle') }),
  z.object({ kind: z.literal('emit'), output: providerOutputSchema }),
  z.object({
    kind: z.literal('settle'),
    operationId: z.string().min(1),
    outcome: externalOutcomeSchema,
  }),
  z.object({ kind: z.literal('interrupt'), boundary: interruptionBoundarySchema }),
  z.object({ kind: z.literal('crash') }),
  z.object({ kind: z.literal('restart') }),
  z.object({ kind: z.literal('observe') }),
]);
export type RunConformanceCommand = z.infer<typeof commandSchema>;

const pendingOperationSchema = z.object({
  operationId: z.string().min(1),
  kind: z.enum([
    'agent_turn',
    'permission_decision',
    'scope_decision',
    'message_write',
    'report_write',
    'settled_turn_publication',
    'provider_release',
  ]),
  turnId: z.string().min(1).nullable(),
  correlationId: z.string().min(1).nullable(),
  reportType: z.string().min(1).nullable(),
});
export type RunConformancePendingOperation = z.infer<typeof pendingOperationSchema>;

export const observationSchema = z.object({
  protocol: z.literal(RUN_CONFORMANCE_PROTOCOL),
  availability: z.enum(['running', 'crashed']),
  phase: z.enum(['idle', 'active', 'awaiting_permission', 'awaiting_scope', 'settling']),
  effectiveState: z.enum([
    'idle',
    'starting',
    'thinking',
    'writing',
    'reviewing',
    'awaiting_approval',
  ]),
  outputEvents: z.array(
    z.object({ kind: z.enum(['assistant_delta', 'assistant_complete']), text: z.string() }),
  ),
  activeTurn: z
    .object({ turnId: z.string(), inputId: z.string(), trigger: runInputSchema.shape.trigger })
    .nullable(),
  queuedInputIds: z.array(z.string()),
  providerSessionId: z.string().nullable(),
  providerSessionHistory: z.array(z.string()),
  pendingOperations: z.array(pendingOperationSchema),
  terminalTurns: z.array(
    z.object({
      turnId: z.string(),
      outcome: z.enum(['completed', 'failed', 'aborted']),
      assistantMessageId: z.string().nullable(),
      reportIds: z.array(z.string()),
    }),
  ),
  settledTurnPublications: z.array(z.string()),
  rejectedSettlements: z.array(z.string()),
});
export type RunConformanceObservation = z.infer<typeof observationSchema>;

const expectationSchema = z.object({
  phase: observationSchema.shape.phase.optional(),
  effectiveState: observationSchema.shape.effectiveState.optional(),
  outputEvents: observationSchema.shape.outputEvents.optional(),
  activeInputId: z.string().nullable().optional(),
  activeTrigger: runInputSchema.shape.trigger.optional(),
  queuedInputIds: z.array(z.string()).optional(),
  providerSessionHistory: z.array(z.string()).optional(),
  terminalOutcomes: z.array(z.enum(['completed', 'failed', 'aborted'])).optional(),
  publicationCount: z.number().int().nonnegative().optional(),
  rejectedSettlementCount: z.number().int().nonnegative().optional(),
});
export type RunConformanceExpectation = z.infer<typeof expectationSchema>;

export const scenarioSchema = z.object({
  protocol: z.literal(RUN_CONFORMANCE_PROTOCOL),
  name: z.string().min(1),
  commands: z.array(commandSchema),
  expectedFinal: expectationSchema,
});
export type RunConformanceScenario = z.infer<typeof scenarioSchema>;

export const processRequestSchema = z.object({
  protocol: z.literal(RUN_CONFORMANCE_PROTOCOL),
  requestId: z.string().min(1),
  command: commandSchema,
});
type RunConformanceProcessRequest = z.infer<typeof processRequestSchema>;

export const processResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    protocol: z.literal(RUN_CONFORMANCE_PROTOCOL),
    requestId: z.string().min(1),
    ok: z.literal(true),
    observation: observationSchema,
  }),
  z.object({
    protocol: z.literal(RUN_CONFORMANCE_PROTOCOL),
    requestId: z.string().min(1),
    ok: z.literal(false),
    error: z.string(),
  }),
]);
export type RunConformanceProcessResponse = z.infer<typeof processResponseSchema>;

export interface RunConformanceDriver {
  execute(command: RunConformanceCommand): Promise<RunConformanceObservation>;
}
