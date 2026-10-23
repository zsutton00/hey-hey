import axios, { type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseAdmittedChildServiceScope,
  pollSubagentDispatchClaims,
  SubagentInteractionRuntime,
  subagentChildPayloadHash,
  type SubagentDispatchClaims,
  type SubagentInteractionRuntimeDependencies,
} from './subagent-interaction-runtime';
import type { DispatchSource } from './dispatch-source';
import { AgentSessionsApi } from '../shared/api/generated/api';
import { ChildAgentLauncher } from '../run/child-agent-launcher';
import { researchHandler } from '../agents/research/research.handler';
import type { ChildAgentLauncherDependencies } from '../run/child-agent-launcher';
import { HostActionAdmission } from './controller-authorization/host-action-admission';
import type {
  ControllerAssertionVerificationResult,
  ControllerAuthorizationAdmissionContext,
  ExecutableEnvelopeAuthorization,
  GrantAdmissionInput,
} from './controller-authorization/types';
import { CURRENT_AGENT_OPERATIONS } from './controller-authorization/types';
import type { SubagentDispatch } from '../shared/api/generated/api';

/**
 * Real HostActionAdmission over in-memory grant and replay stores, with a
 * verifier stub that checks the bindings the real verifier enforces.
 */
const authority = () => {
  const grants = new Map<
    string,
    {
      machineId: string;
      userId: string;
      organizationId: string;
      expiresAtMs: number;
      revoked: boolean;
    }
  >();
  const consumed = new Set<string>();
  const consumeMany = vi.fn(async (ids: string[]) => {
    if (ids.some((id) => consumed.has(id))) return false;
    for (const id of ids) consumed.add(id);
    return true;
  });
  const grantStore = {
    admit: vi.fn(async (input: GrantAdmissionInput) => {
      const grant = grants.get(input.grantId);
      if (!grant || grant.revoked || grant.expiresAtMs <= Date.now())
        throw new Error('GRANT_NOT_ACTIVE');
      if (
        grant.machineId !== input.machineId ||
        grant.userId !== input.userId ||
        grant.organizationId !== input.organizationId ||
        input.actionType !== 'CONVERSATION_TRIGGER'
      )
        throw new Error('GRANT_SCOPE_MISMATCH');
      return { grantId: input.grantId };
    }),
    create: vi.fn(
      async (input: {
        grantId: string;
        descriptor: {
          machineId: string;
          userId: string;
          organizationId: string;
          effectiveExpiresAtMs: number;
        };
      }) => {
        grants.set(input.grantId, {
          machineId: input.descriptor.machineId,
          userId: input.descriptor.userId,
          organizationId: input.descriptor.organizationId,
          expiresAtMs: input.descriptor.effectiveExpiresAtMs,
          revoked: false,
        });
        return { grantId: input.grantId };
      },
    ),
  };
  const verify = vi.fn(
    async (
      authorization: Extract<ExecutableEnvelopeAuthorization, { kind: 'controller_assertion' }>,
      context: ControllerAuthorizationAdmissionContext,
    ): Promise<ControllerAssertionVerificationResult> => {
      const { intent } = authorization;
      if (intent.machineId !== context.machineId || intent.userId !== context.userId)
        return { ok: false, reason: 'CREDENTIAL_MISMATCH' };
      if (intent.actionType !== context.actionType) return { ok: false, reason: 'ACTION_MISMATCH' };
      if (intent.actionPayloadHash !== context.actionPayloadHash)
        return { ok: false, reason: 'PAYLOAD_HASH_MISMATCH' };
      if (intent.target.kind !== context.target.kind || intent.target.id !== context.target.id)
        return { ok: false, reason: 'TARGET_MISMATCH' };
      return {
        ok: true,
        authorizationId: intent.authorizationId,
        intent,
        credentialFingerprint: 'c'.repeat(64),
      };
    },
  );
  const admission = new HostActionAdmission({
    assertionVerifier: { verify } as never,
    grantStore: grantStore as never,
    replayStore: {
      consume: (id: string) => consumeMany([id]),
      consumeMany,
    } as never,
  });
  const seedGrant = (
    grantId: string,
    overrides: Partial<{ expiresAtMs: number; revoked: boolean }> = {},
  ) =>
    grants.set(grantId, {
      machineId: 'machine',
      userId: 'user',
      organizationId: 'org',
      expiresAtMs: Date.now() + 60_000,
      revoked: false,
      ...overrides,
    });
  return { admission, grantStore, verify, consumed, seedGrant };
};

