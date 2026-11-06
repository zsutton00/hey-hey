import { describe, expect, it, vi } from 'vitest';
import { WorkflowDispatchVerdictReader } from './workflow-dispatch-verdict';

const identity = {
  organizationId: 'org-1',
  projectId: 'project-1',
  conversationId: 'conversation-1',
};

describe('WorkflowDispatchVerdictReader.readCurrentNodeId', () => {
  it('returns the platform-owned current node id', async () => {
    const getConversationWorkflowNode = vi.fn().mockResolvedValue({
      data: {
        data: {
          currentNodeId: 'feature-sync-implementation-readiness-review',
          workflowName: 'feature-sync',
        },
      },
    });
    const reader = new WorkflowDispatchVerdictReader({
      getConversationPromptType: vi.fn(),
      getConversationWorkflowNode,
    });

    await expect(reader.readCurrentNodeId(identity)).resolves.toBe(
      'feature-sync-implementation-readiness-review',
    );
    expect(getConversationWorkflowNode).toHaveBeenCalledWith(identity);
  });

  it('preserves an explicit null for a conversation without an active node', async () => {
    const reader = new WorkflowDispatchVerdictReader({
      getConversationPromptType: vi.fn(),
      getConversationWorkflowNode: vi.fn().mockResolvedValue({
        data: { data: { currentNodeId: null } },
      }),
    });

    await expect(reader.readCurrentNodeId(identity)).resolves.toBeNull();
  });

  it('rejects a malformed node lookup instead of inventing a node id', async () => {
    const reader = new WorkflowDispatchVerdictReader({
      getConversationPromptType: vi.fn(),
      getConversationWorkflowNode: vi.fn().mockResolvedValue({ data: { data: {} } }),
    });

    await expect(reader.readCurrentNodeId(identity)).rejects.toThrow(
      'Workflow node lookup returned no currentNodeId.',
    );
  });
});

describe('WorkflowDispatchVerdictReader.read', () => {
  const readerFor = (data: Record<string, unknown>) =>
    new WorkflowDispatchVerdictReader({
      getConversationPromptType: vi.fn().mockResolvedValue({ data: { data } }),
      getConversationWorkflowNode: vi.fn(),
    });

  it('raises an error for an agent node that has no open trigger instead of calling it terminal', async () => {
    const reader = readerFor({
      workflowState: 'agent-pending',
      promptType: 'feature_sync_analyze',
      nodeId: 'feature-sync-analyze',
      triggerMessageId: null,
    });

    await expect(reader.read(identity)).rejects.toThrow('agent-pending');
  });

  it('returns the pair for an agent node with an open trigger', async () => {
    const reader = readerFor({
      workflowState: 'agent-pending',
      promptType: 'feature_sync_analyze',
      nodeId: 'feature-sync-analyze',
      triggerMessageId: 'trigger-1',
    });

    await expect(reader.read(identity)).resolves.toMatchObject({
      state: 'agent-pending',
      triggerMessageId: 'trigger-1',
    });
  });
});
