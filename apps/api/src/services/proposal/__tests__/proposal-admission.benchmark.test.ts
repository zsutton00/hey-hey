/**
 * Opt-in PostgreSQL workload. All fixture writes roll back. See
 * scripts/benchmarks/proposal-admission.md for the before/after procedure.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProposalService } from '../proposal.service';
import { ProposalValidationEngine } from '../proposal-validation.engine';
import { WorkItemChangeSetProjectorService } from '../work-item-change-set-projector.service';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { ProposalApprovalService } from '../proposal-approval.service';
import {
  PendingEdgeService,
  SERVICE_TOKEN_FACTORY,
} from '../pending-edge.service';
import { AgentEdgeClientService } from '../../agent-edge-client.service';
import { ProjectApprovalPolicyService } from '../project-approval-policy.service';
import { createWarmWorkItemTypeRegistryWithCustomTypes } from '../../../../test/setup/work-item-type-registry.fixture';
import type { StampedCreateProposalDto } from '../proposal.types';
import type { OrganizationId, ProjectId, UserId } from '../../../types';

const enabled = process.env.PROPOSAL_ADMISSION_BENCHMARK === '1';
const run = enabled ? describe : describe.skip;

run('proposal admission PostgreSQL benchmark', () => {
  it('measures create and draft update workloads', async () => {
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
            process.env.PROPOSAL_ADMISSION_BENCHMARK_BASELINE === '1';
          const serviceClass = baseline
            ? require('../proposal.service.benchmark-baseline').ProposalService
            : ProposalService;
          const engineClass = baseline
            ? require('../proposal-validation.engine.benchmark-baseline')
                .ProposalValidationEngine
            : ProposalValidationEngine;
          const module = await Test.createTestingModule({
            providers: [
              { provide: ProposalService, useClass: serviceClass },
              { provide: ProposalValidationEngine, useClass: engineClass },
              { provide: PrismaService, useValue: prisma },
              { provide: WorkItemTypeRegistryService, useValue: registry },
              WorkItemParentageValidator,
              WorkItemChangeSetProjectorService,
              ProjectApprovalPolicyService,
              {
                provide: ProposalApprovalService,
                useValue: { genericChangeSetRequest: () => null },
              },
              {
                provide: PendingEdgeService,
                useValue: { rollbackMaterializedEdges: async () => {} },
              },
              { provide: AgentEdgeClientService, useValue: {} },
              {
                provide: SERVICE_TOKEN_FACTORY,
                useValue: () => {
                  throw new Error('Unexpected graph RPC in ordinary workload');
                },
              },
            ],
          }).compile();
          const service = module.get(ProposalService);
          const dto = {
            type: 'SINGLE',
            action: 'CREATE',
            targetEntityType: 'TASK',
            targetEntityId: '00000000-0000-0000-0000-000000000000',
            title: 'Benchmark task',
            eli5: 'Creates a benchmark task for proposal admission.',
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
          const updateSeed = await tx.proposal.create({
            data: {
              organizationId,
              projectId,
              requestorId: userId,
              type: 'SINGLE',
              action: 'UPDATE',
              targetEntityType: 'TASK',
              targetEntityId: targetId,
              title: 'Update benchmark',
              updates: { name: 'Renamed' },
              requestorContext: dto.requestorContext,
              edges: dto.edges,
              influences: [],
            },
          });
          const workloads = [
            {
              workload: 'create',
              execute: () =>
                service.create(organizationId, projectId, userId, dto),
            },
            {
              workload: 'update',
              execute: () =>
                service.update(
                  updateSeed.id,
                  organizationId,
                  projectId,
                  {
                    updates: { name: 'Renamed again' },
                    influences: dto.influences,
                  },
                  userId,
                ),
            },
          ];
          for (const workload of workloads) {
            const times: number[] = [];
            const counts: number[] = [];
            for (let i = 0; i < 40; i++) {
              // Reset outside timing so draft updates use identical input sizes.
              await tx.proposal.update({
                where: { id: updateSeed.id },
                data: { influences: [], updates: { name: 'Renamed' } },
              });
              const beforeQueries = queries;
              const start = performance.now();
              await workload.execute();
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
      baseline: process.env.PROPOSAL_ADMISSION_BENCHMARK_BASELINE === '1',
      results,
    };
    if (process.env.PROPOSAL_ADMISSION_BENCHMARK_OUTPUT)
      writeFileSync(
        process.env.PROPOSAL_ADMISSION_BENCHMARK_OUTPUT,
        JSON.stringify(output, null, 2) + '\n',
      );
    expect(results).toHaveLength(2);
  }, 150000);
});