const controllerRegistry = {
  read: async () => ({
    controllers: [{ machineId: 'machine', accountId: 'user', organizationId: 'org' }],
  }),
} as never;

const assertionFor = (actionPayloadHash: string): ExecutableEnvelopeAuthorization => ({
  kind: 'controller_assertion',
  intent: {
    version: 2,
    authorizationId: 'authorization-1',
    controllerCredentialId: 'credential-1',
    controllerInstallationId: 'installation-1',
    machineId: 'machine',
    userId: 'user',
    organizationId: 'org',
    projectId: 'project',
    cadence: 'ONE_DAY',
    policyRevision: 1,
    effectiveGrantExpiresAtMs: Date.now() + 60_000,
    grantDescriptorHash: 'b'.repeat(64),
    actionCategory: 'CONVERSATION',
    actionType: 'CONVERSATION_TRIGGER',
    actionPayloadHash,
    allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
    allowedActionCategories: new Set(['CONVERSATION' as const]),
    target: { kind: 'AGENT_SESSION', id: 'session', revision: null },
    agentSessionId: 'session',
    taskMonitorId: null,
    nonce: 'n'.repeat(43),
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 120_000,
  },
  credentialId: 'credential-1',
  clientDataJSON: 'client',
  authenticatorData: 'authenticator',
  signature: 'signature',
  userHandle: null,
  grantDescriptor: {
    scope: 'controller_device_window',
    controllerCredentialId: 'credential-1',
    controllerInstallationId: 'installation-1',
    machineId: 'machine',
    userId: 'user',
    organizationId: 'org',
    cadence: 'ONE_DAY',
    policyRevision: 1,
    allowedActionTypes: new Set(CURRENT_AGENT_OPERATIONS),
    allowedActionCategories: new Set(['CONVERSATION' as const]),
    issuedAtMs: Date.now(),
    effectiveExpiresAtMs: Date.now() + 60_000,
  },
  grantId: 'grant-activated',
});

const childDispatch = (
  overrides: Partial<SubagentDispatch> = {},
  authorization: ExecutableEnvelopeAuthorization | null = {
    kind: 'bounded_grant',
    grantId: 'grant-1',
  },
): SubagentDispatch => {
  const base = {
    interactionId: 'interaction',
    attemptId: 'attempt',
    effectId: 'effect',
    leaseToken: 'lease',
    sourceSessionId: 'session',
    sourceRunId: 'run',
    targetTurnId: 'turn',
    mode: 'BACKGROUND' as const,
    capability: 'RESEARCH' as const,
    objective: 'Inspect the implementation',
    generation: 1,
    childScope: { serviceIds: ['service-a'], launchServiceId: 'service-a' },
    sourceExecutionContext: {
      provider: 'codex',
      conversationId: 'conversation',
      createdAt: new Date().toISOString(),
      serviceIds: ['service-a'],
    },
    ...overrides,
  };
  return {
    ...base,
    authorization,
    actionPayloadHash: authorization
      ? subagentChildPayloadHash(base, base.childScope.serviceIds)
      : null,
  };
};

const child = vi.hoisted(() => ({ execute: vi.fn(), inputs: [] as any[] }));
vi.mock('../run/subagent', () => ({
  SubAgent: class {
    constructor(input: any) {
      child.inputs.push(input);
    }
    execute() {
      return child.execute();
    }
  },
}));
vi.mock('../agents/run-scope', () => ({
  resolveRunWorkspace: vi.fn(async () => ({
    ok: true,
    cwd: '/tmp',
    allowedRepositoryRoots: ['/tmp'],
  })),
}));

/** Delivers work only when the test says so; no timers involved. */
const fakeDispatchSource = () => {
  let onWork: ((work: SubagentDispatchClaims) => Promise<void>) | undefined;
  const source: DispatchSource<SubagentDispatchClaims> = {
    subscribe(listener) {
      onWork = listener;
      return { dispose: () => (onWork = undefined) };
    },
  };
  return { source, deliver: (work: SubagentDispatchClaims) => onWork!(work) };
};

