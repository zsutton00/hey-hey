import { describe, expect, it } from 'vitest';
import { SubmissionToolRegistry } from './registry';
import type { SubmissionToolDeclaration } from './types';

const makeTool = (name: string): SubmissionToolDeclaration => ({
  name,
  description: `tool ${name}`,
  inputSchema: { type: 'object' },
  execute: () => ({ action: name.toUpperCase() }),
});

describe('SubmissionToolRegistry', () => {
  it('registers tools and looks them up by token', () => {
    const submissionToolRegistry = new SubmissionToolRegistry();
    const reg = submissionToolRegistry.register({
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-1',
      tools: [makeTool('submit_a')],
    });

    expect(reg.token).toBeTruthy();
    expect(submissionToolRegistry.get(reg.token)?.tools[0]?.name).toBe('submit_a');
    expect(submissionToolRegistry.getByRunId('run-1')?.token).toBe(reg.token);
  });

  it('is idempotent for the same runId — repeat register() keeps the token and entry', () => {
    const submissionToolRegistry = new SubmissionToolRegistry();
    const first = submissionToolRegistry.register({
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-1',
      tools: [makeTool('submit_a')],
    });

    // Repeat register with new per-Turn fields — these should be ignored;
    // the contract is: once registered, the entry is stable until update()
    // or unregister. The Claude SDK caches the MCP URL, so the token must
    // not rotate.
    const second = submissionToolRegistry.register({
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-2',
      triggerMessageId: 'trigger-2',
      tools: [makeTool('submit_b')],
    });

    expect(second.token).toBe(first.token);
    expect(submissionToolRegistry.get(first.token)?.tools[0]?.name).toBe('submit_a');
  });

  it('update() rotates per-Turn fields but keeps the token stable', () => {
    const submissionToolRegistry = new SubmissionToolRegistry();
    const reg = submissionToolRegistry.register({
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-1',
      tools: [makeTool('submit_a')],
    });

    const updated = submissionToolRegistry.update('run-1', {
      tools: [makeTool('submit_b')],
      externalAgentNodeId: 'node-2',
    });

    expect(updated.token).toBe(reg.token);
    expect(submissionToolRegistry.get(reg.token)?.tools[0]?.name).toBe('submit_b');
    expect(submissionToolRegistry.get(reg.token)?.externalAgentNodeId).toBe('node-2');
    // Non-patched fields preserved.
    expect(submissionToolRegistry.get(reg.token)?.organizationId).toBe('org-1');
  });

  it('update() throws when no registration exists for the runId', () => {
    const submissionToolRegistry = new SubmissionToolRegistry();
    expect(() =>
      submissionToolRegistry.update('missing-run', {
        tools: [makeTool('submit_a')],
      }),
    ).toThrow(/no registration for runId missing-run/);
  });

  it('unregisters by runId and by token', () => {
    const submissionToolRegistry = new SubmissionToolRegistry();
    const reg = submissionToolRegistry.register({
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-1',
      tools: [makeTool('submit_a')],
    });

    submissionToolRegistry.unregisterByRunId('run-1');
    expect(submissionToolRegistry.get(reg.token)).toBeNull();
    expect(submissionToolRegistry.getByRunId('run-1')).toBeNull();
  });

  it('after unregister, register() mints a new token for the same runId', () => {
    const submissionToolRegistry = new SubmissionToolRegistry();
    const first = submissionToolRegistry.register({
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-1',
      tools: [makeTool('submit_a')],
    });
    submissionToolRegistry.unregisterByRunId('run-1');

    const second = submissionToolRegistry.register({
      runId: 'run-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'trigger-1',
      tools: [makeTool('submit_a')],
    });

    expect(second.token).not.toBe(first.token);
    expect(submissionToolRegistry.get(first.token)).toBeNull();
    expect(submissionToolRegistry.get(second.token)?.tools[0]?.name).toBe('submit_a');
  });
});
