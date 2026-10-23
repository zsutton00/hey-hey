import path from 'node:path';
import {
  TaskMonitorMachineDiagnosticReader,
  type TaskMonitorMachineDiagnosticView,
} from '../agents/task-monitor/state-machine/diagnostics';
import { taskMonitorStateStoreCodec } from '../agents/task-monitor/state-machine/machine';
import { resolveBaseDir } from '../session';
import { MachineStateStore } from '../state-machine';

export const MACHINE_HISTORY_USAGE = 'Usage: heyhey machine-history <machine-instance-id>';

export const runMachineHistoryCommand = async (
  args: readonly string[],
  dependencies: {
    readonly inspect?: (instanceId: string) => Promise<TaskMonitorMachineDiagnosticView | null>;
    readonly log?: (message: string) => void;
    readonly logError?: (message: string) => void;
  } = {},
): Promise<boolean> => {
  const [instanceId, ...extra] = args;
  const log = dependencies.log ?? console.log;
  const logError = dependencies.logError ?? console.error;
  if (!instanceId || extra.length > 0) {
    logError(MACHINE_HISTORY_USAGE);
    return false;
  }

  const view = dependencies.inspect
    ? await dependencies.inspect(instanceId)
    : await new TaskMonitorMachineDiagnosticReader(
        new MachineStateStore(
          path.join(resolveBaseDir(), 'state-machines', 'snapshots.json'),
          taskMonitorStateStoreCodec,
        ),
      ).inspect(instanceId);
  if (!view) {
    logError(`Machine instance ${instanceId} was not found.`);
    return false;
  }
  log(JSON.stringify(view, null, 2));
  return true;
};