const originalAdapter = axios.defaults.adapter;
let runtime: SubagentInteractionRuntime | undefined;
afterEach(() => {
  runtime?.dispose();
  if (originalAdapter === undefined) delete axios.defaults.adapter;
  else axios.defaults.adapter = originalAdapter;
  vi.useRealTimers();
  vi.clearAllMocks();
  child.inputs.length = 0;
});

describe('subagent dispatch delivery', () => {
  const scope = { organizationId: 'org', projectId: 'project' };
  const ownedRun = {
    contextMetadata: { agentSessionId: 'session', organizationId: 'org', projectId: 'project' },
  };
  const wait = { interactionId: 'interaction', sourceSessionId: 'session', sourceRunId: 'run' };
  const setup = () => {
    const runRegistry = { holdForSubagent: vi.fn(), releaseSubagentHold: vi.fn() };
    const getRun = vi.fn(async () => ownedRun);
    runtime = new SubagentInteractionRuntime({
      runStore: { getRun },
      runRegistry,
      childAgentLauncher: {},
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      hostActionAdmission: authority().admission,
      controllerRegistry,
    } as unknown as SubagentInteractionRuntimeDependencies);
    const fake = fakeDispatchSource();
    fake.source.subscribe((work) => runtime!.receive(work));
    const deliver = (foregroundWaits: (typeof wait)[], failure?: { error: unknown }) =>
      fake.deliver({
        api: {} as AgentSessionsApi,
        machineId: 'machine',
        claims: [{ scope, response: { claimed: false, foregroundWaits } }],
        ...(failure && { failure }),
      });
    return { runtime, runRegistry, getRun, deliver };
  };

  it('restores foreground holds before it reports ready for input pickup', async () => {
    const { runtime, runRegistry, deliver } = setup();
    const ready = vi.fn(() => {
      expect(runRegistry.holdForSubagent).toHaveBeenCalledWith('run', 'interaction');
    });
    runtime.onReadyForInputPickup(ready);
    expect(runtime.readyForInputPickup).toBe(false);

    await deliver([wait]);
    await deliver([wait]);

    expect(runtime.readyForInputPickup).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('stays unready when the first delivery fails', async () => {
    const { runtime, getRun, deliver } = setup();
    getRun.mockRejectedValueOnce(new Error('store down'));

    await expect(deliver([wait])).rejects.toThrow('store down');

    expect(runtime.readyForInputPickup).toBe(false);
  });

  it('handles claims made before a failed claim, then pauses input pickup', async () => {
    const { runtime, runRegistry, deliver } = setup();
    await deliver([]);
    expect(runtime.readyForInputPickup).toBe(true);

    await expect(deliver([wait], { error: new Error('claim failed') })).rejects.toThrow(
      'claim failed',
    );

    expect(runRegistry.holdForSubagent).toHaveBeenCalledWith('run', 'interaction');
    expect(runtime.readyForInputPickup).toBe(false);
  });

  it('releases a hold whose wait is gone and keeps claiming its scope', async () => {
    const { runtime, runRegistry, deliver } = setup();
    await deliver([wait]);
    expect(runtime.foregroundWaitScopes).toEqual([scope]);

    await deliver([]);

    expect(runRegistry.releaseSubagentHold).toHaveBeenCalledWith('run', 'interaction');
    expect(runtime.foregroundWaitScopes).toEqual([scope]);
  });
});

describe('subagent dispatch generated-client integration', () => {
  it('rejects a dispatch without the admitted child Service set', () => {
    expect(() =>
      parseAdmittedChildServiceScope({ childScope: { launchServiceId: 'source' } as never }),
    ).toThrow();
  });

  it('rejects a dispatch admitted without childScope', () => {
    expect(() => parseAdmittedChildServiceScope({})).toThrow(/no admitted childScope/);
  });

  it('reads the admitted child Service set from childScope', () => {
    expect(
      parseAdmittedChildServiceScope({ childScope: { serviceIds: ['a'], launchServiceId: 'a' } }),
    ).toEqual({ serviceIds: ['a'], launchServiceId: 'a' });
  });

  it('keeps the claims made before a claim fails and stops claiming', async () => {
    const claimUrls: string[] = [];
    axios.defaults.adapter = (async (config) => {
      const url = new URL(config.url!, config.baseURL).pathname;
      let data: any;
      if (url === '/api/v1/subagent-dispatches/scopes') {
        data = {
          scopes: [
            { organizationId: 'org', projectId: 'a' },
            { organizationId: 'org', projectId: 'b' },
            { organizationId: 'org', projectId: 'c' },
          ],
        };
      } else {
        claimUrls.push(url);
        if (url.includes('/projects/b/')) throw new Error('claim failed');
        data = { claimed: false, foregroundWaits: [] };
      }
      return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data } };
    }) as AxiosAdapter;
    const keyPairStore = {
      loadCurrentMachineId: vi.fn(async () => 'machine'),
      loadMachineCredential: vi.fn(async () => 'test-machine-credential'),
    };

    const work = await pollSubagentDispatchClaims(
      { keyPairStore, apiBaseUrl: 'http://local-test.invalid/api/v1' } as never,
      [],
    );

    expect(work!.claims.map(({ scope }) => scope.projectId)).toEqual(['a']);
    expect((work!.failure!.error as Error).message).toBe('claim failed');
    expect(claimUrls).toHaveLength(2);
  });

  it.each(['FOREGROUND', 'BACKGROUND'] as const)(
    'claims, executes, and returns a %s child through API envelopes',
    async (mode) => {
      const requests: Array<{ url: string; method: string; body: any }> = [];
      const dispatch = childDispatch({ mode, childScope: { serviceIds: [] } });
      const controllerAuthority = authority();
      controllerAuthority.seedGrant('grant-1');
      const adapter: AxiosAdapter = async (config) => {
        const url = new URL(config.url!, config.baseURL).pathname;
        expect(config.headers.get('Authorization')).toBe('Bearer test-machine-credential');
        const body = config.data ? JSON.parse(config.data) : undefined;
        requests.push({ url, method: config.method!, body });
        let data: any;
        if (url === '/api/v1/subagent-dispatches/scopes')
          data = { scopes: [{ organizationId: 'org', projectId: 'project' }] };
        else if (url === '/api/v1/organizations/org/projects/project/subagent-dispatches/claim') {
          data = {
            claimed: true,
            dispatch,
            foregroundWaits:
              mode === 'FOREGROUND'
                ? [{ interactionId: 'interaction', sourceSessionId: 'session', sourceRunId: 'run' }]
                : [],
          };
        } else if (
          url === '/api/v1/organizations/org/projects/project/subagent-dispatches/effect/settlement'
        )
          data = { accepted: true };
        else throw new Error(`Unexpected request: ${url}`);
        return {
          config,
          status: 200,
          statusText: 'OK',
          headers: {},
          data: { success: true, data },
        };
      };
      axios.defaults.adapter = adapter;
      child.execute.mockResolvedValue({
        assistantCompleted: true,
        outputText: 'Verified child result',
      });
      const holdForSubagent = vi.fn();
      const keyPairStore = {
        loadCurrentMachineId: vi.fn(async () => 'machine'),
        loadMachineCredential: vi.fn(async () => 'test-machine-credential'),
      };
      const deps = {
        runStore: {
          getRun: vi.fn(async () => ({
            agentic_session_id: 'session',
            provider: 'codex',
            services: [],
            contextMetadata: {
              agentSessionId: 'session',
              organizationId: 'org',
              projectId: 'project',
            },
          })),
        },
        runRegistry: { holdForSubagent, releaseSubagentHold: vi.fn() },
        childAgentLauncher: new ChildAgentLauncher({
          promptTypeRegistry: {
            getChildHandler: (id: string) =>
              id === researchHandler.id ? researchHandler : undefined,
          },
          repoStore: {},
          oauthClient: {},
          submissionToolRegistry: {},
          localAgentEndpoint: {},
          logger: { debug: vi.fn() },
        } as unknown as ChildAgentLauncherDependencies),
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        hostActionAdmission: controllerAuthority.admission,
        controllerRegistry,
      } as unknown as SubagentInteractionRuntimeDependencies;
      runtime = new SubagentInteractionRuntime(deps);
      const work = await pollSubagentDispatchClaims(
        { keyPairStore, apiBaseUrl: 'http://local-test.invalid/api/v1' } as never,
        [],
      );
      expect(requests.map((request) => request.url)).toEqual([
        '/api/v1/subagent-dispatches/scopes',
        '/api/v1/organizations/org/projects/project/subagent-dispatches/claim',
      ]);
      const fake = fakeDispatchSource();
      fake.source.subscribe((delivered) => runtime!.receive(delivered));
      await fake.deliver(work!);
      await vi.waitFor(() =>
        expect(requests.some((request) => request.url.endsWith('/settlement'))).toBe(true),
      );
      expect(child.inputs[0]).toMatchObject({
        handler: researchHandler,
        payload: { userMessage: dispatch.objective },
        config: {
          submissionTools: 'none',
          codexSandboxMode: 'read-only',
        },
      });
      expect(requests.at(-1)).toMatchObject({
        method: 'post',
        body: {
          leaseToken: 'lease',
          generation: 1,
          targetTurnId: 'turn',
          outcome: 'SUCCEEDED',
          outputText: 'Verified child result',
        },
      });
      expect(holdForSubagent).toHaveBeenCalledTimes(mode === 'FOREGROUND' ? 2 : 0);
      expect(deps.logger.error).not.toHaveBeenCalled();
    },
  );
});

