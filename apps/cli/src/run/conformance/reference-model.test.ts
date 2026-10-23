import { describe, expect, it } from 'vitest';

import { RUN_CONFORMANCE_PROTOCOL, scenarioSchema } from './protocol';
import { RunConformanceReferenceModel } from './reference-model';
import { runConformanceScenario } from './scenario-runner';
import { generateRunConformanceScenario, RUN_CONFORMANCE_REGRESSION_SCENARIOS } from './scenarios';

describe('Run conformance reference model', () => {
  it.each(RUN_CONFORMANCE_REGRESSION_SCENARIOS.map((scenario) => [scenario.name, scenario]))(
    '%s',
    async (_name, scenario) => {
      await expect(
        runConformanceScenario(new RunConformanceReferenceModel(), scenario),
      ).resolves.toMatchObject({ name: scenario.name });
    },
  );

  it.each([1, 7, 42, 0xdeadbeef])('runs deterministic generated trace seed %s', async (seed) => {
    const first = generateRunConformanceScenario(seed, 12);
    const second = generateRunConformanceScenario(seed, 12);
    expect(second).toEqual(first);
    const result = await runConformanceScenario(new RunConformanceReferenceModel(), first);
    expect(result.finalObservation.phase).toBe('idle');
    expect(result.finalObservation.settledTurnPublications).toHaveLength(12);
  });

  it('rejects non-versioned scenario data at the portable boundary', () => {
    expect(() =>
      scenarioSchema.parse({
        protocol: 'unversioned',
        name: 'invalid',
        commands: [],
        expectedFinal: {},
      }),
    ).toThrow();
  });

  it('keeps interruption names JSON-compatible and implementation-neutral', () => {
    const encoded = JSON.stringify(generateRunConformanceScenario(3));
    expect(JSON.parse(encoded)).toMatchObject({ protocol: RUN_CONFORMANCE_PROTOCOL });
    expect(encoded).not.toMatch(/Run\.|Turn\.|xstate|collaborator/i);
  });

  it('generates traces across every named interruption boundary', () => {
    const boundaries = new Set(
      Array.from({ length: 64 }, (_, seed) => generateRunConformanceScenario(seed, 12))
        .flatMap((scenario) => scenario.commands)
        .filter((command) => command.kind === 'interrupt')
        .map((command) => command.boundary),
    );
    expect([...boundaries].sort()).toEqual(
      [
        'admission',
        'external_work_completion',
        'external_work_dispatch',
        'outcome_application',
        'required_evidence_settlement',
        'settled_turn_publication',
        'state_persistence',
      ].sort(),
    );
  });
});
