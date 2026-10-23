import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RUN_CONFORMANCE_PROTOCOL } from '../conformance/protocol';
import { DeterministicE2EScenarioRegistry } from './deterministic-e2e-scenario-registry';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true })));

const setup = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'heyhey-deterministic-'));
  dirs.push(directory);
  const config = path.join(directory, 'scenario.json');
  const observationsPath = path.join(directory, 'observations.jsonl');
  fs.writeFileSync(
    config,
    JSON.stringify({
      protocol: RUN_CONFORMANCE_PROTOCOL,
      owner: 'owner-1',
      observationsPath,
      scenario: {
        protocol: RUN_CONFORMANCE_PROTOCOL,
        name: 'test',
        commands: [],
        expectedFinal: {},
      },
    }),
  );
  return { config, observationsPath };
};

describe('DeterministicE2EScenarioRegistry', () => {
  it('is explicitly gated and rejects production', () => {
    expect(DeterministicE2EScenarioRegistry.fromEnvironment({})).toBeNull();
    const { config } = setup();
    expect(() =>
      DeterministicE2EScenarioRegistry.fromEnvironment({
        NODE_ENV: 'production',
        HEY_HEY_DETERMINISTIC_E2E_SCENARIO: config,
      }),
    ).toThrow(/forbidden/);
  });

  it('claims one Run and records exhaustion', () => {
    const { config, observationsPath } = setup();
    const registry = DeterministicE2EScenarioRegistry.fromEnvironment({
      NODE_ENV: 'test',
      HEY_HEY_DETERMINISTIC_E2E_SCENARIO: config,
      HEY_HEY_DETERMINISTIC_E2E_OWNER: 'owner-1',
    })!;
    registry.claim('run-1');
    expect(() => registry.claim('run-2')).toThrow(/already claimed/);
    registry.complete('run-1');
    expect(fs.readFileSync(observationsPath, 'utf8')).toContain('exhausted');
  });

  it('rejects cross-process consumption through an atomic claim file', () => {
    const { config } = setup();
    const environment = {
      NODE_ENV: 'test',
      HEY_HEY_DETERMINISTIC_E2E_SCENARIO: config,
      HEY_HEY_DETERMINISTIC_E2E_OWNER: 'owner-1',
    };
    DeterministicE2EScenarioRegistry.fromEnvironment(environment)!.claim('run-1');
    expect(() =>
      DeterministicE2EScenarioRegistry.fromEnvironment(environment)!.claim('run-2'),
    ).toThrow(/another CLI process/);
  });
});
