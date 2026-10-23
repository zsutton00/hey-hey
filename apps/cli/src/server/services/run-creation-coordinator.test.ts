import { describe, expect, it, vi } from 'vitest';
import { StagedBrowserTabNotFoundError } from '../../browser/run-tabs';
import type { LocalCreateRunRequest } from '../../shared/agent-bridge-contract/contract';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import { NOOP_LOGGER } from '../logger';
import { RunCreationCoordinator } from './run-creation-coordinator';

const RUN_ID = '77777777-7777-4777-8777-777777777777';
const PROJECT_ID = 'project-1';
const STAGED = { stagedTabId: '88888888-8888-4888-8888-888888888888' };

const request = (stagedBrowserTab: LocalCreateRunRequest['stagedBrowserTab']) =>
  ({
    context: { projectId: PROJECT_ID },
    contextMetadata: {},
    conversationId: 'conversation-1',
    payload: { promptType: LocalPromptType.EntityConversation, userMessage: 'hello' },
    attachments: [],
    stagedBrowserTab,
  }) as unknown as LocalCreateRunRequest;

const harness = (adoptStaged?: ReturnType<typeof vi.fn<() => Promise<void>>>) => {
  const order: string[] = [];
  const run = { agentic_session_id: RUN_ID };
  const sendMessage = vi.fn(async () => {
    order.push('first_turn');
  });
  const coordinator = new RunCreationCoordinator(
    {
      runService: {
        materializeRun: vi.fn(async () => ({ status: 'started', created: true, run })),
        getRun: vi.fn(async () => ({ run })),
      } as never,
      messageService: { sendMessage } as never,
      runRegistry: { get: () => ({ awaitIdle: async () => {} }) } as never,
      promptTypeRegistry: {
        get: (promptType: string) => ({ promptType }),
      } as never,
      logger: NOOP_LOGGER,
      projectModeBundleMaterializer: {} as never,
      ...(adoptStaged
        ? {
            stagedBrowserTabs: {
              adoptStaged: adoptStaged.mockImplementation(() => {
                order.push('adopt');
                return Promise.resolve();
              }),
            },
          }
        : {}),
    },
    { bindStaged: vi.fn(async () => {}) } as never,
  );
  return { coordinator, sendMessage, order };
};

describe('RunCreationCoordinator staged browser tab', () => {
  it('adopts the staged tab after the Run exists and before its first Turn', async () => {
    const adoptStaged = vi.fn<() => Promise<void>>();
    const h = harness(adoptStaged);

    await h.coordinator.createRun(request(STAGED));

    expect(adoptStaged).toHaveBeenCalledWith(RUN_ID, PROJECT_ID, STAGED.stagedTabId);
    expect(h.order).toEqual(['adopt', 'first_turn']);
  });

  it('starts without adoption when no tab was opened', async () => {
    const adoptStaged = vi.fn<() => Promise<void>>();
    const h = harness(adoptStaged);

    await h.coordinator.createRun(request(null));

    expect(adoptStaged).not.toHaveBeenCalled();
    expect(h.sendMessage).toHaveBeenCalledOnce();
  });

  it('rejects the start and runs no first Turn when the staged tab is gone', async () => {
    const adoptStaged = vi.fn<() => Promise<void>>();
    const h = harness(adoptStaged);
    adoptStaged.mockRejectedValue(new StagedBrowserTabNotFoundError(STAGED.stagedTabId));

    await expect(h.coordinator.createRun(request(STAGED))).rejects.toMatchObject({
      code: 'STAGED_BROWSER_TAB_NOT_FOUND',
    });
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a staged tab when this CLI has no Shared Browser', async () => {
    const h = harness();

    await expect(h.coordinator.createRun(request(STAGED))).rejects.toBeInstanceOf(
      StagedBrowserTabNotFoundError,
    );
    expect(h.sendMessage).not.toHaveBeenCalled();
  });
});
