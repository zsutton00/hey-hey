import type { ServerLogger } from '../server/logger';

export interface TrackedProposalStatus {
  status: string;
  action: string;
  targetEntityId: string;
  targetEntityType: string;
}

/** The only way `RunProposalTracker` sees the Run that owns it. */
export interface RunProposalTrackerDeps {
  runId: string;
  logger: ServerLogger;
  lookupProposal(proposalId: string, signal: AbortSignal): Promise<TrackedProposalStatus>;
  /**
   * Resolves the title of the entity a create proposal materialized; null when
   * the platform has no title for it (for example, it was deleted). Rejects
   * only when the lookup itself failed.
   */
  lookupEntityTitle(
    entityId: string,
    entityType: string,
    signal: AbortSignal,
  ): Promise<string | null>;
}

export interface ProposalDecisionNotices {
  lines: readonly string[];
  /** Proposal ids to drop once the Turn carrying `lines` has begun. */
  proposalIds: readonly string[];
}

const LOOKUP_TIMEOUT_MS = 3000;

/**
 * Remembers the Proposals this Run created and tells the agent, once each,
 * when the user has approved or rejected one. Memory only: a CLI restart
 * forgets earlier Proposals.
 */
export class RunProposalTracker {
  private readonly undecided = new Set<string>();

  constructor(private readonly deps: RunProposalTrackerDeps) {}

  record(proposalId: string): void {
    this.undecided.add(proposalId);
  }

  forget(proposalId: string): void {
    this.undecided.delete(proposalId);
  }

  /** Looks up every tracked proposal; pending, failed and slow lookups add nothing. */
  async refresh(): Promise<ProposalDecisionNotices> {
    const results = await Promise.all([...this.undecided].map((id) => this.check(id)));
    const decided = results.filter((result) => result !== null);
    return { lines: decided.map((r) => r.line), proposalIds: decided.map((r) => r.id) };
  }

  /** Called after `turn.begin()` succeeds. */
  delivered(notices: ProposalDecisionNotices): void {
    for (const id of notices.proposalIds) this.undecided.delete(id);
  }

  private async check(id: string): Promise<{ id: string; line: string } | null> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Proposal lookup exceeded ${String(LOOKUP_TIMEOUT_MS)}ms`));
      }, LOOKUP_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.describe(id, controller.signal), expired]);
    } catch (error) {
      this.deps.logger.debug('local.run.proposal_tracker.lookup_skipped', {
        runId: this.deps.runId,
        proposalId: id,
        error,
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async describe(
    id: string,
    signal: AbortSignal,
  ): Promise<{ id: string; line: string } | null> {
    const proposal = await this.deps.lookupProposal(id, signal);
    if (proposal.status === 'REJECTED')
      return { id, line: `Proposal ${id} was rejected by the user.` };
    if (proposal.status !== 'APPROVED') return null;
    if (proposal.action !== 'CREATE') {
      return { id, line: `Proposal ${id} was approved by the user.` };
    }
    const title = await this.deps.lookupEntityTitle(
      proposal.targetEntityId,
      proposal.targetEntityType,
      signal,
    );
    if (title === null) {
      return {
        id,
        line: `Proposal ${id} was approved by the user and created ${proposal.targetEntityType.toLowerCase()} ${proposal.targetEntityId}, which no longer has a readable title; reference that item, not the proposal.`,
      };
    }
    return {
      id,
      line: `Proposal ${id} was approved by the user and created @[${proposal.targetEntityType.toLowerCase()}:${proposal.targetEntityId}|${title}]; reference that item, not the proposal.`,
    };
  }
}
