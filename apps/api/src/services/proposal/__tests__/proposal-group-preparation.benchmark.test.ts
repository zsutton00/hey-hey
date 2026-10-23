/**
 * Opt-in PostgreSQL workload. All fixture writes roll back. See
 * scripts/benchmarks/proposal-group-preparation.md for the before/after procedure.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProposalGroupAuthoringService } from '../proposal-group-authoring.service';
import { ProposalGroupService } from '../proposal-group.service';
import { ProposalValidationEngine } from '../proposal-validation.engine';
import { WorkItemChangeSetProjectorService } from '../work-item-change-set-projector.service';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { SERVICE_TOKEN_FACTORY } from '../pending-edge.service';
import { AgentEdgeClientService } from '../../agent-edge-client.service';
import { createWarmWorkItemTypeRegistryWithCustomTypes } from '../../../../test/setup/work-item-type-registry.fixture';
import type { StampedCreateProposalDto } from '../proposal.types';
import type { OrganizationId, ProjectId, UserId } from '../../../types';

const enabled = process.env.PROPOSAL_GROUP_BENCHMARK === '1';
const run = enabled ? describe : describe.skip;

run('proposal group preparation PostgreSQL benchmark', () => {
  it('measures member and repeated-reference scaling', async () => {
    const url = process.env.PROJECT_DATABASE_URL;
    if (
      !url ||
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)
    ) {
      throw new Error(
        'Benchmark requires an explicitly configured loopback PostgreSQL database.',
      );
    }
    Logger.overrideLogger(false);
    const client = new PrismaClient({
      log: [{ emit: 'event', level: 'query' }],
    });
    let queries = 0;
    client.$on('query', () => {
      queries++;
    });
    const rollback = new Error('benchmark rollback');
    const results: Array<{
      workload: string;
      samples: number;
      medianMs: number;
      p95Ms: number;
      minQueries: number;
      maxQueries: number;
    }> = [];
    try {
      await client.$transaction(
        async (tx) => {
          const organizationId = randomUUID() as OrganizationId;
          const projectId = randomUUID() as ProjectId;
          const userId = randomUUID() as UserId;
          const targetId = randomUUID();
          await tx.organization.create({
            data: {
              id: organizationId,
              name: 'Admission benchmark',
              slug: randomUUID(),
            },
          });
          await tx.user.create({
            data: {
              id: userId,
              name: 'Benchmark fixture',
              email: `${userId}@example.invalid`,
              passwordHash: 'unused-benchmark-fixture',
            },
          });
          await tx.project.create({
            data: {
              id: projectId,
              organizationId,
              name: 'Admission benchmark',
            },
          });
          await tx.organizationMember.create({
            data: { organizationId, userId },
          });
          await tx.projectMember.create({ data: { projectId, userId } });
          await tx.task.create({
            data: {
              id: targetId,
              organizationId,
              projectId,
              name: 'Repeated reference',
              type: 'FEATURE',
            },
          });
          await tx.entityRegistry.create({
            data: {
              organizationId,
              entityId: targetId,
              entityType: 'TASK',
              entityName: 'Repeated reference',
            },
          });
          const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
            { projectId, typeKey: 'benchmark_info', role: 'project-info' },
          ]);
          // Service transaction callbacks share this rollback-only transaction.
          const prisma = {
            db: new Proxy(tx, {
              get(target, key) {
                return key === '$transaction'
                  ? async (callback: (db: typeof tx) => Promise<unknown>) =>
                      callback(tx)
                  : Reflect.get(target, key);
              },
            }),
          };
          const baseline =
            process.env.PROPOSAL_GROUP_BENCHMARK_BASELINE === '1';
          const serviceClass = baseline
            ? require('../proposal-group-authoring.service.benchmark-baseline')
                .ProposalGroupAuthoringService
            : ProposalGroupAuthoringService;
          const module = await Test.createTestingModule({
            providers: [
              {
                provide: ProposalGroupAuthoringService,
                useClass: serviceClass,
              },
              ProposalGroupService,
              ProposalValidationEngine,
              { provide: PrismaService, useValue: prisma },
              { provide: WorkItemTypeRegistryService, useValue: registry },
              WorkItemParentageValidator,
              WorkItemChangeSetProjectorService,
              { provide: AgentEdgeClientService, useValue: {} },
              {
                provide: SERVICE_TOKEN_FACTORY,
                useValue: () => {
                  throw new Error('Unexpected graph RPC in ordinary workload');
                },
              },
            ],
          }).compile();
          const service = module.get(ProposalGroupAuthoringService);
          const conversation = await tx.conversation.create({
            data: {
              organizationId,
              projectId,
              initiatedBy: 'USER',
              workflowAboutType: 'task',
              workflowAboutId: targetId,
            },
          });
          const dto = {
            type: 'SINGLE',
            action: 'CREATE',
            targetEntityType: 'TASK',
            targetEntityId: '00000000-0000-0000-0000-000000000000',
            title: 'Benchmark task',
            eli5: 'Creates a benchmark task for proposal group preparation.',
            conversationId: conversation.id,
            updates: {
              name: 'Benchmark task',
              type: 'STANDARD',
              parentTaskId: targetId,
            },
            requestorContext: {
              source: 'agent',
              userId,
              organizationId,
              toolName: 'benchmark',
              timestamp: '2026-09-22T00:00:00.000Z',
            },
            influences: Array.from({ length: 5 }, () => ({
              entityId: targetId,
              entityType: 'TASK',
              reasonType: 'derived',
              reasoning: 'Repeated evidence',
            })),
            edges: [
              {
                targetEntityId: targetId,
                targetEntityType: 'TASK',
                edgeType: 'RELATED_TO',
              },
            ],
          } satisfies StampedCreateProposalDto;
          const workloads = [1, 5, 20].flatMap((memberCount) =>
            [1, 10].map((referenceCount) => ({
              workload: `members-${memberCount}-references-${referenceCount}`,
              memberCount,
              referenceCount,
            })),
          );
          for (const workload of workloads) {
            const times: number[] = [];
            const counts: number[] = [];
            for (let i = 0; i < 40; i++) {
              const group = await tx.proposalGroup.create({
                data: {
                  organizationId,
                  projectId,
                  status: 'BUILDING',
                  revision: 1,
                },
              });
              const proposals = Array.from(
                { length: workload.memberCount },
                () => ({
                  ...dto,
                  influences: Array.from(
                    { length: workload.referenceCount },
                    () => dto.influences[0]!,
                  ),
                }),
              );
              const beforeQueries = queries;
              const start = performance.now();
              await service.addMembers(
                organizationId,
                projectId,
                group.id,
                userId,
                1,
                proposals,
              );
              const elapsed = performance.now() - start;
              if (i >= 10) {
                times.push(elapsed);
                counts.push(queries - beforeQueries);
              }
            }
            times.sort((a, b) => a - b);
            results.push({
              workload: workload.workload,
              samples: times.length,
              medianMs: times[Math.floor(times.length / 2)]!,
              p95Ms: times[Math.ceil(times.length * 0.95) - 1]!,
              minQueries: Math.min(...counts),
              maxQueries: Math.max(...counts),
            });
          }
          // Real admission/persistence regression checks, outside measurement.
          const group = await service.start(organizationId, projectId, {});
          const beforeCount = await tx.proposal.count({ where: { projectId } });
          await expect(
            service.addMembers(
              organizationId,
              projectId,
              group.groupId,
              userId,
              1,
              [
                dto,
                { ...dto, title: '' },
                {
                  ...dto,
                  edges: [
                    {
                      targetEntityId: randomUUID(),
                      targetEntityType: 'TASK',
                      edgeType: 'RELATED_TO',
                    },
                  ],
                },
              ],
            ),
          ).rejects.toMatchObject({
            response: {
              errors: expect.arrayContaining([
                expect.objectContaining({ field: 'proposals[1].title' }),
                expect.objectContaining({
                  field: 'proposals[2].edges[0].targetEntityId',
                }),
              ]),
            },
          });
          expect(await tx.proposal.count({ where: { projectId } })).toBe(
            beforeCount,
          );
          expect(
            await tx.proposalGroupMember.count({
              where: { groupId: group.groupId },
            }),
          ).toBe(0);
          expect(
            await tx.proposalGroup.findUniqueOrThrow({
              where: { id: group.groupId },
            }),
          ).toMatchObject({ revision: 1 });
          const first = await service.addMember(
            organizationId,
            projectId,
            group.groupId,
            userId,
            { expectedRevision: 1, proposal: dto },
          );
          const reservation = first.members[0]!.reservedEntityId!;
          const second = await service.addMembers(
            organizationId,
            projectId,
            group.groupId,
            userId,
            2,
            [
              {
                ...dto,
                edges: [
                  {
                    targetEntityId: reservation,
                    targetEntityType: 'TASK',
                    edgeType: 'RELATED_TO',
                  },
                ],
              },
            ],
          );
          expect(second.members.map((member) => member.memberOrder)).toEqual([
            0, 1,
          ]);
          const updated = await service.updateMember(
            organizationId,
            projectId,
            group.groupId,
            first.members[0]!.memberId,
            userId,
            {
              expectedRevision: 3,
              proposal: { ...dto, title: 'Revised title' },
            },
          );
          expect(updated.members[0]!.reservedEntityId).toBe(reservation);
          expect(updated.currentRevision).toBe(4);
          await expect(
            service.addMembers(
              organizationId,
              projectId,
              group.groupId,
              userId,
              3,
              [dto],
            ),
          ).rejects.toMatchObject({ status: 409 });
          await module.close();
          throw rollback;
        },
        { timeout: 120000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await client.$disconnect();
    }
    const output = {
      node: process.version,
      measuredAt: new Date().toISOString(),
      baseline: process.env.PROPOSAL_GROUP_BENCHMARK_BASELINE === '1',
      results,
    };
    if (process.env.PROPOSAL_GROUP_BENCHMARK_OUTPUT)
      writeFileSync(
        process.env.PROPOSAL_GROUP_BENCHMARK_OUTPUT,
        JSON.stringify(output, null, 2) + '\n',
      );
    expect(results).toHaveLength(6);
  }, 150000);
});