describe('subagent controller admission before child launch', () => {
  const scope = { organizationId: 'org', projectId: 'project' };
  const setup = (controllerAuthority = authority()) => {
    const launchRegistered = vi.fn(async () => ({
      assistantCompleted: true,
      outputText: 'Child result',
    }));
    const holdForSubagent = vi.fn();
    const settleSubagentDispatch = vi.fn(async () => ({ data: { data: { accepted: true } } }));
    const api = {
      heartbeatSubagentDispatch: vi.fn(async () => ({ data: { data: { accepted: true } } })),
      settleSubagentDispatch,
    } as unknown as AgentSessionsApi;
    const created = new SubagentInteractionRuntime({
      runStore: { getRun: vi.fn(async () => null) },
      runRegistry: { holdForSubagent, releaseSubagentHold: vi.fn() },
      childAgentLauncher: { launchRegistered },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      hostActionAdmission: controllerAuthority.admission,
      controllerRegistry,
    } as unknown as SubagentInteractionRuntimeDependencies);
    runtime = created;
    const deliver = async (dispatch: SubagentDispatch) => {
      const settled = settleSubagentDispatch.mock.calls.length;
      await created.receive({
        api,
        machineId: 'machine',
        claims: [{ scope, response: { claimed: true, dispatch, foregroundWaits: [] } }],
      });
      await vi.waitFor(() => expect(settleSubagentDispatch.mock.calls.length).toBe(settled + 1));
      return (
        settleSubagentDispatch.mock.calls.at(-1) as unknown as [
          { subagentSettledAttempt: { outcome: string; failureCode?: string } },
        ]
      )[0].subagentSettledAttempt;
    };
    return { controllerAuthority, launchRegistered, holdForSubagent, deliver };
  };

  it('launches once under an active grant with the admitted child Service scope', async () => {
    const { controllerAuthority, launchRegistered, deliver } = setup();
    controllerAuthority.seedGrant('grant-1');

    expect(await deliver(childDispatch())).toMatchObject({ outcome: 'SUCCEEDED' });
    expect(launchRegistered).toHaveBeenCalledTimes(1);
    expect(launchRegistered).toHaveBeenCalledWith(
      'research',
      expect.objectContaining({ serviceIds: ['service-a'], launchServiceId: 'service-a' }),
    );
    expect(controllerAuthority.grantStore.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        grantId: 'grant-1',
        machineId: 'machine',
        userId: 'user',
        organizationId: 'org',
        actionType: 'CONVERSATION_TRIGGER',
      }),
      undefined,
    );
  });

  it('activates a fresh assertion once and verifies it against the source session', async () => {
    const { controllerAuthority, launchRegistered, deliver } = setup();
    const dispatch = childDispatch({}, assertionFor('a'.repeat(64)));

    expect(await deliver(dispatch)).toMatchObject({ outcome: 'SUCCEEDED' });
    expect(launchRegistered).toHaveBeenCalledTimes(1);
    expect(controllerAuthority.verify).toHaveBeenCalledWith(
      dispatch.authorization,
      expect.objectContaining({
        machineId: 'machine',
        userId: 'user',
        controllerInstallationId: 'installation-1',
        target: { kind: 'AGENT_SESSION', id: 'session', revision: null },
      }),
    );
    expect(controllerAuthority.grantStore.create).toHaveBeenCalledTimes(1);
    expect(controllerAuthority.consumed.has('authorization-1')).toBe(true);
  });

  it('does not relaunch a repeated claim of the same attempt generation', async () => {
    const { controllerAuthority, launchRegistered, deliver } = setup();
    controllerAuthority.seedGrant('grant-1');
    await deliver(childDispatch());

    expect(await deliver(childDispatch())).toMatchObject({
      outcome: 'FAILED',
      failureCode: 'AUTHORIZATION_REPLAY_DETECTED',
    });
    expect(launchRegistered).toHaveBeenCalledTimes(1);
  });

  it('reuses an activated grant after restart without consuming new authority', async () => {
    const controllerAuthority = authority();
    const first = setup(controllerAuthority);
    const assertion = assertionFor('a'.repeat(64));
    await first.deliver(childDispatch({}, assertion));
    runtime?.dispose();

    const restarted = setup(controllerAuthority);
    expect(
      await restarted.deliver(childDispatch({ attemptId: 'attempt-2', generation: 2 }, assertion)),
    ).toMatchObject({ outcome: 'SUCCEEDED' });
    expect(controllerAuthority.grantStore.create).toHaveBeenCalledTimes(1);
    expect(restarted.launchRegistered).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'a different objective',
      () => ({ ...childDispatch(), objective: 'Widened work' }),
      'AUTHORIZATION_PAYLOAD_HASH_MISMATCH',
    ],
    [
      'a different child Service scope',
      () => ({ ...childDispatch(), childScope: { serviceIds: ['service-b'] } }),
      'AUTHORIZATION_PAYLOAD_HASH_MISMATCH',
    ],
    [
      'a launch Service outside the admitted scope',
      () => ({
        ...childDispatch(),
        childScope: { serviceIds: ['service-a'], launchServiceId: 'service-b' },
      }),
      'AUTHORIZATION_GRANT_SCOPE_MISMATCH',
    ],
    [
      'an assertion for another source session',
      () => {
        const assertion = assertionFor('a'.repeat(64));
        if (assertion.kind !== 'controller_assertion') throw new Error('fixture');
        return childDispatch(
          {},
          {
            ...assertion,
            intent: {
              ...assertion.intent,
              target: { kind: 'AGENT_SESSION', id: 'other', revision: null },
            },
          },
        );
      },
      'AUTHORIZATION_TARGET_MISMATCH',
    ],
    [
      'a legacy attempt without retained evidence',
      () => childDispatch({}, null),
      'AUTHORIZATION_EVIDENCE_MISSING',
    ],
  ])('refuses %s without launching', async (_label, dispatch, failureCode) => {
    const { controllerAuthority, launchRegistered, holdForSubagent, deliver } = setup();
    controllerAuthority.seedGrant('grant-1');

    expect(await deliver(dispatch())).toMatchObject({ outcome: 'FAILED', failureCode });
    expect(launchRegistered).not.toHaveBeenCalled();
    expect(holdForSubagent).not.toHaveBeenCalled();
  });

  it('refuses an unsupported capability before admission', async () => {
    const { controllerAuthority, launchRegistered, deliver } = setup();
    controllerAuthority.seedGrant('grant-1');

    expect(await deliver({ ...childDispatch(), capability: 'WRITE' as never })).toMatchObject({
      outcome: 'FAILED',
    });
    expect(controllerAuthority.grantStore.admit).not.toHaveBeenCalled();
    expect(launchRegistered).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', { expiresAtMs: Date.now() - 1 }],
    ['revoked', { revoked: true }],
  ])('refuses an %s grant without launching', async (_label, grant) => {
    const { controllerAuthority, launchRegistered, deliver } = setup();
    controllerAuthority.seedGrant('grant-1', grant);

    expect(await deliver(childDispatch())).toMatchObject({
      outcome: 'FAILED',
      failureCode: 'AUTHORIZATION_GRANT_NOT_ACTIVE',
    });
    expect(launchRegistered).not.toHaveBeenCalled();
  });

  it('holds the source Run for an admitted foreground child', async () => {
    const { controllerAuthority, holdForSubagent, deliver } = setup();
    controllerAuthority.seedGrant('grant-1');

    await deliver(childDispatch({ mode: 'FOREGROUND' }));

    expect(holdForSubagent).toHaveBeenCalledWith('run', 'interaction');
  });
});
