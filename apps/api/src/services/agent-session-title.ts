import { AgentSessionType } from 'src/generated';

export const DEFAULT_AGENT_SESSION_TITLE = 'Agent Session';

export type AgentSessionTitleAnchor = {
  taskName?: string | null;
  designDocName?: string | null;
  projectName?: string | null;
  planTitle?: string | null;
  proposalEntityName?: string | null;
  initiativeName?: string | null;
  serviceName?: string | null;
  agentSessionTitle?: string | null;
  searchQuery?: string | null;
  sessionDate?: Date | null;
  /**
   * For ENTITY_CONVERSATION the anchor entity's display name regardless of
   * which concrete entity type it resolves to.
   */
  entityName?: string | null;
};

const trim = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

export function deriveAgentSessionTitle(
  type: AgentSessionType | undefined,
  anchor: AgentSessionTitleAnchor,
): string | null {
  if (!type) return null;

  switch (type) {
    case AgentSessionType.Coding: {
      const taskName = trim(anchor.taskName);
      return taskName ? `Coding prompts for ${taskName}` : 'Coding Session';
    }
    case AgentSessionType.TaskRefining:
      return trim(anchor.taskName);
    case AgentSessionType.DesignDocRefining:
      return trim(anchor.designDocName);
    case AgentSessionType.EntityConversation: {
      const name = trim(anchor.entityName);
      return name ? `Discuss ${name}` : null;
    }
    case AgentSessionType.ProjectConversation:
      return trim(anchor.projectName);
    case AgentSessionType.ProposalRefining: {
      const name = trim(anchor.proposalEntityName);
      return name ? `Refine ${name}` : null;
    }
    case AgentSessionType.DailySession: {
      const datePart = anchor.sessionDate
        ? formatDate(anchor.sessionDate)
        : null;
      const projectPart = trim(anchor.projectName);
      if (datePart && projectPart) {
        return `Daily Session — ${projectPart} — ${datePart}`;
      }
      if (datePart) {
        return `Daily Session — ${datePart}`;
      }
      return projectPart ? `Daily Session — ${projectPart}` : null;
    }
    case AgentSessionType.AgentSearch: {
      const query = trim(anchor.searchQuery);
      if (query) return `Search: ${query}`;
      const sessionTitle = trim(anchor.agentSessionTitle);
      return sessionTitle ? `Search in ${sessionTitle}` : null;
    }
    case AgentSessionType.PlanGeneration:
      return trim(anchor.planTitle);
    default:
      return null;
  }
}
