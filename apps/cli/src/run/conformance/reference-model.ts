import {
  RUN_CONFORMANCE_PROTOCOL,
  type RunConformanceCommand,
  type RunConformanceDriver,
  type RunConformanceExternalOutcome,
  type RunConformanceInput,
  type RunConformanceObservation,
  type RunConformancePendingOperation,
} from './protocol';

type Phase = RunConformanceObservation['phase'];
type TerminalTurn = RunConformanceObservation['terminalTurns'][number];

interface ActiveTurn {
  turnId: string;
  input: RunConformanceInput;
  assistantMessageId: string | null;
  reportIds: string[];
  remainingReports: string[];
  terminalOutcome: TerminalTurn['outcome'] | null;
}

/** A deliberately small oracle for provider-controlled, observable Run promises. */
export class RunConformanceReferenceModel implements RunConformanceDriver {
  private availability: RunConformanceObservation['availability'] = 'running';
  private phase: Phase = 'idle';
  private effectiveState: RunConformanceObservation['effectiveState'] = 'idle';
  private readonly outputEvents: RunConformanceObservation['outputEvents'] = [];
  private active: ActiveTurn | null = null;
  private readonly queue: RunConformanceInput[] = [];
  private readonly pending = new Map<string, RunConformancePendingOperation>();
  private readonly terminalTurns: TerminalTurn[] = [];
  private readonly publications: string[] = [];
  private readonly rejectedSettlements: string[] = [];
  private providerSessionId: string | null = null;
  private readonly providerHistory: string[] = [];
  private nextTurn = 1;
  private nextOperation = 1;

  public execute(command: RunConformanceCommand): Promise<RunConformanceObservation> {
    if (command.kind === 'restart') {
      this.availability = 'running';
      return Promise.resolve(this.observe());
    }
    if (command.kind === 'crash') {
      this.availability = 'crashed';
      return Promise.resolve(this.observe());
    }
    if (command.kind === 'observe' || command.kind === 'interrupt') {
      return Promise.resolve(this.observe());
    }
    if (this.availability === 'crashed') throw new Error('Run is crashed; restart it first.');

    switch (command.kind) {
      case 'start':
      case 'admit':
        this.admit(command.input);
        break;
      case 'cancel':
        this.cancel();
        break;
      case 'reap_idle':
        this.reapIdle();
        break;
      case 'emit':
        this.emitProviderOutput(command.output);
        break;
      case 'settle':
        this.settle(command.operationId, command.outcome);
        break;
    }
    return Promise.resolve(this.observe());
  }

  private admit(input: RunConformanceInput): void {
    if (this.active) {
      this.queue.push(input);
      return;
    }
    this.openTurn(input);
  }

  private openTurn(input: RunConformanceInput): void {
    const turnId = `turn-${String(this.nextTurn++)}`;
    this.active = {
      turnId,
      input,
      assistantMessageId: null,
      reportIds: [],
      remainingReports: [...input.requiredReportTypes],
      terminalOutcome: null,
    };
    this.phase = 'active';
    this.effectiveState = 'starting';
    this.addOperation('agent_turn', turnId, input.inputId);
  }

  private emitProviderOutput(
    output: Extract<RunConformanceCommand, { kind: 'emit' }>['output'],
  ): void {
    if (!this.active) throw new Error('Cannot emit provider output without an active Turn.');
    if (output.kind === 'thinking' || output.kind === 'writing') {
      this.effectiveState = output.kind;
      return;
    }
    this.effectiveState = 'writing';
    this.outputEvents.push({ kind: output.kind, text: output.text });
  }

  private cancel(): void {
    if (!this.active) return;
    this.removeTurnOperations(this.active.turnId);
    this.queue.length = 0;
    this.active.terminalOutcome = 'aborted';
    this.phase = 'settling';
    this.addOperation('settled_turn_publication', this.active.turnId, this.active.turnId);
  }

  private reapIdle(): void {
    if (this.active) return;
    if (this.providerSessionId) this.addOperation('provider_release', null, this.providerSessionId);
  }

  private settle(operationId: string, outcome: RunConformanceExternalOutcome): void {
    const operation = this.pending.get(operationId);
    if (!operation) {
      this.rejectedSettlements.push(operationId);
      return;
    }
    this.pending.delete(operationId);
    switch (operation.kind) {
      case 'agent_turn':
        this.settleAgent(outcome);
        break;
      case 'permission_decision':
      case 'scope_decision':
        this.settleDecision(outcome);
        break;
      case 'message_write':
        this.settleMessage(outcome);
        break;
      case 'report_write':
        this.settleReport(operation, outcome);
        break;
      case 'settled_turn_publication':
        this.settlePublication(outcome);
        break;
      case 'provider_release':
        if (outcome.kind === 'released') this.providerSessionId = null;
        break;
    }
  }

