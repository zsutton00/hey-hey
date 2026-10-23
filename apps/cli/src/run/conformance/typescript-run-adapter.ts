import {
  observationSchema,
  type RunConformanceCommand,
  type RunConformanceDriver,
  type RunConformanceExternalOutcome,
  type RunConformanceInput,
  type RunConformanceInterruptionBoundary,
  type RunConformanceObservation,
  type RunConformanceProviderOutput,
} from './protocol';

export interface TypeScriptRunConformanceBoundary {
  handleInput(input: RunConformanceInput): Promise<void>;
  stop(): Promise<void>;
  settleExternalOperation(
    operationId: string,
    outcome: RunConformanceExternalOutcome,
  ): Promise<void>;
  interruptAt(boundary: RunConformanceInterruptionBoundary): Promise<void>;
  reapIdle(): Promise<void>;
  emitProviderOutput(output: RunConformanceProviderOutput): Promise<void>;
  crash(): Promise<void>;
  restart(): Promise<TypeScriptRunConformanceBoundary>;
  observe(): RunConformanceObservation;
}

/**
 * The only conformance layer that knows the current TypeScript Run. Its
 * boundary translates runtime callbacks, stores, and controlled fakes into
 * the portable protocol; scenarios never inspect Run or Turn state.
 */
export class TypeScriptRunConformanceDriver implements RunConformanceDriver {
  public constructor(private boundary: TypeScriptRunConformanceBoundary) {}

  public async execute(command: RunConformanceCommand): Promise<RunConformanceObservation> {
    switch (command.kind) {
      case 'start':
      case 'admit':
        await this.boundary.handleInput(command.input);
        break;
      case 'cancel':
        await this.boundary.stop();
        break;
      case 'settle':
        await this.boundary.settleExternalOperation(command.operationId, command.outcome);
        break;
      case 'interrupt':
        await this.boundary.interruptAt(command.boundary);
        break;
      case 'reap_idle':
        await this.boundary.reapIdle();
        break;
      case 'emit':
        await this.boundary.emitProviderOutput(command.output);
        break;
      case 'crash':
        await this.boundary.crash();
        break;
      case 'restart':
        this.boundary = await this.boundary.restart();
        break;
      case 'observe':
        break;
    }
    return observationSchema.parse(this.boundary.observe());
  }
}
