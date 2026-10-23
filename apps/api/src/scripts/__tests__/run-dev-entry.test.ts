import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('run-dev-entry', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'api-run-dev-entry-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('waits for a temporarily missing compiled entrypoint and starts it', async () => {
    const entryPath = path.join(directory, 'main.js');
    const runnerPath = path.resolve('scripts/run-dev-entry.js');
    const child = spawn(process.execPath, [runnerPath, entryPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk.toString()));
    child.stderr.on('data', (chunk) => (output += chunk.toString()));

    await new Promise((resolve) => setTimeout(resolve, 150));
    fs.writeFileSync(entryPath, "console.log('recovered dev app');\n");

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });

    expect(exitCode).toBe(0);
    expect(output).toContain('temporarily unavailable');
    expect(output).toContain('restarting the application');
    expect(output).toContain('recovered dev app');
  });

  it('waits for the JavaScript file when Nest provides an extensionless entrypoint', async () => {
    const entryPath = path.join(directory, 'main');
    const compiledEntryPath = `${entryPath}.js`;
    const runnerPath = path.resolve('scripts/run-dev-entry.js');
    const child = spawn(process.execPath, [runnerPath, entryPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk.toString()));
    child.stderr.on('data', (chunk) => (output += chunk.toString()));

    await new Promise((resolve) => setTimeout(resolve, 150));
    fs.writeFileSync(compiledEntryPath, "console.log('resolved Nest entrypoint');\n");

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });

    expect(exitCode).toBe(0);
    expect(output).toContain(`${compiledEntryPath} is temporarily unavailable`);
    expect(output).toContain('resolved Nest entrypoint');
  });

  it('does not restart an application failure while its entrypoint exists', async () => {
    const entryPath = path.join(directory, 'main.js');
    const runnerPath = path.resolve('scripts/run-dev-entry.js');
    fs.writeFileSync(entryPath, 'process.exitCode = 23;\n');

    const child = spawn(process.execPath, [runnerPath, entryPath], {
      stdio: 'ignore',
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });

    expect(exitCode).toBe(23);
  });
});
