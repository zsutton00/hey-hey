import { asMessageId } from '../test-utils/contract-ids';
import { taskMonitorCoordinationLocalStateFromContext } from '../agents/task-monitor/task-monitor-coordination';
import { TaskMonitorStartRuntime } from './task-monitor-start';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import type { TaskMonitorExecutionDefinition, UpdateTaskDto } from '@hey-hey/contracts/api/models';

import {
  fetchServingMonitorKinds,
  mixedMonitorKinds,
  nodeResultPayload,
  type ServedNodeResult,
} from '../agents/task-monitor/kinds/task-monitor-kind.test-support';
import {
  createTaskMonitorDefinition,
  taskMonitorStateStoreCodec,
  type TaskMonitorStateStore,
  type TaskMonitorMachineRuntime,
  type TaskMonitorMachineRegistry,
} from '../agents/task-monitor/state-machine/machine';
import {
  EffectRunner,
  MachineRecovery,
  MachineRegistry,
  MachineRuntime,
  MachineStateStore,
} from '../state-machine';
import { useTestCapabilityCatalog } from '../test-support/capability-catalog';
import { createTestLocalAgentServerRuntimeOwners } from './local-agent-server-runtime.test-support';
import {
  AddressedMachineAdmission,
  TaskMonitorStateMachineInputAdapter,
} from './state-machine-input-adapter';
import {
  drainDurableTaskMonitorWork,
  firstStartCommand,
  ORGANIZATION_ID,
  PROJECT_ID,
} from './task-monitor-first-launch.integration.test-support';
import { TaskMonitorSettlementMachineAdapter } from './task-monitor-settlement-machine-adapter';
import { NOOP_LOGGER } from './logger';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
useTestCapabilityCatalog();

