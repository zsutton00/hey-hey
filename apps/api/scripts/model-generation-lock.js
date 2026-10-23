const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const LOCK_FILE_NAME = path.join('.tmp', 'model-generation.lock');
const LOCK_TOKEN_ENV = 'HEY_HEY_MODEL_GENERATION_LOCK_TOKEN';
const LOCK_POLL_INTERVAL_MS = 250;
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..');

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const lockPathFor = (projectRoot) => path.join(projectRoot, LOCK_FILE_NAME);

const readOwner = (lockPath) => {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Unable to read model generation lock at ${lockPath}.`, {
      cause: error,
    });
  }
};

const processIsRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') {
      return false;
    }
    if (error && error.code === 'EPERM') {
      return true;
    }
    throw error;
  }
};

const isValidOwner = (owner) =>
  owner &&
  Number.isInteger(owner.pid) &&
  owner.pid > 0 &&
  typeof owner.token === 'string' &&
  owner.token.length > 0;

const reclaimStaleLock = (lockPath) => {
  const stalePath = `${lockPath}.${process.pid}.${randomUUID()}.stale`;
  try {
    fs.renameSync(lockPath, stalePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    if (error && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')) {
      return false;
    }
    throw error;
  }

  fs.rmSync(stalePath, { force: true });
  return true;
};

const tryAcquire = (lockPath, owner) => {
  try {
    const descriptor = fs.openSync(lockPath, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
    } finally {
      fs.closeSync(descriptor);
    }
    return true;
  } catch (error) {
    if (error && error.code !== 'EEXIST') {
      throw error;
    }
    return false;
  }
};

const acquireModelGenerationLock = async ({
  projectRoot = DEFAULT_PROJECT_ROOT,
  environment = process.env,
  pollIntervalMs = LOCK_POLL_INTERVAL_MS,
  sleep = delay,
  isRunning = processIsRunning,
  output = console.log,
} = {}) => {
  const lockPath = lockPathFor(projectRoot);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const inheritedToken = environment[LOCK_TOKEN_ENV];
  const owner = {
    pid: process.pid,
    token: inheritedToken || randomUUID(),
    command: process.argv.slice(1).join(' '),
    startedAt: new Date().toISOString(),
  };

  if (inheritedToken) {
    const currentOwner = readOwner(lockPath);
    if (currentOwner?.token === inheritedToken) {
      return {
        acquired: false,
        lockPath,
        token: inheritedToken,
        release: () => {},
      };
    }
  }

  let announcedWait = false;
  while (!tryAcquire(lockPath, owner)) {
    const currentOwner = readOwner(lockPath);
    if (
      currentOwner &&
      isValidOwner(currentOwner) &&
      !isRunning(currentOwner.pid)
    ) {
      if (reclaimStaleLock(lockPath)) {
        continue;
      }
      continue;
    }

    if (!announcedWait) {
      const ownerDescription = isValidOwner(currentOwner)
        ? ` (PID ${currentOwner.pid})`
        : '';
      output(
        `Waiting for another model generation to finish${ownerDescription}...`,
      );
      announcedWait = true;
    }
    await sleep(pollIntervalMs);
  }

  const release = () => {
    const currentOwner = readOwner(lockPath);
    if (currentOwner?.token === owner.token) {
      fs.rmSync(lockPath, { force: true });
    }
  };

  return { acquired: true, lockPath, token: owner.token, release };
};

const withModelGenerationLock = async (operation, options = {}) => {
  const lock = await acquireModelGenerationLock(options);
  try {
    const environment = {
      ...(options.environment || process.env),
      [LOCK_TOKEN_ENV]: lock.token,
    };
    return await operation({ ...lock, environment });
  } finally {
    lock.release();
  }
};

module.exports = {
  LOCK_FILE_NAME,
  LOCK_TOKEN_ENV,
  acquireModelGenerationLock,
  withModelGenerationLock,
};
