import { startFailureOf } from './start-failure';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AxiosError, AxiosHeaders } from 'axios';
import { InputAdmissionOwner } from './input-admission-owner';
import { storedInput, type InputIdentity } from './input-admission-codec';
import { InputAdmissionLifecycle } from './admission-lifecycle';
import { OPEN_SESSION_INDEX_FILE } from './input-admission-store';
import { OperationTimelineRegistry } from './operation-timeline';
import { NOOP_LOGGER } from '../logger';
import { createTestRunRegistry } from '../../run/run.test-support';
import type { SendMessageOptions } from '../../shared/agent-bridge-contract/contract';
import { LocalAgentApiError } from '../../shared/agent-bridge-contract/errors';
import { validateUserMessageTriggerPayload } from '../conversation-dispatch/trigger-payload-schemas';
import { RunAttachmentStore } from '../run-attachment-store';
import { StagedBrowserTabNotFoundError } from '../../browser/run-tabs';
import { PromptTypeRegistry } from '../../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../agents/prompt-type-registry.test-support';

const promptTypeRegistry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

const api = vi.hoisted(() => ({
  project: vi.fn(),
  settle: vi.fn(),
  claim: vi.fn(),
  restore: vi.fn(),
}));
vi.mock('../../shared/api/generated/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ProjectsApi: class {
    projectInputExecution = api.project;
  },
  AgentSessionsApi: class {
    settleAgentInteractionTurn = api.settle;
    claimAgentSessionTurnHead = api.claim;
  },
}));
vi.mock('../restore-persisted-runs', () => ({
  RunReadRestoreCoordinator: class {
    restore = api.restore;
    restoreIdentity = api.restore;
  },
}));

/** A verified conversation trigger in its stored shape. */
const triggerFrame = (event: Record<string, unknown>) =>
  storedInput('trigger_frame', 'operation', {
    conversationId: randomUUID(),
    signedEvent: event,
    event,
  });

/** Setup admissions that should wait, so the lifecycle's own pickup decides. */
const waits = () => false;

const hold = () => {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release?.() };
};

