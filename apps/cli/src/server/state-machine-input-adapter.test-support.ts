import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createTaskMonitorDefinition,
  taskMonitorStateStoreCodec,
  type TaskMonitorMachineRegistry,
  type TaskMonitorMachineRuntime,
  type TaskMonitorStateStore,
} from '../agents/task-monitor/state-machine/machine';
import { MachineRegistry, MachineRuntime, MachineStateStore } from '../state-machine';
import { NOOP_LOGGER, type ServerLogger } from './logger';
import {
  AddressedMachineAdmission,
  TaskMonitorStateMachineInputAdapter,
} from './state-machine-input-adapter';

export const createTestTaskMonitorStateMachineInputAdapter = (
  logger: ServerLogger = NOOP_LOGGER,
): TaskMonitorStateMachineInputAdapter => {
  const store: TaskMonitorStateStore = new MachineStateStore(
    path.join(tmpdir(), `hey-hey-test-state-machines-${randomUUID()}.json`),
    taskMonitorStateStoreCodec,
  );
  const runtime: TaskMonitorMachineRuntime = new MachineRuntime(store, logger);
  const registry: TaskMonitorMachineRegistry = new MachineRegistry(runtime, logger);
  registry.register(createTaskMonitorDefinition());
  return new TaskMonitorStateMachineInputAdapter(
    new AddressedMachineAdmission(registry, logger),
    logger,
    store,
  );
};
