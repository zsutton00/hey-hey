import { MachineOptionsStore } from '../options/machine-options-store';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import { AgentApplicationRuntime } from '../agents/agent-application-runtime';
import { validateProjectModeConfig } from '../agents/project-mode';
import { seedCredentialFromEnvIfAbsent } from '../auth';
import { toServiceId } from '../repo';
import type {
  LocalCreateRunRequest,
  LocalRunPromptRequest,
} from '../shared/agent-bridge-contract/contract';
import {
  LocalPromptType,
  type AgentSessionConfig,
} from '../shared/agent-bridge-contract/generated/api';
import { AgentOutputEvents } from '../server/agent-output-events';
import { LocalAgentInfrastructure } from '../server/local-agent-infrastructure';
import { EntityReportIndex } from '../server/reports/entity-report-index';
import { RunApplicationRuntime } from '../server/run-application-runtime';
import { RunLifecycleEvents } from '../server/run-lifecycle-events';
import { TaskMonitorLaunchFailureRuntime } from '../server/task-monitor-launch-failure-runtime';
import { TaskMonitorManagedTurnRuntime } from '../server/task-monitor-managed-turn-runtime';
import type {
  CapturedProjectModeSession,
  CanonicalModeEdit,
  ProjectModeLaunchResumeProbeDependencies,
} from './probe-project-mode-launch-resume';
import type { ProjectModeLaunchResumeProbeArgs } from './probe-project-mode-launch-resume-args';
import { RuntimeCapabilityCatalogLifecycle } from '../server/runtime-capability-catalog';

const envelopeSchema = z.object({ data: z.unknown() }).passthrough();
const sessionSchema = z.object({ id: z.string().uuid(), config: z.unknown() }).passthrough();
const conversationSchema = z
  .object({ conversation: z.object({ id: z.string().uuid() }).passthrough() })
  .passthrough();
const sectionSchema = z
  .object({ key: z.string(), order: z.number().int(), materializedMarkdown: z.string() })
  .passthrough();
const modeTaskSchema = z
  .object({ id: z.string().uuid(), type: z.literal('MODE'), sections: z.array(sectionSchema) })
  .passthrough();
const updateSchema = z
  .object({ status: z.enum(['APPLIED', 'PENDING']), task: modeTaskSchema })
  .passthrough();
const filesSchema = z
  .object({
    schemaVersion: z.literal('project-mode-files.v1'),
    files: z.record(z.string(), z.string()).refine((files) => Boolean(files['MODE.md'])),
  })
  .strict();

const headers = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

const readData = async (response: Response, operation: string): Promise<unknown> => {
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ message: z.string() }).passthrough().safeParse(body);
    throw new Error(
      `${operation} failed with status ${String(response.status)}${parsed.success ? `: ${parsed.data.message}` : ''}.`,
    );
  }
  return envelopeSchema.parse(body).data;
};

const parseConfig = (value: unknown): AgentSessionConfig => {
  const validated = validateProjectModeConfig(value);
  if (!validated.ok)
    throw new Error(
      `Platform returned invalid project MODE capture: ${validated.issues.join('; ')}`,
    );
  const header = z
    .object({
      type: z.literal('CODING_SESSION'),
      version: z.literal('v2'),
      model: z.string().min(1),
      effort: z.string().optional(),
      fastMode: z.boolean().optional(),
      worktree: z.string().optional(),
    })
    .passthrough()
    .parse(value);
  return {
    type: header.type,
    version: header.version,
    model: header.model,
    ...(header.effort ? { effort: header.effort } : {}),
    ...(header.fastMode !== undefined ? { fastMode: header.fastMode } : {}),
    ...(header.worktree ? { worktree: header.worktree } : {}),
    projectModeSelection: { ...validated.value.selection },
    projectModeSnapshot: {
      ...validated.value.snapshot,
      applicableWorkItemTypeKeys: [...validated.value.snapshot.applicableWorkItemTypeKeys],
      files: {
        ...validated.value.snapshot.files,
        files: { ...validated.value.snapshot.files.files },
      },
    },
  };
};

