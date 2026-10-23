import { AgentSessionType } from 'src/generated';
import {
  DEFAULT_AGENT_SESSION_TITLE,
  deriveAgentSessionTitle,
} from '../agent-session-title';

describe('deriveAgentSessionTitle', () => {
  it('TASK_REFINING uses the task name', () => {
    expect(
      deriveAgentSessionTitle(AgentSessionType.TaskRefining, {
        taskName: 'Plumb feature flags',
      }),
    ).toBe('Plumb feature flags');
  });

  it('DESIGN_DOC_REFINING uses the design doc name', () => {
    expect(
      deriveAgentSessionTitle(AgentSessionType.DesignDocRefining, {
        designDocName: 'Auth ADR',
      }),
    ).toBe('Auth ADR');
  });

  it('ENTITY_CONVERSATION prefixes the entity name with Discuss', () => {
    expect(
      deriveAgentSessionTitle(AgentSessionType.EntityConversation, {
        entityName: 'Onboarding plan',
      }),
    ).toBe('Discuss Onboarding plan');
  });

  it('PROJECT_CONVERSATION uses the project name', () => {
    expect(
      deriveAgentSessionTitle(AgentSessionType.ProjectConversation, {
        projectName: 'Hey Hey',
      }),
    ).toBe('Hey Hey');
  });

  it('PROPOSAL_REFINING prefixes the proposal target with Refine', () => {
    expect(
      deriveAgentSessionTitle(AgentSessionType.ProposalRefining, {
        proposalEntityName: 'Plan stage 2',
      }),
    ).toBe('Refine Plan stage 2');
  });

  it('DAILY_SESSION renders the date', () => {
    expect(
      deriveAgentSessionTitle(AgentSessionType.DailySession, {
        sessionDate: new Date('2026-05-06T13:00:00Z'),
      }),
    ).toBe('Daily Session — 2026-05-06');
  });

  it('AGENT_SEARCH renders the search query', () => {
    expect(
      deriveAgentSessionTitle(AgentSessionType.AgentSearch, {
        searchQuery: 'login bug',
      }),
    ).toBe('Search: login bug');
  });

  it('CODING uses the task name when present and falls back to "Coding Session"', () => {
    expect(
      deriveAgentSessionTitle(AgentSessionType.Coding, {
        taskName: 'Wire deploy hook',
      }),
    ).toBe('Coding prompts for Wire deploy hook');
    expect(
      deriveAgentSessionTitle(AgentSessionType.Coding, { taskName: '' }),
    ).toBe('Coding Session');
  });

  it('PLAN_GENERATION uses the plan title', () => {
    expect(
      deriveAgentSessionTitle(AgentSessionType.PlanGeneration, {
        planTitle: 'Q3 planning',
      }),
    ).toBe('Q3 planning');
  });

  it('returns null when no anchor data is available', () => {
    expect(
      deriveAgentSessionTitle(AgentSessionType.TaskRefining, {}),
    ).toBeNull();
    expect(
      deriveAgentSessionTitle(AgentSessionType.EntityConversation, {
        entityName: '   ',
      }),
    ).toBeNull();
  });

  it('exposes the default fallback constant', () => {
    expect(DEFAULT_AGENT_SESSION_TITLE).toBe('Agent Session');
  });
});
