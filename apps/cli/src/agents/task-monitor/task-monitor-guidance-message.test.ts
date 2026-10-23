import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagePoster } from '../../run/message-poster';
import type { MessagePosterApiClient } from '../../run/types';
import {
  MessageStatus,
  MessageType,
  UserMessageAgentInputProvenance,
  UserMessageDataCodingFreeformPromptTypeEnum,
  type CreateUserMessage,
} from '../../shared/api/generated/api';
import { NOOP_LOGGER } from '../../server/logger';
import { postTaskMonitorGuidanceMessage } from './task-monitor-guidance-message';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-task-monitor-guidance-'));
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('postTaskMonitorGuidanceMessage', () => {
  it('posts one monitor-authored USER message through the generated message API', async () => {
    const postMessage = vi.fn().mockResolvedValue({
      data: { data: { id: 'guidance-message-1' } },
    });
    const apiClient: MessagePosterApiClient = {
      postMessage,
      updateMessage: vi.fn().mockResolvedValue(undefined),
    };
    const poster = new MessagePoster({ apiClient, logger: NOOP_LOGGER, dataDir });

    await expect(
      postTaskMonitorGuidanceMessage({
        poster,
        organizationId: 'organization-1',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        guidance: 'Run the focused test and report the result.',
      }),
    ).resolves.toBe('guidance-message-1');

    expect(postMessage).toHaveBeenCalledOnce();
    const sent = postMessage.mock.calls[0]![0].createMessageDto as CreateUserMessage;
    expect(sent).toMatchObject({
      type: MessageType.User,
      userId: 'user-1',
      status: MessageStatus.Completed,
      projectId: 'project-1',
      conversationId: 'conversation-1',
      data: {
        agentInput: {
          promptType: UserMessageDataCodingFreeformPromptTypeEnum.CodingFreeform,
          userMessage: 'Run the focused test and report the result.',
          provenance: UserMessageAgentInputProvenance.TaskMonitor,
        },
      },
    });
    expect(sent).not.toHaveProperty('parentMessageId');
    expect(sent.data).not.toHaveProperty('triggersAgent');
  });
});
