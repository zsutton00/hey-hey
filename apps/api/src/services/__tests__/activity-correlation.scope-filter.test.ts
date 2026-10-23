import { Prisma } from '@prisma/client';
import { EntityType } from 'src/generated';
import { ActivityCorrelationService } from '../activity-correlation.service';

// This test exists to make the (entityType, entityId) polymorphic schema for
// AgentSession enforceable at compile time. The historical bug it guards
// against: buildAgentSessionScopeFilter used to return Array<Record<string,
// unknown>>, which let it push removed relation keys like
// `{ taskId: { in: ids } }`. Prisma rejected those at runtime; TS didn't.
//
// The Prisma.validator() wrapper below is the load-bearing line: it forces
// the helper's output to be assignable to Prisma.AgentSessionWhereInput[] at
// compile time. If anyone re-widens the return type or re-introduces a stale
// relation key, this file fails to compile — not at request time.
describe('ActivityCorrelationService.buildAgentSessionScopeFilter', () => {
  type Helper = (
    scopeEntities: Array<{ entityId: string; entityType: EntityType }>,
  ) => Prisma.AgentSessionWhereInput[];

  const service = Object.create(
    ActivityCorrelationService.prototype,
  ) as ActivityCorrelationService;
  const buildAgentSessionScopeFilter = (
    service as unknown as { buildAgentSessionScopeFilter: Helper }
  ).buildAgentSessionScopeFilter.bind(service);

  const validate = Prisma.validator<Prisma.AgentSessionWhereInput[]>();

  it('builds polymorphic filters for task / initiative / design-doc scopes', () => {
    const filter = buildAgentSessionScopeFilter([
      { entityId: 'task-1', entityType: EntityType.Task },
      { entityId: 'task-2', entityType: EntityType.Task },
      { entityId: 'init-1', entityType: EntityType.Initiative },
      { entityId: 'dd-1', entityType: EntityType.DesignDoc },
    ]);

    expect(validate(filter)).toEqual([
      { entityType: 'TASK', entityId: { in: ['task-1', 'task-2'] } },
      { entityType: 'INITIATIVE', entityId: { in: ['init-1'] } },
      { entityType: 'DESIGN_DOC', entityId: { in: ['dd-1'] } },
    ]);
  });

  it('passes service / conversation / agent-session scopes through direct columns', () => {
    const filter = buildAgentSessionScopeFilter([
      { entityId: 'svc-1', entityType: EntityType.Service },
      { entityId: 'conv-1', entityType: EntityType.Conversation },
      { entityId: 'sess-1', entityType: EntityType.AgentSession },
    ]);

    expect(validate(filter)).toEqual([
      { id: { in: ['sess-1'] } },
      { serviceId: { in: ['svc-1'] } },
      { conversationId: { in: ['conv-1'] } },
    ]);
  });

  it('returns an empty array for an empty scope', () => {
    expect(validate(buildAgentSessionScopeFilter([]))).toEqual([]);
  });
});
