import fs from 'node:fs';
import { z } from 'zod';
import {
  RUN_CONFORMANCE_PROTOCOL,
  scenarioSchema,
  type RunConformanceProviderOutput,
  type RunConformanceScenario,
} from '../conformance/protocol';

export const configurationSchema = z.object({
  protocol: z.literal(RUN_CONFORMANCE_PROTOCOL),
  owner: z.string().min(1),
  scenario: scenarioSchema,
  observationsPath: z.string().min(1),
  acknowledgementReleasePath: z.string().optional(),
  providerReleasePath: z.string().optional(),
});

export type DeterministicE2EConfiguration = z.infer<typeof configurationSchema>;

export class DeterministicE2EScenarioRegistry {
  private claimedRunId: string | null = null;
  private consumed = false;

  public static fromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
  ): DeterministicE2EScenarioRegistry | null {
    const path = environment['HEY_HEY_DETERMINISTIC_E2E_SCENARIO'];
    if (!path) return null;
    if (environment['NODE_ENV'] === 'production') {
      throw new Error('Deterministic E2E scenarios are forbidden in production.');
    }
    const configuration = configurationSchema.parse(JSON.parse(fs.readFileSync(path, 'utf8')));
    if (configuration.owner !== environment['HEY_HEY_DETERMINISTIC_E2E_OWNER']) {
      throw new Error(
        'Deterministic E2E scenario ownership does not match the spawned CLI process.',
      );
    }
    return new DeterministicE2EScenarioRegistry(configuration, `${path}.claimed`);
  }

  public constructor(
    private readonly configuration: DeterministicE2EConfiguration,
    private readonly claimPath: string,
  ) {}

  public claim(runId: string): RunConformanceScenario {
    if (this.claimedRunId !== null) {
      throw new Error(
        `Deterministic E2E scenario "${this.configuration.scenario.name}" was already claimed by Run ${this.claimedRunId}; Run ${runId} cannot consume it.`,
      );
    }
    try {
      const claim = fs.openSync(this.claimPath, 'wx');
      fs.writeFileSync(claim, JSON.stringify({ owner: this.configuration.owner, runId }));
      fs.closeSync(claim);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(
          `Deterministic E2E scenario "${this.configuration.scenario.name}" was consumed by another CLI process.`,
        );
      }
      throw error;
    }
    this.claimedRunId = runId;
    this.record('claimed', { runId });
    return this.configuration.scenario;
  }

  public recordOutput(runId: string, output: RunConformanceProviderOutput): void {
    this.assertOwner(runId);
    this.record('output', { runId, output });
  }

  public complete(runId: string): void {
    this.assertOwner(runId);
    if (this.consumed) throw new Error('Deterministic E2E scenario was completed more than once.');
    this.consumed = true;
    this.record('exhausted', { runId });
  }

  private assertOwner(runId: string): void {
    if (this.claimedRunId !== runId) {
      throw new Error(`Run ${runId} does not own the deterministic E2E scenario.`);
    }
  }

  private record(kind: string, detail: object): void {
    fs.appendFileSync(
      this.configuration.observationsPath,
      `${JSON.stringify({ protocol: RUN_CONFORMANCE_PROTOCOL, kind, ...detail })}\n`,
    );
  }
}
