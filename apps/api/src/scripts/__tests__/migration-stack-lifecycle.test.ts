import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const script = resolve(__dirname, '../../../scripts/migration-stack.sh');
const checksum = 'a'.repeat(64);

// A recording stand-in for the Docker CLI: containers and volumes exist
// unless a test removes them, and every call is appended to a log.
const fakeDocker = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$FAKE_DOCKER_LOG"
case "$1" in
  ps)
    if [[ "$*" == *service=api* && "$*" == *status=running* ]]; then
      [[ -n "\${FAKE_API_RUNNING:-}" ]] && echo api-container
    else
      [[ -z "\${FAKE_NO_CONTAINERS:-}" ]] && echo container-id
    fi
    ;;
  volume) [[ "$2" == inspect && "$3" == *"\${FAKE_MISSING_VOLUME:-__none__}" ]] && exit 1 ;;
esac
exit 0
`;

interface Fixture {
  root: string;
  apiRoot: string;
  stateRoot: string;
  stackDir: string;
  log: string;
  run: (
    args: string[],
    env?: Record<string, string>,
  ) => ReturnType<typeof spawnSync>;
  calls: () => string[];
}

function createFixture(options: { runtime: boolean }): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'mstack-lifecycle-'));
  const apiRoot = join(root, 'api');
  const stateRoot = join(root, 'state');
  const bin = join(root, 'bin');
  const stackDir = join(apiRoot, '.tmp/migration-stack/evals');
  const log = join(root, 'docker.log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(stateRoot, 'bootstrap'), { recursive: true });
  mkdirSync(apiRoot, { recursive: true });
  writeFileSync(log, '');
  writeFileSync(join(bin, 'docker'), fakeDocker);
  writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(bin, 'docker'), 0o755);
  chmodSync(join(bin, 'curl'), 0o755);
  writeFileSync(
    join(stateRoot, 'bootstrap/metadata.txt'),
    `created_at=now\nsource=test\nsha256=${checksum}\n`,
  );
  if (options.runtime) {
    mkdirSync(stackDir, { recursive: true });
    writeFileSync(
      join(stackDir, 'runtime.env'),
      [
        'COMPOSE_PROJECT_NAME=heyhey-evals',
        'STACK_API_PORT=3000',
        'STACK_UI_PORT=5173',
        'STACK_GRAPH_PORT=8081',
        'STACK_EMBEDDINGS_PORT=5005',
        'STACK_TEMPORAL_UI_PORT=8080',
        'STACK_NEO4J_HTTP_PORT=7474',
        'STACK_NEO4J_BOLT_PORT=7687',
        'STACK_VESPA_PORT=8082',
        'STACK_CLI_PORT=4000',
        'STACK_MACHINE_ENROLLMENT_CODE_HMAC_KEY=key',
        'STACK_TRIGGER_SIGNING_PRIVATE_KEY=not-a-hex-key',
        '',
      ].join('\n'),
    );
  }
  return {
    root,
    apiRoot,
    stateRoot,
    stackDir,
    log,
    run: (args, env = {}) =>
      spawnSync(
        'bash',
        [script, '--api-root', apiRoot, ...args, '--name', 'evals'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            HEY_HEY_MIGRATION_STATE_ROOT: stateRoot,
            FAKE_DOCKER_LOG: log,
            ...env,
          },
        },
      ),
    calls: () =>
      readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== ''),
  };
}

describe('migration stack stop and resume', () => {
  const fixtures: Fixture[] = [];
  const create = (options: { runtime: boolean }) => {
    const fixture = createFixture(options);
    fixtures.push(fixture);
    return fixture;
  };

  afterEach(() => {
    while (fixtures.length > 0) {
      rmSync(fixtures.pop()!.root, { recursive: true, force: true });
    }
  });

  it('stop keeps volumes, configuration and the provisioned record', () => {
    const fixture = create({ runtime: true });

    const result = fixture.run(['stop']);

    expect(result.status).toBe(0);
    expect(fixture.calls()).toEqual([
      expect.stringMatching(/^compose .* stop$/),
    ]);
    expect(existsSync(join(fixture.stackDir, 'runtime.env'))).toBe(true);
    expect(fixture.calls().join('\n')).not.toMatch(/down|--volumes|volume rm/);
  });

  it('resume restarts the existing stack without bootstrap, import or rebuild', () => {
    const fixture = create({ runtime: true });
    expect(fixture.run(['mark-provisioned', '--replay-completed']).status).toBe(
      0,
    );
    const record = readFileSync(
      join(fixture.stackDir, 'provisioned.env'),
      'utf8',
    );
    expect(record).toContain(`bootstrap_sha256=${checksum}`);
    expect(record).toContain('replay_completed=true');

    const result = fixture.run(['resume']);

    expect(result.status).toBe(0);
    const composeCalls = fixture.calls().filter((c) => c.startsWith('compose'));
    expect(composeCalls).toHaveLength(3);
    for (const call of composeCalls) {
      expect(call).toContain('up --detach --no-deps --no-recreate --wait');
    }
    const started = composeCalls.join(' ');
    for (const oneShot of [
      'postgres-bootstrap',
      'flyway',
      'postgres-data-import',
      'neo4j-identity-seed',
      'vespa-deploy',
      'vespa-app-sync',
    ]) {
      expect(started).not.toContain(oneShot);
    }
    expect(started).not.toMatch(/--build|--force-recreate|--volumes| down /);
  });

  it('resume refuses a stack that was never provisioned and changes nothing', () => {
    const fixture = create({ runtime: true });

    const result = fixture.run(['resume']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('never marked provisioned');
    expect(fixture.calls().filter((c) => c.startsWith('compose'))).toEqual([]);
  });

  it('resume refuses a stack whose bootstrap changed', () => {
    const fixture = create({ runtime: true });
    fixture.run(['mark-provisioned']);
    writeFileSync(
      join(fixture.stateRoot, 'bootstrap/metadata.txt'),
      `sha256=${'b'.repeat(64)}\n`,
    );

    const result = fixture.run(['resume']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('bootstrap behind');
    expect(fixture.calls().filter((c) => c.startsWith('compose'))).toEqual([]);
  });

  it.each([
    ['containers', { FAKE_NO_CONTAINERS: '1' }, 'container'],
    ['a data volume', { FAKE_MISSING_VOLUME: 'neo4j-data' }, 'is missing'],
  ])('resume refuses when %s are missing', (_label, env, message) => {
    const fixture = create({ runtime: true });
    fixture.run(['mark-provisioned']);

    const result = fixture.run(['resume'], env);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(fixture.calls().filter((c) => c.startsWith('compose'))).toEqual([]);
  });

  it.each(['stop', 'resume', 'mark-provisioned'])(
    '%s on a missing stack creates nothing',
    (command) => {
      const fixture = create({ runtime: false });

      const result = fixture.run([command]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('nothing was changed');
      expect(existsSync(join(fixture.apiRoot, '.tmp'))).toBe(false);
      expect(fixture.calls()).toEqual([]);
    },
  );

  it('destroy still removes the stack volumes and state', () => {
    const fixture = create({ runtime: true });
    fixture.run(['mark-provisioned']);

    const result = fixture.run(['destroy']);

    expect(result.status).toBe(0);
    expect(fixture.calls().join('\n')).toMatch(
      /down --remove-orphans --volumes/,
    );
    expect(existsSync(fixture.stackDir)).toBe(false);
  });

  describe('provisioning and the one-time rebuild', () => {
    it('provision starts only stores and consumers, and creates the API without starting it', () => {
      const fixture = create({ runtime: true });
      const sources = [
        'api/Dockerfile',
        'graphs/pom.xml',
        'api/docker/migration-stack/embeddings.Dockerfile',
        'embeddings/requirements.txt',
        'embeddings/constraints.txt',
        'embeddings/generated/openapi-models/setup.py',
        'embeddings/generated/openapi-events-models/setup.py',
        'ui/Dockerfile',
        'ui-common/package.json',
        'openapi/specs/api/openapi.yaml',
        'openapi/specs/graphs/openapi.yaml',
      ];
      for (const source of sources) {
        const file = join(fixture.root, source);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, '');
      }
      writeFileSync(join(fixture.stateRoot, 'bootstrap/application.dump'), '');

      const result = fixture.run(['provision']);

      expect(result.status).toBe(0);
      const composeCalls = fixture
        .calls()
        .filter((c) => c.startsWith('compose'));
      const started = composeCalls.find((c) => c.includes(' up '))!;
      expect(started).toMatch(
        /postgres redis neo4j vespa postgres-data-import graph-service embeddings$/,
      );
      const created = composeCalls.find((c) => c.includes(' create '))!;
      expect(created).toMatch(/create --build api ui temporal temporal-ui$/);
      expect(composeCalls).toHaveLength(2);
    });

    it('replay runs the one-shot with the API stopped and passes its options', () => {
      const fixture = create({ runtime: true });

      const result = fixture.run(['replay', '--dry-run', '--skip', '1000']);

      expect(result.status).toBe(0);
      const composeCalls = fixture
        .calls()
        .filter((c) => c.startsWith('compose'));
      expect(composeCalls).toHaveLength(1);
      expect(composeCalls[0]).toMatch(
        /run --rm --no-deps -T event-replay --dry-run --skip 1000$/,
      );
    });

    it('replay refuses while the API is running', () => {
      const fixture = create({ runtime: true });

      const result = fixture.run(['replay'], { FAKE_API_RUNNING: '1' });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('API');
      expect(fixture.calls().filter((c) => c.startsWith('compose'))).toEqual(
        [],
      );
    });

    it('replay refuses after the rebuild is recorded as completed', () => {
      const fixture = create({ runtime: true });
      fixture.run(['mark-provisioned', '--replay-completed']);

      const result = fixture.run(['replay']);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('runs once');
      expect(fixture.calls().filter((c) => c.startsWith('compose'))).toEqual(
        [],
      );
    });

    it('replay on a missing stack creates nothing', () => {
      const fixture = create({ runtime: false });

      expect(fixture.run(['replay']).status).not.toBe(0);
      expect(existsSync(join(fixture.apiRoot, '.tmp'))).toBe(false);
    });
  });

  it('rejects provisioning options on other commands', () => {
    const fixture = create({ runtime: true });

    expect(fixture.run(['stop', '--replay-completed']).status).toBe(2);
  });
});
