import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentOperationDispatchAcknowledgement } from '../../shared/api/generated/api';
import {
  configurationSchema,
  type DeterministicE2EConfiguration,
} from './deterministic-e2e-scenario-registry';

/** Process-owned observations and barriers in the existing fake-provider lane. */
export class DeterministicE2EEvidence {
  private static instance: DeterministicE2EEvidence | null = null;

  static current(): DeterministicE2EEvidence | null {
    const path = process.env['HEY_HEY_DETERMINISTIC_E2E_SCENARIO'];
    if (!path) return null;
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('Deterministic E2E evidence is forbidden in production.');
    }
    if (this.instance) return this.instance;
    const configuration = configurationSchema.parse(JSON.parse(fs.readFileSync(path, 'utf8')));
    if (configuration.owner !== process.env['HEY_HEY_DETERMINISTIC_E2E_OWNER']) {
      throw new Error('Deterministic E2E evidence owner does not match this CLI.');
    }
    return (this.instance = new DeterministicE2EEvidence(configuration));
  }

  private constructor(private readonly configuration: DeterministicE2EConfiguration) {}

  record(
    kind: string,
    detail: {
      operationId?: string;
      runId?: string | null;
      turnId?: string | null;
      nonce?: string;
      replayed?: boolean;
      acknowledgement?: AgentOperationDispatchAcknowledgement;
    },
  ): void {
    fs.appendFileSync(
      this.configuration.observationsPath,
      `${JSON.stringify({ protocol: this.configuration.protocol, kind, ...detail })}\n`,
    );
  }

  async beforeAcknowledgement(
    acknowledgement: AgentOperationDispatchAcknowledgement,
  ): Promise<void> {
    this.record('acknowledgement_ready', { acknowledgement });
    if (acknowledgement.status === 'ACCEPTED') {
      await this.waitForRelease(this.configuration.acknowledgementReleasePath);
    }
    this.record('acknowledgement_sent', { acknowledgement });
  }

  async beforeProvider(signal: AbortSignal): Promise<void> {
    await this.waitForRelease(this.configuration.providerReleasePath, signal);
  }

  private async waitForRelease(path: string | undefined, signal?: AbortSignal): Promise<void> {
    if (!path) return;
    const deadline = Date.now() + 300_000;
    while (!fs.existsSync(path)) {
      if (Date.now() >= deadline)
        throw new Error('Deterministic E2E barrier was not released within 300 seconds.');
      await delay(25, undefined, signal ? { signal } : undefined);
    }
  }
}
