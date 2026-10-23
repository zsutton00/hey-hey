import { describe, expect, it, vi } from 'vitest';
import { MessagePoster } from '../run/message-poster';
import { RunStore } from '../run-store';
import { MessageType } from '../shared/api';
import { NOOP_LOGGER } from './logger';
import { MachineRevocationSurface } from './machine-revocation-surface';
import { MonitorProjectContext } from './monitors/project-context';
import { createTestPlatformWebSocketManager } from './monitors/test-owners.test-support';

const makePoster = () => {
  const poster = new MessagePoster({
    apiClient: {
      postMessage: vi.fn(),
      updateMessage: vi.fn(),
    },
    logger: NOOP_LOGGER,
    dataDir: '/tmp',
  });
  const createOutOfBand = vi.spyOn(poster, 'createOutOfBand').mockResolvedValue('message-1');
  return { poster, createOutOfBand };
};

const makeProjectContext = (projectId: string | null): MonitorProjectContext => {
  const projectContext = new MonitorProjectContext({
    runStore: new RunStore(),
    platformWebSocketManager: createTestPlatformWebSocketManager(),
    logger: NOOP_LOGGER,
  });
  if (projectId) projectContext.learn(projectId);
  return projectContext;
};

describe('MachineRevocationSurface', () => {
  it('posts a re-pair notice into every subscribed conversation', async () => {
    const { poster, createOutOfBand } = makePoster();
    const surface = new MachineRevocationSurface(
      poster,
      makeProjectContext('project-1'),
      NOOP_LOGGER,
    );

    surface.handle({ organizationId: 'org-1', conversationIds: ['conversation-1'] });
    await vi.waitFor(() => expect(createOutOfBand).toHaveBeenCalledOnce());

    expect(createOutOfBand).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      dto: expect.objectContaining({ type: MessageType.System }),
      stamp: null,
    });
  });

  it('does not post without complete platform context', () => {
    const { poster, createOutOfBand } = makePoster();
    const surface = new MachineRevocationSurface(poster, makeProjectContext(null), NOOP_LOGGER);

    surface.handle({ organizationId: 'org-1', conversationIds: ['conversation-1'] });

    expect(createOutOfBand).not.toHaveBeenCalled();
  });
});
