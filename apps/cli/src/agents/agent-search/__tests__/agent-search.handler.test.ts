import { describe, expect, it } from 'vitest';
import { agentSearchHandler } from '../agent-search.handler';
import type { LocalAgentSearchPromptPayload } from '../../../shared/agent-bridge-contract/index';
import { LocalAgentSearchEntityType } from '../../../shared/agent-bridge-contract/index';

const makePayload = (
  userMessage: string,
  entityTypes?: LocalAgentSearchEntityType[],
): LocalAgentSearchPromptPayload => ({
  payloadVersion: 1,
  userMessage,
  ...(entityTypes ? { entityTypes } : {}),
});

describe('agentSearchHandler', () => {
  it('registers under the agent_search prompt type', () => {
    expect(agentSearchHandler.promptType).toBe('agent_search');
  });

  it('uses the read-only research surface with no built-in tools or generic code-search guidance', () => {
    expect(agentSearchHandler.mcpToolUseCase).toBe('research');
    expect(agentSearchHandler.builtinTools).toEqual([]);
    expect(agentSearchHandler.omitServiceContextNote).toBe(true);
  });

  it('exposes a starting message', () => {
    expect(agentSearchHandler.buildStartingMessage?.(makePayload('hi'))).toMatch(/searching/i);
  });

  describe('buildPrompt', () => {
    it('renders the full entity type list when unrestricted and no longer embeds the user message', () => {
      const prompt = agentSearchHandler.buildPrompt(makePayload('anything about mcp'));
      // Injection moved to the resolver via the default addUserMessage — the
      // prompt builder no longer double-injects the user message.
      expect(prompt).not.toContain('anything about mcp');
      expect(prompt).not.toContain('## User message');
      expect(prompt).toContain('- TASK');
      expect(prompt).toContain('- DESIGN_DOC');
      expect(prompt).toContain('- INITIATIVE');
      expect(prompt).toContain('unified_search');
      expect(prompt).toContain('@[type:id|title]');
      expect(prompt).toMatch(/graph-only search session/i);
      expect(prompt).toMatch(/never inspect or discuss a repository/i);
      expect(prompt).toMatch(/every materially plausible candidate/i);
      expect(prompt).toMatch(/concrete refinement question/i);
    });

    it('snapshots the unrestricted search-only prompt', () => {
      expect(agentSearchHandler.buildPrompt(makePayload('anything about mcp'))).toMatchSnapshot(
        'unrestricted',
      );
    });

    it('appends the user message via the default addUserMessage preamble', () => {
      expect(agentSearchHandler.addUserMessage(makePayload('anything about mcp'))).toBe(
        '\n\n---\n\nThe user has sent the following message. Please respond to it directly:\n\nanything about mcp',
      );
    });

    it('restricts the entity type list when the caller supplies entityTypes', () => {
      const prompt = agentSearchHandler.buildPrompt(
        makePayload('tasks about mcp', [
          LocalAgentSearchEntityType.Task,
          LocalAgentSearchEntityType.Initiative,
        ]),
      );
      expect(prompt).toContain('caller restricted this search');
      expect(prompt).toContain('- TASK');
      expect(prompt).toContain('- INITIATIVE');
      expect(prompt).not.toContain('- DESIGN_DOC');
      expect(prompt).not.toContain('- SERVICE');
    });

    it('snapshots the caller-restricted search-only prompt', () => {
      expect(
        agentSearchHandler.buildPrompt(
          makePayload('tasks about mcp', [
            LocalAgentSearchEntityType.Task,
            LocalAgentSearchEntityType.Initiative,
          ]),
        ),
      ).toMatchSnapshot('restricted');
    });

    it('tells the model not to ask for permission to keep searching', () => {
      const prompt = agentSearchHandler.buildPrompt(makePayload('find the auth task'));
      expect(prompt).toMatch(/do not ask.*permission/i);
      expect(prompt).toMatch(/do not offer follow-up query suggestions/i);
    });

    it('requires preserving each search hit type and identifier as an atomic pair', () => {
      const prompt = agentSearchHandler.buildPrompt(makePayload('find prior discussion about auth'));

      expect(prompt).toMatch(/type.*id.*authoritative identity pair/i);
      expect(prompt).toMatch(/MESSAGE and CONVERSATION are different entity types/i);
      expect(prompt).toMatch(/MESSAGE.*complete and actionable.*message ID/i);
      expect(prompt).toMatch(/conversation metadata is absent/i);
      expect(prompt).toMatch(/never relabel it as CONVERSATION/i);
      expect(prompt).toMatch(/never reuse a message ID as a conversation ID/i);
      expect(prompt).toMatch(/trace it to an owning conversation/i);
      expect(prompt).toMatch(/follow-up lookup merely to make the MESSAGE result actionable/i);
      expect(prompt).toMatch(/independent authoritative search hit.*type: CONVERSATION/i);
      expect(prompt).not.toContain('follow-up read explicitly returns that conversation identity');
      expect(prompt).toMatch(/same authoritative hit/i);
    });
  });
});
