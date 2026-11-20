import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityContextApi, WorkItemTypesApi } from '@hey-hey/contracts/api';
import type { AgenticSession } from '../../../session/types';
import { createPromptTypeHandlerTestDeps } from '../../prompt-type-handler.test-support';
import { readActiveWorkItemTypeDefinitions } from '../../prompts/work-item-type-registry';
import { SessionRoleGuidance } from '../../session-role-guidance/session-role-guidance';
import { featureSyncAnalyzeHandler } from '../analyze.handler';

vi.mock('../../prompts/work-item-type-registry', () => ({
  readActiveWorkItemTypeDefinitions: vi.fn(),
}));

// The advice a canonical type carries after the shipped migration: read from the real SQL.
const migrationSql = readFileSync(
  resolve(
    __dirname,
    '../../../../../api/db/flyway/V2026.11.20.055556__seed_canonical_sync_session_role_guidance.sql',
  ),
  'utf8',
);
const migratedSyncAdvice: Record<string, string> = JSON.parse(
  migrationSql.match(/\$advice\$([\s\S]*?)\$advice\$/)![1]!,
);
// A project-owned complete type has no sync entry; canonical types carry the migrated one.
const projectOwnedTypeKeys = ['PROJECT_OWNED'];

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const typeByEntity: Record<string, string> = {
  [id(1)]: 'STANDARD',
  [id(2)]: 'mockup',
  [id(3)]: 'DIAGRAM',
  [id(4)]: 'PROJECT_OWNED',
};
const envelope = (data: object) => ({ data: { success: true, data } }) as any;

beforeEach(() => {
  vi.mocked(readActiveWorkItemTypeDefinitions).mockResolvedValue(
    ['STANDARD', 'mockup', 'DIAGRAM', 'PROJECT_OWNED'].map((key) => ({ key, name: key })) as any,
  );
  vi.spyOn(EntityContextApi.prototype, 'getEntityContext').mockImplementation(
    async ({ entityId }) =>
      envelope({
        entityId,
        entityType: 'TASK',
        taskType: typeByEntity[entityId],
        displayName: 'Selected item',
        createdAt: 'now',
        content: { sections: {}, status: 'BACKLOG' },
        featureHierarchy: [],
      }),
  );
  vi.spyOn(WorkItemTypesApi.prototype, 'getWorkItemTypeGuidanceBatch').mockImplementation(
    async ({ workItemTypeGuidanceBatchRequestDto: request }) =>
      envelope({
        results: request.typeKeys.map((typeKey) => {
          const guidance = projectOwnedTypeKeys.includes(typeKey)
            ? undefined
            : request.sessionRole === 'sync'
              ? migratedSyncAdvice[typeKey]
              : undefined;
          return {
            typeKey,
            name: typeKey,
            sessionRole: request.sessionRole,
            ...(guidance === undefined ? {} : { guidance }),
          };
        }),
      }),
  );
});
afterEach(() => vi.restoreAllMocks());

describe('Feature Sync analyze receives migrated sync advice', () => {
  it('puts the shipped Mockup and Diagram advice in the analysis prompt and nothing for a project-owned type without sync', async () => {
    const session = {
      agentic_session_id: id(100),
      entity: { entityId: id(1), entityType: 'TASK' },
      provider_session_id: 'provider-one',
      contextMetadata: { organizationId: 'org', projectId: 'project' },
      memos: [],
    } as unknown as AgenticSession;

    const result = await new SessionRoleGuidance(createPromptTypeHandlerTestDeps()).prepare({
      session,
      handler: featureSyncAnalyzeHandler as never,
      payload: {
        userMessage: `@[task:${id(2)}|Checkout mockup] @[task:${id(3)}|Flow diagram] @[task:${id(4)}|Owned item]`,
      },
      fresh: true,
    });

    expect(result.text).toContain(migratedSyncAdvice['mockup']);
    expect(result.text).toContain(migratedSyncAdvice['DIAGRAM']);
    expect(result.text).toMatch(/do not filter by priority/i);
    expect(result.deliveryKeys).toContain('sync:PROJECT_OWNED');
    expect(result.text).not.toContain('PROJECT_OWNED');
  });
});
