import { performance } from 'node:perf_hooks';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import { createDefaultProjectApprovalPolicy } from '../project-approval-policy.service';
import { mapProposalResponse } from '../proposal-response-policy';
import type { ProposalWithApprovals } from '../proposal.types';

const enabled = process.env.PROPOSAL_RESPONSE_BENCHMARK === '1';
const run = enabled ? describe : describe.skip;

function persistedProposal(
  action: 'CREATE' | 'UPDATE',
  status: 'DRAFT' | 'APPROVED',
  withApproval: boolean,
): ProposalWithApprovals {
  return {
    id: `proposal-${action}-${status}`,
    organizationId: 'organization-1',
    projectId: 'project-1',
    type: 'SINGLE',
    action,
    status,
    targetEntityId: '00000000-0000-0000-0000-000000000000',
    targetEntityType: 'TASK',
    targetLastAppliedProposalId: null,
    title: 'Response benchmark',
    eli5: 'Summarizes the response mapping benchmark proposal.',
    updates: { name: 'Response benchmark' },
    requestorId: 'user-1',
    requestorContext: { source: 'user' },
    influences: null,
    ragEnabled: true,
    applicationEligible: true,
    retainedOriginalTargetContent: null,
    generatedWithVersion: null,
    validationSessionId: null,
    conversationId: null,
    messageId: null,
    edges: null,
    createdAt: new Date('2026-09-22T00:00:00.000Z'),
    updatedAt: new Date('2026-09-22T00:00:00.000Z'),
    approvalRecords: withApproval
      ? [
          {
            id: 'approval-1',
            proposalId: `proposal-${action}-${status}`,
            userId: 'user-1',
            type: 'APPROVAL',
            reason: null,
            createdAt: new Date('2026-09-22T00:00:00.000Z'),
          },
        ]
      : [],
    groupMembership: null,
    workItemChangeSetMaterialization: null,
  } as ProposalWithApprovals;
}

run('proposal authoring response mapping benchmark', () => {
  it('isolates relation reload calls and mapper latency', async () => {
    const samples = 500;
    const workloads = [
      ['create', persistedProposal('CREATE', 'DRAFT', false)],
      ['draft-update', persistedProposal('UPDATE', 'DRAFT', false)],
      [
        'immediately-applied-user-change',
        persistedProposal('UPDATE', 'APPROVED', true),
      ],
    ] as const;
    const measurements: Array<Record<string, string | number>> = [];

    for (const [workload, complete] of workloads) {
      for (const [variant, input] of [
        [
          'before',
          {
            ...complete,
            approvalRecords: undefined,
            groupMembership: undefined,
            workItemChangeSetMaterialization: undefined,
          },
        ],
        ['after', complete],
      ] as const) {
        let relationReloads = 0;
        const tx = {
          proposal: {
            findUnique: async () => {
              relationReloads++;
              return complete;
            },
          },
        } as unknown as AnyTransactionClient;
        const startedAt = performance.now();
        for (let sample = 0; sample < samples; sample++) {
          await mapProposalResponse(
            tx,
            input,
            createDefaultProjectApprovalPolicy(1),
            { requiredApprovals: 1 },
          );
        }
        measurements.push({
          workload,
          variant,
          samples,
          totalMs: Number((performance.now() - startedAt).toFixed(3)),
          relationReloads,
        });
      }
    }

    process.stdout.write(`${JSON.stringify(measurements, null, 2)}\n`);
    expect(
      measurements
        .filter(({ variant }) => variant === 'before')
        .map(({ relationReloads }) => relationReloads),
    ).toEqual([samples, samples, samples]);
    expect(
      measurements
        .filter(({ variant }) => variant === 'after')
        .map(({ relationReloads }) => relationReloads),
    ).toEqual([0, 0, 0]);
  });
});
