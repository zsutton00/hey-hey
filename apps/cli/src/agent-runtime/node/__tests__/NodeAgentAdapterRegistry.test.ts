/** @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { ClaudeCodeAdapter } from '../ClaudeCodeAdapter';
import { CodexAdapter } from '../CodexAdapter';
import {
  BUILTIN_NODE_ADAPTER_IDS,
  createNodeAdapter,
  createNodeAdapterRegistry,
} from '../NodeAgentAdapterRegistry';

describe('NodeAgentAdapterRegistry', () => {
  it('registers built-in node adapters', () => {
    const registry = createNodeAdapterRegistry();
    expect(registry.list()).toEqual([...BUILTIN_NODE_ADAPTER_IDS]);
  });

  it('creates concrete adapter instances by id', () => {
    const registry = createNodeAdapterRegistry();
    expect(registry.create('claude')).toBeInstanceOf(ClaudeCodeAdapter);
    expect(registry.create('codex')).toBeInstanceOf(CodexAdapter);
  });

  it('supports creating adapters directly', () => {
    const claudeAdapter = createNodeAdapter('claude');
    const codexAdapter = createNodeAdapter('codex');

    expect(claudeAdapter).toBeInstanceOf(ClaudeCodeAdapter);
    expect(codexAdapter).toBeInstanceOf(CodexAdapter);
  });
});
