import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const collector = new URL(
  '../collect-staging-api-evidence.mjs',
  import.meta.url,
).href;
function preflight(environment, labelEnvironment = environment) {
  const root = mkdtempSync(join(tmpdir(), 'evidence-environment-'));
  try {
    const token = join(root, 'token');
    writeFileSync(token, 'test-viewer-token');
    const source = `
      process.argv[2] = 'preflight';
      globalThis.fetch = async (url, options) => {
        if (options.headers.Authorization !== 'Bearer test-viewer-token') throw Error('Wrong credential');
        console.log(String(url));
        const path = url.pathname;
        let result;
        if (path.endsWith('/api/datasources')) result = [{type:'loki',uid:'logs'}, ...(${JSON.stringify(environment)} === 'staging' ? [{type:'tempo',uid:'traces'}] : [])];
        else if (path.endsWith('/labels')) result = {data:['environment','service_name']};
        else if (path.endsWith('/label/environment/values')) result = {data:[${JSON.stringify(labelEnvironment)}]};
        else if (path.endsWith('/label/service_name/values')) result = {data:['api']};
        else result = {data:{result:[]}};
        return {ok:true,json:async()=>result};
      };
      await import(${JSON.stringify(collector)});
    `;
    return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        API_DIAGNOSTIC_ENVIRONMENT: environment,
        STAGING_GRAFANA_TOKEN_FILE: token,
        PRODUCTION_GRAFANA_TOKEN_FILE: token,
        PRODUCTION_GRAFANA_URL: 'https://production.example/grafana/',
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('staging retains its endpoint, environment filter and required Tempo access', () => {
  const result = preflight('staging');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /https:\/\/staging.heyhey.dev\/grafana/);
  assert.match(result.stdout, /environment%3D%22staging%22/);
  assert.match(result.stdout, /uid\/traces\/api\/search/);
});
test('production selects its own endpoint and labels without requiring Tempo', () => {
  const result = preflight('production');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /https:\/\/production.example\/grafana/);
  assert.match(result.stdout, /environment%3D%22production%22/);
  assert.doesNotMatch(result.stdout, /staging.heyhey.dev/);
  assert.match(result.stdout, /"tempo":null/);
});
test('production refuses evidence from a datasource containing only staging labels', () => {
  const result = preflight('production', 'staging');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing production Loki environment=production/);
});
