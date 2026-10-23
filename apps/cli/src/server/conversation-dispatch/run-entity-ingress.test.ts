import { describe, expect, it } from 'vitest';
import type { LocalCreateRunRequest } from '../../shared/agent-bridge-contract/contract';
import { PromptTypeRegistry } from '../../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../agents/prompt-type-registry.test-support';
import { readLaunchEntity as readLaunchEntityWithRegistry } from './run-entity-ingress';

const promptTypeRegistry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
const readLaunchEntity = (launchPayload: LocalCreateRunRequest['payload']) =>
  readLaunchEntityWithRegistry(launchPayload, promptTypeRegistry);

const payload = (value: object): LocalCreateRunRequest['payload'] =>
  value as LocalCreateRunRequest['payload'];

describe('readLaunchEntity', () => {
  it.each([
    ['TASK', 'free_form'],
    ['TASK', 'project_mode'],
    ['TASK', 'run_eval'],
    ['DESIGN_DOC', 'design_doc_refiner'],
    ['TASK', 'plan_shaping_finalize'],
    ['AGENT_SESSION', 'entity_conversation'],
    ['TASK', 'session_monitor'],
    ['TASK', 'task_monitor'],
    ['TASK', 'goal_pm'],
    ['PROJECT', 'open_items_triage'],
  ] as const)('reads a %s declaration from a scoped %s launch', (entityType, promptType) => {
    expect(
      readLaunchEntity(
        payload({
          promptType,
          entity: {
            entityType,
            entityId: '11111111-1111-4111-8111-111111111111',
            ...(promptType === 'goal_pm' ? { taskType: 'GOAL' } : {}),
          },
        }),
      ),
    ).toEqual({
      entityType,
      entityId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('validates a generated triage launch and rejects missing or malformed identity', () => {
    const launch = {
      promptType: 'open_items_triage',
      projectId: '11111111-1111-4111-8111-111111111111',
      requestKind: 'freshPass',
      mode: 'tidyUp',
      userMessage: '',
      entity: { entityType: 'PROJECT', entityId: '11111111-1111-4111-8111-111111111111' },
    } satisfies NonNullable<LocalCreateRunRequest['payload']>;
    expect(readLaunchEntity(launch)).toEqual(launch.entity);
    const { entity: _entity, ...missing } = launch;
    expect(() => readLaunchEntity(payload(missing))).toThrow(/requires payload\.entity/);
    for (const entity of [
      null,
      { entityType: 'PROJECT', entityId: 'invalid' },
      { entityType: 'INVALID', entityId: launch.projectId },
    ]) {
      expect(() => readLaunchEntity(payload({ ...launch, entity }))).toThrow(
        /invalid payload\.entity/,
      );
    }
  });

  it('does not carry copied conversation history in the launch identity', () => {
    expect(
      readLaunchEntity(
        payload({
          promptType: 'entity_conversation',
          entity: {
            entityType: 'AGENT_SESSION',
            entityId: '11111111-1111-4111-8111-111111111111',
          },
          transcript: 'copied history must not cross the launch boundary',
        }),
      ),
    ).toEqual({
      entityType: 'AGENT_SESSION',
      entityId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('returns null for a payload-free materialize-only launch', () => {
    expect(readLaunchEntity(undefined)).toBeNull();
  });

  it('returns null for an explicitly unscoped prompt type', () => {
    expect(readLaunchEntity(payload({ promptType: 'daily_session' }))).toBeNull();
  });

  it('rejects a scoped prompt with no entity', () => {
    expect(() => readLaunchEntity(payload({ promptType: 'free_form' }))).toThrow(
      /requires payload\.entity/,
    );
  });

  it('rejects a Task Monitor launch with no canonical monitor entity', () => {
    expect(() =>
      readLaunchEntity(
        payload({
          promptType: 'task_monitor',
          monitorId: '11111111-1111-4111-8111-111111111111',
          cause: 'START',
          correlationId: '22222222-2222-4222-8222-222222222222',
        }),
      ),
    ).toThrow(/requires payload\.entity/);
  });

  it('rejects an unsupported entity type and malformed id', () => {
    expect(() =>
      readLaunchEntity(
        payload({
          promptType: 'free_form',
          entity: { entityType: 'NOT_AN_ENTITY', entityId: 'not-a-uuid' },
        }),
      ),
    ).toThrow(/invalid payload\.entity/);
  });

  it('rejects an entity declaration on an unscoped prompt type', () => {
    expect(() =>
      readLaunchEntity(
        payload({
          promptType: 'daily_session',
          entity: {
            entityType: 'TASK',
            entityId: '11111111-1111-4111-8111-111111111111',
          },
        }),
      ),
    ).toThrow(/does not accept payload\.entity/);
  });

  it('rejects a Goal PM launch unless its entity is a GOAL TASK', () => {
    for (const entity of [
      { entityType: 'FEATURE', entityId: '11111111-1111-4111-8111-111111111111' },
      { entityType: 'TASK', entityId: '11111111-1111-4111-8111-111111111111' },
      {
        entityType: 'TASK',
        entityId: '11111111-1111-4111-8111-111111111111',
        taskType: 'STANDARD',
      },
    ]) {
      expect(() =>
        readLaunchEntity(
          payload({
            promptType: 'goal_pm',
            entity,
          }),
        ),
      ).toThrow(/GOAL TASK/);
    }
  });

  it('reads the optional workflow kickoff entity when explicitly scoped', () => {
    expect(
      readLaunchEntity({
        promptType: 'workflow_kickoff',
        entity: {
          entityType: 'TASK',
          entityId: '11111111-1111-4111-8111-111111111111',
        },
        userMessage: 'Plan this task',
      }),
    ).toEqual({
      entityType: 'TASK',
      entityId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('keeps a workflow kickoff explicitly unscoped and rejects malformed optional identity', () => {
    expect(
      readLaunchEntity({ promptType: 'workflow_kickoff', userMessage: 'Plan generally' }),
    ).toBeNull();
    expect(() =>
      readLaunchEntity({
        promptType: 'workflow_kickoff',
        entity: { entityType: 'TASK', entityId: 'not-a-uuid' },
        userMessage: 'Plan this task',
      }),
    ).toThrow(/invalid payload\.entity/);
  });

  it('rejects a payload whose prompt type has no registered handler', () => {
    expect(() => readLaunchEntity(payload({ promptType: 'not_a_prompt_type' }))).toThrow(
      /has no registered handler/,
    );
  });
});
