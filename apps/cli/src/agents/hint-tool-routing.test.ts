import { describe, expect, it } from 'vitest';
import {
  HINT_READ_MCP_TOOLS,
  HINT_WRITE_MCP_TOOLS,
  resolveHintPromptAccess,
  resolveMcpToolNames,
} from './mcp-server-config';
import { dailySessionHandler } from './daily-session/daily-session.handler';
import { PromptTypeRegistry } from './prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from './prompt-type-registry.test-support';

const HINT_TOOLS = [...HINT_WRITE_MCP_TOOLS, ...HINT_READ_MCP_TOOLS];

describe('hint tool routing', () => {
  const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
  const hintToolsById = new Map(
    registry.list().map((handler) => [
      handler.id,
      resolveMcpToolNames({
        ...(handler.mcpToolUseCase ? { useCase: handler.mcpToolUseCase } : {}),
        additionalTools: handler.additionalAllowedTools ?? [],
      }).filter((tool) => HINT_TOOLS.includes(tool)),
    ]),
  );

  it('gives write tools to entity conversations and coding sessions only', () => {
    expect(hintToolsById.get('entity_conversation')).toEqual(HINT_WRITE_MCP_TOOLS);
    expect(hintToolsById.get('implement')).toEqual(HINT_WRITE_MCP_TOOLS);
  });

  it('gives the Project Assistant read access only', () => {
    expect(hintToolsById.get('project_assistant')).toEqual(HINT_READ_MCP_TOOLS);
  });

  it('gives no other handler, including verification, feature sync and daily sessions, any hint tool', () => {
    const others = [...hintToolsById].filter(
      ([id]) => !['entity_conversation', 'implement', 'project_assistant'].includes(id),
    );
    expect(others.map(([id]) => id)).toEqual(
      expect.arrayContaining(['verify_feature', 'feature_sync_analyze', 'daily_session_coach']),
    );
    for (const [id, tools] of others) expect({ id, tools }).toEqual({ id, tools: [] });
    expect(
      resolveMcpToolNames({
        ...(dailySessionHandler.mcpToolUseCase
          ? { useCase: dailySessionHandler.mcpToolUseCase }
          : {}),
        additionalTools: dailySessionHandler.additionalAllowedTools ?? [],
      }).filter((tool) => HINT_TOOLS.includes(tool)),
    ).toEqual([]);
  });
});

describe('resolveHintPromptAccess', () => {
  it('carries no hint guidance when the switch is off, whatever the tools', () => {
    expect(resolveHintPromptAccess(false, [...HINT_TOOLS])).toBe('none');
  });

  it('picks write over read and accepts qualified names', () => {
    expect(resolveHintPromptAccess(true, ['mcp__heyhey-platform__create_hint'])).toBe('write');
    expect(resolveHintPromptAccess(true, [...HINT_TOOLS])).toBe('write');
    expect(resolveHintPromptAccess(true, ['get_hints_for_items'])).toBe('read');
    expect(resolveHintPromptAccess(true, ['get_context'])).toBe('none');
  });
});
