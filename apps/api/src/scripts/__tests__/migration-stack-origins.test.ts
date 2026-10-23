import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { load } from 'js-yaml';

describe('migration stack browser origins', () => {
  const root = resolve(__dirname, '../../..');
  const script = readFileSync(
    resolve(root, 'scripts/migration-stack.sh'),
    'utf8',
  );
  const compose = load(
    readFileSync(resolve(root, 'docker-compose.migration-stack.yml'), 'utf8'),
  ) as { services: Record<'api' | 'ui', { environment: Record<string, string> }> };

  it.each(['dev', 'migration-one', 'migration-two', 'collab'])(
    'uses the same host for %s UI, API, CORS and WebAuthn',
    (name) => {
      const hostname = execFileSync(
        'bash',
        [
          '-ec',
          script.slice(
            script.indexOf('safe_name='),
            script.indexOf('repositories_root='),
          ) + '\nprintf "%s" "$STACK_HOSTNAME"',
        ],
        { env: { ...process.env, stack_name: name }, encoding: 'utf8' },
      );
      expect(hostname).toBe(`${name}.localhost`);
      const values: Record<string, string> = {
        STACK_HOSTNAME: hostname,
        STACK_API_PORT: '46293',
        STACK_UI_PORT: '34229',
        STACK_CLI_PORT: '45321',
      };
      const expand = (value: string | undefined) =>
        value!.replace(
          /\$\{(\w+)(?::\?[^}]*)?\}/g,
          (_, key: string) => values[key]!,
        );
      const api = compose.services.api.environment;
      const ui = compose.services.ui.environment;
      expect(expand(ui.API_HOST)).toBe(hostname);
      expect(expand(ui.VITE_LOCAL_AGENT_PORT)).toBe('45321');
      for (const key of ['API_BASE_URL', 'WEBHOOK_BASE_URL']) {
        expect(expand(api[key])).toBe(`http://${hostname}:46293`);
      }
      for (const key of [
        'WEB_APP_URL',
        'FRONTEND_URL',
        'APP_BASE_URL',
        'MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN',
      ]) {
        expect(expand(api[key])).toBe(`http://${hostname}:34229`);
      }
      expect(expand(api.CORS_WHITELIST).split(',')).toContain(
        `http://${hostname}:34229`,
      );
      expect(expand(api.MACHINE_ENROLLMENT_WEBAUTHN_RP_ID)).toBe(hostname);
    },
  );
});
