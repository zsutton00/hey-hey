import { describe, expect, it } from 'vitest';
import { JsonLineProcess, ProviderNotInstalledError } from './provider-process';

const run = (script: string): JsonLineProcess =>
  new JsonLineProcess('Fake', process.execPath, ['-e', script], {
    cwd: process.cwd(),
    env: process.env,
  });

describe('JsonLineProcess', () => {
  it('reports a missing executable as not installed', async () => {
    const missing = new JsonLineProcess('Fake', 'hey-hey-no-such-provider-binary', [], {
      cwd: process.cwd(),
      env: process.env,
    });
    const answer = missing.expect('anything', () => true, 5_000);
    missing.send({ hello: 'world' });

    await expect(answer).rejects.toEqual(
      new ProviderNotInstalledError('Fake', 'hey-hey-no-such-provider-binary'),
    );
    await missing.dispose();
  });

  it('resolves the first message the caller accepts', async () => {
    const echo = run(
      "process.stdin.on('data', (d) => { const m = JSON.parse(d.toString()); console.log(JSON.stringify({ noise: true })); console.log(JSON.stringify({ id: m.id, ok: true })); });",
    );
    const answer = echo.expect('the echo', (m) => (m as { id?: number }).id === 7, 5_000);
    echo.send({ id: 7 });

    await expect(answer).resolves.toEqual({ id: 7, ok: true });
    await echo.dispose();
  });

  it('fails with the provider output when it exits before answering', async () => {
    const dying = run("console.error('boom: not signed in'); process.exit(3);");
    const answer = dying.expect('an answer', () => true, 5_000);

    await expect(answer).rejects.toThrow(
      /Fake exited before reporting its models \(code=3.*boom: not signed in/s,
    );
    await dying.dispose();
  });

  it('fails when the provider writes something that is not JSON', async () => {
    const noisy = run("console.log('this is not json'); setInterval(() => undefined, 1000);");
    const answer = noisy.expect('an answer', () => true, 5_000);

    await expect(answer).rejects.toThrow('Fake wrote a line that was not JSON: this is not json');
    await noisy.dispose();
  });

  it('times out when the provider never answers', async () => {
    const silent = run('setInterval(() => undefined, 1000);');

    await expect(silent.expect('the request', () => true, 50)).rejects.toThrow(
      'Fake did not answer the request within 50ms.',
    );
    await silent.dispose();
  });
});
