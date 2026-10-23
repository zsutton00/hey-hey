import { describe, expect, it } from 'vitest';

import type { AgenticSession } from '../session/types';
import type { LocalStartupSessionPromptPayload } from '../shared/agent-bridge-contract/generated/api';
import type { PromptTypeHandlerDeps } from './prompt-type-handler';
import { codingPlanHandler } from './coding-plan/coding-plan.handler';
import { featureSyncAnalyzeHandler } from './feature-sync/analyze.handler';

const deps = {
  logger: {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => deps.logger,
  },
} as unknown as PromptTypeHandlerDeps;

describe('automatic Plan Mode durable focal identity', () => {
  it('carries the same Run-owned task from Feature Sync into Coding Plan preparation', async () => {
    const entity = {
      entityType: 'TASK' as const,
      entityId: '11111111-1111-4111-8111-111111111111',
    };
    const run = {
      agentic_session_id: 'plan-mode-run',
      entity,
      contextMetadata: {},
      memos: [],
    } as unknown as AgenticSession;

    const featureSync = await featureSyncAnalyzeHandler.prepare!(
      run,
      { taskId: entity.entityId, userMessage: '' },
      deps,
    );
    expect(featureSync.payload.taskId).toBe(entity.entityId);

    const codingPlanPayload = {
      startupInput: {
        task: {
          id: entity.entityId,
          taskType: 'STANDARD',
          description: '',
        },
        focalEntity: entity,
        adjacentScopeTasks: [],
        evidenceItems: [],
      },
    } as LocalStartupSessionPromptPayload;
    const codingPlan = await codingPlanHandler.prepare!(run, codingPlanPayload, deps);

    expect(codingPlan.payload.startupInput?.focalEntity).toEqual(entity);
    expect(codingPlan.payload.startupInput?.task.id).toBe(entity.entityId);
    expect(run.entity).toEqual(entity);
  });
});