it.each(['DIRECT_ACCEPTANCE', 'COORDINATOR_REVIEW', 'REQUIRE_REVIEW'] as const)(
  'runs Task and %s reusable operations through dependencies and restart without changing reusable items',
  async (policy) => {
    const supervision = policy === 'DIRECT_ACCEPTANCE' ? policy : 'COORDINATOR_REVIEW';
    const requireReview = policy === 'REQUIRE_REVIEW';
    const reviewed = new Set<string>();
    const waitNext = new Set<string>();
    const recoverNext = new Map<string, 'WAIT' | 'REQUEST_JUDGMENT'>();
    const taskMonitorId = crypto.randomUUID();
    const directMonitorId = crypto.randomUUID();
    const taskIds: string[] = [crypto.randomUUID(), crypto.randomUUID()];
    const directIds: string[] = [crypto.randomUUID(), crypto.randomUUID()];
    const launchConfiguration = {
      method: 'quick',
      provider: 'codex',
      model: 'gpt-6-sol',
      reasoningEffort: 'high',
    } as const;
    const definitions = new Map<string, TaskMonitorExecutionDefinition>(
      (
        [
          [taskMonitorId, 'task', taskIds],
          [directMonitorId, 'requirement-check', directIds],
        ] as const
      ).map(([id, kind, ids]) => [
        id,
        {
          kind,
          executionPlan: ids.map((taskId, index) => ({
            taskId,
            dependsOnTaskIds: index === 0 ? [] : [ids[0]!],
            launchConfiguration,
            agentSessionId: null,
          })),
          cursor: 0,
          launchPolicy: {
            terminalSupervision: {
              mode: id === directMonitorId && requireReview ? 'REQUIRE_REVIEW' : 'AGENT_DECIDES',
            },
          },
        },
      ]),
    );
    const statuses = new Map<string, string>(
      [...taskIds, ...directIds].map((id) => [id, 'BACKLOG']),
    );
    const monitorStatuses = new Map<string, string>([
      [taskMonitorId, 'BACKLOG'],
      [directMonitorId, 'BACKLOG'],
    ]);
    const sessions = new Map<
      string,
      { monitorId: string; nodeId: string; conversationId: string | null; status: string }
    >();
    const nodeResults: ServedNodeResult[] = [];
    const mutations: { id: string; status: string }[] = [];
    const starts: string[] = [];
    const item = (id: string) => ({
      id,
      name: `Selected work ${id}`,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      type: definitions.has(id)
        ? 'TASK_MONITOR'
        : directIds.includes(id)
          ? 'reusable_check'
          : 'STANDARD',
      status: monitorStatuses.get(id) ?? statuses.get(id),
      sections: definitions.has(id)
        ? [
            {
              key: 'executionDefinition',
              materializedMarkdown: JSON.stringify(definitions.get(id)),
            },
          ]
        : directIds.includes(id)
          ? [
              {
                key: 'scenario',
                materializedMarkdown:
                  'Validate the populated release candidate with persisted customer configuration.',
              },
              {
                key: 'expectedEvidence',
                materializedMarkdown:
                  'Record observed compatibility and downstream release readiness.',
              },
            ]
          : [
              {
                key: 'description',
                materializedMarkdown: 'Deliver and verify the selected change.',
              },
              {
                key: 'acceptanceCriteria',
                materializedMarkdown: 'The selected change is delivered.',
              },
            ],
      serviceRelations: [{ serviceId: 'service-a' }],
    });
    const boundaryFetch: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      const id = url.pathname.split('/').at(-1)!;
      if (url.pathname.includes('/work-items/')) {
        if (init?.method === 'PATCH') {
          const update: UpdateTaskDto = JSON.parse(String(init.body));
          if (update.status) {
            (definitions.has(id) ? monitorStatuses : statuses).set(id, update.status);
            mutations.push({ id, status: update.status });
          }
          const section = update.sections?.find((entry) => entry.key === 'executionDefinition');
          if (section) {
            const definition: TaskMonitorExecutionDefinition =
              typeof section.content === 'string' ? JSON.parse(section.content) : section.content;
            definitions.set(id, definition);
          }
          return Response.json({ data: { status: 'APPLIED', task: item(id) } });
        }
        return Response.json({ data: item(id) });
      }
      if (url.pathname.endsWith('/context')) {
        return Response.json({
          data: {
            entityId: url.pathname.split('/').at(-2),
            entityType: 'TASK',
            displayName: 'Selected work',
            createdAt: new Date().toISOString(),
          },
        });
      }
      if (url.pathname.endsWith('/run-effects')) {
        const session = [...sessions.entries()].find(([, value]) =>
          url.pathname.includes(value.conversationId!),
        );
        if (!session) {
          throw new Error('Run dispatch has no created conversation.');
        }
        starts.push(session[1].nodeId);
        return Response.json({ success: true, data: { dispatched: true } });
      }
      if (url.pathname.includes('/agent-sessions/')) {
        const session = sessions.get(id)!;
        return Response.json({
          data: {
            id,
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
            status: session.status,
            serviceIds: ['service-a'],
            launchServiceId: 'service-a',
            conversationId: session.conversationId,
            autoDecide: false,
            config: {
              type: 'CODING_SESSION',
              version: 'v2',
              model: launchConfiguration.model,
              taskMonitorId: session.monitorId,
            },
          },
        });
      }
      throw new Error(`Unexpected platform boundary ${init?.method ?? 'GET'} ${url.pathname}`);
    };
    const fetchImpl = fetchServingMonitorKinds(
      {
        [PROJECT_ID]: mixedMonitorKinds().map((kind) =>
          kind.key === 'task'
            ? kind
            : { ...kind, allowedNodeTypes: ['reusable_check'], supervision: { type: supervision } },
        ),
      },
      boundaryFetch,
      nodeResults,
    );
    vi.stubGlobal('fetch', fetchImpl);
    const runDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-kinds-runs-'));
    directories.push(runDirectory);
    vi.stubEnv('HEYHEY_SESSION_DIR', runDirectory);
    const owners = createTestLocalAgentServerRuntimeOwners({ fetchImpl });
    directories.push(owners.dataDir);
    await owners.infrastructure.runStore.initialize({ migrateLegacySessions: false });
    const auth = {
      accessToken: 'token',
      userId: crypto.randomUUID(),
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
    };
    vi.spyOn(owners.infrastructure.platformAuthContext, 'resolve').mockResolvedValue(auth);
    vi.spyOn(owners.infrastructure.platformAuthContext, 'getAccessToken').mockResolvedValue(
      auth.accessToken,
    );
    const machineId = crypto.randomUUID();
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    vi.spyOn(owners.infrastructure.keyPairStore, 'loadCurrentMachineId').mockResolvedValue(
      machineId,
    );
    vi.spyOn(owners.infrastructure.keyPairStore, 'loadPrivateKey').mockResolvedValue(
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    vi.spyOn(owners.infrastructure.keyPairStore, 'loadMachineCredential').mockResolvedValue(
      'machine-credential',
    );

    // API clients and the provider are the only scripted boundaries. Monitor runtime, kind,
    // handlers, coordinator runner, decision store and durable machine all execute real code.
    const clients = owners.infrastructure.apiRuntime.clients;
    vi.spyOn(clients.agentSessions, 'createAgentSession').mockImplementation(
      async ({ createAgentSessionDto: dto }) => {
        const id = crypto.randomUUID();
        const nodeId = dto.entityId!;
        const monitorId = taskIds.includes(nodeId) ? taskMonitorId : directMonitorId;
        sessions.set(id, { monitorId, nodeId, conversationId: null, status: 'NOT_STARTED' });
        return { data: { data: { id } } } as never;
      },
    );
    vi.spyOn(clients.agentSessions, 'getAgentSession').mockImplementation(
      async ({ agentSessionId }) =>
        ({ data: { data: { id: agentSessionId, ...sessions.get(agentSessionId) } } }) as never,
    );
    vi.spyOn(clients.agentSessions, 'createAgentSessionConversation').mockImplementation(
      async ({ agentSessionId }) => {
        const session = sessions.get(agentSessionId)!;
        session.conversationId = crypto.randomUUID();
        return { data: { data: { conversation: { id: session.conversationId } } } } as never;
      },
    );
    vi.spyOn(clients.agentSessions, 'resolveWorkItemCoordinator').mockImplementation(
      async ({ resolveWorkItemCoordinatorAgentSessionDto: dto }) =>
        ({
          data: { data: { agentSession: { id: dto.workItemId, conversationId: dto.workItemId } } },
        }) as never,
    );
    vi.spyOn(clients.conversationsApi, 'postMessage').mockResolvedValue({
      data: { success: true },
    } as never);
    vi.spyOn(owners.messagePoster, 'createOutOfBand').mockResolvedValue(crypto.randomUUID());
    vi.spyOn(owners.infrastructure.apiRuntime.transport, 'request').mockResolvedValue({
      data: { success: true },
    } as never);
    const coordinatorRuns = new Map<
      string,
      Awaited<ReturnType<typeof owners.infrastructure.runStore.createRun>>
    >();
    vi.spyOn(owners.agentService, 'ensureRunForMonitor').mockImplementation(async (input) => {
      const monitorId = input.contextMetadataSeed.taskMonitorId!;
      let run = coordinatorRuns.get(monitorId);
      if (!run) {
        run = await owners.infrastructure.runStore.createRun({
          agentic_session_id: monitorId,
          entity: null,
          services: [],
          provider: 'codex',
          provider_session_id: monitorId,
          conversationId: monitorId,
          contextMetadata: { ...input.contextMetadataSeed, agentSessionId: monitorId },
        });
        coordinatorRuns.set(monitorId, run);
      }
      return {
        run,
        agentSessionId: monitorId,
        ownConversationId: monitorId,
        created: false,
      } as never;
    });
    const coordinatorCalls: string[] = [];
    let rejectedRecoveryCalls = 0;
    vi.spyOn(owners.agentService, 'sendSystemMessage').mockImplementation(async (runId) => {
      if (sessions.has(runId)) {
        return {} as never;
      }
      coordinatorCalls.push(runId);
      const recovery = recoverNext.get(runId);
      if (recovery) {
        recoverNext.delete(runId);
        owners.taskMonitorDecisionStore.publish(runId, {
          status: 'DECISION',
          decision:
            recovery === 'WAIT'
              ? { action: 'WAIT', rationale: 'Pause before accepting the operation.' }
              : {
                  action: 'REQUEST_JUDGMENT',
                  rationale: 'Confirm the operation.',
                  guidance: 'Confirm acceptance.',
                },
        });
        return {} as never;
      }
      if (waitNext.delete(runId)) {
        owners.taskMonitorDecisionStore.publish(runId, {
          status: 'DECISION',
          decision: {
            action: 'WAIT',
            rationale: 'Operation evidence is insufficient; keep observing.',
          },
        });
        return {} as never;
      }
      owners.taskMonitorDecisionStore.publish(runId, {
        status: 'DECISION',
        decision: {
          action:
            runId === directMonitorId &&
            requireReview &&
            !reviewed.has(
              definitions.get(runId)!.executionPlan[definitions.get(runId)!.cursor]!
                .agentSessionId!,
            )
              ? 'REQUEST_REVIEW'
              : 'ACCEPT_TASK',
          rationale: 'Judge selected operation evidence under its Review policy.',
        },
      });
      return {} as never;
    });

    for (const [monitorId, ids] of [
      [taskMonitorId, taskIds],
      [directMonitorId, directIds],
    ] as const) {
      const command = firstStartCommand();
      command.commandId = crypto.randomUUID();
      command.target.workItemId = monitorId;
      command.command = {
        cause: 'START',
        launchConfig: { taskId: ids[0]!, ...launchConfiguration },
      };
      await owners.taskMonitorStateMachineInputAdapter.admit(command);
    }
    await drainDurableTaskMonitorWork(owners.effectRunner);
    expect(
      starts,
      JSON.stringify(await owners.machineStore.findByInstanceId(directMonitorId)),
    ).toEqual(expect.arrayContaining([taskIds[0], directIds[0]]));
    expect(starts).toHaveLength(2);
    expect(statuses.get(taskIds[0]!)).toBe('ACTIVE');
    expect(statuses.get(directIds[0]!)).toBe('BACKLOG');

    // Write the actual running snapshot in its pre-change shape, including prior effects and
    // settlements, then reconstruct every durable owner. The canonical monitor was backfilled.
    const snapshotPath = path.join(owners.dataDir, 'state-machines', 'snapshots.json');
    const persisted: { instances: { identity: { instanceId: string } }[] } = JSON.parse(
      await fs.readFile(snapshotPath, 'utf8'),
    );
    persisted.instances = persisted.instances.map((instance) =>
      instance.identity.instanceId === taskMonitorId
        ? JSON.parse(
            JSON.stringify(instance, (key, value: unknown) =>
              key === 'kindKey' ? undefined : value,
            ),
          )
        : instance,
    );
    await fs.writeFile(snapshotPath, JSON.stringify(persisted));
    const restore = async () => {
      const store: TaskMonitorStateStore = new MachineStateStore(
        snapshotPath,
        taskMonitorStateStoreCodec,
      );
      const runtime: TaskMonitorMachineRuntime = new MachineRuntime(store);
      const registry: TaskMonitorMachineRegistry = new MachineRegistry(runtime);
      registry.register(createTaskMonitorDefinition());
      const runner = new EffectRunner(
        store,
        runtime,
        registry,
        owners.monitorRuntime.taskMonitorEffectHandlers,
      );
      await new MachineRecovery(store, registry, runner).restore();
      const adapter = new TaskMonitorStateMachineInputAdapter(
        new AddressedMachineAdmission(registry),
        NOOP_LOGGER,
        store,
      );
      const settlement = new TaskMonitorSettlementMachineAdapter(
        owners.infrastructure.agentSessionReader,
        owners.infrastructure.runStore,
        store,
        adapter,
        NOOP_LOGGER,
      );

      return { store, runner, settlement, adapter };
    };
    let { store, runner, settlement, adapter } = await restore();
    const readKind = () =>
      new TaskMonitorStartRuntime({
        apiBaseUrl: 'https://api.test/v1',
        fetchImpl,
        authContext: owners.infrastructure.platformAuthContext,
        logger: NOOP_LOGGER,
      }).kindFor({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        taskMonitorId: directMonitorId,
        kindKey: 'requirement-check',
      });

    for (let index = 0; index < 2; index += 1) {
      for (const monitorId of [taskMonitorId, directMonitorId]) {
        const instance = await store.findByInstanceId(monitorId);
        expect(instance?.snapshot.state).toMatchObject({ RUNNING: { work: 'OBSERVING_RUN' } });
        const agentSessionId = instance!.snapshot.context.activeRunAgentSessionId!;
        const session = sessions.get(agentSessionId)!;
        await owners.infrastructure.runStore.createRun({
          agentic_session_id: agentSessionId,
          entity: null,
          services: [],
          provider: 'codex',
          provider_session_id: agentSessionId,
          conversationId: session.conversationId!,
          contextMetadata: {
            capturedAt: new Date().toISOString(),
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
            agentSessionId,
            userComments: [],
            fileReferences: { resolved: [], unresolved: [] },
          },
        });
        const reports: { reportId: string; reportType: 'MONITOR_NODE_RESULT' }[] = [];
        if (monitorId === directMonitorId) {
          const reportId = crypto.randomUUID();
          nodeResults.push({
            reportId,
            agentSessionId,
            payload: nodeResultPayload(session.nodeId, 'ACCEPTED'),
          });
          reports.push({ reportId, reportType: 'MONITOR_NODE_RESULT' as const });
        }
        const released = {
          kind: 'settled_turn',
          eventType: 'settled_turn',
          origin: 'self',
          entityId: agentSessionId,
          timestamp: new Date().toISOString(),
          agentSessionId,
          turnId: crypto.randomUUID(),
          promptType: 'quick',
          terminalOutcome: 'COMPLETED',
          completedAssistantMessageId: null,
          reports,
          settledAt: new Date().toISOString(),
        } as const;
        if (monitorId === directMonitorId && supervision === 'COORDINATOR_REVIEW') {
          for (const failed of [false, true]) {
            const failedReportId = crypto.randomUUID();
            if (failed) {
              nodeResults.push({
                reportId: failedReportId,
                agentSessionId,
                payload: nodeResultPayload(
                  session.nodeId,
                  'FAILED',
                  'Customer compatibility check failed.',
                ),
              });
            }
            waitNext.add(directMonitorId);
            expect(
              await settlement.invoke(
                {
                  ...released,
                  turnId: crypto.randomUUID(),
                  reports: failed
                    ? [{ reportId: failedReportId, reportType: 'MONITOR_NODE_RESULT' }]
                    : [],
                },
                auth,
              ),
            ).toMatchObject({ status: 'HANDLED' });
            await drainDurableTaskMonitorWork(runner);
            expect((await store.findByInstanceId(directMonitorId))?.snapshot.state).toMatchObject({
              RUNNING: { work: 'OBSERVING_RUN' },
            });
            expect(definitions.get(directMonitorId)!.cursor).toBe(index);
            expect(
              await (await readKind()).readDone(auth, { nodeId: session.nodeId, agentSessionId }),
            ).toBe(false);
          }
        }
        if (monitorId === directMonitorId && supervision === 'COORDINATOR_REVIEW') {
          const kind = await readKind();
          const scope = {
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
            nodeId: session.nodeId,
            agentSessionId,
          };
          const recorded = { nodeId: session.nodeId, agentSessionId };
          expect(await kind.readDone(auth, recorded)).toBe(false);
          const mismatches = [
            {
              agentSessionId: crypto.randomUUID(),
              payload: nodeResultPayload(session.nodeId, 'ACCEPTED'),
            },
            { agentSessionId, payload: nodeResultPayload(crypto.randomUUID(), 'ACCEPTED') },
          ];
          for (const mismatch of mismatches) {
            const staleId = crypto.randomUUID();
            nodeResults.push({ reportId: staleId, ...mismatch });
            await kind.retainOperationResult(
              { ...scope, turnReportIds: [staleId] },
              crypto.randomUUID(),
              false,
            );
            await expect(kind.admitOperation(auth, recorded, directMonitorId)).rejects.toThrow();
            expect(await kind.readDone(auth, recorded)).toBe(false);
          }
          await kind.retainOperationResult(
            { ...scope, turnReportIds: [] },
            crypto.randomUUID(),
            false,
          );
          await expect(kind.admitOperation(auth, recorded, directMonitorId)).rejects.toThrow();
          await kind.retainOperationResult(
            { ...scope, turnReportIds: reports.map((report) => report.reportId) },
            released.turnId,
            false,
          );
          // A new runtime sees persisted pending evidence, never inferred acceptance.
          expect(await (await readKind()).readDone(auth, recorded)).toBe(false);
        }
        if (supervision === 'COORDINATOR_REVIEW' && !requireReview) {
          recoverNext.set(monitorId, index === 0 ? 'WAIT' : 'REQUEST_JUDGMENT');
        }
        expect(await settlement.invoke(released, auth)).toMatchObject({ status: 'HANDLED' });
        await drainDurableTaskMonitorWork(runner);
        if (monitorId === directMonitorId && requireReview) {
          const pending =
            definitions.get(directMonitorId)!.executionPlan[index]!.operationEvidence!;
          expect(pending.coordinatorRunId).toBeUndefined();
          expect(statuses.get(session.nodeId)).toBe('BACKLOG');
          const callsBeforeRecovery = coordinatorCalls.length;
          ({ store, runner, settlement } = await restore());
          expect(coordinatorCalls).toHaveLength(callsBeforeRecovery);
          expect(
            await (await readKind()).readDone(auth, { nodeId: session.nodeId, agentSessionId }),
          ).toBe(false);
          reviewed.add(agentSessionId);
          recoverNext.set(monitorId, 'REQUEST_JUDGMENT');
          expect(
            await settlement.invoke(
              { ...released, turnId: crypto.randomUUID(), promptType: 'code_review', reports: [] },
              auth,
            ),
          ).toMatchObject({ status: 'HANDLED' });
          await drainDurableTaskMonitorWork(runner);
          expect(
            definitions.get(directMonitorId)!.executionPlan[index]!.operationEvidence!.reportId,
          ).toBe(pending.reportId);
        }
        if (
          supervision === 'COORDINATOR_REVIEW' &&
          (!requireReview || monitorId === directMonitorId)
        ) {
          // Task recovery requires completion already persisted by Work Items.
          if (monitorId === taskMonitorId) {
            statuses.set(session.nodeId, 'COMPLETED');
          }
          // Restore retained operation evidence before recovery admission and acceptance effects.
          ({ store, runner, settlement, adapter } = await restore());
          if (monitorId === directMonitorId && !requireReview) {
            const context = (await store.findByInstanceId(monitorId))!.snapshot.context;
            const definition = definitions.get(monitorId)!;
            const entry = definition.executionPlan[index]!;
            const retained = entry.operationEvidence!;
            const report = nodeResults.find((result) => result.reportId === retained.reportId)!;
            const probe = async () => {
              rejectedRecoveryCalls += 1;
              const result =
                await owners.monitorRuntime.taskMonitorEffectHandlers.COORDINATE_TASK_MONITOR_WORK.execute(
                  {
                    type: 'COORDINATE_TASK_MONITOR_WORK',
                    taskMonitorId: monitorId,
                    organizationId: ORGANIZATION_ID,
                    projectId: PROJECT_ID,
                    kindKey: definition.kind,
                    executionPlan: context.executionPlan,
                    cursor: index,
                    cause: index === 0 ? 'RESUME' : 'JUDGMENT_RESOLVED',
                    correlationId: crypto.randomUUID(),
                    coordination: taskMonitorCoordinationLocalStateFromContext(
                      context,
                      'ACTIVE',
                      'COORDINATING',
                    ),
                    settledTurn: {
                      turnId: released.turnId,
                      promptType: released.promptType,
                      terminalOutcome: released.terminalOutcome,
                      completedAssistantMessage: null,
                      reports,
                    },
                  },
                  {
                    machineType: 'TASK_MONITOR',
                    instanceId: monitorId,
                    effectId: crypto.randomUUID(),
                  },
                );
              expect(result.status).toBe('failed');
              expect(definitions.get(monitorId)!.cursor).toBe(index);
              expect(statuses.get(session.nodeId)).toBe('BACKLOG');
            };
            // Recovery must reject absent, failed and other-session retained evidence.
            delete entry.operationEvidence;
            await probe();
            entry.operationEvidence = { ...retained, agentSessionId: crypto.randomUUID() };
            await probe();
            entry.operationEvidence = retained;
            const reportIndex = nodeResults.indexOf(report);
            nodeResults[reportIndex] = {
              ...report,
              payload: nodeResultPayload(session.nodeId, 'FAILED'),
            };
            await probe();
            nodeResults[reportIndex] = {
              ...report,
              payload: nodeResultPayload(crypto.randomUUID(), 'ACCEPTED'),
            };
            await probe();
            nodeResults[reportIndex] = report;
            definition.launchPolicy.terminalSupervision.mode = 'REQUIRE_REVIEW';
            await probe();
            definition.launchPolicy.terminalSupervision.mode = 'AGENT_DECIDES';
          }
          const command = firstStartCommand();
          command.commandId = crypto.randomUUID();
          command.target.workItemId = monitorId;
          if (index === 0 && !requireReview) {
            command.command = { cause: 'PAUSE' };
            expect(await adapter.admit(command)).toMatchObject({ status: 'ADMITTED' });
            await drainDurableTaskMonitorWork(runner);
            command.commandId = crypto.randomUUID();
            command.command = { cause: 'RESUME' };
          } else {
            command.command = {
              cause: 'JUDGMENT_RESOLVED',
              judgment: {
                requestMessageId: asMessageId(crypto.randomUUID()),
                label: 'Confirmed',
                conclusion: 'Accept the observed operation.',
              },
            };
          }
          expect(await adapter.admit(command)).toMatchObject({ status: 'ADMITTED' });
          await drainDurableTaskMonitorWork(runner);
        }
        const callsAfterAcceptance = coordinatorCalls.length;
        await settlement.invoke(released, auth);
        await drainDurableTaskMonitorWork(runner);
        expect(coordinatorCalls).toHaveLength(callsAfterAcceptance);
      }
      if (index === 0) {
        expect(starts).toHaveLength(4);
        expect(starts.slice(2)).toEqual(expect.arrayContaining([taskIds[1], directIds[1]]));
      }
    }
    for (const monitorId of [taskMonitorId, directMonitorId]) {
      expect((await store.findByInstanceId(monitorId))?.snapshot.state).toBe('COMPLETED');
      expect(monitorStatuses.get(monitorId)).toBe('COMPLETED');
    }
    expect(taskIds.map((id) => statuses.get(id))).toEqual(['COMPLETED', 'COMPLETED']);
    expect(directIds.map((id) => statuses.get(id))).toEqual(['BACKLOG', 'BACKLOG']);
    expect(mutations.filter(({ id }) => directIds.includes(id))).toEqual([]);
    expect(coordinatorCalls.filter((id) => id === taskMonitorId)).toHaveLength(
      supervision === 'COORDINATOR_REVIEW' && !requireReview ? 4 : 2,
    );
    expect(coordinatorCalls.filter((id) => id === directMonitorId)).toHaveLength(
      supervision === 'DIRECT_ACCEPTANCE' ? 0 : requireReview ? 10 : 8 + rejectedRecoveryCalls,
    );
    if (supervision === 'COORDINATOR_REVIEW') {
      for (const entry of definitions.get(directMonitorId)!.executionPlan) {
        expect(entry.operationEvidence).toMatchObject({
          agentSessionId: entry.agentSessionId,
          coordinatorRunId: directMonitorId,
        });
      }
    }
    await restore();
    expect(starts).toHaveLength(4);
    await owners.applicationLifecycle.dispose();
  },
);
