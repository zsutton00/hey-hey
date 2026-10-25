import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import type {
  PassThroughSubmissionToolDeclaration,
  SubmissionToolExecuteContext,
} from '../submission-tools/types';
import type { ProposalReconciliationState } from '../../shared/api/generated/api';
import { proposalReconciliationCandidateSchema } from '../../shared/api/generated/proposal-reconciliation.schema';
import { parseCandidate, parseReconciliationResponse } from './reconciliation-boundary';

interface ReconciliationScope {
  proposalId: string;
  organizationId: string;
  projectId: string;
  deps: PromptTypeHandlerDeps;
  state: ProposalReconciliationState;
}

export class ProposalReconciliationSubmission implements PassThroughSubmissionToolDeclaration {
  readonly kind = 'pass_through' as const;
  readonly name = 'submit_proposal_reconciliation';
  readonly description =
    'Submit a complete reconciled proposal for user review. Scoped to this refiner proposal; never approves or applies.';
  readonly inputSchema = proposalReconciliationCandidateSchema;
  private readonly scopes = new Map<string, ReconciliationScope>();

  private endpoint(
    scope: Pick<ReconciliationScope, 'deps' | 'organizationId' | 'projectId' | 'proposalId'>,
  ): string {
    return `${scope.deps.apiBaseUrl.replace(/\/$/u, '')}/organizations/${encodeURIComponent(scope.organizationId)}/projects/${encodeURIComponent(scope.projectId)}/proposals/${encodeURIComponent(scope.proposalId)}/reconciliation`;
  }

  async prepare(
    runId: string,
    scope: Omit<ReconciliationScope, 'state'>,
  ): Promise<ProposalReconciliationState> {
    const token = await scope.deps.auth.getAccessToken();
    const response = await scope.deps.fetchImpl(this.endpoint(scope), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Cannot load reconciliation content (${response.status}).`);
    const state = parseReconciliationResponse(await response.json());
    this.scopes.set(runId, { ...scope, state });
    scope.deps.logger.info('proposal_refiner.reconciliation.loaded', {
      runId,
      proposalId: scope.proposalId,
      status: state.status,
    });
    return state;
  }

  async execute(context: SubmissionToolExecuteContext) {
    const scope = this.scopes.get(context.runId);
    if (!scope) throw new Error('Reconciliation context has not been prepared for this run.');
    const input = parseCandidate(context.args);
    const token = await scope.deps.auth.getAccessToken();
    const response = await scope.deps.fetchImpl(this.endpoint(scope), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Agent-Session-ID': context.runId,
      },
      body: JSON.stringify(
        input.method === 'AGENT_FIX'
          ? {
              ...input,
              expectedCurrentBases: scope.state.currentBases,
              expectedFutureRevision: scope.state.futureRevision,
            }
          : input,
      ),
    });
    scope.deps.logger.info('proposal_refiner.reconciliation.submitted', {
      runId: context.runId,
      proposalId: scope.proposalId,
      status: response.status,
    });
    if (response.status === 409) {
      const current = await this.prepare(context.runId, scope);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message:
                'Content changed. Review this refreshed context and prepare a new candidate; unresolved semantic choices require the user.',
              reconciliation: current,
            }),
          },
        ],
      };
    }
    if (!response.ok) throw new Error(`Candidate was not accepted (${response.status}).`);
    const state = parseReconciliationResponse(await response.json());
    if (state.replacementProposalId)
      context.run?.activeTurn?.includeExistingProposals([state.replacementProposalId]);
    return { content: [{ type: 'text', text: JSON.stringify(state) }] };
  }
}
