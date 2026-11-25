import { createTestRun } from '../../../../run/run.test-support';
import { describe, expect, it, vi } from 'vitest';

import { normalizeProviderEventPayload } from '../../../providers/provider-event-normalization';
import { mapCodexEvent } from '../../../providers/codex/codex-event-mapper';
import type { LocalAgentOutputEvent } from '../../../../run/types';
import { createTestRunRegistryWiring } from '../../../../server/__tests__/helpers/test-run-registry';
import { AgentOutputEvents } from '../../../../server/agent-output-events';
import { NOOP_LOGGER } from '../../../../server/logger';
import { TaskMonitorProviderEventAdmission } from '../../../../server/task-monitor-provider-event-admission';
import { TaskMonitorStateMachineInputAdapter } from '../../../../server/state-machine-input-adapter';
import { taskMonitorExactActionInputFromProviderEvent } from '../provider-event-adapter';

const event = (): LocalAgentOutputEvent => ({
  runId: '40000000-0000-4000-8000-000000000004',
  source: 'provider',
  eventType: 'permission_request_detected',
  timestamp: '2026-08-08T12:00:00.000Z',
  sessionId: 'provider-session',
  agentId: 'codex',
  payload: {
    messageType: 'provider_event',
    canonical_event_type: 'permission_request',
    normalization: { success: true },
    canonical_event: {
      canonical_event_type: 'permission_request',
      timestamp: '2026-08-08T12:00:00.000Z',
      permission_request: {
        id: 'provider-action-1',
        action: 'exec',
        target: 'pnpm deploy',
        fingerprint: 'sha256:exact-action',
        created_at: '2026-08-08T12:00:00.000Z',
        expires_at: '2026-08-08T12:05:00.000Z',
      },
    },
  },
});

const realCodexPermissionEvent = (): LocalAgentOutputEvent => {
  const mapped = mapCodexEvent({
    provider: 'codex',
    runId: '40000000-0000-4000-8000-000000000004',
    eventType: 'item/commandExecution/requestApproval',
    timestamp: '2026-08-08T12:00:00.000Z',
    sessionId: 'provider-session',
    agentId: 'codex',
    rawEvent: {
      id: 'provider-action-1',
      params: { command: ['pnpm', 'deploy'], cwd: '/workspace' },
    },
    config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
  });
  if (!mapped.resolvedEventType) throw new Error('Expected a resolved Codex permission event.');
  return {
    runId: '40000000-0000-4000-8000-000000000004',
    source: 'provider',
    eventType: mapped.resolvedEventType,
    timestamp: '2026-08-08T12:00:00.000Z',
    sessionId: 'provider-session',
    agentId: 'codex',
    payload: mapped.payload,
  };
};

const owner = {
  taskMonitorId: '10000000-0000-4000-8000-000000000001',
  agentSessionId: '20000000-0000-4000-8000-000000000002',
  runId: '40000000-0000-4000-8000-000000000004',
};

