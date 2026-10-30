import { describe, expect, it } from 'vitest';
import {
  HINT_READ_MCP_TOOLS,
  HINT_WRITE_MCP_TOOLS,
  resolveHintPromptAccess,
  resolveMcpToolNames,
  type McpToolUseCase,
} from './mcp-server-config';
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

  it('gives coding, general, planning and research sessions every hint tool', () => {
    for (const useCase of ['coding', 'general', 'planning', 'research'] as McpToolUseCase[]) {
      expect(resolveMcpToolNames({ useCase }).filter((t) => HINT_TOOLS.includes(t))).toEqual(
        HINT_TOOLS,
      );
    }
  });

  it('keeps curated report, monitor and evidence-gathering surfaces free of hint tools', () => {
    for (const useCase of [
      'project_report',
      'plan_shaping',
      'task_monitor',
      'session_monitor',
      'repository_grounding',
    ] as McpToolUseCase[]) {
      expect(resolveMcpToolNames({ useCase }).filter((t) => HINT_TOOLS.includes(t))).toEqual([]);
    }
  });

  it('gives entity conversations, coding sessions and the Project Assistant all hint tools', () => {
    for (const id of ['entity_conversation', 'implement', 'project_assistant']) {
      expect(hintToolsById.get(id)).toEqual(HINT_TOOLS);
    }
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
