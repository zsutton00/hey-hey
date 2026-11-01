import { describe, expect, it, vi } from 'vitest';
import type { ProjectAssistantPolicy, PromptTypeHandler } from '../../prompt-type-handler';
import type { ProjectAssistantConfig } from '../../../shared/agent-bridge-contract/contract';
import {
  LocalPromptType,
  type RunEntityReference,
} from '../../../shared/agent-bridge-contract/generated/api';
import type { AgenticSession } from '../../../session/types';
import {
  resolveProjectAssistantBootstrap,
  resolveProjectAssistantPolicy,
} from '../proactive-behavior';

const ceiling: ProjectAssistantPolicy = {
  allowEdgeUpdates: false,
  notifyDiscrepancies: true,
  workItemProposalMode: 'edit',
};

describe('resolveProjectAssistantPolicy', () => {
  it('returns no policy without a handler declaration', () => {
    expect(resolveProjectAssistantPolicy(undefined)).toBeUndefined();
  });

  it('returns the handler declaration unchanged when config is omitted', () => {
    expect(resolveProjectAssistantPolicy(ceiling)).toEqual(ceiling);
  });

  it('returns the handler declaration unchanged when explicitly enabled', () => {
    expect(resolveProjectAssistantPolicy(ceiling, { enabled: true })).toEqual(ceiling);
  });

  it('returns no policy when explicitly disabled', () => {
    expect(resolveProjectAssistantPolicy(ceiling, { enabled: false })).toBeUndefined();
  });

  it('narrows edge and discrepancy authority from persisted config', () => {
    expect(
      resolveProjectAssistantPolicy(ceiling, {
        notifyDiscrepancies: false,
      }),
    ).toEqual({
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'edit',
    });
  });

  it('preserves the handler ceiling when config flags are true', () => {
    expect(
      resolveProjectAssistantPolicy(ceiling, {
        allowEdgeUpdates: true,
        notifyDiscrepancies: true,
      }),
    ).toEqual({
      allowEdgeUpdates: false,
      notifyDiscrepancies: true,
      workItemProposalMode: 'edit',
    });
  });

  it('disables proposals independently from participation', () => {
    expect(resolveProjectAssistantPolicy(ceiling, { allowUpdateProposals: false })).toEqual({
      allowEdgeUpdates: false,
      notifyDiscrepancies: true,
      workItemProposalMode: 'none',
    });
  });
});

describe('resolveProjectAssistantBootstrap', () => {
  const focalEntity = {
    entityId: 'entity-1',
    entityType: 'FEATURE',
  } as unknown as RunEntityReference;
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
  const sessionWith = (projectAssistant?: ProjectAssistantConfig): AgenticSession =>
    ({
      agentic_session_id: 'run-1',
      config: { type: 'ENTITY_CONVERSATION', projectAssistant },
    }) as unknown as AgenticSession;
  const handler = (
    overrides: Partial<PromptTypeHandler<unknown>> = {},
    { withoutDeclaration = false } = {},
  ) =>
    ({
      id: 'consumer',
      ...(withoutDeclaration ? {} : { projectAssistant: ceiling }),
      ...overrides,
    }) as PromptTypeHandler<unknown>;

  it('returns the declared policy and a research payload quoting the user message', () => {
    expect(
      resolveProjectAssistantBootstrap(handler(), sessionWith(), focalEntity, 'hello', logger),
    ).toEqual({
      policy: ceiling,
      payload: {
        promptType: LocalPromptType.Research,
        entity: focalEntity,
        userMessage: 'hello',
        projectAssistantHandoff: { consumerHandlerId: 'consumer', policy: ceiling },
      },
    });
  });

  it('returns nothing for a consumer without a declared policy', () => {
    expect(
      resolveProjectAssistantBootstrap(
        handler({}, { withoutDeclaration: true }),
        sessionWith(),
        focalEntity,
        'hello',
        logger,
      ),
    ).toBeUndefined();
  });

  it('returns nothing without a consumer handler or focal entity', () => {
    expect(
      resolveProjectAssistantBootstrap(undefined, sessionWith(), focalEntity, 'hello', logger),
    ).toBeUndefined();
    expect(
      resolveProjectAssistantBootstrap(handler(), sessionWith(), null, 'hello', logger),
    ).toBeUndefined();
  });

  it('narrows the policy and handoff from session config', () => {
    const result = resolveProjectAssistantBootstrap(
      handler(),
      sessionWith({ notifyDiscrepancies: false, allowUpdateProposals: false }),
      focalEntity,
      'hello',
      logger,
    );
    const narrowed = {
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'none',
    };
    expect(result?.policy).toEqual(narrowed);
    expect(result?.payload.projectAssistantHandoff.policy).toEqual(narrowed);
  });

  it('returns nothing when session config disables Project Assistant', () => {
    expect(
      resolveProjectAssistantBootstrap(
        handler(),
        sessionWith({ enabled: false }),
        focalEntity,
        'hello',
        logger,
      ),
    ).toBeUndefined();
  });

  it('uses the handler resolver over the static declaration, still narrowed by config', () => {
    const resolveProjectAssistant = vi.fn().mockReturnValue(ceiling);
    const session = sessionWith({ enabled: false });
    expect(
      resolveProjectAssistantBootstrap(
        handler({ resolveProjectAssistant }, { withoutDeclaration: true }),
        session,
        focalEntity,
        'hello',
        logger,
      ),
    ).toBeUndefined();
    expect(resolveProjectAssistant).toHaveBeenCalledWith(session, logger);
    expect(
      resolveProjectAssistantBootstrap(
        handler({ resolveProjectAssistant }, { withoutDeclaration: true }),
        sessionWith(),
        focalEntity,
        'hello',
        logger,
      )?.policy,
    ).toEqual(ceiling);
  });
});
