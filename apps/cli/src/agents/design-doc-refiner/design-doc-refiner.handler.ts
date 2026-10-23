import type { LocalDesignDocRefinerPromptPayload } from '../../shared/agent-bridge-contract/generated/api';
import type {
  PromptTypeHandler,
  PromptTypeHandlerDeps,
  PrepareResult,
} from '../prompt-type-handler';
import type { AgenticSession } from '../../session/types';
import type { AssistantDeltaEvent, AssistantCompleteEvent } from '../../run/types';
import type { UpdateMessageDto } from '../../shared/api/index';
import { SystemMessageDataTypeEnum } from '../../shared/api/index';
import type { DesignDocRefinerPromptInput } from './types';
import type { FullEntityContextDto } from '../../shared/api/generated/api';
import { buildDesignDocRefinerPrompt } from './design-doc-refiner-prompt';
import { extractStructuredJsonPayload } from '../response-parser';
import { assertFullProposalHistory } from '../entity-context/full-proposal-history';

const parseDesignDocRefinerResponse = (text: string): string | null => {
  const payload = extractStructuredJsonPayload(text);
  if (!payload) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const response = typeof obj['response'] === 'string' ? obj['response'].trim() : null;
  return response && response.length > 0 ? response : null;
};

type EnrichedPayload = LocalDesignDocRefinerPromptPayload & {
  _enriched?: DesignDocRefinerPromptInput;
};

export const designDocRefinerHandler: PromptTypeHandler<LocalDesignDocRefinerPromptPayload> = {
  id: 'design_doc_refiner',
  promptType: 'design_doc_refiner',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'none',
  projectAssistant: {
    allowEdgeUpdates: false,
    notifyDiscrepancies: false,
    workItemProposalMode: 'all',
  },
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],

  async prepare(
    run: AgenticSession,
    payload: LocalDesignDocRefinerPromptPayload,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<LocalDesignDocRefinerPromptPayload>> {
    const designDocId = payload.designDoc.id;
    const { organizationId, projectId } = run.contextMetadata;
    if (!designDocId || !organizationId || !projectId) {
      return { payload };
    }

    let accessToken: string;
    try {
      accessToken = await deps.auth.getAccessToken();
    } catch {
      deps.logger.warn('design_doc_refiner.prepare.auth_failed', {
        runId: run.agentic_session_id,
      });
      return { payload };
    }

    try {
      const path = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/entities/DESIGN_DOC/${encodeURIComponent(designDocId)}/context?proposalDetail=full`;
      const res = await deps.fetchImpl(`${deps.apiBaseUrl}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        deps.logger.warn('design_doc_refiner.prepare.context_fetch_failed', {
          runId: run.agentic_session_id,
          status: res.status,
        });
        return { payload };
      }

      const body = (await res.json()) as { data?: FullEntityContextDto };
      const ctx = body.data;

      const input: DesignDocRefinerPromptInput = { designDoc: payload.designDoc };
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
      deps.logger.warn('design_doc_refiner.prepare.context_fetch_error', {
        runId: run.agentic_session_id,
        error: err,
      });
      return { payload };
    }
  },

  buildPrompt(payload: LocalDesignDocRefinerPromptPayload): string {
    const enriched = (payload as EnrichedPayload)._enriched;
    if (enriched) {
      return buildDesignDocRefinerPrompt(enriched);
    }
    return buildDesignDocRefinerPrompt({ designDoc: payload.designDoc });
  },

  buildStartingMessage(_payload: LocalDesignDocRefinerPromptPayload): string | null {
    return 'Setting up design doc refiner...';
  },

  transformOutput(event: AssistantDeltaEvent | AssistantCompleteEvent): UpdateMessageDto | null {
    const response = parseDesignDocRefinerResponse(event.summary);
    if (!response) return null;

    return {
      data: {
        type: SystemMessageDataTypeEnum.Agent,
        response,
        title: 'Design Doc Refinement',
        detectedIntent: 'design_doc_refiner',
        intentConfidence: 1,
        ragEnabled: false,
      },
    };
  },
};
