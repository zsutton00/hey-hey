import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

const root = resolve(__dirname, '../../..');
const script = readFileSync(
  resolve(root, 'scripts/migration-stack.sh'),
  'utf8',
);
const cleanup = script.slice(
  script.indexOf('prune_stack_images()'),
  script.indexOf('repositories_root='),
);

function run(command: string, failCompose = false) {
  return execFileSync(
    'bash',
    [
      '-ec',
      `
      safe_name=migration-one
      command=${command}
      confirmed=true
      docker() { printf '%s\\n' "$*"; }
      ${cleanup}
      require_bootstrap() { :; }
      require_sources() { :; }
      ensure_persistent_volumes() { :; }
      wait_for_web() { :; }
      print_endpoints() { :; }
      readiness_timeout=600
      mock_compose() {
        printf 'compose %s\\n' "$*"
        ${failCompose ? 'return 1' : ':'}
      }
      compose=(mock_compose)
      ${script.slice(script.lastIndexOf('case "$command" in'))}
      `,
    ],
    { encoding: 'utf8' },
  );
}

describe('migration stack image cleanup', () => {
  it.each(['up', 'down', 'reset', 'prune'])(
    '%s prunes unused images only for the named stack',
    (command) => {
      const output = run(command);
      expect(output).toContain(
        'image prune --force --all --filter label=com.heyhey.migration-stack=heyhey-migration-one',
      );
      if (command !== 'prune') {
        expect(output.lastIndexOf('image prune')).toBeGreaterThan(
          output.lastIndexOf('compose '),
        );
      } else {
        expect(output).not.toContain('compose ');
      }
    },
  );

  it('prepare preserves the newly built tagged images', () => {
    expect(run('prepare')).toBe(
      'compose build\nimage prune --force --filter label=com.heyhey.migration-stack=heyhey-migration-one\n',
    );
  });

  it('does not prune after a failed build/start', () => {
    try {
      run('up', true);
      throw new Error('Expected compose to fail');
    } catch (error) {
      expect((error as { stdout: string }).stdout).toBe(
        'compose up --detach --build --wait --wait-timeout 600\n',
      );
    }
  });

  it('labels every built application image for scoped cleanup', () => {
    const compose = load(
      readFileSync(resolve(root, 'docker-compose.migration-stack.yml'), 'utf8'),
    ) as {
      services: Record<string, { build?: { labels: Record<string, string> } }>;
    };
    const builds = Object.values(compose.services).filter(
      (service) => service.build,
    );
    expect(builds).toHaveLength(4);
    for (const service of builds) {
      expect(service.build!.labels['com.heyhey.migration-stack']).toBe(
        '${COMPOSE_PROJECT_NAME}',
      );
    }
  });
});
