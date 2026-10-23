const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_FORCE_TIMEOUT_MS = 2_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const API_PORT = 3000;

function readLockOwner(lockPath, fileSystem = fs) {
  const contents = fileSystem.readFileSync(lockPath, 'utf8');
  const owner = JSON.parse(contents);
  if (!Number.isInteger(owner.pid) || owner.pid <= 0) {
    throw new Error(`Invalid API dev lock at ${lockPath}`);
  }
  return owner;
}

function processIsRunning(pid, signal = process.kill) {
  try {
    signal(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function readProcessCommand(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    if (error.status === 1) return '';
    throw error;
  }
}

function readDescendantPids(rootPid) {
  const output = execFileSync('ps', ['-axo', 'pid=,ppid='], {
    encoding: 'utf8',
  });
  const childrenByParent = new Map();
  for (const line of output.split('\n')) {
    const [rawPid, rawParentPid] = line.trim().split(/\s+/);
    const pid = Number(rawPid);
    const parentPid = Number(rawParentPid);
    if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) continue;
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }

  const descendants = [];
  const pending = [...(childrenByParent.get(rootPid) ?? [])];
  while (pending.length) {
    const pid = pending.shift();
    descendants.push(pid);
    pending.push(...(childrenByParent.get(pid) ?? []));
  }
  return descendants.reverse();
}

function readListeningPids(port = API_PORT) {
  let output;
  try {
    output = execFileSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }

  return [
    ...new Set(
      output
        .split('\n')
        .map((value) => Number(value.trim()))
        .filter((pid) => Number.isInteger(pid) && pid > 0),
    ),
  ];
}

function signalIfRunning(pid, signalName, sendSignal = process.kill) {
  try {
    sendSignal(pid, signalName);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function removeMatchingLock(lockPath, expectedPid, fileSystem = fs) {
  try {
    const owner = readLockOwner(lockPath, fileSystem);
    if (owner.pid === expectedPid) fileSystem.unlinkSync(lockPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForExit(
  pid,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    isRunning = processIsRunning,
    sleep = delay,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (isRunning(pid)) {
    if (Date.now() >= deadline) return false;
    await sleep(pollIntervalMs);
  }
  return true;
}

async function stopDevServer({
  cwd = process.cwd(),
  fileSystem = fs,
  getProcessCommand = readProcessCommand,
  getDescendantPids = readDescendantPids,
  getListeningPids = readListeningPids,
  isRunning = processIsRunning,
  sendSignal = process.kill,
  sleep = delay,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  forceTimeoutMs = DEFAULT_FORCE_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  output = console.log,
} = {}) {
  const lockPath = path.join(cwd, '.tmp', 'api-dev.pid.lock');
  const targetPids = new Set(getListeningPids(API_PORT));
  let lockOwnerPid;
  try {
    const owner = readLockOwner(lockPath, fileSystem);
    if (owner.cwd && path.resolve(owner.cwd) !== path.resolve(cwd)) {
      removeMatchingLock(lockPath, owner.pid, fileSystem);
      output(`Removed stale API dev lock owned by another checkout.`);
    } else if (!isRunning(owner.pid)) {
      removeMatchingLock(lockPath, owner.pid, fileSystem);
      output(`Removed stale API dev lock for stopped process ${owner.pid}.`);
    } else {
      const command = getProcessCommand(owner.pid);
      if (!command.includes('scripts/run-dev.js')) {
        removeMatchingLock(lockPath, owner.pid, fileSystem);
        output(
          `Removed stale API dev lock whose PID was reused by another process.`,
        );
      } else {
        lockOwnerPid = owner.pid;
        targetPids.add(owner.pid);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (targetPids.size === 0) {
    output(`No process is listening on port ${API_PORT}.`);
    return 'not-running';
  }

  const pids = [...targetPids];
  output(
    `Stopping process${pids.length === 1 ? '' : 'es'} ${pids.join(', ')}...`,
  );
  for (const pid of pids) signalIfRunning(pid, 'SIGTERM', sendSignal);

  let runningPids = [];
  for (const pid of pids) {
    const stopped = await waitForExit(pid, {
      timeoutMs,
      pollIntervalMs,
      isRunning,
      sleep,
    });
    if (!stopped) runningPids.push(pid);
  }
  if (runningPids.length > 0) {
    output(
      `Process${runningPids.length === 1 ? '' : 'es'} ${runningPids.join(', ')} did not exit gracefully; forcing shutdown...`,
    );
    for (const pid of runningPids) {
      for (const descendantPid of getDescendantPids(pid)) {
        signalIfRunning(descendantPid, 'SIGKILL', sendSignal);
      }
      signalIfRunning(pid, 'SIGKILL', sendSignal);
    }
    const stillRunning = [];
    for (const pid of runningPids) {
      const stopped = await waitForExit(pid, {
        timeoutMs: forceTimeoutMs,
        pollIntervalMs,
        isRunning,
        sleep,
      });
      if (!stopped) stillRunning.push(pid);
    }
    runningPids = stillRunning;
  }
  if (runningPids.length > 0) {
    throw new Error(
      `Process${runningPids.length === 1 ? '' : 'es'} ${runningPids.join(', ')} remained alive after forced shutdown.`,
    );
  }

  if (lockOwnerPid) removeMatchingLock(lockPath, lockOwnerPid, fileSystem);
  output(`Port ${API_PORT} is clear.`);
  return 'stopped';
}

if (require.main === module) {
  stopDevServer().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  processIsRunning,
  readDescendantPids,
  readListeningPids,
  readLockOwner,
  removeMatchingLock,
  stopDevServer,
  waitForExit,
};
