import type { AgentSessionDto, UpdateAgentSessionDto } from "../../api";
import { agentSessionsClient } from "../../clients";

export interface BindGraphConversationAgentSessionMachineInput {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  machineId: string;
}

export const bindGraphConversationAgentSessionMachine = async ({
  organizationId,
  projectId,
  agentSessionId,
  machineId,
}: BindGraphConversationAgentSessionMachineInput): Promise<AgentSessionDto> => {
  const response =
    await agentSessionsClient.updateAgentSession(
      {
        organizationId,
        projectId,
        agentSessionId,
        updateAgentSessionDto: {
          machineId,
        } satisfies UpdateAgentSessionDto,
      }
    );
  const session = response.data?.data;
  if (!session) {
    throw new Error(
      "The Agent Session was not returned after binding the selected machine."
    );
  }
  return session;
};