describe('input admission lifecycle delivery', () => {
  let directory: string;
  let lifecycles: InputAdmissionLifecycle[] = [];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'admission-lifecycle-'));
    vi.resetAllMocks();
    api.project.mockResolvedValue({ data: { data: { accepted: true } } });
    api.settle.mockResolvedValue({ data: { data: { accepted: true } } });
  });
  afterEach(async () => {
    for (const lifecycle of lifecycles) lifecycle.dispose();
    lifecycles = [];
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  const paths = () => ({
    directory: join(directory, 'inputs'),
    legacyStoreFile: join(directory, 'inputs.json'),
  });

  async function fixture(
    messageId: string | null = null,
    inputPayload?: (identity: InputIdentity) => Parameters<InputAdmissionOwner['admit']>[1],
    admitOnSetup = true,
  ) {
    const owner = new InputAdmissionOwner(paths(), NOOP_LOGGER);
    const identity = {
      key: randomUUID(),
      fingerprint: 'a'.repeat(64),
      agentSessionId: randomUUID(),
      runId: randomUUID(),
      organizationId: randomUUID(),
      projectId: randomUUID(),
      machineId: randomUUID(),
      userId: randomUUID(),
      messageId,
    };
    const sourceSessionId = randomUUID();
    const attemptId = randomUUID();
    const interactionId = randomUUID();
    const collaboration = {
      kind: 'session_message',
      generation: 1,
      platformAdmissionId: identity.key,
      input: {
        sourceSessionId,
        interactionId,
        attemptId,
        authorKind: 'AGENT',
        objective: 'Research',
        authority: {
          kind: 'MACHINE_SESSION',
          machineId: identity.machineId,
          sourceSessionId,
          targetSessionId: identity.agentSessionId,
          subagentCapability: 'RESEARCH',
        },
      },
    };
    const payload = storedInput('session_message', 'operation', collaboration);
    if (admitOnSetup)
      await owner.admit(identity, inputPayload ? inputPayload(identity) : payload, waits);
    let callbacks: NonNullable<SendMessageOptions['admittedInput']> | undefined;
    const send = vi.fn(async (_runId, _request, options: SendMessageOptions) => {
      callbacks = options.admittedInput;
    });
    let ready = true;
    let runReady = true;
    let platformAvailable = true;
    api.claim.mockImplementation(async ({ turnAdmissionClaimRequest: request }) => ({
      data: { data: { claimed: true, admission: { id: identity.key, turnId: request.turnId } } },
    }));
    const warn = vi.fn();
    const info = vi.fn();
    const attachmentStore = new RunAttachmentStore(directory);
    const materialize = vi.fn().mockResolvedValue({ status: 'started' });
    const adoptStagedBrowserTab = vi.fn().mockResolvedValue(undefined);
    const make = (admissionOwner = owner, operationTimeline?: OperationTimelineRegistry) => {
      const lifecycle = new InputAdmissionLifecycle(
        admissionOwner,
        {
          sendSystemMessage: send,
          materializeAdmittedRun: materialize,
          adoptStagedBrowserTab,
        } as never,
        {
          get: () => ({ canAcceptDurableInput: true }),
          canAcceptDurableInput: () => runReady,
        } as never,
        {
          loadCurrentMachineId: async () => identity.machineId,
          loadMachineCredential: async () => (platformAvailable ? 'credential' : null),
        } as never,
        'http://localhost',
        { ...NOOP_LOGGER, info, warn, debug: vi.fn(), error: vi.fn() },
        () => ready,
        {} as never,
        operationTimeline,
        attachmentStore,
      );
      lifecycles.push(lifecycle);
      return lifecycle;
    };
    const records = () => owner.session(identity.agentSessionId);
    return {
      records,
      owner,
      identity,
      collaboration,
      payload,
      attachmentStore,
      materialize,
      adoptStagedBrowserTab,
      attemptId,
      interactionId,
      send,
      make,
      warn,
      info,
      callbacks: () => callbacks!,
      setPlatformAvailable: (value: boolean) => {
        platformAvailable = value;
      },
      setReady: (value: boolean) => {
        ready = value;
      },
      setRunReady: (value: boolean) => {
        runReady = value;
      },
    };
  }

  it('reports accepted cancellation projection once, while every replay still advances obligations', async () => {
    const f = await fixture(randomUUID(), undefined, false);
    await f.owner.cancel(f.identity);
    const lifecycle = f.make();
    await lifecycle.start();
    expect(f.info).toHaveBeenCalledWith(
      'input_admission.projection_accepted',
      expect.objectContaining({
        operationId: f.identity.key,
        messageId: f.identity.messageId,
        agentSessionId: f.identity.agentSessionId,
        state: 'cancelled',
        revision: 1,
      }),
    );
    for (let n = 0; n < 5; n += 1) {
      await f.owner.cancel(f.identity);
      await lifecycle.advance(f.identity.agentSessionId);
    }
    expect(api.project).toHaveBeenCalledTimes(1);
    expect((await f.records())[0]).toMatchObject({ state: 'cancelled', projectedRevision: 1 });
  });

  it('reports unavailable and exhausted projection truthfully without losing committed cancellation', async () => {
    const f = await fixture(randomUUID(), undefined, false);
    await f.owner.cancel(f.identity);
    f.setPlatformAvailable(false);
    const lifecycle = f.make();
    await lifecycle.start();
    await lifecycle.advance(f.identity.agentSessionId);
    await lifecycle.advance(f.identity.agentSessionId);
    expect(
      f.warn.mock.calls.filter(([event]) => event === 'input_admission.projection_unavailable'),
    ).toHaveLength(1);
    expect(api.project).not.toHaveBeenCalled();
    f.setPlatformAvailable(true);
    api.project.mockResolvedValue({ data: { data: { accepted: false } } });
    await lifecycle.advance(f.identity.agentSessionId);
    for (const elapsed of [10_001, 20_001]) {
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + elapsed);
      await f.owner.cancel(f.identity);
      await lifecycle.advance(f.identity.agentSessionId);
    }
    expect(api.project).toHaveBeenCalledTimes(3);
    expect(f.warn).toHaveBeenCalledWith(
      'input_admission.projection_exhausted',
      expect.objectContaining({
        operationId: f.identity.key,
        messageId: f.identity.messageId,
        state: 'cancelled',
      }),
    );
    expect((await f.records())[0]).toMatchObject({ state: 'cancelled', projectedRevision: 0 });
    expect(
      f.info.mock.calls.some(([event]) => event === 'input_admission.projection_accepted'),
    ).toBe(false);
  });

  it('attributes a slow startup pass to credential retrieval without logging the credential', async () => {
    const f = await fixture();
    f.setReady(false);
    const debug = vi.fn();
    const lifecycle = new InputAdmissionLifecycle(
      f.owner,
      { sendSystemMessage: f.send } as never,
      { get: () => undefined, canAcceptDurableInput: () => true } as never,
      {
        loadCurrentMachineId: async () => f.identity.machineId,
        loadMachineCredential: async () => {
          await new Promise((resolve) => setTimeout(resolve, 120));
          return 'secret-credential';
        },
      } as never,
      'http://localhost',
      { ...NOOP_LOGGER, debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      () => false,
      {} as never,
    );
    lifecycles.push(lifecycle);
    await lifecycle.start();
    const startup = debug.mock.calls.find(([event]) => event === 'input_admission.startup.timing');
    expect(startup?.[1]).toMatchObject({ outcome: 'completed', openSessionCount: 1 });
    expect(startup?.[1].credentialMs).toBeGreaterThanOrEqual(110);
    expect(startup?.[1].advanceMs).toBeGreaterThanOrEqual(110);
    const advance = debug.mock.calls.find(([event]) => event === 'input_admission.advance.timing');
    expect(advance?.[1]).toMatchObject({ agentSessionId: f.identity.agentSessionId });
    expect(advance?.[1].credentialMs).toBeGreaterThanOrEqual(110);
    expect(JSON.stringify(debug.mock.calls)).not.toContain('secret-credential');
  });

  it('logs the failed projection URL and response without Axios secrets or payloads', async () => {
    const f = await fixture(randomUUID());
    f.setReady(false);
    const config = {
      baseURL: 'https://user:secret@staging.heyhey.dev/api/v1',
      url: '/organizations/org/projects/project/agent-sessions/session/input-execution?token=secret',
      method: 'post',
      headers: new AxiosHeaders({ Authorization: 'Bearer secret' }),
      data: 'private request payload',
    };
    api.project.mockRejectedValue(
      new AxiosError('Request failed with status code 404', 'ERR_BAD_REQUEST', config, undefined, {
        config,
        headers: new AxiosHeaders({ 'set-cookie': 'secret' }),
        status: 404,
        statusText: 'Not Found',
        data: {
          message: 'The machine does not own this admitted input.',
          data: 'private response payload',
        },
      }),
    );
    await f.make().start();
    expect(f.warn).toHaveBeenCalledWith(
      'input_admission.projection_deferred',
      expect.objectContaining({
        operationId: f.identity.key,
        agentSessionId: f.identity.agentSessionId,
        messageId: f.identity.messageId,
        state: 'queued',
        method: 'POST',
        requestUrl:
          'https://staging.heyhey.dev/api/v1/organizations/org/projects/project/agent-sessions/session/input-execution',
        statusCode: 404,
        responseMessage: 'The machine does not own this admitted input.',
      }),
    );
    expect(JSON.stringify(f.warn.mock.calls)).not.toMatch(/secret|private .* payload/);
  });

  it('backs off even when the HTTP error body is not JSON', async () => {
    const f = await fixture(randomUUID());
    f.setReady(false);
    api.project.mockRejectedValue(
      new AxiosError('Request failed', undefined, undefined, undefined, {
        config: { headers: new AxiosHeaders() },
        headers: {},
        status: 404,
        statusText: 'Not Found',
        data: '<html>not found</html>',
      }),
    );
    const lifecycle = f.make();
    await lifecycle.start();
    await lifecycle.advance(f.identity.agentSessionId);
    expect(api.project).toHaveBeenCalledTimes(1);
    expect(f.warn).toHaveBeenCalledWith(
      'input_admission.projection_deferred',
      expect.objectContaining({ statusCode: 404, responseMessage: undefined }),
    );
  });

  it('durably rejects contract-invalid feature-sync follow-ups and does not pick them up again', async () => {
    const f = await fixture(randomUUID(), (identity: InputIdentity) =>
      triggerFrame({
        promptType: 'user_message',
        operationId: identity.key,
        operationFingerprint: identity.fingerprint,
        triggerMessageId: randomUUID(),
        sourceUserMessageId: identity.messageId!,
        payload: {
          handlerPromptType: 'plan_shaping_feature_sync_iterate',
          userMessage: 'Keep refining.',
          attachments: [],
          featureSyncContext: {
            planId: randomUUID(),
            designDocId: randomUUID(),
            discrepancies: [],
            decisions: [],
          },
        },
      }),
    );
    // The message service reports a payload its handler rejects as a 400.
    f.send.mockRejectedValueOnce(new LocalAgentApiError('INVALID_REQUEST', 'invalid payload', 400));
    const lifecycle = f.make();

    await lifecycle.start();

    expect(f.send).toHaveBeenCalledOnce();
    expect((await f.records())[0]?.state).toBe('failed');
    expect(f.warn).toHaveBeenCalledWith(
      'input_admission.delivery_rejected',
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );

    await lifecycle.advance(f.identity.agentSessionId);

    expect(f.send).toHaveBeenCalledOnce();
    expect((await f.records())[0]?.state).toBe('failed');
    expect(
      f.warn.mock.calls.filter(([event]) => event === 'input_admission.delivery_rejected'),
    ).toHaveLength(1);
  });

  it.each([true, false])(
    'retains user-message scope through durable delivery (scope present: %s)',
    async (withScope) => {
      const serviceId = randomUUID();
      const scope = { serviceIds: [serviceId], launchServiceId: serviceId };
      const f = await fixture(randomUUID(), (identity: InputIdentity) =>
        triggerFrame({
          promptType: 'user_message',
          operationId: identity.key,
          operationFingerprint: identity.fingerprint,
          triggerMessageId: randomUUID(),
          sourceUserMessageId: identity.messageId!,
          ...(withScope ? { admittedServiceScope: scope } : {}),
          payload: {
            handlerPromptType: 'coding_freeform',
            userMessage: 'Inspect the service.',
            attachments: [],
          },
        }),
      );
      // Reopen persisted inputs so this also covers the payload codec during restart.
      const restored = new InputAdmissionOwner(paths(), NOOP_LOGGER);
      await f.make(restored).start();
      expect(f.send).toHaveBeenCalledOnce();
      const options = f.send.mock.calls[0]![2];
      expect(options.sourceUserMessageId).toBe(f.identity.messageId);
      if (withScope) expect(options.admittedServiceScope).toEqual(scope);
      else expect(options).not.toHaveProperty('admittedServiceScope');
      expect(options.admittedInput?.turnId).toBe(
        (await restored.session(f.identity.agentSessionId))[0]?.turnId,
      );
    },
  );

  const userMessageFrame =
    (handlerPromptType: string, attachments: { attachmentId: string; fileName: string }[]) =>
    (identity: InputIdentity) =>
      triggerFrame({
        promptType: 'user_message',
        operationId: identity.key,
        operationFingerprint: identity.fingerprint,
        triggerMessageId: randomUUID(),
        sourceUserMessageId: identity.messageId!,
        payload: { handlerPromptType, userMessage: 'Read the attached notes.', attachments },
      });

  it.each(['coding_freeform', 'quick'])(
    'preserves text and carries stored references in the %s Turn input',
    async (handlerPromptType) => {
      const f = await fixture(randomUUID(), undefined, false);
      const stored = await f.attachmentStore.save(
        f.identity.runId,
        'notes.md',
        Buffer.from('notes'),
        new AbortController().signal,
      );
      await f.owner.admit(
        f.identity,
        userMessageFrame(handlerPromptType, [
          { attachmentId: stored.attachmentId, fileName: stored.fileName },
        ])(f.identity),
        waits,
      );

      await f.make(new InputAdmissionOwner(paths(), NOOP_LOGGER)).start();

      expect(f.send).toHaveBeenCalledOnce();
      const request = f.send.mock.calls[0]![1];
      expect(request.payload.userMessage).toBe('Read the attached notes.');
      expect(request.attachments).toEqual([
        { attachmentId: stored.attachmentId, fileName: stored.fileName },
      ]);
      expect(JSON.stringify(await f.records())).not.toContain('Attached files:');
    },
  );

  const startRunFrame =
    (
      attachments: { attachmentId: string; fileName: string }[],
      stagedBrowserTab: { stagedTabId: string } | null = null,
    ) =>
    (identity: InputIdentity) =>
      triggerFrame({
        promptType: 'start_run',
        operationId: identity.key,
        operationFingerprint: identity.fingerprint,
        triggerMessageId: randomUUID(),
        payload: {
          handlerPromptType: 'coding_freeform',
          payload: { promptType: 'coding_freeform', userMessage: '  exact launch text\n' },
          attachments,
          stagedBrowserTab,
          agentSessionId: identity.agentSessionId,
          model: 'test-model',
          provider: 'claude',
          contextMetadata: {
            organizationId: identity.organizationId,
            projectId: identity.projectId,
            agentSessionId: identity.agentSessionId,
            capturedAt: new Date().toISOString(),
            userComments: [],
            fileReferences: { resolved: [], unresolved: [] },
          },
        },
      });

  it('ends a queued start as failed, without retrying, when a Service has no folder', async () => {
    const serviceId = randomUUID();
    const f = await fixture(randomUUID(), startRunFrame([]));
    f.materialize.mockResolvedValue({
      status: 'repo-required',
      serviceIds: [serviceId],
      launchServiceId: serviceId,
    });
    const lifecycle = f.make();

    await lifecycle.start();
    await lifecycle.advance(f.identity.agentSessionId);

    const [record] = await f.records();
    expect(record?.state).toBe('failed');
    expect(startFailureOf(record?.settlement)).toEqual({
      reason: 'service_folder_not_bound',
      serviceIds: [serviceId],
    });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.materialize).toHaveBeenCalledOnce();
    expect(
      f.warn.mock.calls.filter(([event]) => event === 'input_admission.delivery_deferred'),
    ).toHaveLength(0);
  });

  it('binds staged launch files before delivery and preserves references, text and duplicate identity', async () => {
    const reference = { attachmentId: randomUUID(), fileName: 'notes.md' };
    const f = await fixture(randomUUID(), startRunFrame([reference]));
    const staged = join(directory, 'run-attachments-staging', reference.attachmentId);
    await mkdir(staged, { recursive: true });
    await writeFile(join(staged, reference.fileName), 'private staged text');
    const lifecycle = f.make();
    await lifecycle.start();
    expect(f.materialize).toHaveBeenCalledOnce();
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]![1]).toMatchObject({
      payload: { userMessage: '  exact launch text\n' },
      attachments: [reference],
    });
    expect(await f.attachmentStore.resolvePaths(f.identity.runId, [reference])).toHaveLength(1);
    expect(JSON.stringify(await f.records())).not.toContain('private staged text');
    expect(JSON.stringify(await f.records())).not.toContain(directory);
    const replay = await f.owner.admit(
      f.identity,
      (await f.records())[0]!.kind === 'trigger_frame'
        ? storedInput('trigger_frame', 'operation', (await f.records())[0]!.payload)
        : f.payload,
      waits,
    );
    expect(replay.replayed).toBe(true);
    await lifecycle.advance(f.identity.agentSessionId);
    expect(f.send).toHaveBeenCalledOnce();
  });

  it('rejects a missing launch file before delivery and allows an independent healthy launch', async () => {
    const valid = { attachmentId: randomUUID(), fileName: 'valid.md' };
    const missing = { attachmentId: randomUUID(), fileName: 'missing.md' };
    const f = await fixture(randomUUID(), startRunFrame([valid, missing]));
    const staged = join(directory, 'run-attachments-staging', valid.attachmentId);
    await mkdir(staged, { recursive: true });
    await writeFile(join(staged, valid.fileName), 'valid');
    await f.make().start();
    expect(f.send).not.toHaveBeenCalled();
    expect((await f.records())[0]?.state).toBe('failed');
    expect(f.warn).toHaveBeenCalledWith(
      'input_admission.delivery_rejected',
      expect.objectContaining({ code: 'ATTACHMENT_NOT_FOUND' }),
    );
    const healthy = await fixture(randomUUID(), startRunFrame([valid]));
    await healthy.make().start();
    expect(healthy.send).toHaveBeenCalledOnce();
  });

  it('delivers a no-file launch with an explicit empty list', async () => {
    const f = await fixture(randomUUID(), startRunFrame([]));
    await f.make().start();
    expect(f.send.mock.calls[0]![1].attachments).toEqual([]);
    expect(f.adoptStagedBrowserTab).toHaveBeenCalledWith(
      f.identity.runId,
      f.identity.projectId,
      null,
    );
  });

  it('adopts the tab the user opened before the session started, before its first Turn', async () => {
    const stagedBrowserTab = { stagedTabId: randomUUID() };
    const f = await fixture(randomUUID(), startRunFrame([], stagedBrowserTab));
    f.adoptStagedBrowserTab.mockImplementation(async () => {
      expect(f.send).not.toHaveBeenCalled();
    });
    await f.make().start();
    expect(f.adoptStagedBrowserTab).toHaveBeenCalledWith(
      f.identity.runId,
      f.identity.projectId,
      stagedBrowserTab,
    );
    expect(f.send).toHaveBeenCalledOnce();
  });

  it('rejects a start whose opened tab is gone and starts no Turn', async () => {
    const stagedBrowserTab = { stagedTabId: randomUUID() };
    const f = await fixture(randomUUID(), startRunFrame([], stagedBrowserTab));
    f.adoptStagedBrowserTab.mockRejectedValue(
      new StagedBrowserTabNotFoundError(stagedBrowserTab.stagedTabId),
    );
    const lifecycle = f.make();
    await lifecycle.start();
    expect(f.send).not.toHaveBeenCalled();
    expect((await f.records())[0]?.state).toBe('failed');
    expect(f.warn).toHaveBeenCalledWith(
      'input_admission.delivery_rejected',
      expect.objectContaining({ code: 'STAGED_BROWSER_TAB_NOT_FOUND' }),
    );
    await lifecycle.advance(f.identity.agentSessionId);
    expect(f.send).not.toHaveBeenCalled();
  });

  it('rejects a message whose attachment is not stored for the Run and starts no Turn', async () => {
    const missing = { attachmentId: randomUUID(), fileName: 'gone.md' };
    const f = await fixture(randomUUID(), userMessageFrame('coding_freeform', [missing]));
    const lifecycle = f.make();

    await lifecycle.start();

    expect(f.send).not.toHaveBeenCalled();
    expect((await f.records())[0]?.state).toBe('failed');
    expect(f.warn).toHaveBeenCalledWith(
      'input_admission.delivery_rejected',
      expect.objectContaining({ code: 'ATTACHMENT_NOT_FOUND' }),
    );

    await lifecycle.advance(f.identity.agentSessionId);
    expect(f.send).not.toHaveBeenCalled();
  });

  it('retries transient preparation across restart with the same input and Turn without failing projection', async () => {
    const f = await fixture(randomUUID());
    f.send.mockRejectedValueOnce(new Error('temporary preparation failure'));
    const lifecycle = f.make();
    await lifecycle.start();
    const picked = (await f.records())[0]!;
    expect(picked.state).toBe('picked');
    expect(picked.turnId).not.toBeNull();
    f.send.mockRejectedValueOnce(new Error('still unavailable'));
    await lifecycle.advance(f.identity.agentSessionId);
    expect(f.send).toHaveBeenCalledTimes(2);
    lifecycle.dispose();

    const restored = new InputAdmissionOwner(paths(), NOOP_LOGGER);
    const replay = await restored.admit(f.identity, f.payload, waits);
    expect(replay.replayed).toBe(true);
    expect(replay.record).toMatchObject({
      ...f.identity,
      admissionId: picked.admissionId,
      turnId: picked.turnId,
      state: 'picked',
    });
    const restarted = f.make(restored);
    await restarted.start();
    expect(f.send).toHaveBeenCalledTimes(3);
    for (const call of f.send.mock.calls) {
      expect(call[0]).toBe(f.identity.runId);
      expect(call[1].payload).toEqual(f.collaboration.input);
      expect(call[2].sourceUserMessageId).toBe(f.identity.messageId);
      expect(call[2].admittedInput?.turnId).toBe(picked.turnId);
    }
    await f.callbacks().onStarted();
    await vi.waitFor(async () =>
      expect((await restored.session(f.identity.agentSessionId))[0]?.projectedRevision).toBe(3),
    );
    api.restore.mockRejectedValue(new Error('execution remains active'));
    const again = new InputAdmissionOwner(paths(), NOOP_LOGGER);
    await f.make(again).start();
    expect((await again.session(f.identity.agentSessionId))[0]?.state).toBe('started');
    expect(
      api.project.mock.calls.map(([request]) => request.inputExecutionProjection.executionStatus),
    ).toEqual(['started']);
    expect(f.send).toHaveBeenCalledTimes(3);
  });

  it('reserves an input admitted to an idle Run, delivers it, and first projects started', async () => {
    const f = await fixture(randomUUID(), undefined, false);
    const lifecycle = f.make();
    await lifecycle.start();
    const admitted = await lifecycle.admitInput(f.identity, f.payload);
    expect(admitted.record).toMatchObject({ state: 'picked', admissionDisposition: 'immediate' });
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    expect(f.callbacks().turnId).toBe(admitted.record.turnId);
    // Reservation is not execution: nothing is reported until the Turn actually starts.
    expect(api.project).not.toHaveBeenCalled();
    await f.callbacks().onStarted();
    expect(api.project).toHaveBeenCalledOnce();
    const projection = api.project.mock.calls[0]?.[0].inputExecutionProjection;
    expect(projection).toEqual({
      operationId: f.identity.key,
      operationFingerprint: f.identity.fingerprint,
      messageId: f.identity.messageId,
      admissionId: admitted.record.admissionId,
      revision: 3,
      executionStatus: 'started',
      turnId: admitted.record.turnId,
    });
  });

  it('queues an input admitted while the Run is held, and reports it as queued', async () => {
    const f = await fixture(randomUUID(), undefined, false);
    f.setRunReady(false);
    const lifecycle = f.make();
    await lifecycle.start();
    const admitted = await lifecycle.admitInput(f.identity, f.payload);
    expect(admitted.record).toMatchObject({ state: 'queued', admissionDisposition: 'queued' });
    await lifecycle.advance(f.identity.agentSessionId);
    expect(f.send).not.toHaveBeenCalled();
    expect(api.project.mock.calls[0]?.[0].inputExecutionProjection).toMatchObject({
      executionStatus: 'queued',
      revision: 1,
    });
  });

  it('never reserves before the lifecycle has started', async () => {
    const f = await fixture(randomUUID(), undefined, false);
    const admitted = await f.make().admitInput(f.identity, f.payload);
    expect(admitted.record.admissionDisposition).toBe('queued');
  });

  it('publishes immediate start from the callback without first projecting queued or waiting for a timer', async () => {
    const f = await fixture(randomUUID());
    await f.make().start();
    expect(f.send).toHaveBeenCalledOnce();
    expect(api.project).not.toHaveBeenCalled();
    await f.callbacks().onStarted();
    await vi.waitFor(async () => expect((await f.records())[0]?.projectedRevision).toBe(3));
    expect(api.project).toHaveBeenCalledOnce();
    expect(api.project.mock.calls[0]?.[0].inputExecutionProjection).toMatchObject({
      messageId: f.identity.messageId,
      executionStatus: 'started',
      turnId: f.callbacks().turnId,
    });
  });

  it('logs the operation, admission, and assigned turn together at pickup', async () => {
    const f = await fixture();
    const timeline = new OperationTimelineRegistry({ ...NOOP_LOGGER, info: f.info });

    await f.make(f.owner, timeline).start();

    const picked = (await f.records())[0]!;
    expect(f.info).toHaveBeenCalledWith(
      'input_admission.picked',
      expect.objectContaining({
        operationId: f.identity.key,
        admissionId: picked.admissionId,
        turnId: picked.turnId,
        agentSessionId: f.identity.agentSessionId,
        runId: f.identity.runId,
      }),
    );
    expect(timeline.has(picked.turnId!)).toBe(true);
  });

  it('confirms waiting while pickup is held and retains that confirmation until actual start', async () => {
    const f = await fixture(randomUUID());
    const lifecycle = f.make();
    f.setReady(false);
    await lifecycle.start();
    expect(api.project.mock.calls[0]?.[0].inputExecutionProjection.executionStatus).toBe('queued');
    f.setReady(true);
    await lifecycle.advanceOpenSessions();
    expect(api.project).toHaveBeenCalledOnce();
    await f.callbacks().onStarted();
    await vi.waitFor(async () => expect((await f.records())[0]?.projectedRevision).toBe(3));
    expect(api.project.mock.calls[1]?.[0].inputExecutionProjection.executionStatus).toBe('started');
  });

  it('confirms queue membership when the Run is busy', async () => {
    const f = await fixture(randomUUID());
    f.setRunReady(false);
    await f.make().start();
    expect(f.send).not.toHaveBeenCalled();
    expect(api.project.mock.calls[0]?.[0].inputExecutionProjection.executionStatus).toBe('queued');
  });

  it('does not resolve start until the platform accepts the started projection', async () => {
    const f = await fixture(randomUUID());
    await f.make().start();
    let release: () => void = () => {};
    api.project.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ data: { data: { accepted: true } } });
        }),
    );
    let resolved = false;
    const started = f
      .callbacks()
      .onStarted()
      .then(() => {
        resolved = true;
      });
    await vi.waitFor(() => expect(api.project).toHaveBeenCalledOnce());
    expect((await f.records())[0]?.state).toBe('started');
    expect(resolved).toBe(false);
    release();
    await started;
    expect((await f.records())[0]?.projectedRevision).toBe(3);
  });

  it('picks up another session while an earlier session is still starting', async () => {
    const f = await fixture(randomUUID());
    const lifecycle = f.make();
    const held = hold();
    f.send.mockImplementationOnce(() => held.promise);
    const first = lifecycle.advance(f.identity.agentSessionId);
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    const second = {
      ...f.identity,
      key: randomUUID(),
      agentSessionId: randomUUID(),
      runId: randomUUID(),
      messageId: randomUUID(),
    };
    await f.owner.admit(
      second,
      storedInput('session_message', 'operation', {
        ...f.collaboration,
        input: {
          ...f.collaboration.input,
          authority: { ...f.collaboration.input.authority, targetSessionId: second.agentSessionId },
        },
      }),
      waits,
    );
    await lifecycle.advance(second.agentSessionId);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls[1]?.[0]).toBe(second.runId);
    held.release();
    await first;
    expect(api.project).not.toHaveBeenCalled();
  });

  it('does not project a same-session admission as queued before its pickup decision', async () => {
    const f = await fixture(randomUUID());
    const lifecycle = f.make();
    const held = hold();
    f.send.mockImplementationOnce(() => held.promise);
    const first = lifecycle.advance(f.identity.agentSessionId);
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    const later = { ...f.identity, key: randomUUID(), messageId: randomUUID() };
    await f.owner.admit(later, f.payload, waits);
    const rerun = lifecycle.advance(f.identity.agentSessionId);
    expect(api.project).not.toHaveBeenCalled();
    held.release();
    await first;
    await rerun;
    expect(f.send).toHaveBeenCalledOnce();
    expect(api.project).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        inputExecutionProjection: expect.objectContaining({
          messageId: later.messageId,
          executionStatus: 'queued',
        }),
      }),
    );
  });

  it('picks up the next input as soon as the previous turn settles, without a sweep', async () => {
    const f = await fixture();
    const later = { ...f.identity, key: randomUUID() };
    await f.owner.admit(later, f.payload, waits);
    const lifecycle = f.make();
    await lifecycle.advance(f.identity.agentSessionId);
    const callbacks = f.callbacks();
    await callbacks.onStarted();
    await callbacks.onSettled({
      turnId: callbacks.turnId,
      terminalOutcome: 'COMPLETED',
      completedAssistantMessageId: null,
      reports: [],
    });
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    expect(f.callbacks().turnId).not.toBe(callbacks.turnId);
    expect((await f.records()).map((record) => record.state)).toEqual(['settled', 'picked']);
  });

  it('keeps retrying a transiently failing start projection beyond the projection budget', async () => {
    const f = await fixture(randomUUID());
    await f.make().start();
    const realSetTimeout = globalThis.setTimeout;
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      api.project
        .mockRejectedValueOnce(new Error('offline'))
        .mockRejectedValueOnce(new Error('offline'))
        .mockRejectedValueOnce(new Error('offline'))
        .mockRejectedValueOnce(new Error('offline'))
        .mockRejectedValueOnce(new Error('offline'));
      let resolved = false;
      const started = f
        .callbacks()
        .onStarted()
        .then(() => {
          resolved = true;
        });
      // Store writes are real I/O, so let them finish before advancing the backoff clock.
      for (let step = 0; step < 1000 && !resolved; step++) {
        await new Promise((resolve) => realSetTimeout(resolve, 2));
        clock += 250;
        await vi.advanceTimersByTimeAsync(250);
      }
      await started;
      expect(api.project).toHaveBeenCalledTimes(6);
      expect(
        api.project.mock.calls.every(
          ([request]) => request.inputExecutionProjection.executionStatus === 'started',
        ),
      ).toBe(true);
      expect(f.send).toHaveBeenCalledOnce();
      expect((await f.records())[0]?.projectedRevision).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails start when the platform definitively rejects the started projection', async () => {
    const f = await fixture(randomUUID());
    await f.make().start();
    api.project.mockResolvedValueOnce({ data: { data: { accepted: false } } });
    await expect(f.callbacks().onStarted()).rejects.toThrow('not accepted');
    expect(api.project).toHaveBeenCalledOnce();
    expect((await f.records())[0]?.projectedRevision).toBe(0);
  });

  it('holds ordered pickup until foreground restoration succeeds', async () => {
    const f = await fixture();
    const lifecycle = f.make();
    f.setReady(false);
    await lifecycle.start();
    expect(f.send).not.toHaveBeenCalled();
    expect((await f.records())[0]?.state).toBe('queued');
    f.setReady(true);
    await lifecycle.advanceOpenSessions();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect((await f.records())[0]?.state).toBe('picked');
  });

  it('retries report-only settlement after restart without another execution or source callback', async () => {
    const f = await fixture();
    const lifecycle = f.make();
    await lifecycle.start();
    const callbacks = f.callbacks();
    await callbacks.onStarted();
    const reportId = randomUUID();
    api.settle.mockRejectedValueOnce(new Error('temporary disconnect'));
    await callbacks.onSettled({
      turnId: callbacks.turnId,
      terminalOutcome: 'COMPLETED',
      completedAssistantMessageId: null,
      reports: [reportId],
    });
    await vi.waitFor(() =>
      expect(f.warn).toHaveBeenCalledWith('input_admission.settlement_deferred', expect.anything()),
    );
    expect((await f.records())[0]?.settlementDelivered).toBe(false);
    lifecycle.dispose();
    // The failed delivery is retried at its persisted due time, including after a restart.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_001);
    const restored = new InputAdmissionOwner(paths(), NOOP_LOGGER);
    await f.make(restored).start();
    expect((await restored.session(f.identity.agentSessionId))[0]?.settlementDelivered).toBe(true);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(api.settle.mock.calls[1]?.[0].agentInteractionSettledTurn).toMatchObject({
      attemptId: f.attemptId,
      interactionId: f.interactionId,
      reports: [reportId],
      completedAssistantMessageId: null,
    });
  });

  it('reconciles a started execution with Run-owned recovery evidence instead of executing it again', async () => {
    const f = await fixture();
    await f.make().start();
    await f.callbacks().onStarted();
    api.restore.mockResolvedValue({
      recoverInterruptedInput: async (turnId: string) => ({
        turnId,
        terminalOutcome: 'ABORTED',
        completedAssistantMessageId: null,
        reports: [],
        settledAt: new Date().toISOString(),
      }),
    });
    await f.make().start();
    expect((await f.records())[0]?.state).toBe('settled');
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('increases failed recovery backoff across timer firings', async () => {
    const f = await fixture();
    const admissionLifecycle = f.make();
    await admissionLifecycle.start();
    await f.callbacks().onStarted();
    admissionLifecycle.dispose();

    const realSetTimeout = globalThis.setTimeout;
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      api.restore.mockRejectedValue(new Error('Run restore temporarily unavailable'));
      const recoveryLifecycle = f.make();
      await recoveryLifecycle.start();
      expect(api.restore).toHaveBeenCalledOnce();

      const waitForRestoreCalls = async (count: number): Promise<void> => {
        for (let step = 0; step < 100; step++) {
          if (api.restore.mock.calls.length >= count) return;
          await new Promise((resolve) => realSetTimeout(resolve, 2));
        }
        expect(api.restore).toHaveBeenCalledTimes(count);
      };

      clock += 999;
      await vi.advanceTimersByTimeAsync(999);
      expect(api.restore).toHaveBeenCalledOnce();
      clock += 1;
      await vi.advanceTimersByTimeAsync(1);
      await waitForRestoreCalls(2);

      clock += 1_999;
      await vi.advanceTimersByTimeAsync(1_999);
      expect(api.restore).toHaveBeenCalledTimes(2);
      clock += 1;
      await vi.advanceTimersByTimeAsync(1);
      await waitForRestoreCalls(3);
      recoveryLifecycle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains a rejected projection for retry and never treats acknowledgement as started', async () => {
    const f = await fixture();
    const ordinary = {
      ...f.identity,
      key: randomUUID(),
      messageId: randomUUID(),
      agentSessionId: randomUUID(),
    };
    await f.owner.admit(
      ordinary,
      storedInput('session_message', 'operation', {
        ...f.collaboration,
        input: {
          ...f.collaboration.input,
          authority: {
            ...f.collaboration.input.authority,
            targetSessionId: ordinary.agentSessionId,
          },
        },
      }),
      waits,
    );
    f.setReady(false);
    api.project.mockResolvedValueOnce({ data: { data: { accepted: false } } });
    const lifecycle = f.make();
    await lifecycle.start();
    const ordinaryRecord = async () =>
      (await f.owner.session(ordinary.agentSessionId)).find(
        (record) => record.key === ordinary.key,
      );
    expect((await ordinaryRecord())?.projectedRevision).toBe(0);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5001);
    await lifecycle.advance(ordinary.agentSessionId);
    expect((await ordinaryRecord())?.state).toBe('queued');
    expect(api.project.mock.calls[1]?.[0].inputExecutionProjection.executionStatus).toBe('queued');
  });
  const spyLogger = () => ({
    ...NOOP_LOGGER,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
  const idleLifecycle = (owner: InputAdmissionOwner, logger: ReturnType<typeof spyLogger>) => {
    const lifecycle = new InputAdmissionLifecycle(
      owner,
      { sendSystemMessage: vi.fn() } as never,
      { get: () => null, canAcceptDurableInput: () => true } as never,
      {
        loadCurrentMachineId: async () => randomUUID(),
        loadMachineCredential: async () => 'credential',
      } as never,
      'http://localhost',
      logger,
      () => true,
      {} as never,
    );
    lifecycles.push(lifecycle);
    return lifecycle;
  };
  const writeFinishedSessions = async (count: number): Promise<void> => {
    await mkdir(paths().directory, { recursive: true });
    await Promise.all(
      Array.from({ length: count }, () => {
        const agentSessionId = randomUUID();
        const record = {
          key: randomUUID(),
          fingerprint: 'a'.repeat(64),
          agentSessionId,
          runId: randomUUID(),
          organizationId: randomUUID(),
          projectId: randomUUID(),
          machineId: randomUUID(),
          userId: randomUUID(),
          messageId: null,
          admissionId: randomUUID(),
          sequence: 0,
          payload: null,
          state: 'cancelled',
          turnId: null,
          revision: 1,
          projectedRevision: 0,
          settlement: null,
          settlementDelivered: false,
        };
        return writeFile(
          join(paths().directory, `${agentSessionId}.json`),
          JSON.stringify({ schemaVersion: 1, records: [record] }),
        );
      }),
    );
  };

  it('starts idle over 1,000 finished sessions without reading them, doing work, or logging', async () => {
    await writeFinishedSessions(1000);
    await writeFile(
      join(paths().directory, OPEN_SESSION_INDEX_FILE),
      JSON.stringify({ schemaVersion: 1, sessionIds: [] }),
    );
    const readFile = vi.spyOn(fsPromises, 'readFile');
    const readdir = vi.spyOn(fsPromises, 'readdir');
    const logger = spyLogger();
    const lifecycle = idleLifecycle(new InputAdmissionOwner(paths(), logger), logger);
    const advance = vi.spyOn(lifecycle, 'advance');
    await lifecycle.start();
    expect(readFile.mock.calls.map(([file]) => String(file))).toEqual([
      join(paths().directory, OPEN_SESSION_INDEX_FILE),
    ]);
    expect(readdir).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
    for (const method of [logger.debug, logger.info, logger.warn, logger.error])
      expect(method).not.toHaveBeenCalled();
  });

  it('rebuilds a missing or corrupt open index once, then starts from it', async () => {
    await writeFinishedSessions(20);
    for (const corrupt of [false, true]) {
      if (corrupt) await writeFile(join(paths().directory, OPEN_SESSION_INDEX_FILE), '{');
      const read = vi.spyOn(fsPromises, 'readFile');
      const logger = spyLogger();
      await idleLifecycle(new InputAdmissionOwner(paths(), logger), logger).start();
      expect(read).toHaveBeenCalledTimes(21);
      expect(logger.info).toHaveBeenCalledWith(
        'input_admission.open_index_rebuilt',
        expect.objectContaining({ scannedSessions: 20, openSessions: 0 }),
      );
      read.mockClear();
      await idleLifecycle(new InputAdmissionOwner(paths(), logger), logger).start();
      expect(read).toHaveBeenCalledOnce();
      read.mockRestore();
    }
  });

  it('picks up queued input when its Run reports it can take input, without a timer', async () => {
    const f = await fixture();
    f.setRunReady(false);
    const lifecycle = f.make();
    await lifecycle.start();
    expect(f.send).not.toHaveBeenCalled();
    const advance = vi.spyOn(lifecycle, 'advance');
    f.setRunReady(true);
    // Readiness of an unrelated Run does not touch this session.
    lifecycle.durableInputReady(randomUUID());
    expect(advance).not.toHaveBeenCalled();
    lifecycle.durableInputReady(f.identity.runId);
    expect(advance).toHaveBeenCalledExactlyOnceWith(f.identity.agentSessionId);
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    expect((await f.records())[0]?.state).toBe('picked');
  });

  it('retries failed status reports and settlements at their due time, touching only due sessions', async () => {
    const f = await fixture();
    f.setReady(false);
    const sibling = (messageId: string | null) => {
      const identity = {
        ...f.identity,
        key: randomUUID(),
        agentSessionId: randomUUID(),
        messageId,
      };
      return {
        identity,
        payload: storedInput('session_message', 'operation', {
          ...f.collaboration,
          platformAdmissionId: identity.key,
          input: {
            ...f.collaboration.input,
            authority: {
              ...f.collaboration.input.authority,
              targetSessionId: identity.agentSessionId,
            },
          },
        }),
      };
    };
    const reported = sibling(randomUUID());
    const idle = sibling(randomUUID());
    await f.owner.admit(reported.identity, reported.payload, waits);
    await f.owner.admit(idle.identity, idle.payload, waits);
    // Settle the first session's input directly, as a Turn would have.
    const picked = await f.owner.pickup(f.identity.agentSessionId);
    await f.owner.transition(f.identity.agentSessionId, f.identity.key, 'started');
    await f.owner.transition(f.identity.agentSessionId, f.identity.key, 'settled', {
      turnId: picked!.turnId!,
      terminalOutcome: 'COMPLETED',
      completedAssistantMessageId: null,
      reports: [],
      settledAt: new Date().toISOString(),
    });
    let reportFailed = false;
    api.project.mockImplementation(async (request: { agentSessionId: string }) => {
      if (request.agentSessionId === reported.identity.agentSessionId && !reportFailed) {
        reportFailed = true;
        throw new Error('offline');
      }
      return { data: { data: { accepted: true } } };
    });
    api.settle.mockRejectedValueOnce(new Error('offline'));
    const realSetTimeout = globalThis.setTimeout;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const lifecycle = f.make();
      await lifecycle.start();
      expect(api.settle).toHaveBeenCalledOnce();
      expect(api.project).toHaveBeenCalledTimes(2);
      expect(f.owner.earliestDueAt()).toBe(clock + 5_000);
      const advance = vi.spyOn(lifecycle, 'advance');
      clock += 4_999;
      await vi.advanceTimersByTimeAsync(4_999);
      expect(advance).not.toHaveBeenCalled();
      clock += 1;
      await vi.advanceTimersByTimeAsync(1);
      for (let step = 0; step < 500 && f.owner.earliestDueAt() !== null; step++)
        await new Promise((resolve) => realSetTimeout(resolve, 2));
      await Promise.all(advance.mock.results.map((result) => result.value));
      expect(advance.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual(
        [f.identity.agentSessionId, reported.identity.agentSessionId].sort(),
      );
      expect(api.settle).toHaveBeenCalledTimes(2);
      expect((await f.records())[0]?.settlementDelivered).toBe(true);
      expect((await f.owner.session(reported.identity.agentSessionId))[0]?.projectedRevision).toBe(
        1,
      );
      // The idle session stays open (its input is still queued) but was never due.
      expect(f.owner.openSessionIds().sort()).toEqual(
        [reported.identity.agentSessionId, idle.identity.agentSessionId].sort(),
      );
      expect(f.owner.earliestDueAt()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('saved inputs from the previous storage version', () => {
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    /** A record exactly as schemaVersion 1 wrote it, owned by the fixture's identity. */
    const v1Record = (f: Fixture, payload: unknown, overrides: Record<string, unknown> = {}) => ({
      ...f.identity,
      payload,
      admissionId: randomUUID(),
      sequence: 0,
      state: 'queued',
      turnId: null,
      revision: 1,
      projectedRevision: 0,
      settlement: null,
      settlementDelivered: false,
      ...overrides,
    });
    const v1Frame = (f: Fixture, event: Record<string, unknown>) => ({
      organizationId: f.identity.organizationId,
      projectId: f.identity.projectId,
      conversationId: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'trigger.conversation',
      envelope: {
        machineId: f.identity.machineId,
        userId: f.identity.userId,
        nonce: randomUUID(),
        timestampMs: Date.now(),
        signature: 'signature',
        protocolVersion: 2,
        authorization: { kind: 'bounded_grant', grantId: randomUUID() },
        event: {
          promptType: 'user_message',
          operationId: f.identity.key,
          operationFingerprint: f.identity.fingerprint,
          triggerMessageId: randomUUID(),
          sourceUserMessageId: f.identity.messageId,
          ...event,
        },
      },
    });
    const writeV1 = async (f: Fixture, records: unknown[]) => {
      await mkdir(paths().directory, { recursive: true });
      await writeFile(
        join(paths().directory, `${f.identity.agentSessionId}.json`),
        JSON.stringify({ schemaVersion: 1, records }),
      );
    };

    it('delivers a v1 user_message saved without attachments with attachments: []', async () => {
      const f = await fixture(randomUUID(), undefined, false);
      await writeV1(f, [
        v1Record(
          f,
          v1Frame(f, { payload: { handlerPromptType: 'coding_freeform', userMessage: 'Go on.' } }),
        ),
      ]);

      await f.make().start();

      expect(f.send).toHaveBeenCalledOnce();
      expect(f.send.mock.calls[0]![1]).toMatchObject({
        promptType: 'coding_freeform',
        payload: { userMessage: 'Go on.' },
        attachments: [],
      });
    });

    it('delivers an open saved frame the current wire schema would reject', async () => {
      // An empty body is refused at admission today, but this input was admitted before.
      const payload = { handlerPromptType: 'coding_freeform', userMessage: '', attachments: [] };
      expect(() => validateUserMessageTriggerPayload(payload, promptTypeRegistry)).toThrow();
      const f = await fixture(randomUUID(), undefined, false);
      await writeV1(f, [v1Record(f, v1Frame(f, { payload }))]);

      await f.make().start();

      expect(f.send).toHaveBeenCalledOnce();
      expect(f.send.mock.calls[0]![1]).toMatchObject({ payload: { userMessage: '' } });
      expect((await f.records())[0]?.state).toBe('picked');
    });

    const settledOutcome = (turnId: string) => ({
      turnId,
      terminalOutcome: 'COMPLETED',
      completedAssistantMessageId: null,
      reports: [],
      settledAt: new Date().toISOString(),
    });

    it('replays settlement for finished history whose payload drifted', async () => {
      const f = await fixture(randomUUID(), undefined, false);
      const turnId = randomUUID();
      await writeV1(f, [
        v1Record(
          f,
          {
            ...f.collaboration,
            // Fields a later contract no longer accepts; settled history is never re-judged.
            input: { ...f.collaboration.input, authority: undefined, objective: 42 },
            retiredField: true,
          },
          {
            state: 'settled',
            turnId,
            revision: 4,
            projectedRevision: 4,
            settlement: settledOutcome(turnId),
          },
        ),
      ]);

      await f.make().start();

      expect(api.settle).toHaveBeenCalledWith(
        expect.objectContaining({
          interactionId: f.interactionId,
          agentInteractionSettledTurn: expect.objectContaining({
            attemptId: f.attemptId,
            interactionId: f.interactionId,
            generation: 1,
            targetTurnId: turnId,
          }),
        }),
      );
      expect((await f.records())[0]?.settlementDelivered).toBe(true);
    });

    it('quarantines settled history it cannot correlate and keeps executing the session', async () => {
      const f = await fixture(randomUUID(), undefined, false);
      const turnId = randomUUID();
      const uncorrelated = v1Record(
        f,
        { kind: 'session_message', generation: 1 },
        {
          state: 'settled',
          turnId,
          revision: 4,
          projectedRevision: 4,
          settlement: settledOutcome(turnId),
        },
      );
      await writeV1(f, [uncorrelated]);
      const lifecycle = f.make();
      await lifecycle.start();

      expect(api.settle).not.toHaveBeenCalled();
      expect(await f.owner.quarantinedKeys(f.identity.agentSessionId)).toEqual([f.identity.key]);
      const written = JSON.parse(
        await fsPromises.readFile(
          join(paths().directory, `${f.identity.agentSessionId}.json`),
          'utf8',
        ),
      );
      expect(written.quarantined[0]).toMatchObject({
        key: f.identity.key,
        reason: expect.stringContaining('settlement correlation'),
        raw: expect.objectContaining({ payload: uncorrelated.payload }),
      });

      const next = { ...f.identity, key: randomUUID(), messageId: null };
      await lifecycle.admitInput(next, f.payload);
      await lifecycle.advance(f.identity.agentSessionId);
      expect(f.send).toHaveBeenCalledOnce();
      expect(f.send.mock.calls[0]![1]).toMatchObject({ payload: f.collaboration.input });
    });
  });

  it('blocks pickup for a restored foreground hold before its Run is hydrated', () => {
    const registry = createTestRunRegistry();
    const runId = randomUUID();
    const interactionId = randomUUID();
    expect(registry.get(runId)).toBeNull();
    registry.holdForSubagent(runId, interactionId);
    expect(registry.canAcceptDurableInput(runId)).toBe(false);
    registry.releaseSubagentHold(runId, interactionId);
    expect(registry.canAcceptDurableInput(runId)).toBe(true);
  });
});
