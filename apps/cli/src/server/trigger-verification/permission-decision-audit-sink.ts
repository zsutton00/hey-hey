/**
 * Durable append-only audit log for permission-decision deliveries.
 *
 * Every decision routed through the trigger dispatch path — delivered, dropped,
 * or failed — is appended here as one JSON line so the outcome survives process
 * exit and is inspectable after the fact. This is the durable counterpart to
 * the stdout/ring-buffer logger, which does not persist across restarts.
 *
 * Modeled on `RunEventStore`'s append-file pattern. The parent directory
 * is created lazily on first append so the sink does not depend on store
 * construction order.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface PermissionDecisionAuditEntry {
  requestId: string;
  runId: string;
  decision: string;
  outcome: 'delivered' | 'dropped' | 'failed';
  reason?: string;
}

export class PermissionDecisionAuditSink {
  private directoryEnsured = false;

  public constructor(
    private readonly filePath: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async ensureDirectory(): Promise<void> {
    if (this.directoryEnsured) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    this.directoryEnsured = true;
  }

  public async append(entry: PermissionDecisionAuditEntry): Promise<void> {
    await this.ensureDirectory();
    const line = `${JSON.stringify({ ...entry, timestampMs: this.now() })}\n`;
    await fs.appendFile(this.filePath, line, 'utf8');
  }
}
