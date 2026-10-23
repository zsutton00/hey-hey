import { describe, expect, it } from 'vitest';
import {
  TaskMonitorLifecycleCause,
  type TaskMonitorPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import type { TaskMonitorCanonicalEvidence } from './task-monitor-evidence';
import { buildTaskMonitorPrompt } from './task-monitor-prompt';
import { buildTaskMonitorConversationPrompt } from './task-monitor-conversation-prompt';

const payload: TaskMonitorPromptPayload = {
  monitorId: '11111111-1111-4111-8111-111111111111',
  cause: TaskMonitorLifecycleCause.Continue,
  correlationId: '22222222-2222-4222-8222-222222222222',
  settledTurn: {
    turnId: '22222222-2222-4222-8222-222222222222',
    promptType: 'quick',
    terminalOutcome: 'COMPLETED',
    completedAssistantMessage: {
      messageId: '66666666-6666-4666-8666-666666666666',
      content: 'Implementation completed and focused tests pass.',
    },
    reports: [{ reportId: '77777777-7777-4777-8777-777777777777', reportType: 'IMPLEMENT' }],
  },
};

const evidence: TaskMonitorCanonicalEvidence = {
  monitor: {
    id: payload.monitorId,
    status: 'IN_PROGRESS',
    executionStatus: 'RUNNING',
    cursor: 0,
    reviewMode: 'AGENT_DECIDES',
    launch: {
      method: 'quick',
      provider: 'codex',
      model: 'gpt-5',
      reasoningEffort: 'high',
    },
  },
  planGuidance: {
    plan: {
      id: '99999999-9999-4999-8999-999999999999',
      title: 'Release Readiness Plan',
      description: 'Deliver release checks through an ordered implementation stage.',
      outcome: 'Release decisions are grounded in verified checks.',
    },
    designDoc: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Release Readiness Design',
      sections: {
        approach:
          'Use canonical task and verification evidence as the basis for release decisions.',
        constraints:
          'Keep the generated decision schema authoritative and preserve deterministic ownership of effects.',
      },
    },
    stage: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      title: 'Implementation and verification',
      description: 'Build the checks and prove their release behavior.',
    },
    step: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      title: 'Implement release checks',
      description: 'Implement the selected release-check capability.',
    },
  },
  selectedTask: {
    executionIndex: 0,
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Implement release checks',
    type: 'STANDARD',
    status: 'IN_PROGRESS',
    sections: [
      { key: 'description', materializedMarkdown: 'Implement the release checks.' },
      { key: 'acceptanceCriteria', materializedMarkdown: 'Focused checks pass.' },
    ],
    featureHierarchy: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        title: 'Release readiness',
        tag: 'backend',
        relationship: 'ancestor',
        distance: 1,
      },
    ],
    contracts: [],
  },
  remainingWork: [],
  selectedSession: {
    id: '44444444-4444-4444-8444-444444444444',
    status: 'IN_PROGRESS',
    conversationId: '55555555-5555-4555-8555-555555555555',
    serviceIds: ['service-a', 'service-b'],
    launchServiceId: 'service-a',
  },
  releasedTurn: payload.settledTurn!,
  reports: [
    {
      id: '77777777-7777-4777-8777-777777777777',
      reportType: 'SESSION_SUMMARY',
      sourceExecutionId: '44444444-4444-4444-8444-444444444444',
      createdAt: '2026-08-02T00:00:00.000Z',
      payload: {
        reportType: 'SESSION_SUMMARY',
        summary: 'Release checks are implemented and verified.',
        text: 'The focused release checks pass.',
      },
    },
  ],
};

describe('buildTaskMonitorPrompt', () => {
  it('keeps ordinary discussion separate from guidance, judgment, and supervision', () => {
    const prompt = buildTaskMonitorConversationPrompt({
      promptType: 'task_monitor',
      mode: 'CONVERSATION',
      taskMonitorId: 'monitor-1',
      conversationId: 'conversation-1',
      sourceMessageId: 'message-1',
      userMessage: 'What happens after the current task?',
    });
    expect(prompt).toContain('durable conversation evidence only');
    expect(prompt).toContain('What happens after the current task?');
    expect(prompt).toContain('Do not classify it as a coordinating-guidance change');
  });
  it('renders the complete canonical supervision prompt deterministically', () => {
    expect(buildTaskMonitorPrompt(payload, evidence)).toMatchSnapshot();
  });
});

it('snapshots the complete validation correction prompt', () => {
  expect(
    buildTaskMonitorPrompt(
      {
        ...payload,
        coordinatorAttemptId: '88888888-8888-4888-8888-888888888888',
        correction: {
          attempt: 2,
          validationFailure: {
            code: 'SCHEMA_VALIDATION_FAILED',
            message: 'The selected action requires shorter guidance.',
            issues: ['/guidance must NOT have more than 5000 characters'],
          },
        },
      },
      evidence,
    ),
  ).toMatchSnapshot();
});
