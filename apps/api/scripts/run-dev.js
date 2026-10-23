const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const lockPath = path.join(process.cwd(), '.tmp', 'api-dev.pid.lock');
const owner = {
  pid: process.pid,
  startedAt: new Date().toISOString(),
  cwd: process.cwd(),
};

let activeChild;
let shuttingDown = false;

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') {
      return false;
    }

    if (error.code === 'EPERM') {
      return true;
    }

    throw error;
  }
}

function readLockOwner() {
  const contents = fs.readFileSync(lockPath, 'utf8');
  const lockOwner = JSON.parse(contents);

  if (!Number.isInteger(lockOwner.pid) || lockOwner.pid <= 0) {
    throw new Error(`Invalid API dev lock at ${lockPath}`);
  }

  return lockOwner;
}

function acquireLock() {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  while (true) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify(owner, null, 2)}\n`);
      } finally {
        fs.closeSync(descriptor);
      }
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      const lockOwner = readLockOwner();
      if (processIsRunning(lockOwner.pid)) {
        throw new Error(
          `API dev server is already running for this checkout ` +
            `(PID ${lockOwner.pid}, started ${lockOwner.startedAt ?? 'unknown'}).\n` +
            `Stop that process before running pnpm dev again.\n` +
            `Lock: ${lockPath}`,
        );
      }

      fs.unlinkSync(lockPath);
    }
  }
}

function releaseLock() {
  try {
    const lockOwner = readLockOwner();
    if (lockOwner.pid === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Failed to release API dev lock: ${error.message}`);
    }
  }
}

function runPnpm(args) {
  const pnpmScript = process.env.npm_execpath;
  if (!pnpmScript) {
    throw new Error('npm_execpath is not set; run this command through pnpm dev');
  }

  return new Promise((resolve, reject) => {
    activeChild = spawn(pnpmScript, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    activeChild.once('error', reject);
    activeChild.once('exit', (code, signal) => {
      activeChild = undefined;
      resolve({ code, signal });
    });
  });
}

async function runStep(args) {
  const result = await runPnpm(args);
  if (result.code !== 0) {
    const detail = result.signal
      ? `terminated by ${result.signal}`
      : `exited with code ${result.code}`;
    throw new Error(`pnpm ${args.join(' ')} ${detail}`);
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    if (activeChild) {
      activeChild.kill(signal);
    } else {
      process.exitCode = 1;
    }
  });
}

process.on('exit', releaseLock);

async function main() {
  acquireLock();
  await runStep(['run', 'clean']);
  await runStep(['prisma', 'generate']);
  await runStep([
    'exec',
    'nest',
    'start',
    '--watch',
    '--exec',
    'node scripts/run-dev-entry.js',
  ]);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
