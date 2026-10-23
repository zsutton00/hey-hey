import {
  RUN_CONFORMANCE_PROTOCOL,
  scenarioSchema,
  type RunConformanceCommand,
  type RunConformanceInput,
  type RunConformanceScenario,
} from './protocol';

const input = (
  inputId: string,
  requiredReportTypes: string[] = [],
  triggerNumber = inputId,
): RunConformanceInput => ({
  inputId,
  prompt: `prompt:${inputId}`,
  trigger: { nodeId: `node:${triggerNumber}`, messageId: `message:${triggerNumber}` },
  requiredReportTypes,
});

const scenario = (value: RunConformanceScenario): RunConformanceScenario =>
  scenarioSchema.parse(value);

export const RUN_CONFORMANCE_REGRESSION_SCENARIOS: readonly RunConformanceScenario[] = [
  scenario({
    protocol: RUN_CONFORMANCE_PROTOCOL,
    name: 'provider output drives the observable Run state and preserves delta/final order',
    commands: [
      { kind: 'start', input: input('output') },
      { kind: 'emit', output: { kind: 'thinking' } },
      { kind: 'emit', output: { kind: 'writing' } },
      { kind: 'emit', output: { kind: 'assistant_delta', text: 'Working on it.' } },
      { kind: 'emit', output: { kind: 'assistant_complete', text: 'Done.' } },
    ],
    expectedFinal: {
      phase: 'active',
      effectiveState: 'writing',
      outputEvents: [
        { kind: 'assistant_delta', text: 'Working on it.' },
        { kind: 'assistant_complete', text: 'Done.' },
      ],
    },
  }),
  scenario({
    protocol: RUN_CONFORMANCE_PROTOCOL,
    name: 'one active Turn releases queued inputs in admission order',
    commands: [
      { kind: 'start', input: input('first') },
      { kind: 'admit', input: input('second') },
      {
        kind: 'settle',
        operationId: 'agent_turn-1',
        outcome: { kind: 'completed', assistantMessageId: 'message:first' },
      },
      {
        kind: 'settle',
        operationId: 'message_write-2',
        outcome: { kind: 'written', evidenceId: 'message:first' },
      },
      { kind: 'settle', operationId: 'settled_turn_publication-3', outcome: { kind: 'published' } },
    ],
    expectedFinal: {
      phase: 'active',
      activeInputId: 'second',
      activeTrigger: { nodeId: 'node:second', messageId: 'message:second' },
      queuedInputIds: [],
      publicationCount: 1,
    },
  }),
  scenario({
    protocol: RUN_CONFORMANCE_PROTOCOL,
    name: 'stale external work is rejected after Turn rotation',
    commands: [
      { kind: 'start', input: input('first') },
      {
        kind: 'settle',
        operationId: 'agent_turn-1',
        outcome: { kind: 'completed', assistantMessageId: 'message:first' },
      },
      {
        kind: 'settle',
        operationId: 'message_write-2',
        outcome: { kind: 'written', evidenceId: 'message:first' },
      },
      { kind: 'settle', operationId: 'settled_turn_publication-3', outcome: { kind: 'published' } },
      { kind: 'settle', operationId: 'agent_turn-1', outcome: { kind: 'failed', code: 'late' } },
    ],
    expectedFinal: { phase: 'idle', publicationCount: 1, rejectedSettlementCount: 1 },
  }),
  scenario({
    protocol: RUN_CONFORMANCE_PROTOCOL,
    name: 'correlated permission decision resumes only its waiting Turn',
    commands: [
      { kind: 'start', input: input('permission') },
      {
        kind: 'settle',
        operationId: 'agent_turn-1',
        outcome: { kind: 'permission_required', requestId: 'permission-1' },
      },
      { kind: 'settle', operationId: 'permission_decision-2', outcome: { kind: 'approved' } },
    ],
    expectedFinal: { phase: 'active', activeInputId: 'permission' },
  }),
  scenario({
    protocol: RUN_CONFORMANCE_PROTOCOL,
    name: 'correlated scope denial aborts and publishes once',
    commands: [
      { kind: 'start', input: input('scope') },
      {
        kind: 'settle',
        operationId: 'agent_turn-1',
        outcome: { kind: 'scope_required', requestId: 'scope-1' },
      },
      { kind: 'settle', operationId: 'scope_decision-2', outcome: { kind: 'denied' } },
      { kind: 'settle', operationId: 'settled_turn_publication-3', outcome: { kind: 'published' } },
    ],
    expectedFinal: { phase: 'idle', terminalOutcomes: ['aborted'], publicationCount: 1 },
  }),
  scenario({
    protocol: RUN_CONFORMANCE_PROTOCOL,
    name: 'cancellation aborts the active Turn and clears queued input',
    commands: [
      { kind: 'start', input: input('cancelled') },
      { kind: 'admit', input: input('after-cancel') },
      { kind: 'cancel' },
      { kind: 'settle', operationId: 'settled_turn_publication-2', outcome: { kind: 'published' } },
    ],
    expectedFinal: {
      phase: 'idle',
      activeInputId: null,
      queuedInputIds: [],
      terminalOutcomes: ['aborted'],
      publicationCount: 1,
    },
  }),
  scenario({
    protocol: RUN_CONFORMANCE_PROTOCOL,
    name: 'Message and Reports settle before canonical Turn publication',
    commands: [
      { kind: 'start', input: input('reports', ['implementation', 'validation']) },
      {
        kind: 'settle',
        operationId: 'agent_turn-1',
        outcome: { kind: 'completed', assistantMessageId: 'message:reports' },
      },
      { kind: 'interrupt', boundary: 'required_evidence_settlement' },
      {
        kind: 'settle',
        operationId: 'message_write-2',
        outcome: { kind: 'written', evidenceId: 'message:reports' },
      },
      {
        kind: 'settle',
        operationId: 'report_write-3',
        outcome: { kind: 'written', evidenceId: 'report:implementation' },
      },
      {
        kind: 'settle',
        operationId: 'report_write-4',
        outcome: { kind: 'written', evidenceId: 'report:validation' },
      },
      { kind: 'settle', operationId: 'settled_turn_publication-5', outcome: { kind: 'published' } },
      { kind: 'settle', operationId: 'settled_turn_publication-5', outcome: { kind: 'published' } },
    ],
    expectedFinal: { phase: 'idle', publicationCount: 1, rejectedSettlementCount: 1 },
  }),
  scenario({
    protocol: RUN_CONFORMANCE_PROTOCOL,
    name: 'crash and restart retain dispatched work without duplication',
    commands: [
      { kind: 'start', input: input('restart') },
      { kind: 'interrupt', boundary: 'external_work_dispatch' },
      { kind: 'crash' },
      { kind: 'restart' },
      {
        kind: 'settle',
        operationId: 'agent_turn-1',
        outcome: { kind: 'completed', assistantMessageId: 'message:restart' },
      },
      {
        kind: 'settle',
        operationId: 'message_write-2',
        outcome: { kind: 'written', evidenceId: 'message:restart' },
      },
      { kind: 'crash' },
      { kind: 'restart' },
      { kind: 'settle', operationId: 'settled_turn_publication-3', outcome: { kind: 'published' } },
    ],
    expectedFinal: { phase: 'idle', terminalOutcomes: ['completed'], publicationCount: 1 },
  }),
  scenario({
    protocol: RUN_CONFORMANCE_PROTOCOL,
    name: 'capacity failure returns idle and permits a successful retry',
    commands: [
      { kind: 'start', input: input('capacity') },
      { kind: 'settle', operationId: 'agent_turn-1', outcome: { kind: 'capacity' } },
      { kind: 'settle', operationId: 'settled_turn_publication-2', outcome: { kind: 'published' } },
      { kind: 'admit', input: input('retry') },
      {
        kind: 'settle',
        operationId: 'agent_turn-3',
        outcome: { kind: 'completed', assistantMessageId: 'message:retry' },
      },
      {
        kind: 'settle',
        operationId: 'message_write-4',
        outcome: { kind: 'written', evidenceId: 'message:retry' },
      },
      { kind: 'settle', operationId: 'settled_turn_publication-5', outcome: { kind: 'published' } },
    ],
    expectedFinal: {
      phase: 'idle',
      terminalOutcomes: ['failed', 'completed'],
      publicationCount: 2,
    },
  }),
  scenario({
    protocol: RUN_CONFORMANCE_PROTOCOL,
    name: 'idle reaping clears the active provider but preserves membership history',
    commands: [
      { kind: 'start', input: input('provider') },
      {
        kind: 'settle',
        operationId: 'agent_turn-1',
        outcome: { kind: 'completed', assistantMessageId: 'message:provider' },
      },
      {
        kind: 'settle',
        operationId: 'message_write-2',
        outcome: { kind: 'written', evidenceId: 'message:provider' },
      },
      { kind: 'settle', operationId: 'settled_turn_publication-3', outcome: { kind: 'published' } },
      { kind: 'reap_idle' },
      { kind: 'settle', operationId: 'provider_release-4', outcome: { kind: 'released' } },
      { kind: 'crash' },
      { kind: 'restart' },
    ],
    expectedFinal: {
      phase: 'idle',
      providerSessionHistory: ['provider-turn-1'],
      publicationCount: 1,
    },
  }),
];

