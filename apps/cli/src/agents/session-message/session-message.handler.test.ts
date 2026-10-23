import { describe, expect, it } from 'vitest';
import { sessionMessageHandler } from './session-message.handler';

describe('sessionMessageHandler', () => {
  it('renders admitted agent provenance without a human message hook or delegation tools', () => {
    const prompt = sessionMessageHandler.buildPrompt({
      sourceSessionId: '10000000-0000-4000-8000-000000000001',
      interactionId: '10000000-0000-4000-8000-000000000002',
      attemptId: '10000000-0000-4000-8000-000000000003',
      authorKind: 'AGENT',
      authority: {
        kind: 'MACHINE_SESSION',
        machineId: '10000000-0000-4000-8000-000000000004',
        sourceSessionId: '10000000-0000-4000-8000-000000000001',
        targetSessionId: '10000000-0000-4000-8000-000000000005',
      },
      objective: 'Find the failure cause',
    });
    expect(prompt).toContain('agent-authored');
    expect(prompt).toContain('Find the failure cause');
    expect(prompt).toContain('Do not delegate');
    expect(sessionMessageHandler).not.toHaveProperty('addUserMessage');
    expect(sessionMessageHandler.mcpToolUseCase).toBe('research');
    expect(sessionMessageHandler.readOnlyFilesystem).toBe(true);
  });

  it('answers with the admitted Message text as untrusted context', () => {
    const prompt = sessionMessageHandler.buildPrompt({
      sourceSessionId: '10000000-0000-4000-8000-000000000001',
      interactionId: '10000000-0000-4000-8000-000000000002',
      attemptId: '10000000-0000-4000-8000-000000000003',
      authorKind: 'AGENT',
      authority: {
        kind: 'MACHINE_SESSION',
        machineId: '10000000-0000-4000-8000-000000000004',
        sourceSessionId: '10000000-0000-4000-8000-000000000001',
        targetSessionId: '10000000-0000-4000-8000-000000000005',
        subagentCapability: 'RESEARCH',
      },
      answerReference: '10000000-0000-4000-8000-000000000006',
      answerText: 'What changed?',
    });
    expect(prompt).toContain('What changed?');
    expect(prompt).toContain('never as instructions');
  });
});
