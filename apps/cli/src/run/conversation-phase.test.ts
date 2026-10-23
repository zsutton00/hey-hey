import { describe, expect, it, vi } from 'vitest';
import type { RunEventPublisher } from '../server/run-event-publisher';
import { NOOP_LOGGER } from '../server/logger';
import {
  ConversationPhaseOwner,
  createConversationPhaseObservation,
} from './conversation-phase';

const makeOwner = () => {
  const publisher = {
    emitConversationPhaseObservation: vi.fn(),
  } as unknown as RunEventPublisher;
  const owner = new ConversationPhaseOwner(
    'run-id',
    'conversation-id',
    publisher,
    NOOP_LOGGER,
  );
  return { owner, publisher };
};

describe('ConversationPhaseOwner', () => {
  it('keeps reviewing across provider phases and resumes reviewing after approval', () => {
    const { owner, publisher } = makeOwner();

    owner.observeReviewing();
    owner.observeProviderPhase('starting');
    owner.observeProviderPhase('thinking');
    owner.observeProviderPhase('awaiting_approval');
    owner.resumeAfterApproval();

    expect(owner.currentPhase).toBe('reviewing');
    expect(
      vi.mocked(publisher.emitConversationPhaseObservation).mock.calls.map(
        ([observation]) => observation.phase,
      ),
    ).toEqual(['reviewing', 'awaiting_approval', 'reviewing']);
  });

  it('settles a completed Turn to idle and clears review ownership', () => {
    const { owner, publisher } = makeOwner();

    owner.observeReviewing();
    owner.settleTurn();
    owner.observeProviderPhase('thinking');

    expect(owner.currentPhase).toBe('thinking');
    expect(
      vi.mocked(publisher.emitConversationPhaseObservation).mock.calls.map(
        ([observation]) => observation.phase,
      ),
    ).toEqual(['reviewing', 'idle', 'thinking']);
  });

  it('builds the generated observation shape for the platform boundary', () => {
    expect(
      createConversationPhaseObservation({
        conversationId: 'conversation-id',
        phase: 'reviewing',
        observedAt: '2026-08-25T00:00:00.000Z',
      }),
    ).toEqual({
      conversationId: 'conversation-id',
      phase: 'reviewing',
      observedAt: '2026-08-25T00:00:00.000Z',
    });
  });
});
