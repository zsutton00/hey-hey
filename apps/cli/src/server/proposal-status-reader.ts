import type { ApiRuntime } from '../../../../packages/ui-common/src/clients/shared';

import type { TrackedProposalStatus } from '../run/run-proposal-tracker';

export type ProposalStatusClients = Pick<ApiRuntime['clients'], 'proposals' | 'entities'>;

export interface ProposalStatusReader {
  lookupProposal(
    location: { organizationId: string; projectId: string },
    proposalId: string,
    signal: AbortSignal,
  ): Promise<TrackedProposalStatus>;
  lookupEntityTitle(
    organizationId: string,
    entityId: string,
    entityType: string,
    signal: AbortSignal,
  ): Promise<string | null>;
}

/** Reads a proposal's current decision and the title of the item it created, with the CLI's own credentials. */
export const createProposalStatusReader = (
  clients: ProposalStatusClients,
): ProposalStatusReader => ({
  lookupProposal: async ({ organizationId, projectId }, proposalId, signal) => {
    const proposal = (
      await clients.proposals.getProposal({ organizationId, projectId, proposalId }, { signal })
    ).data.data;
    if (!proposal) throw new Error(`Proposal ${proposalId} was not found`);
    return {
      status: proposal.status,
      action: proposal.action,
      targetEntityId: proposal.targetEntityId,
      targetEntityType: proposal.targetEntityType,
    };
  },
  lookupEntityTitle: async (organizationId, entityId, entityType, signal) => {
    const names = (
      await clients.entities.getEntityNames(
        {
          organizationId,
          getEntityNamesDto: { entities: [{ entityId, entityType: entityType as never }] },
        },
        { signal },
      )
    ).data;
    return names.find((candidate) => candidate.entityId === entityId)?.entityName || null;
  },
});
