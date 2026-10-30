import { createTestMessagePoster } from './run.test-support';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { claudeTurnContent, codexAttachmentInput } from '../agent-runtime/index';
import { RunAttachmentStore } from '../server/run-attachment-store';
import { RunAttachmentContentReader } from '../agents/providers/run-attachment-content-reader';
import { opencodeAttachmentParts } from '../agents/providers/opencode/session-runner-opencode';
import type {
  RunPromptArgs,
  ResumeArgs,
  AgentSessionRunner,
} from '../agents/providers/session-runner';
import type { PromptTypeHandler } from '../agents/prompt-type-handler';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import { toInternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import { NOOP_LOGGER } from '../server/logger';
import { NewSessionRunner } from './runners/new-session-runner';
import { ResumeRunner } from './runners/resume-runner';
import {
  createTestRun,
  createTestRunStore,
  createTestRunOwnership,
  createTestRunnerPicker,
  createTestSessionRunnerFacade,
} from './run.test-support';
import type { Run } from './run';
import { InputAdmissionOwner } from '../server/input-admission/input-admission-owner';
import { InputAdmissionLifecycle } from '../server/input-admission/admission-lifecycle';
import { storedInput } from '../server/input-admission/input-admission-codec';
import { ProjectsApi } from '../shared/api/generated/api';
import type {
  LocalRunPromptRequest,
  SendMessageOptions,
} from '../shared/agent-bridge-contract/contract';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it.each(['claude', 'codex', 'opencode'] as const)(
  'carries uploaded references through real Run/Turn and fresh/resumed %s inputs',
  async (provider) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-attachment-'));
    roots.push(root);
    vi.stubEnv('HEYHEY_SESSION_DIR', root);
    const runId = randomUUID();
    const store = new RunAttachmentStore(root);
    const uploaded = await store.save(
      runId,
      'notes.md',
      Buffer.from('private file contents\n'),
      new AbortController().signal,
    );
    const image = await store.save(
      runId,
      'image.png',
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      new AbortController().signal,
    );
    const attachments = [uploaded, image].map(({ attachmentId, fileName }) => ({
      attachmentId,
      fileName,
    }));
    // Reproduce the pre-Run upload layout; first-message admission binds it to Run ownership.
    await fs.mkdir(path.join(root, 'run-attachments-staging'), { recursive: true });
    for (const reference of attachments) {
      await fs.rename(
        path.join(root, 'run-attachments', runId, reference.attachmentId),
        path.join(root, 'run-attachments-staging', reference.attachmentId),
      );
    }
    const handler = {
      id: 'attachment-test',
      promptType: LocalPromptType.AgentSearch,
      service: 'optional',
      launchEntity: 'required',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: true,
      reports: [],
      buildPrompt: (payload: { userMessage: string }) => payload.userMessage,
    } satisfies PromptTypeHandler<{ userMessage: string }>;
    const ownership = createTestRunOwnership(() => handler);
    const runStore = createTestRunStore();
    const frames: object[] = [];
    let run: Run;
    const send = vi.fn(async (args: RunPromptArgs | ResumeArgs) => {
      expect(run.activeTurn?.attachments).toEqual(args.attachments ?? []);
      expect(Object.isFrozen(run.activeTurn?.attachments)).toBe(true);
      expect(args.attachments ?? []).toEqual(run.activeTurn?.attachments);
      expect(args.attachmentRunId).toBe(runId);
      const content = await new RunAttachmentContentReader().read(
        args.attachmentRunId,
        args.attachments ?? [],
      );
      const prompt = args.prompt ?? '';
      frames.push(
        provider === 'claude'
          ? { content: claudeTurnContent(prompt, content) }
          : provider === 'codex'
            ? { input: [{ type: 'text', text: prompt }, ...codexAttachmentInput(content)] }
            : { parts: [{ type: 'text', text: prompt }, ...opencodeAttachmentParts(content)] },
      );
      return {
        providerSessionId: 'attachment-provider-session',
        providerConversationId: null,
        errorCount: 0,
      };
    });
    const facade = createTestSessionRunnerFacade({
      runPrompt: send,
      resumeSession: send,
      promptOnce: vi.fn(),
      getContextUsage: vi.fn(),
    } satisfies AgentSessionRunner);
    const runnerPicker = createTestRunnerPicker((ctx) =>
      ctx.run.hasProviderSession
        ? new ResumeRunner(ctx, { sessionRunnerFacade: facade, logger: NOOP_LOGGER })
        : new NewSessionRunner(ctx, { sessionRunnerFacade: facade, logger: NOOP_LOGGER }),
    );
    run = createTestRun({ runId, provider }, { runStore, ...ownership, runnerPicker });
    run.refreshSessionFields({ services: [], provider });
    for (const name of [
      'updateRunPromptType',
      'updateRunSessionContext',
      'updateRunTriggerContext',
      'updateRunWorktreeState',
      'updateRunPreviousProviderSession',
      'updateRunProviderIdentity',
    ] as const)
      vi.spyOn(runStore, name).mockResolvedValue(run.session);
    vi.spyOn(runStore, 'addTouchedFiles').mockResolvedValue(undefined);
    vi.spyOn(runStore, 'getRun').mockResolvedValue(null);
    const prompt = '  Read this exactly.\n\n';
    const input = () =>
      toInternalRunPromptRequest({
        promptType: LocalPromptType.AgentSearch,
        payload: { promptType: LocalPromptType.AgentSearch, userMessage: prompt },
        references: { resolved: [], unresolved: [] },
        attachments,
      });
    vi.spyOn(ProjectsApi.prototype, 'projectInputExecution').mockResolvedValue({
      data: { data: { accepted: true } },
    } as never);
    const owner = new InputAdmissionOwner(
      { directory: path.join(root, 'inputs'), legacyStoreFile: path.join(root, 'inputs.json') },
      NOOP_LOGGER,
    );
    const identity = {
      key: randomUUID(),
      fingerprint: 'a'.repeat(64),
      agentSessionId: runId,
      runId,
      organizationId: randomUUID(),
      projectId: randomUUID(),
      machineId: randomUUID(),
      userId: randomUUID(),
      messageId: randomUUID(),
    };
    const event = {
      promptType: 'start_run',
      operationId: identity.key,
      operationFingerprint: identity.fingerprint,
      triggerMessageId: randomUUID(),
      payload: {
        handlerPromptType: LocalPromptType.AgentSearch,
        payload: { promptType: LocalPromptType.AgentSearch, userMessage: prompt },
        attachments,
        model: 'test-model',
        provider,
        agentSessionId: runId,
        contextMetadata: {
          organizationId: identity.organizationId,
          projectId: identity.projectId,
          agentSessionId: runId,
          capturedAt: new Date().toISOString(),
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
      },
    };
    await owner.admit(
      identity,
      storedInput('trigger_frame', 'operation', {
        conversationId: randomUUID(),
        signedEvent: event,
        event,
      }),
      () => false,
    );
    const lifecycle = new InputAdmissionLifecycle(
      owner,
      {
        materializeAdmittedRun: vi.fn().mockResolvedValue({ status: 'started' }),
        adoptStagedBrowserTab: vi.fn().mockResolvedValue(undefined),
        sendSystemMessage: async (
          _id: string,
          request: LocalRunPromptRequest,
          options: SendMessageOptions,
        ) => run.handleMessage(toInternalRunPromptRequest(request), options),
      } as never,
      {
        get: () => run,
        canAcceptDurableInput: () => run.canAcceptDurableInput,
      } as never,
      {
        loadCurrentMachineId: async () => identity.machineId,
        loadMachineCredential: async () => 'test-credential',
      } as never,
      'http://localhost',
      NOOP_LOGGER,
      () => true,
      runStore,
      createTestMessagePoster(),
      undefined,
      store,
    );
    try {
      await lifecycle.start();
      await run.awaitIdle();
      await lifecycle.dispose();
      expect(JSON.stringify(await owner.session(runId))).not.toContain('private file contents');
      expect(JSON.stringify(await owner.session(runId))).not.toContain(root);
      await run.handleMessage(input());
      await run.awaitIdle();
      expect(send).toHaveBeenCalledTimes(2);
      expect(frames).toHaveLength(2);
      expect(JSON.stringify(frames)).toContain('private file contents');
      expect(JSON.stringify(frames)).toContain('image/png');
      expect(JSON.stringify(frames)).not.toContain(root);
      expect(JSON.stringify(frames)).not.toContain('Attached files:');
      expect(send.mock.calls[0]![0].prompt?.startsWith(prompt)).toBe(true);
      expect(send.mock.calls[1]![0].prompt?.startsWith(prompt)).toBe(true);
      const durable = JSON.stringify(await runStore.readDurableRunEvents(runId));
      expect(durable).not.toContain('private file contents');
      expect(durable).not.toContain(root);
      await fs.unlink(
        path.join(root, 'run-attachments', runId, uploaded.attachmentId, uploaded.fileName),
      );
      await expect(run.handleMessage(input())).rejects.toMatchObject({
        code: 'ATTACHMENT_NOT_FOUND',
      });
      expect(send).toHaveBeenCalledTimes(2);
      expect(run.activeTurn).toBeNull();
      await run.handleMessage(
        toInternalRunPromptRequest({
          promptType: LocalPromptType.AgentSearch,
          payload: { promptType: LocalPromptType.AgentSearch, userMessage: 'healthy' },
          references: { resolved: [], unresolved: [] },
        }),
      );
      await run.awaitIdle();
    } finally {
      await lifecycle.dispose();
      run.cleanup();
    }
  },
);
