import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  canonicalizeTaskMonitorExecutionDefinitionContent,
  validateTaskMonitorExecutionDefinitionContent,
} from '../task-monitor-execution-definition.validator';
import { TaskMonitorReviewMode } from '../../../generated/model/taskMonitorReviewMode';

interface TaskMonitorContractFixture {
  notStarted: Record<string, unknown>;
  running: Record<string, unknown>;
  paused: Record<string, unknown>;
}

const openapiRoot = execFileSync(
  process.execPath,
  ['scripts/openapi-root.js'],
  { encoding: 'utf8' },
).trim();
const fixture = JSON.parse(
  readFileSync(
    join(openapiRoot, 'specs/fixtures/task-monitor-contract.json'),
    'utf8',
  ),
) as TaskMonitorContractFixture;

const clone = <T>(value: T): T => structuredClone(value);

describe('task monitor execution definition validation', () => {
  it.each(['notStarted', 'running', 'paused'] as const)(
    'accepts and preserves the canonical %s fixture',
    (variant) => {
      const definition = fixture[variant];
      const result = validateTaskMonitorExecutionDefinitionContent(definition);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toEqual(definition);
        expect(result.canonicalContent).toBe(JSON.stringify(definition));
      }
    },
  );

  it('accepts the unchanged serialized fixture definition', () => {
    const serialized = JSON.stringify(fixture.notStarted);
    expect(canonicalizeTaskMonitorExecutionDefinitionContent(serialized)).toBe(
      serialized,
    );
  });

  it.each([
    TaskMonitorReviewMode.AgentDecides,
    TaskMonitorReviewMode.RequireReview,
  ])('accepts the current %s terminal supervision mode', (mode) => {
    const definition = clone(fixture.notStarted);
    (
      (definition.launchPolicy as Record<string, unknown>)
        .terminalSupervision as Record<string, unknown>
    ).mode = mode;

    expect(validateTaskMonitorExecutionDefinitionContent(definition)).toEqual(
      expect.objectContaining({ success: true }),
    );
  });

  it('rejects the removed SKIP_REVIEW terminal supervision mode', () => {
    const definition = clone(fixture.notStarted);
    (
      (definition.launchPolicy as Record<string, unknown>)
        .terminalSupervision as Record<string, unknown>
    ).mode = 'SKIP_REVIEW';

    expect(validateTaskMonitorExecutionDefinitionContent(definition)).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining(
          'must be equal to one of the allowed values',
        ),
      }),
    );
  });

  it('preserves configured and omitted worktree launch settings', () => {
    const configured = validateTaskMonitorExecutionDefinitionContent(
      fixture.notStarted,
    );
    const omitted = validateTaskMonitorExecutionDefinitionContent(
      fixture.running,
    );

    expect(configured).toEqual(
      expect.objectContaining({
        success: true,
        value: expect.objectContaining({
          launchPolicy: expect.objectContaining({
            worktree: {
              enabled: true,
              branch: 'heyhey/task-monitor-worktree',
            },
          }),
        }),
      }),
    );
    expect(omitted).toEqual(
      expect.objectContaining({
        success: true,
        value: expect.objectContaining({
          launchPolicy: expect.not.objectContaining({
            worktree: expect.anything(),
          }),
        }),
      }),
    );
  });

  it('rejects malformed JSON', () => {
    expect(
      validateTaskMonitorExecutionDefinitionContent('{"executionPlan":'),
    ).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('not valid JSON'),
      }),
    );
  });

  it.each(['executionPlan', 'launchPolicy', 'cursor'] as const)(
    'rejects a missing required %s field',
    (field) => {
      const definition = clone(fixture.notStarted);
      delete definition[field];

      expect(validateTaskMonitorExecutionDefinitionContent(definition)).toEqual(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining(field),
        }),
      );
    },
  );

  it('rejects legacy execution definitions', () => {
    expect(
      validateTaskMonitorExecutionDefinitionContent({
        source: { sourceType: 'TASK_BATCH', display: 'Legacy batch' },
        selectedWork: [],
        dependencyOrder: { nodes: [], edges: [] },
        selectionState: {
          pruningPolicy: 'STRICT_DEPENDENCIES',
          disabledNodeIds: [],
          prunedNodeIds: [],
        },
        readiness: { state: 'READY', findings: [] },
        policies: {
          executionMode: 'SEQUENTIAL',
          launchPolicy: { startMode: 'MANUAL' },
          checkpointPolicy: { terminalBoundaryMode: 'NEVER' },
        },
        cursor: { state: 'READY', nextNodeIds: [] },
      }),
    ).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('executionPlan'),
      }),
    );
  });

  it('rejects invalid and incomplete nodes', () => {
    const invalidTaskId = clone(fixture.notStarted);
    (invalidTaskId.executionPlan as Array<Record<string, unknown>>)[0]!.taskId =
      'not-a-uuid';

    expect(
      validateTaskMonitorExecutionDefinitionContent(invalidTaskId),
    ).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('format "uuid"'),
      }),
    );

    const missingDependencies = clone(fixture.notStarted);
    delete (
      missingDependencies.executionPlan as Array<Record<string, unknown>>
    )[0]!.dependsOnTaskIds;

    expect(
      validateTaskMonitorExecutionDefinitionContent(missingDependencies),
    ).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('dependsOnTaskIds'),
      }),
    );

    const missingLaunchConfiguration = clone(fixture.notStarted);
    delete (
      missingLaunchConfiguration.executionPlan as Array<Record<string, unknown>>
    )[0]!.launchConfiguration;

    expect(
      validateTaskMonitorExecutionDefinitionContent(missingLaunchConfiguration),
    ).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('launchConfiguration'),
      }),
    );
  });

  it('rejects duplicate task and dependency identities', () => {
    const duplicateTask = clone(fixture.notStarted);
    const plan = duplicateTask.executionPlan as Array<{
      taskId: string;
      dependsOnTaskIds: string[];
    }>;
    plan[1]!.taskId = plan[0]!.taskId;

    expect(
      validateTaskMonitorExecutionDefinitionContent(duplicateTask),
    ).toEqual(
      expect.objectContaining({
        success: false,
        message: 'executionPlan taskId values must be unique',
      }),
    );

    const duplicateDependency = clone(fixture.notStarted);
    const dependencies = (
      duplicateDependency.executionPlan as Array<{
        dependsOnTaskIds: string[];
      }>
    )[1]!.dependsOnTaskIds;
    dependencies.push(dependencies[0]!);

    expect(
      validateTaskMonitorExecutionDefinitionContent(duplicateDependency),
    ).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining(
          'executionPlan[1].dependsOnTaskIds values must be unique',
        ),
      }),
    );
  });

  it('rejects dependencies outside the plan or after their dependent node', () => {
    const missingDependency = clone(fixture.notStarted);
    (
      missingDependency.executionPlan as Array<{
        dependsOnTaskIds: string[];
      }>
    )[1]!.dependsOnTaskIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];

    expect(
      validateTaskMonitorExecutionDefinitionContent(missingDependency),
    ).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('outside executionPlan'),
      }),
    );

    const laterDependency = clone(fixture.notStarted);
    const plan = laterDependency.executionPlan as Array<{
      taskId: string;
      dependsOnTaskIds: string[];
    }>;
    plan[0]!.dependsOnTaskIds = [plan[1]!.taskId];

    expect(
      validateTaskMonitorExecutionDefinitionContent(laterDependency),
    ).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining(
          'must reference earlier executionPlan nodes',
        ),
      }),
    );
  });

  it.each([-1, 2])('rejects an invalid cursor value %s', (cursor) => {
    const definition = clone(fixture.notStarted);
    definition.cursor = cursor;

    expect(validateTaskMonitorExecutionDefinitionContent(definition)).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringMatching(
          cursor < 0
            ? /must be >= 0/u
            : /must reference an executionPlan node/u,
        ),
      }),
    );
  });

  it('rejects the removed lifecycle status field', () => {
    const definition = clone(fixture.notStarted);
    definition.status = 'INVALID_STATUS';

    expect(validateTaskMonitorExecutionDefinitionContent(definition)).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('must NOT have additional properties'),
      }),
    );
  });

  it('rejects missing or unknown terminal supervision policy', () => {
    const missingPolicy = clone(fixture.notStarted);
    delete (missingPolicy.launchPolicy as Record<string, unknown>)
      .terminalSupervision;
    expect(
      validateTaskMonitorExecutionDefinitionContent(missingPolicy),
    ).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('terminalSupervision'),
      }),
    );

    const unknownMode = clone(fixture.notStarted);
    (
      (unknownMode.launchPolicy as Record<string, unknown>)
        .terminalSupervision as Record<string, unknown>
    ).mode = 'UNKNOWN';
    expect(validateTaskMonitorExecutionDefinitionContent(unknownMode)).toEqual(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining(
          'must be equal to one of the allowed values',
        ),
      }),
    );
  });
});
