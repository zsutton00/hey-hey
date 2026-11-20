import { createInterface } from 'node:readline/promises';
import { LOCAL_RESET_CONFIRMATION, LocalReset } from '../src/local-app/local-reset';
import { devWorkspace, installedWorkspace } from '../src/local-app/local-workspace';

const terminal = createInterface({ input: process.stdin, output: process.stdout });

/** Resets the installed `heyhey local` and the `heyhey local dev` workspace under one confirmation. */
async function reset() {
  const answer = (await terminal.question('Clear dedicated local CLI credentials too? [y/N] '))
    .trim()
    .toLowerCase();
  if (!['', 'n', 'no', 'y', 'yes'].includes(answer)) {
    throw new Error('Unrecognized credential choice.');
  }
  const clearCredentials = ['y', 'yes'].includes(answer);

  const steps = [];
  for (const workspace of [installedWorkspace(), devWorkspace()]) {
    const reset = new LocalReset('installation', clearCredentials, workspace);
    const plan = await reset.plan();
    reset.describe(plan).forEach((line) => console.log(line));
    steps.push({ reset, plan });
  }

  const confirmation = await terminal.question(
    `Type ${LOCAL_RESET_CONFIRMATION} to erase the listed targets: `,
  );
  if (confirmation !== LOCAL_RESET_CONFIRMATION) {
    console.log('Cancelled.');
    return;
  }
  for (const { reset, plan } of steps) {
    await reset.apply(plan);
  }
}

reset()
  .catch((error) => {
    console.error('Reset stopped.', error.message, 'Rerun to list remaining targets and retry.');
    process.exitCode = 1;
  })
  .finally(() => terminal.close());
