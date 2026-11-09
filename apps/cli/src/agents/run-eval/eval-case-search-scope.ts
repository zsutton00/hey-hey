import { Configuration, ProposalsApi, TasksApi, TopologyApi } from '@hey-hey/contracts/api';
import type { EvalSearchScope } from '../../shared/agent-bridge-contract/runtime-types';
import { EXCLUDE_CONNECTED_DEPTH } from '../platform-mcp-proxy/search-scope';

const PROPOSAL_PAGE_SIZE = 100;
/** The most entities the platform accepts in one exclusion. */
const MAX_EXCLUDED_ENTITIES = 100;

/**
 * Works out, once per Eval Case and eval run, what an attempt must not reveal: the case, its Eval,
 * its proposals and their conversations, the case's creation time, and everything connected to
 * those entities. A failed read is
 * cached too, so every attempt of that case fails with the same reason and none searches without
 * its scope, while other cases keep running.
 */
export class EvalCaseSearchScope {
  private readonly reads = new Map<string, Promise<EvalSearchScope>>();
  private readonly tasks: TasksApi;
  private readonly proposals: ProposalsApi;
  private readonly topology: TopologyApi;

  public constructor(
    private readonly scope: { organizationId: string; projectId: string },
    connection: { accessToken: string; apiBaseUrl: string },
  ) {
    const configuration = new Configuration({
      accessToken: connection.accessToken,
      basePath: connection.apiBaseUrl,
    });
    this.tasks = new TasksApi(configuration);
    this.proposals = new ProposalsApi(configuration);
    this.topology = new TopologyApi(configuration);
  }

  public read(evalCaseId: string): Promise<EvalSearchScope> {
    let read = this.reads.get(evalCaseId);
    if (!read) {
      read = this.fetch(evalCaseId);
      this.reads.set(evalCaseId, read);
    }

    return read;
  }

  private async fetch(evalCaseId: string): Promise<EvalSearchScope> {
    try {
      const { createdAt, evalId } = await this.readCase(evalCaseId);
      const proposalEntities = await this.readProposalEntities(evalCaseId);
      const excludeConnectedTo = [...new Set([evalCaseId, evalId, ...proposalEntities])];
      if (excludeConnectedTo.length > MAX_EXCLUDED_ENTITIES) {
        throw new Error(`the case involves ${excludeConnectedTo.length} entities`);
      }

      const hiddenEntityIds = await this.readConnectedEntities(excludeConnectedTo);

      return { createdBefore: createdAt, excludeConnectedTo, hiddenEntityIds };
    } catch (error) {
      throw new Error(
        `Could not work out what Eval Case ${evalCaseId} must hide from search: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }

  private async readCase(evalCaseId: string): Promise<{ createdAt: string; evalId: string }> {
    const response = await this.tasks.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet({
      organizationId: this.scope.organizationId,
      projectId: this.scope.projectId,
      taskId: evalCaseId,
    });
    const { createdAt, parentTaskId } = response.data.data ?? {};
    if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
      throw new Error('the platform returned no creation time');
    }
    if (!parentTaskId) {
      throw new Error('the platform returned no parent Eval');
    }

    return { createdAt, evalId: parentTaskId };
  }

  /** Uses the same walk and depth as the search exclusion, so search and reads hide the same set. */
  private async readConnectedEntities(entityIds: string[]): Promise<string[]> {
    const response = await this.topology.getTopologyConnectedEntities({
      organizationId: this.scope.organizationId,
      projectId: this.scope.projectId,
      connectedEntitiesRequest: { entityIds, depth: EXCLUDE_CONNECTED_DEPTH },
    });
    const connected = response.data.data?.entityIds;
    if (!connected) {
      throw new Error('the platform returned no connected entities');
    }

    return connected;
  }

  /** Every proposal about the case, whatever its status, with the conversation it was made in. */
  private async readProposalEntities(evalCaseId: string): Promise<string[]> {
    const entities: string[] = [];
    for (let offset = 0; ; offset += PROPOSAL_PAGE_SIZE) {
      const response = await this.proposals.listProposals({
        organizationId: this.scope.organizationId,
        projectId: this.scope.projectId,
        targetEntityId: evalCaseId,
        limit: PROPOSAL_PAGE_SIZE,
        offset,
      });
      const page = response.data.data;
      if (!page) {
        throw new Error('the platform returned no proposals page');
      }
      for (const proposal of page.data) {
        entities.push(proposal.id);
        if (proposal.conversationId) {
          entities.push(proposal.conversationId);
        }
      }
      if (offset + PROPOSAL_PAGE_SIZE >= page.total) {
        return entities;
      }
    }
  }
}