const modeUrl = (baseUrl: string, args: ProjectModeLaunchResumeProbeArgs): string =>
  `${baseUrl}/organizations/${encodeURIComponent(args.organizationId)}/projects/${encodeURIComponent(args.projectId)}/work-items/${encodeURIComponent(args.modeId)}`;

const readCanonicalFiles = async (
  baseUrl: string,
  token: string,
  args: ProjectModeLaunchResumeProbeArgs,
): Promise<{ files: z.infer<typeof filesSchema>; order: number }> => {
  const response = await fetch(modeUrl(baseUrl, args), { headers: headers(token) });
  const task = modeTaskSchema.parse(await readData(response, 'Canonical MODE read'));
  const section = task.sections.find((candidate) => candidate.key === 'files');
  if (!section) throw new Error('Canonical MODE is missing its files section.');
  let content: unknown;
  try {
    content = JSON.parse(section.materializedMarkdown);
  } catch {
    throw new Error('Canonical MODE files section is not valid JSON.');
  }
  return { files: filesSchema.parse(content), order: section.order };
};

const patchCanonicalFiles = async (
  baseUrl: string,
  token: string,
  args: ProjectModeLaunchResumeProbeArgs,
  files: z.infer<typeof filesSchema>,
  order: number,
  reason: string,
): Promise<void> => {
  const response = await fetch(modeUrl(baseUrl, args), {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({
      sections: [{ key: 'files', content: files, order }],
      sectionUpdateSource: 'USER',
      reason,
    }),
  });
  const result = updateSchema.parse(await readData(response, 'Canonical MODE edit'));
  if (result.status !== 'APPLIED') {
    throw new Error('Canonical MODE edit requires review and was not approved synchronously.');
  }
};