describe('Task Monitor provider event adapter', () => {
  describe('with the real Claude request shape', () => {
    const claudeEvent = (extra: Record<string, unknown>): LocalAgentOutputEvent => {
      const timestamp = '2026-08-08T12:00:00.000Z';
      const normalized = normalizeProviderEventPayload({
        provider: 'claude',
        runId: owner.runId,
        eventType: 'permission_request',
        timestamp,
        sessionId: 'provider-session',
        agentId: 'claude',
        // Exactly what the Claude runner records, including the open (null) deadline.
        rawEvent: {
          type: 'permission_request',
          timestamp,
          session_id: 'provider-session',
          permission_request: {
            id: 'claude-request-1',
            permission_type: 'Write',
            action: 'Write',
            target: 'src/a.ts',
            fingerprint: 'sha256:claude-exact-action',
            created_at: timestamp,
            expires_at: null,
            ...extra,
          },
        },
        config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
      });

      return {
        runId: owner.runId,
        source: 'provider',
        eventType: 'permission_request_detected',
        timestamp,
        sessionId: 'provider-session',
        agentId: 'claude',
        payload: normalized.payload,
      };
    };

    it('admits an ordinary request with no deadline as monitor-decidable', () => {
      expect(
        taskMonitorExactActionInputFromProviderEvent({ owner, event: claudeEvent({}) }),
      ).toMatchObject({ userRequired: false, expiresAt: null, action: 'Write' });
    });

    it('keeps a request its originating tool marks USER_REQUIRED human-only after normalization', () => {
      expect(
        taskMonitorExactActionInputFromProviderEvent({
          owner,
          event: claudeEvent({ user_required: true }),
        }),
      ).toMatchObject({ userRequired: true });
    });

    it('keeps a request human-only when a top-level designation is masked by a nested false', () => {
      const withTopLevelDesignation = claudeEvent({ user_required: false });
      const normalized = normalizeProviderEventPayload({
        provider: 'claude',
        runId: owner.runId,
        eventType: 'permission_request',
        timestamp: '2026-08-08T12:00:00.000Z',
        sessionId: 'provider-session',
        agentId: 'claude',
        rawEvent: {
          type: 'permission_request',
          user_required: true,
          permission_request: {
            id: 'claude-request-1',
            permission_type: 'Write',
            action: 'Write',
            target: 'src/a.ts',
            fingerprint: 'sha256:claude-exact-action',
            created_at: '2026-08-08T12:00:00.000Z',
            expires_at: null,
            user_required: false,
          },
        },
        config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
      });

      expect(
        taskMonitorExactActionInputFromProviderEvent({
          owner,
          event: { ...withTopLevelDesignation, payload: normalized.payload },
        }),
      ).toMatchObject({ userRequired: true });
    });

    it('keeps a request with a malformed designation human-only', () => {
      expect(
        taskMonitorExactActionInputFromProviderEvent({
          owner,
          event: claudeEvent({ user_required: 'yes' }),
        }),
      ).toMatchObject({ userRequired: true });
    });
  });

  describe('with the real Codex and OpenCode request shapes', () => {
    const timestamp = '2026-08-08T12:00:00.000Z';
    const config = { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false } as const;

    const codexEvent = (
      eventType: string,
      params: Record<string, unknown>,
    ): LocalAgentOutputEvent => {
      const mapped = mapCodexEvent({
        provider: 'codex',
        runId: owner.runId,
        eventType,
        timestamp,
        sessionId: 'provider-session',
        agentId: 'codex',
        rawEvent: { id: 'provider-action-1', params },
        config,
      });
      if (!mapped.resolvedEventType) throw new Error('Expected a resolved Codex event.');

      return {
        runId: owner.runId,
        source: 'provider',
        eventType: mapped.resolvedEventType,
        timestamp,
        sessionId: 'provider-session',
        agentId: 'codex',
        payload: mapped.payload,
      };
    };

    const opencodeEvent = (metadata: Record<string, unknown>): LocalAgentOutputEvent => {
      const normalized = normalizeProviderEventPayload({
        provider: 'opencode',
        runId: owner.runId,
        eventType: 'permission.asked',
        timestamp,
        sessionId: 'provider-session',
        agentId: 'opencode',
        rawEvent: { id: 'perm-9', permission: 'bash', patterns: ['ls *'], metadata },
        config,
      });

      return {
        runId: owner.runId,
        source: 'provider',
        eventType: 'permission_request_detected',
        timestamp,
        sessionId: 'provider-session',
        agentId: 'opencode',
        payload: normalized.payload,
      };
    };

    const admit = (providerEvent: LocalAgentOutputEvent) =>
      taskMonitorExactActionInputFromProviderEvent({ owner, event: providerEvent });

    it.each([
      ['command', 'item/commandExecution/requestApproval', { command: ['pnpm', 'build'] }],
      [
        'file change',
        'item/fileChange/requestApproval',
        { itemId: 'item-1', grantRoot: '/workspace' },
      ],
    ])('carries a Codex %s USER_REQUIRED designation to the human-only owner', (_n, type, base) => {
      expect(admit(codexEvent(type, base))).toMatchObject({ userRequired: false });
      expect(admit(codexEvent(type, { ...base, user_required: true }))).toMatchObject({
        userRequired: true,
      });
    });

    it('carries an OpenCode metadata USER_REQUIRED designation to the human-only owner', () => {
      expect(admit(opencodeEvent({}))).toMatchObject({ userRequired: false });
      expect(admit(opencodeEvent({ user_required: true }))).toMatchObject({ userRequired: true });
    });

    it('lets the monitor tell the same relative Codex command in two directories apart', () => {
      const inService = admit(
        codexEvent('item/commandExecution/requestApproval', {
          command: ['pnpm', 'build'],
          cwd: '/work/service-a',
        }),
      );
      const elsewhere = admit(
        codexEvent('item/commandExecution/requestApproval', {
          command: ['pnpm', 'build'],
          cwd: '/work/other-checkout',
        }),
      );

      expect(inService?.target).toContain('/work/service-a');
      expect(elsewhere?.target).toContain('/work/other-checkout');
      expect(inService?.target).not.toBe(elsewhere?.target);
    });

    it('preserves argument boundaries in the Codex command the monitor judges', () => {
      const joined = admit(
        codexEvent('item/commandExecution/requestApproval', { command: ['echo', 'a b'] }),
      );
      const split = admit(
        codexEvent('item/commandExecution/requestApproval', { command: ['echo', 'a', 'b'] }),
      );

      const withEmpty = admit(
        codexEvent('item/commandExecution/requestApproval', { command: ['tool', '', 'file'] }),
      );
      const withoutEmpty = admit(
        codexEvent('item/commandExecution/requestApproval', { command: ['tool', 'file'] }),
      );

      expect(joined?.target).toBe("echo 'a b'");
      expect(split?.target).toBe('echo a b');
      expect(withEmpty?.target).toBe("tool '' file");
      expect(withoutEmpty?.target).toBe('tool file');
    });

    it('shows the monitor which resource an MCP tool call acts on', () => {
      const mcpCall = (resource: string) =>
        admit(
          codexEvent('mcpServer/elicitation/request', {
            serverName: 'files',
            mode: 'form',
            message: 'Allow this request?',
            _meta: {
              codex_approval_kind: 'mcp_tool_call',
              tool_name: 'delete',
              tool_params: { path: resource },
            },
          }),
        );
      const inScope = mcpCall('/workspace/src/a.ts');
      const outOfScope = mcpCall('/etc/passwd');

      expect(inScope?.target).toContain('/workspace/src/a.ts');
      expect(outOfScope?.target).toContain('/etc/passwd');
      expect(inScope?.target).not.toBe(outOfScope?.target);
    });

    it('leaves an MCP tool call with no supplied arguments for a person', () => {
      const unscoped = admit(
        codexEvent('mcpServer/elicitation/request', {
          serverName: 'files',
          mode: 'form',
          message: 'Allow the files MCP server to run tool "delete"?',
        }),
      );

      expect(unscoped).toBeNull();
    });

    it('names the grant root, not an opaque item id, for a file approval', () => {
      const approval = admit(
        codexEvent('item/fileChange/requestApproval', {
          itemId: 'item-opaque-1',
          grantRoot: '/workspace/src',
        }),
      );
      const opaqueOnly = admit(
        codexEvent('item/fileChange/requestApproval', { itemId: 'item-opaque-1' }),
      );

      expect(approval?.target).toBe('/workspace/src');
      expect(opaqueOnly).toBeNull();
    });
  });

  it.each(['accepted', 'rejected', 'failed'] as const)(
    'reports actual %s admission to the owning Run',
    async (outcome) => {
      const registry = createTestRunRegistryWiring().runRegistry;
      const run = createTestRun();
      vi.spyOn(run, 'agentSessionId', 'get').mockReturnValue(owner.agentSessionId);
      vi.spyOn(run, 'taskMonitorId', 'get').mockReturnValue(owner.taskMonitorId);
      vi.spyOn(registry, 'get').mockReturnValue(run);
      const inputAdapter = Object.create(
        TaskMonitorStateMachineInputAdapter.prototype,
      ) as TaskMonitorStateMachineInputAdapter;
      const admitVerified = vi.spyOn(inputAdapter, 'admitVerified').mockResolvedValue({
        status: 'accepted',
        ingressId: 'provider-action',
        snapshot: {} as never,
        effects: [],
      });
      if (outcome === 'rejected') {
        admitVerified.mockResolvedValue({
          status: 'rejected',
          code: 'transition_rejected',
          reason: 'Another intervention is pending',
        });
      } else if (outcome === 'failed') {
        admitVerified.mockRejectedValue(new Error('Admission store unavailable'));
      }
      const events = new AgentOutputEvents();
      const admission = new TaskMonitorProviderEventAdmission(registry, inputAdapter, NOOP_LOGGER);
      admission.start(events);
      const { runId, ...envelope } = realCodexPermissionEvent();

      events.publish({ kind: 'agent_output', runId, envelope });
      await vi.waitFor(() => expect(admitVerified).toHaveBeenCalledOnce());
      expect(admitVerified).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'PROVIDER_INTERVENTION',
          identity: { machineType: 'TASK_MONITOR', instanceId: owner.taskMonitorId },
          ingressId: `provider-action:${owner.runId}:provider-action-1`,
          action: 'exec',
          target: 'cwd: /workspace\ncommand: pnpm deploy',
          createdAt: '2026-08-08T12:00:00.000Z',
          expiresAt: null,
          fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        }),
      );

      await expect(run.takeTaskMonitorPermissionAdmission('provider-action-1')).resolves.toBe(
        outcome === 'accepted',
      );

      admission.dispose();
      events.publish({ kind: 'agent_output', runId, envelope });
      await Promise.resolve();
      expect(admitVerified).toHaveBeenCalledOnce();
    },
  );

  it('admits one normalized exact action with canonical owner and immutable facts', () => {
    expect(
      taskMonitorExactActionInputFromProviderEvent(
        { owner, event: event() },
        () => '30000000-0000-4000-8000-000000000003',
      ),
    ).toEqual({
      source: 'PROVIDER_INTERVENTION',
      identity: { machineType: 'TASK_MONITOR', instanceId: owner.taskMonitorId },
      ingressId: `provider-action:${owner.runId}:provider-action-1`,
      taskMonitorId: owner.taskMonitorId,
      interventionId: '30000000-0000-4000-8000-000000000003',
      providerActionId: 'provider-action-1',
      providerSessionId: 'provider-session',
      runId: owner.runId,
      agentSessionId: owner.agentSessionId,
      action: 'exec',
      target: 'pnpm deploy',
      fingerprint: 'sha256:exact-action',
      createdAt: '2026-08-08T12:00:00.000Z',
      expiresAt: '2026-08-08T12:05:00.000Z',
      userRequired: false,
    });
  });

  it('scopes ingress replay identity to the owning Run', () => {
    const first = taskMonitorExactActionInputFromProviderEvent(
      { owner, event: event() },
      () => '30000000-0000-4000-8000-000000000003',
    );
    const otherOwner = {
      ...owner,
      runId: '50000000-0000-4000-8000-000000000005',
    };
    const second = taskMonitorExactActionInputFromProviderEvent(
      { owner: otherOwner, event: { ...event(), runId: otherOwner.runId } },
      () => '60000000-0000-4000-8000-000000000006',
    );

    expect(first?.ingressId).not.toBe(second?.ingressId);
  });

  it.each([
    ['unowned Run', { runId: '50000000-0000-4000-8000-000000000005' }],
    ['local source', { source: 'local' as const }],
    ['malformed payload', { payload: { messageType: 'provider_event' } }],
  ])('rejects %s without minting an intervention', (_name, override) => {
    let minted = false;
    expect(
      taskMonitorExactActionInputFromProviderEvent(
        { owner, event: { ...event(), ...override } },
        () => {
          minted = true;
          return '30000000-0000-4000-8000-000000000003';
        },
      ),
    ).toBeNull();
    expect(minted).toBe(false);
  });
});
