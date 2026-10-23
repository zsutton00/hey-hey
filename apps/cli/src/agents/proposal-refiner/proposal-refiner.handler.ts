import { ProposalReconciliationSubmission } from './reconciliation-submission';
import type { LocalProposalRefinerPromptPayload } from '../../shared/agent-bridge-contract/generated/api';
import type {
  PromptTypeHandler,
  PromptTypeHandlerDeps,
  PrepareResult,
} from '../prompt-type-handler';
import type { AgenticSession } from '../../session/types';
import type { AssistantDeltaEvent, AssistantCompleteEvent } from '../../run/types';
import type { UpdateMessageDto } from '../../shared/api/index';
import { SystemMessageDataTypeEnum } from '../../shared/api/index';
import type { ProposalRefinerPromptInput } from './types';
import type { FullEntityContextDto } from '../../shared/api/generated/api';
import { buildProposalRefinerPrompt } from './proposal-refiner-prompt';
import { parseRefinerResponse } from '../response-parser';
import { assertFullProposalHistory } from '../entity-context/full-proposal-history';

type EnrichedPayload = LocalProposalRefinerPromptPayload & {
  _enriched?: ProposalRefinerPromptInput;
};

const reconciliationSubmission = new ProposalReconciliationSubmission();

export const proposalRefinerHandler: PromptTypeHandler<LocalProposalRefinerPromptPayload> = {
  id: 'proposal_refiner',
  promptType: 'proposal_refiner',
  // Agent fix starts the refiner from a proposal, which has no repository.
  service: 'optional',
  launchEntity: 'required',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  submissionTools: [reconciliationSubmission],

  async prepare(
    run: AgenticSession,
    payload: LocalProposalRefinerPromptPayload,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<LocalProposalRefinerPromptPayload>> {
    const { targetEntityId, targetEntityType } = payload.proposal;
    const { organizationId, projectId } = run.contextMetadata;
    if (!targetEntityId || !targetEntityType || !organizationId || !projectId) {
      return { payload };
    }

    const reconciliation = await reconciliationSubmission.prepare(run.agentic_session_id, {
      proposalId: payload.proposal.id, organizationId, projectId, deps,
    });
    payload = { ...payload, proposal: { ...payload.proposal, reconciliation } };

    let accessToken: string;
    try {
      accessToken = await deps.auth.getAccessToken();
    } catch {
      deps.logger.warn('proposal_refiner.prepare.auth_failed', {
        runId: run.agentic_session_id,
      });
      return { payload };
    }

    try {
      const path = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(targetEntityType)}/${encodeURIComponent(targetEntityId)}/context?proposalDetail=full`;
      const res = await deps.fetchImpl(`${deps.apiBaseUrl}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        deps.logger.warn('proposal_refiner.prepare.context_fetch_failed', {
          runId: run.agentic_session_id,
          status: res.status,
        });
        return { payload };
      }

      const body = (await res.json()) as { data?: FullEntityContextDto };
      const ctx = body.data;

      const input: ProposalRefinerPromptInput = { proposal: payload.proposal };
      if (ctx?.relatedEntities && ctx.relatedEntities.length > 0)
        input.relatedEntities = ctx.relatedEntities;
      if (ctx?.agentSessions && ctx.agentSessions.length > 0)
        input.agentSessions = ctx.agentSessions;
      if (ctx?.proposals && ctx.proposals.length > 0) {
        assertFullProposalHistory(ctx.proposals);
        input.proposals = ctx.proposals;
      }

      const enriched: EnrichedPayload = { ...payload, _enriched: input };
      return { payload: enriched };
    } catch (err) {
      deps.logger.warn('proposal_refiner.prepare.context_fetch_error', {
        runId: run.agentic_session_id,
        error: err,
      });
      return { payload };
    }
  },

  buildPrompt(payload: LocalProposalRefinerPromptPayload): string {
    const enriched = (payload as EnrichedPayload)._enriched;
    if (enriched) {
      return buildProposalRefinerPrompt(enriched);
    }
    return buildProposalRefinerPrompt({ proposal: payload.proposal });
  },

  buildStartingMessage(_payload: LocalProposalRefinerPromptPayload): string | null {
    return 'Setting up proposal refiner...';
  },

  transformOutput(event: AssistantDeltaEvent | AssistantCompleteEvent): UpdateMessageDto | null {
    const response = parseRefinerResponse(event.summary);
    if (!response) return null;

    return {
      data: {
        type: SystemMessageDataTypeEnum.Agent,
        response,
        title: 'Proposal Refinement',
        detectedIntent: 'proposal_refiner',
        intentConfidence: 1,
        ragEnabled: false,
      },
    };
  },
};