/** Composes the proof from the normal CLI infrastructure and Run owners. */
export const createProjectModeLaunchResumeProbeDependencies = async (
  args: ProjectModeLaunchResumeProbeArgs,
): Promise<ProjectModeLaunchResumeProbeDependencies> => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-mode-launch-resume-'));
  const priorSessionDir = process.env['HEYHEY_SESSION_DIR'];
  const priorApiUrl = process.env['HEYHEY_API_URL'];
  process.env['HEYHEY_SESSION_DIR'] = profile;
  process.env['HEYHEY_API_URL'] = args.apiBaseUrl;
  const restoreEnvironment = (): void => {
    if (priorSessionDir === undefined) delete process.env['HEYHEY_SESSION_DIR'];
    else process.env['HEYHEY_SESSION_DIR'] = priorSessionDir;
    if (priorApiUrl === undefined) delete process.env['HEYHEY_API_URL'];
    else process.env['HEYHEY_API_URL'] = priorApiUrl;
  };

  const seededCredential = await seedCredentialFromEnvIfAbsent({ log: () => {} });
  const infrastructure = new LocalAgentInfrastructure({
    apiBaseUrl: args.apiBaseUrl,
    writeLogLine: () => {},
    repoMappingStoreOptions: {
      mappingPath: path.join(profile, 'repos.json'),
      lockPath: path.join(profile, 'repos.lock'),
    },
  });
  try {
    await infrastructure.runStore.initialize();
    const tokenResult = await infrastructure.oauthClient.getAccessToken({});
    if (!tokenResult.success)
      throw new Error(`Project MODE probe authentication failed: ${tokenResult.error}`);
    const token = tokenResult.data;
    infrastructure.apiRuntime.transport.setAuthToken(token);
    const binding = await infrastructure.repoStore.setBinding(
      toServiceId(args.serviceId),
      args.repositoryPath,
    );
    if (binding.repositoryPath !== args.repositoryPath)
      throw new Error('The selected Service repository binding was not retained.');

    const managedTurns = new TaskMonitorManagedTurnRuntime(
      infrastructure.logger.child({ component: 'mode-probe.managed-turn' }),
    );
    const launchFailures = new TaskMonitorLaunchFailureRuntime(
      infrastructure.logger.child({ component: 'mode-probe.launch-failure' }),
    );
    const agentRuntime = new AgentApplicationRuntime({
      runStore: infrastructure.runStore,
      oauthClient: infrastructure.oauthClient,
      apiBaseUrl: infrastructure.normalizedApiBaseUrl,
      logger: infrastructure.logger.child({ component: 'mode-probe.agents' }),
      isJevEnabled: () => new MachineOptionsStore().isJevEnabled(),
      taskMonitorManagedTurnRuntime: managedTurns,
    });
    const capabilityCatalog = new RuntimeCapabilityCatalogLifecycle(
      infrastructure.logger.child({ component: 'mode-probe.model-catalog' }),
    );
    capabilityCatalog.start();
    const runtime = new RunApplicationRuntime({
      capabilityCatalog,
      runStore: infrastructure.runStore,
      repoStore: infrastructure.repoStore,
      oauthClient: infrastructure.oauthClient,
      apiRuntime: infrastructure.apiRuntime,
      agentRuntime,
      agentOutputEvents: new AgentOutputEvents(),
      runLifecycleEvents: new RunLifecycleEvents(),
      taskMonitorManagedTurnRuntime: managedTurns,
      taskMonitorLaunchFailureRuntime: launchFailures,
      logger: infrastructure.logger,
      dataDir: profile,
      apiBaseUrl: infrastructure.normalizedApiBaseUrl,
      authContext: infrastructure.platformAuthContext,
      reportIndex: new EntityReportIndex(),
      agentSessionReader: infrastructure.agentSessionReader,
      toolRuleStore: infrastructure.toolRuleStore,
      monitorProjectContext: infrastructure.monitorProjectContext,
      platformWebSocketManager: infrastructure.platformWebSocketManager,
      keyPairStore: infrastructure.keyPairStore,
      hostActionAdmission: infrastructure.hostActionAdmission,
      controllerRegistry: infrastructure.controllerRegistryStore,
      trackToolUsage: true,
    });
    const restoration = new Map<string, { files: z.infer<typeof filesSchema>; order: number }>();
    let disposed = false;

    return {
      captureSession: async (probeArgs): Promise<CapturedProjectModeSession> => {
        const sessionResponse = await fetch(
          `${infrastructure.normalizedApiBaseUrl}/organizations/${encodeURIComponent(probeArgs.organizationId)}/projects/${encodeURIComponent(probeArgs.projectId)}/agent-sessions`,
          {
            method: 'POST',
            headers: headers(token),
            body: JSON.stringify({
              projectId: probeArgs.projectId,
              sessionDate: new Date().toISOString(),
              title: 'Project MODE local launch/resume verification',
              entityType: 'TASK',
              entityId: probeArgs.taskId,
              serviceIds: [probeArgs.serviceId],
              launchServiceId: probeArgs.serviceId,
              provider: probeArgs.provider,
              type: 'CODING',
              config: {
                type: 'CODING_SESSION',
                version: 'v2',
                model: probeArgs.model,
                effort: probeArgs.reasoningEffort,
                projectModeSelection: {
                  schemaVersion: 'project-mode-selection.v1',
                  modeId: probeArgs.modeId,
                },
              },
            }),
          },
        );
        const session = sessionSchema.parse(
          await readData(sessionResponse, 'Agent Session capture'),
        );
        const conversationResponse = await fetch(
          `${infrastructure.normalizedApiBaseUrl}/organizations/${encodeURIComponent(probeArgs.organizationId)}/projects/${encodeURIComponent(probeArgs.projectId)}/agent-sessions/${encodeURIComponent(session.id)}/conversation`,
          {
            method: 'POST',
            headers: headers(token),
            body: JSON.stringify({
              workflowType: 'agent-session',
              title: 'Project MODE local launch/resume verification',
              entityType: 'TASK',
              entityId: probeArgs.taskId,
            }),
          },
        );
        const conversation = conversationSchema.parse(
          await readData(conversationResponse, 'Agent Session conversation capture'),
        );
        return {
          agentSessionId: session.id,
          conversationId: conversation.conversation.id,
          config: parseConfig(session.config),
        };
      },

      startRun: async (probeArgs, session) => {
        const request = {
          attachments: [],
          stagedBrowserTab: null,
          context: {
            projectId: probeArgs.projectId,
            serviceIds: [probeArgs.serviceId],
            launchServiceId: probeArgs.serviceId,
            provider: probeArgs.provider,
          },
          contextMetadata: {
            capturedAt: new Date().toISOString(),
            organizationId: probeArgs.organizationId,
            projectId: probeArgs.projectId,
            agentSessionId: session.agentSessionId,
            userComments: [],
            fileReferences: { resolved: [], unresolved: [] },
          },
          conversationId: session.conversationId,
          payload: {
            promptType: LocalPromptType.ProjectMode,
            entity: { entityType: 'TASK', entityId: probeArgs.taskId },
            userMessage:
              'Follow the captured MODE instructions, read references/checklist.md, and complete normally.',
          },
          config: session.config,
          model: probeArgs.model,
          reasoningEffort: probeArgs.reasoningEffort,
        } satisfies LocalCreateRunRequest;
        const result = await runtime.agentService.createRun(request);
        if (result.status !== 'started')
          throw new Error('The ordinary project MODE Run requires a repository binding.');
        if (!isDeepStrictEqual(result.run.config, session.config))
          throw new Error('The normal Run path did not retain the API-returned captured config.');
        return result.run.agentic_session_id;
      },

      readDurableEvents: async (runId) => {
        const stored = await infrastructure.runStore.getRunWithEvents(runId);
        if (!stored) throw new Error('The project MODE Run was not persisted.');
        return stored.events;
      },

      editCanonicalMode: async (probeArgs): Promise<CanonicalModeEdit> => {
        const canonical = await readCanonicalFiles(
          infrastructure.normalizedApiBaseUrl,
          token,
          probeArgs,
        );
        const restoreToken = crypto.randomUUID();
        const editedSentinel = `project-mode-probe-edited-${crypto.randomUUID()}`;
        restoration.set(restoreToken, canonical);
        await patchCanonicalFiles(
          infrastructure.normalizedApiBaseUrl,
          token,
          probeArgs,
          {
            ...canonical.files,
            files: {
              ...canonical.files.files,
              'MODE.md': `${canonical.files.files['MODE.md']}\n\n${editedSentinel}`,
            },
          },
          canonical.order,
          'Temporarily edit the canonical MODE for local launch/resume verification.',
        );
        return { restoreToken, editedSentinel };
      },

      resumeRun: async (probeArgs, runId) => {
        const request = {
          promptType: LocalPromptType.ProjectMode,
          payload: {
            promptType: LocalPromptType.ProjectMode,
            entity: { entityType: 'TASK', entityId: probeArgs.taskId },
            userMessage:
              'Resume the same Run, read references/checklist.md again, and complete normally.',
          },
          references: { resolved: [], unresolved: [] },
        } satisfies LocalRunPromptRequest;
        await runtime.agentService.sendSystemMessage(runId, request);
        await runtime.runRegistry.get(runId)?.awaitIdle();
      },

      restoreCanonicalMode: async (probeArgs, restoreToken) => {
        const resolvedToken = restoreToken ?? [...restoration.keys()].at(-1) ?? null;
        if (resolvedToken === null) return;
        const canonical = resolvedToken ? restoration.get(resolvedToken) : undefined;
        if (!canonical) throw new Error('Canonical MODE restoration token is unknown.');
        await patchCanonicalFiles(
          infrastructure.normalizedApiBaseUrl,
          token,
          probeArgs,
          canonical.files,
          canonical.order,
          'Restore canonical MODE content after local launch/resume verification.',
        );
        restoration.delete(resolvedToken);
      },

      dispose: async () => {
        if (disposed) return;
        disposed = true;
        await runtime.dispose();
        if (seededCredential) await infrastructure.oauthClient.clearSession();
        await infrastructure.dispose();
        restoreEnvironment();
        await fs.rm(profile, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await infrastructure.dispose().catch(() => undefined);
    if (seededCredential) await infrastructure.oauthClient.clearSession();
    restoreEnvironment();
    await fs.rm(profile, { recursive: true, force: true });
    throw error;
  }
};
