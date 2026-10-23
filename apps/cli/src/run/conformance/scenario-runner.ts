import type {
  RunConformanceDriver,
  RunConformanceExpectation,
  RunConformanceObservation,
  RunConformanceScenario,
} from './protocol';

export interface RunConformanceScenarioResult {
  name: string;
  observations: RunConformanceObservation[];
  finalObservation: RunConformanceObservation;
}

class RunConformanceFailure extends Error {
  public constructor(
    public readonly scenarioName: string,
    public readonly expectation: RunConformanceExpectation,
    public readonly observation: RunConformanceObservation,
  ) {
    super(
      `Run conformance scenario failed: ${scenarioName}\n` +
        `expected=${JSON.stringify(expectation)}\n` +
        `observed=${JSON.stringify(observation)}`,
    );
  }
}

export const runConformanceScenario = async (
  driver: RunConformanceDriver,
  scenario: RunConformanceScenario,
): Promise<RunConformanceScenarioResult> => {
  const observations: RunConformanceObservation[] = [];
  for (const command of scenario.commands) observations.push(await driver.execute(command));
  const finalObservation = observations.at(-1) ?? (await driver.execute({ kind: 'observe' }));
  if (!matchesExpectation(finalObservation, scenario.expectedFinal)) {
    throw new RunConformanceFailure(scenario.name, scenario.expectedFinal, finalObservation);
  }
  return { name: scenario.name, observations, finalObservation };
};

const matchesExpectation = (
  observation: RunConformanceObservation,
  expectation: RunConformanceExpectation,
): boolean =>
  (expectation.phase === undefined || observation.phase === expectation.phase) &&
  (expectation.effectiveState === undefined ||
    observation.effectiveState === expectation.effectiveState) &&
  (expectation.outputEvents === undefined ||
    JSON.stringify(observation.outputEvents) === JSON.stringify(expectation.outputEvents)) &&
  (expectation.activeInputId === undefined ||
    observation.activeTurn?.inputId === expectation.activeInputId ||
    (observation.activeTurn === null && expectation.activeInputId === null)) &&
  (expectation.activeTrigger === undefined ||
    equalTriggers(observation.activeTurn?.trigger ?? null, expectation.activeTrigger)) &&
  (expectation.queuedInputIds === undefined ||
    equalStrings(observation.queuedInputIds, expectation.queuedInputIds)) &&
  (expectation.providerSessionHistory === undefined ||
    equalStrings(observation.providerSessionHistory, expectation.providerSessionHistory)) &&
  (expectation.terminalOutcomes === undefined ||
    equalStrings(
      observation.terminalTurns.map((turn) => turn.outcome),
      expectation.terminalOutcomes,
    )) &&
  (expectation.publicationCount === undefined ||
    observation.settledTurnPublications.length === expectation.publicationCount) &&
  (expectation.rejectedSettlementCount === undefined ||
    observation.rejectedSettlements.length === expectation.rejectedSettlementCount);

const equalStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const equalTriggers = (
  left: { nodeId: string; messageId: string } | null,
  right: { nodeId: string; messageId: string } | null,
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.nodeId === right.nodeId &&
    left.messageId === right.messageId);
