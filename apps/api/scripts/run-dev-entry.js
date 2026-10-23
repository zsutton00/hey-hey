const fs = require('node:fs');
const { spawn } = require('node:child_process');

const RETRY_DELAY_MS = 100;

let activeChild;
let shuttingDown = false;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getEntryPath(args) {
  const entryPath = args.find((arg) => !arg.startsWith('-'));
  if (!entryPath) {
    throw new Error('The Nest dev runner did not provide a compiled entrypoint');
  }

  // Nest passes an extensionless path (for example `dist/main`) because Node
  // resolves that to `dist/main.js`. The readiness check must watch the file
  // emitted by TypeScript rather than the extensionless argument.
  return fs.existsSync(entryPath) || entryPath.endsWith('.js')
    ? entryPath
    : `${entryPath}.js`;
}

async function waitForEntry(entryPath) {
  let reportedMissing = false;

  while (!shuttingDown && !fs.existsSync(entryPath)) {
    if (!reportedMissing) {
      console.warn(
        `[dev] ${entryPath} is temporarily unavailable; waiting for the build to finish...`,
      );
      reportedMissing = true;
    }
    await sleep(RETRY_DELAY_MS);
  }

  if (reportedMissing && !shuttingDown) {
    console.log(`[dev] ${entryPath} is available; restarting the application.`);
  }
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    activeChild = spawn(process.execPath, args, {
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

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    shuttingDown = true;
    if (activeChild) {
      activeChild.kill(signal);
    }
  });
}

async function main(args = process.argv.slice(2)) {
  const entryPath = getEntryPath(args);

  while (!shuttingDown) {
    await waitForEntry(entryPath);
    if (shuttingDown) return;

    const result = await runNode(args);
    if (shuttingDown) return;

    // A generator or clean build can remove dist after the existence check but
    // before Node opens the entrypoint. Recover only from that transient case;
    // real application failures retain their normal non-zero exit status.
    if (!fs.existsSync(entryPath)) {
      continue;
    }

    if (result.signal) {
      process.kill(process.pid, result.signal);
      return;
    }
    process.exitCode = result.code ?? 1;
    return;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { getEntryPath, main, waitForEntry };
