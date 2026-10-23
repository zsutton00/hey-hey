import type { OnCompleteDeps } from '../agents/prompt-type-handler';
import type { AgentSessionOutputAttentionSetReadyRequestDto } from '../shared/api';

export const setAgentSessionOutputAttentionReady = async (
  input: {
    organizationId: string;
    projectId: string;
    agentSessionId: string;
  },
  deps: Pick<OnCompleteDeps, 'apiBaseUrl' | 'auth' | 'fetchImpl' | 'logger'>,
): Promise<void> => {
  const accessToken = await deps.auth.getAccessToken();
  const body = {
    state: 'MESSAGE_READY',
  } satisfies AgentSessionOutputAttentionSetReadyRequestDto;
  const response = await deps.fetchImpl(
    `${deps.apiBaseUrl}/organizations/${input.organizationId}/projects/${input.projectId}/agent-sessions/${input.agentSessionId}/output-attention:ready`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to set Agent Session output attention: ${response.status}`);
  }
  deps.logger.info('local.run.output_attention.ready_set', {
    agentSessionId: input.agentSessionId,
    projectId: input.projectId,
  });
};
