import { describe, expect, it, vi } from 'vitest';
import { NOOP_LOGGER } from '../server/logger';
import { createTestRunEventPublisher } from './run.test-support';
import { AgentSessionCurrentStateOwner } from './agent-session-current-state';

const makeOwner = () => {
  const publisher = createTestRunEventPublisher();
  const owner = new AgentSessionCurrentStateOwner(
    'run-1',
    'agent-session-1',
    publisher,
    NOOP_LOGGER,
    () => {},
  );
  return { owner, publisher };
};

describe('AgentSessionCurrentStateOwner PLAN_READY evidence', () => {
  it('does not publish or replay PLAN_READY from a report without a terminal assistant message', () => {
    const { owner, publisher } = makeOwner();

    owner.observeProviderPhase('writing');
    owner.observePersistedPlanReady('report-1', 'turn-1');
    owner.replay();

    expect(publisher.emitAgentSessionCurrentStateObservation).not.toHaveBeenCalledWith(
      expect.objectContaining({ currentState: 'PLAN_READY' }),
    );

    owner.settleTurn();

    expect(publisher.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'IDLE' }),
    );
  });

  it('requires the report and terminal assistant message to belong to the same turn', () => {
    const { owner, publisher } = makeOwner();

    owner.observePersistedPlanReady('report-1', 'turn-1');
    owner.observeFinalAssistantMessageCommitted('message-2', 'turn-2');

    expect(publisher.emitAgentSessionCurrentStateObservation).not.toHaveBeenCalledWith(
      expect.objectContaining({ currentState: 'PLAN_READY' }),
    );

    owner.observePersistedPlanReady('report-2', 'turn-2');

    expect(publisher.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'PLAN_READY' }),
    );
  });

  it('publishes PLAN_READY when the terminal assistant message commits before the report', () => {
    const { owner, publisher } = makeOwner();

    owner.observeFinalAssistantMessageCommitted('message-1', 'turn-1');
    owner.observePersistedPlanReady('report-1', 'turn-1');

    expect(publisher.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'PLAN_READY' }),
    );
  });

  it('replaces a completed plan state when a new turn starts', () => {
    const { owner, publisher } = makeOwner();

    owner.observePersistedPlanReady('report-1', 'turn-1');
    owner.observeFinalAssistantMessageCommitted('message-1', 'turn-1');
    owner.observeProviderPhase('starting');

    expect(publisher.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'STARTING' }),
    );
  });
});

describe('AgentSessionCurrentStateOwner local effective state', () => {
  const makeObservedOwner = () => {
    const onChange = vi.fn();
    const owner = new AgentSessionCurrentStateOwner(
      'run-1',
      'agent-session-1',
      createTestRunEventPublisher(),
      NOOP_LOGGER,
      onChange,
    );
    return { owner, onChange };
  };

  it('exposes the exact published state and signals each publication', () => {
    const { owner, onChange } = makeObservedOwner();
    expect(owner.effectiveState).toBeNull();

    owner.observeProviderPhase('writing');

    expect(owner.effectiveState).toMatchObject({
      agentSessionId: 'agent-session-1',
      currentState: 'WRITING',
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keeps PLAN_READY after the turn settles', () => {
    const { owner } = makeObservedOwner();
    owner.observeProviderPhase('writing');
    owner.observeFinalAssistantMessageCommitted('message-1', 'turn-1');
    owner.observePersistedPlanReady('report-1', 'turn-1');

    owner.settleTurn();

    expect(owner.currentProviderPhase).toBeNull();
    expect(owner.effectiveState?.currentState).toBe('PLAN_READY');
  });

  it('keeps the approval wait after the turn settles', () => {
    const { owner } = makeObservedOwner();
    owner.observeProviderPhase('writing');

    owner.settleTurn(true);

    expect(owner.effectiveState?.currentState).toBe('AWAITING_APPROVAL');
  });
});
