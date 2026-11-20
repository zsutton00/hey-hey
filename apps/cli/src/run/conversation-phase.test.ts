import { describe, expect, it, vi } from 'vitest';
import type { RunEventPublisher } from '../server/run-event-publisher';
import { NOOP_LOGGER } from '../server/logger';
import { ConversationPhaseOwner, createConversationPhaseObservation } from './conversation-phase';

const makeOwner = () => {
  const publisher = {
    emitConversationPhaseObservation: vi.fn(),
  } as unknown as RunEventPublisher;
  const owner = new ConversationPhaseOwner('run-id', 'conversation-id', publisher, NOOP_LOGGER);
  return { owner, publisher };
};

describe('ConversationPhaseOwner', () => {
  it('keeps reviewing across provider phases and resumes reviewing after approval', () => {
    const { owner, publisher } = makeOwner();

    owner.observeReviewing();
    owner.observeProviderPhase('starting');
    owner.observeProviderPhase('thinking');
    owner.observeProviderPhase('awaiting_approval');
    owner.resolveApproval('decision_delivered');

    expect(owner.currentPhase).toBe('reviewing');
    expect(
      vi
        .mocked(publisher.emitConversationPhaseObservation)
        .mock.calls.map(([observation]) => observation.phase),
    ).toEqual(['reviewing', 'awaiting_approval', 'reviewing']);
  });

  it('holds awaiting_approval against provider activity until the decision is delivered', () => {
    const { owner, publisher } = makeOwner();

    owner.observeProviderPhase('writing');
    owner.observeProviderPhase('awaiting_approval');
    owner.observeProviderPhase('thinking');
    owner.observeProviderPhase('writing');
    owner.replay();
    expect(owner.currentPhase).toBe('awaiting_approval');

    owner.resolveApproval('decision_delivered');

    expect(owner.currentPhase).toBe('thinking');
    expect(
      vi
        .mocked(publisher.emitConversationPhaseObservation)
        .mock.calls.map(([observation]) => observation.phase),
    ).toEqual(['writing', 'awaiting_approval', 'awaiting_approval', 'thinking']);
  });

  it.each([
    ['a new turn', (o: ConversationPhaseOwner) => o.observeProviderPhase('starting'), 'starting'],
    ['turn settlement', (o: ConversationPhaseOwner) => o.settleTurn(), null],
    ['cleanup', (o: ConversationPhaseOwner) => o.cleanup(true), null],
  ])('releases the hold on %s', (_name, end, phase) => {
    const { owner } = makeOwner();

    owner.observeProviderPhase('awaiting_approval');
    end(owner);

    expect(owner.currentPhase).toBe(phase);
    owner.observeProviderPhase('thinking');
    expect(owner.currentPhase).toBe('thinking');
  });

  it('settles a completed Turn to idle and clears review ownership', () => {
    const { owner, publisher } = makeOwner();

    owner.observeReviewing();
    owner.settleTurn();
    owner.observeProviderPhase('thinking');

    expect(owner.currentPhase).toBe('thinking');
    expect(
      vi
        .mocked(publisher.emitConversationPhaseObservation)
        .mock.calls.map(([observation]) => observation.phase),
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
