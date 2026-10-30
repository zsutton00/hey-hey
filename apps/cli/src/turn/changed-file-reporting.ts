import type {
  ChangedFileReportFinding,
  ChangedFileReportResult,
} from '../shared/agent-bridge-contract/generated/api';
import type { AssistantCompleteEvent } from '../run/types';
import type { ServerLogger } from '../server/logger';
import type { Run } from '../run/run';
import type { ChangedFileClaim } from '../shared/agent-bridge-contract/generated/api';
import { ReportedFileChangeFailure } from '../run/file-change-facts';

export interface ChangedFileReportingEvidence {
  turnId: string;
  providerSessionId: string | null;
  state: ChangedFileReportResult['state'];
  editRevision: number;
  validatedRevision: number | null;
  findings: ChangedFileReportFinding[];
  attempts: number;
  incomplete: boolean;
  retainedResponse: AssistantCompleteEvent | null;
}

/** One Turn owns readiness and its saved answer. A new Turn never restores readiness. */
export class ChangedFileReporting {
  private evidence: ChangedFileReportingEvidence;
  private releasing = false;
  private repairing = false;
  private mutation: Promise<void> = Promise.resolve();

  public constructor(
    public readonly turnId: string,
    private readonly logger: ServerLogger,
  ) {
    this.evidence = {
      turnId,
      providerSessionId: null,
      state: 'not_reported',
      editRevision: 0,
      validatedRevision: null,
      findings: [],
      attempts: 0,
      incomplete: false,
      retainedResponse: null,
    };
  }

  public get isRepairing(): boolean {
    return this.repairing;
  }
  public get isReleasing(): boolean {
    return this.releasing;
  }
  public get ready(): boolean {
    return (
      this.evidence.state === 'validated' &&
      this.evidence.validatedRevision === this.evidence.editRevision
    );
  }
  /** Omission permits completion but never counts as validated evidence. */
  public get needsCorrection(): boolean {
    return this.evidence.state !== 'not_reported' && !this.ready;
  }
  public snapshot(): ChangedFileReportingEvidence {
    return { ...this.evidence, findings: [...this.evidence.findings] };
  }
  public async settleReports(): Promise<void> {
    await this.mutation.catch(() => undefined);
  }
  public successfulEdit(): void {
    this.evidence.editRevision += 1;
    if (this.evidence.state === 'validated') this.evidence.state = 'needs_correction';
    this.log('successful_edit');
  }
  public providerSessionChanged(providerSessionId: string | null): void {
    if (
      this.evidence.state === 'validated' &&
      this.evidence.providerSessionId !== providerSessionId
    ) {
      this.evidence.state = 'needs_correction';
      this.evidence.validatedRevision = null;
      this.log('provider_session_changed');
    }
  }
  public report(findings: ChangedFileReportFinding[]): ChangedFileReportResult {
    this.evidence.findings = findings;
    this.evidence.state = findings.some((item) => item.status === 'rejected')
      ? 'needs_correction'
      : 'validated';
    this.evidence.validatedRevision =
      this.evidence.state === 'validated' ? this.evidence.editRevision : null;
    this.log('report');
    return { state: this.evidence.state, findings };
  }
  public async submit(
    run: Run,
    providerSessionId: string,
    claims: Array<{ index: number; claim: ChangedFileClaim }>,
    findings: ChangedFileReportFinding[],
  ): Promise<ChangedFileReportResult> {
    const operation = this.mutation
      .catch(() => undefined)
      .then(async () => {
        const turn = run.activeTurn;
        if (
          !turn ||
          turn.turnId !== this.turnId ||
          run.providerSessionId !== providerSessionId ||
          turn.abortSignal.aborted
        ) {
          throw new Error('Reporting context is no longer active');
        }
        const revision = this.evidence.editRevision;
        this.evidence.providerSessionId = providerSessionId;
        for (const { index, claim } of claims) {
          try {
            const resolution = await run.recordReportedFileChanges({
              turn,
              providerSessionId,
              files: [claim],
              occurredAt: new Date().toISOString(),
            });
            const rejection = resolution.rejected[0];
            const correction = resolution.corrected[0];
            findings.push(
              rejection
                ? {
                    index,
                    status: 'rejected',
                    claim,
                    reason: rejection.reason,
                    ...(rejection.suggestion
                      ? { suggestion: { serviceId: claim.serviceId, path: rejection.suggestion } }
                      : {}),
                  }
                : {
                    index,
                    status: correction ? 'corrected' : 'accepted',
                    reason: correction ? 'unique_corroborated_dirty_path' : 'dirty_path_verified',
                    claim: { serviceId: claim.serviceId, path: correction?.path ?? claim.path },
                  },
            );
          } catch (error) {
            findings.push({
              index,
              status: 'rejected',
              claim,
              reason:
                error instanceof ReportedFileChangeFailure
                  ? error.reason
                  : 'persistence_failed: retry this claim',
            });
          }
        }
        if (
          run.activeTurn !== turn ||
          run.providerSessionId !== providerSessionId ||
          turn.abortSignal.aborted
        ) {
          this.evidence.state = 'needs_correction';
          this.evidence.validatedRevision = null;
          throw new Error(
            'Reporting context changed during validation; report again in the active context',
          );
        }
        this.report(findings.sort((a, b) => a.index - b.index));
        if (revision !== this.evidence.editRevision) {
          this.evidence.state = 'needs_correction';
          this.evidence.validatedRevision = null;
        }
        try {
          await run.persistChangedFileReporting(turn);
        } catch {
          this.evidence.state = 'needs_correction';
          this.evidence.validatedRevision = null;
          throw new Error('Reporting evidence could not be persisted; retry the report');
        }
      });
    this.mutation = operation;
    await operation;
    return { state: this.evidence.state, findings: [...this.evidence.findings] };
  }
  public retain(event: AssistantCompleteEvent): void {
    if (this.evidence.retainedResponse === null) this.evidence.retainedResponse = event;
    this.log('response_retained');
  }
  public beginRepair(): string | null {
    if (!this.needsCorrection || this.evidence.attempts >= 2 || !this.evidence.retainedResponse)
      return null;
    this.evidence.attempts += 1;
    this.repairing = true;
    this.log('repair_started');
    return `The response is already saved. Do not rewrite it or edit files. Call report_changed_files for this same Turn (${this.turnId}) and current provider session, correcting the findings below. Include changedFiles: [] if no files changed. Finish after reporting.\n${JSON.stringify(this.evidence.findings)}`;
  }
  public endRepair(): void {
    this.repairing = false;
    this.log('repair_ended');
  }
  public release(): AssistantCompleteEvent | null {
    if (this.releasing) return null;
    this.releasing = true;
    this.evidence.incomplete = this.needsCorrection;
    this.log(this.evidence.incomplete ? 'recovery_exhausted' : this.ready ? 'ready' : 'omitted');
    return this.evidence.retainedResponse;
  }
  private log(action: string): void {
    this.logger.debug('runtime.turn.changed_file_reporting.transition', {
      turnId: this.turnId,
      action,
      state: this.evidence.state,
      editRevision: this.evidence.editRevision,
      attempts: this.evidence.attempts,
      incomplete: this.evidence.incomplete,
      unresolvedCount: this.evidence.findings.filter((finding) => finding.status === 'rejected')
        .length,
    });
  }
}