/** Seeded traces vary interruptions while retaining deterministic operation identities. */
export const generateRunConformanceScenario = (
  seed: number,
  turnCount = 8,
): RunConformanceScenario => {
  let state = seed >>> 0;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const commands: RunConformanceCommand[] = [];
  let operation = 1;
  for (let index = 0; index < turnCount; index += 1) {
    commands.push({
      kind: index === 0 ? 'start' : 'admit',
      input: input(`generated-${String(index)}`),
    });
    if (random() < 0.45) {
      commands.push({
        kind: 'interrupt',
        boundary: random() < 0.5 ? 'admission' : 'state_persistence',
      });
    }
    const agentOperation = `agent_turn-${String(operation++)}`;
    if (random() < 0.45) commands.push({ kind: 'interrupt', boundary: 'external_work_dispatch' });
    if (random() < 0.3) commands.push({ kind: 'crash' }, { kind: 'restart' });
    commands.push({
      kind: 'settle',
      operationId: agentOperation,
      outcome: { kind: 'completed', assistantMessageId: `message:generated-${String(index)}` },
    });
    if (random() < 0.45) {
      commands.push({
        kind: 'interrupt',
        boundary: random() < 0.5 ? 'external_work_completion' : 'outcome_application',
      });
    }
    const messageOperation = `message_write-${String(operation++)}`;
    if (random() < 0.45) {
      commands.push({ kind: 'interrupt', boundary: 'required_evidence_settlement' });
    }
    commands.push({
      kind: 'settle',
      operationId: messageOperation,
      outcome: { kind: 'written', evidenceId: `message:generated-${String(index)}` },
    });
    const publicationOperation = `settled_turn_publication-${String(operation++)}`;
    if (random() < 0.45) commands.push({ kind: 'interrupt', boundary: 'settled_turn_publication' });
    if (random() < 0.3) commands.push({ kind: 'crash' }, { kind: 'restart' });
    commands.push({
      kind: 'settle',
      operationId: publicationOperation,
      outcome: { kind: 'published' },
    });
  }
  return scenario({
    protocol: RUN_CONFORMANCE_PROTOCOL,
    name: `seeded trace ${String(seed)}`,
    commands,
    expectedFinal: {
      phase: 'idle',
      terminalOutcomes: Array.from({ length: turnCount }, () => 'completed' as const),
      publicationCount: turnCount,
    },
  });
};