  private settleAgent(outcome: RunConformanceExternalOutcome): void {
    if (!this.active) return;
    if (outcome.kind === 'permission_required') {
      this.phase = 'awaiting_permission';
      this.effectiveState = 'awaiting_approval';
      this.addOperation('permission_decision', this.active.turnId, outcome.requestId);
      return;
    }
    if (outcome.kind === 'scope_required') {
      this.phase = 'awaiting_scope';
      this.effectiveState = 'awaiting_approval';
      this.addOperation('scope_decision', this.active.turnId, outcome.requestId);
      return;
    }
    if (outcome.kind === 'capacity' || outcome.kind === 'failed') {
      this.active.terminalOutcome = 'failed';
      this.phase = 'settling';
      this.addOperation('settled_turn_publication', this.active.turnId, this.active.turnId);
      return;
    }
    if (outcome.kind !== 'completed') throw new Error(`Invalid agent outcome: ${outcome.kind}`);
    this.active.terminalOutcome = 'completed';
    this.active.assistantMessageId = outcome.assistantMessageId;
    this.phase = 'settling';
    this.addOperation('message_write', this.active.turnId, outcome.assistantMessageId);
  }

  private settleDecision(outcome: RunConformanceExternalOutcome): void {
    if (!this.active) return;
    if (outcome.kind === 'approved') {
      this.phase = 'active';
      this.effectiveState = 'thinking';
      this.addOperation('agent_turn', this.active.turnId, this.active.input.inputId);
      return;
    }
    if (outcome.kind === 'denied') {
      this.active.terminalOutcome = 'aborted';
      this.phase = 'settling';
      this.addOperation('settled_turn_publication', this.active.turnId, this.active.turnId);
      return;
    }
    throw new Error(`Invalid decision outcome: ${outcome.kind}`);
  }

  private settleMessage(outcome: RunConformanceExternalOutcome): void {
    if (!this.active || outcome.kind !== 'written')
      throw new Error('Message write must settle as written.');
    this.active.assistantMessageId = outcome.evidenceId;
    this.dispatchNextReportOrPublication();
  }

  private settleReport(
    operation: RunConformancePendingOperation,
    outcome: RunConformanceExternalOutcome,
  ): void {
    if (!this.active || outcome.kind !== 'written')
      throw new Error('Report write must settle as written.');
    this.active.reportIds.push(outcome.evidenceId);
    if (operation.reportType !== this.active.remainingReports.shift()) {
      throw new Error('Report settlement violated declared order.');
    }
    this.dispatchNextReportOrPublication();
  }

  private dispatchNextReportOrPublication(): void {
    if (!this.active) return;
    const reportType = this.active.remainingReports[0];
    if (reportType) {
      this.addOperation('report_write', this.active.turnId, this.active.turnId, reportType);
      return;
    }
    this.addOperation('settled_turn_publication', this.active.turnId, this.active.turnId);
  }

  private settlePublication(outcome: RunConformanceExternalOutcome): void {
    if (!this.active || outcome.kind !== 'published') {
      throw new Error('Settled Turn publication must settle as published.');
    }
    const turn = this.active;
    if (!turn.terminalOutcome) throw new Error('Cannot publish an unsettled Turn.');
    if (!this.publications.includes(turn.turnId)) this.publications.push(turn.turnId);
    this.terminalTurns.push({
      turnId: turn.turnId,
      outcome: turn.terminalOutcome,
      assistantMessageId: turn.assistantMessageId,
      reportIds: [...turn.reportIds],
    });
    if (!this.providerSessionId && turn.terminalOutcome === 'completed') {
      this.providerSessionId = `provider-${turn.turnId}`;
      if (!this.providerHistory.includes(this.providerSessionId)) {
        this.providerHistory.push(this.providerSessionId);
      }
    }
    this.active = null;
    this.phase = 'idle';
    this.effectiveState = 'idle';
    const next = this.queue.shift();
    if (next) this.openTurn(next);
  }

  private addOperation(
    kind: RunConformancePendingOperation['kind'],
    turnId: string | null,
    correlationId: string | null,
    reportType: string | null = null,
  ): void {
    const operationId = `${kind}-${String(this.nextOperation++)}`;
    this.pending.set(operationId, { operationId, kind, turnId, correlationId, reportType });
  }

  private removeTurnOperations(turnId: string): void {
    for (const [operationId, operation] of this.pending) {
      if (operation.turnId === turnId) this.pending.delete(operationId);
    }
  }

  private observe(): RunConformanceObservation {
    return {
      protocol: RUN_CONFORMANCE_PROTOCOL,
      availability: this.availability,
      phase: this.phase,
      effectiveState: this.effectiveState,
      outputEvents: this.outputEvents.map((event) => ({ ...event })),
      activeTurn: this.active
        ? {
            turnId: this.active.turnId,
            inputId: this.active.input.inputId,
            trigger: this.active.input.trigger,
          }
        : null,
      queuedInputIds: this.queue.map((input) => input.inputId),
      providerSessionId: this.providerSessionId,
      providerSessionHistory: [...this.providerHistory],
      pendingOperations: [...this.pending.values()],
      terminalTurns: this.terminalTurns.map((turn) => ({
        ...turn,
        reportIds: [...turn.reportIds],
      })),
      settledTurnPublications: [...this.publications],
      rejectedSettlements: [...this.rejectedSettlements],
    };
  }
}
