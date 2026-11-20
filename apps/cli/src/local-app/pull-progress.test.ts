import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DockerProcess, DockerProcessError } from './docker-process';
import { describeDownload, PullProgressAggregator } from './pull-progress';
import { DockerBoundary } from './docker-boundary';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// Captured from `docker compose --progress json pull` (Compose 5.7.1) of two real images.
const captured = readFileSync(
  join(__dirname, '__fixtures__/compose-pull-progress-json.ndjson'),
  'utf8',
)
  .trim()
  .split('\n');

describe('combined image pull progress', () => {
  it('shows measured bytes and layer activity, and no percentage, while layers are unmeasured', () => {
    const aggregator = new PullProgressAggregator('json');
    for (const line of captured) {
      aggregator.feed(line);
    }
    const final = aggregator.detail();

    // Several real layers complete without ever reporting a size.
    expect(final.layersDone).toBe(final.layersTotal);
    expect(final.bytesTotal).toBeNull();
    expect(final.percent).toBeNull();
    expect(final.bytesDone).toBeGreaterThan(0);
    expect(aggregator.unrecognizedLines).toBe(0);
    expect(describeDownload('Downloading application images', final, 0)).toMatch(
      /MB downloaded · \d+ of \d+ layers done/u,
    );
  });

  it('does not present an exact total while some layers are measured and others are not', () => {
    const aggregator = new PullProgressAggregator('json');
    const event = (id: string, text: string, extra = '') =>
      aggregator.feed(
        `{"id":"${id}","parent_id":"Image x","status":"Working","text":"${text}"${extra}}`,
      );
    event('aaaaaaaaaaaa', 'Downloading', ',"current":5000000,"total":10000000');
    event('bbbbbbbbbbbb', 'Download complete');
    const intermediate = aggregator.detail();

    expect(intermediate).toMatchObject({
      layersDone: 1,
      layersTotal: 2,
      bytesTotal: null,
      percent: null,
    });
    expect(describeDownload('Downloading application images', intermediate, 0)).not.toContain('%');

    event('bbbbbbbbbbbb', 'Downloading', ',"current":1000,"total":1000');
    expect(aggregator.detail()).toMatchObject({ percent: 50 });
  });

  it('counts layers Docker already has as downloaded', () => {
    const aggregator = new PullProgressAggregator('json');
    aggregator.feed(
      '{"id":"aaaaaaaaaaaa","parent_id":"Image x","status":"Done","text":"Already exists"}',
    );
    expect(aggregator.detail()).toMatchObject({ layersDone: 1, layersTotal: 1 });
  });

  it('degrades to activity without a percentage when output cannot be read', () => {
    const aggregator = new PullProgressAggregator('json');
    aggregator.feed('something Docker changed');
    aggregator.feed('{"unexpected":true}');
    const detail = aggregator.detail();

    expect(aggregator.unrecognizedLines).toBe(2);
    expect(detail.percent).toBeNull();
    expect(describeDownload('Downloading application images', detail, 3000)).not.toContain('%');
  });

  it('reads per-layer text lines from Compose versions without JSON progress', () => {
    const aggregator = new PullProgressAggregator('text');
    aggregator.feed('0ba3a3e89cd9 Downloading [==>   ]  1.049MB/12.06MB');
    aggregator.feed('6e771e15690e Already exists');

    expect(aggregator.detail()).toMatchObject({
      layersDone: 1,
      layersTotal: 2,
      bytesTotal: 12060000,
    });
  });
});

describe('streamed process output', () => {
  const script = (body: string) => ['node', ['-e', body]] as const;

  it('never emits a secret split across chunks', async () => {
    const secret = 'abcdef123456ghij';
    const process_ = new DockerProcess({ ...process.env, REGISTRY_TOKEN: secret });
    const lines: string[] = [];
    const [binary, args] = script(
      `process.stdout.write('pull ${secret.slice(0, 7)}');setTimeout(()=>process.stdout.write('${secret.slice(7)} done\\n'),60)`,
    );

    await process_.run(binary, [...args], 'test', undefined, undefined, 10_000, (line) => {
      lines.push(line);
      return false;
    });

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(secret.slice(0, 7));
    expect(lines.join('\n')).not.toContain(secret.slice(7));
  });

  it('still reports a failed process with the same sanitized failure', async () => {
    const [binary, args] = script(`console.error('boom');process.exit(3)`);
    const failure = await new DockerProcess()
      .run(binary, [...args], 'compose.pull', undefined, undefined, 10_000, () => false)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DockerProcessError);
    expect((failure as DockerProcessError).diagnostic).toMatchObject({
      operation: 'compose.pull',
      exitCode: 3,
      detail: 'boom',
    });
  });
});

describe('failure cause during a pull', () => {
  it('keeps the final error after a realistic volume of progress output', async () => {
    const fixture = join(__dirname, '__fixtures__/compose-pull-progress-json.ndjson');
    const aggregator = new PullProgressAggregator('json');
    const failure = await new DockerProcess()
      .run(
        'node',
        [
          '-e',
          `process.stderr.write(require('fs').readFileSync(${JSON.stringify(fixture)}, 'utf8').repeat(40));process.stderr.write('pull access denied for example/app\\n');process.exitCode=1`,
        ],
        'compose.pull',
        undefined,
        undefined,
        20_000,
        (line) => aggregator.feed(line),
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DockerProcessError);
    const { detail } = (failure as DockerProcessError).diagnostic;
    expect(detail).toContain('pull access denied for example/app');
    expect(detail).not.toContain('Pulling fs layer');
  });
});

describe('progress mode selection', () => {
  async function fakeDocker(rejectJson: boolean) {
    const directory = await mkdtemp(join(tmpdir(), 'heyhey-fake-docker-'));
    const log = join(directory, 'calls.log');
    await writeFile(
      join(directory, 'docker'),
      `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in *"--progress json"*)
  if [ -n "$REJECT_JSON" ]; then echo "unsupported progress writer: json" >&2; exit 1; fi;;
esac
case "$*" in *" pull"*)
  case "$*" in
    *"--progress json"*) echo '{"id":"aaaaaaaaaaaa","parent_id":"Image x","status":"Working","text":"Downloading","current":5,"total":10}' >&2;;
    *) echo 'aaaaaaaaaaaa Downloading [==>] 5B/10B';;
  esac;;
esac
exit 0
`,
    );
    await chmod(join(directory, 'docker'), 0o755);
    const docker = new DockerBoundary(
      undefined,
      new DockerProcess({
        PATH: `${directory}:${process.env['PATH'] ?? ''}`,
        DOCKER_HOST: 'unix:///fake.sock',
        ...(rejectJson ? { REJECT_JSON: '1' } : {}),
      }),
    );
    return { docker, calls: async () => (await readFile(log, 'utf8')).trim().split('\n') };
  }

  it.each([
    [false, true],
    [true, false],
  ])(
    'completes the pull when the installed Compose rejects json=%s',
    async (rejectJson, usesJson) => {
      const { docker, calls } = await fakeDocker(rejectJson);
      const details: unknown[] = [];

      await docker.pull('/tmp/compose.json', (detail) => details.push(detail));

      const pull = (await calls()).filter((call) => call.endsWith(' pull'));
      expect(pull).toHaveLength(1);
      expect(pull[0]?.includes('--progress json')).toBe(usesJson);
      expect(details.at(-1)).toMatchObject({ layersTotal: 1, bytesDone: 5, bytesTotal: 10 });
    },
  );
});
