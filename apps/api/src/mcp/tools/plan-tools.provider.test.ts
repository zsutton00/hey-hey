import { BadRequestException } from '@nestjs/common';
import type { ProposalService } from '../../services/proposal/proposal.service';
import { validateProposalStructure } from '../../services/proposal/proposal-validation.engine';
import { createPlanParameters, PlanToolsProvider } from './plan-tools.provider';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const FEATURE_ID = '00000000-0000-4000-8000-000000000003';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000004';

function request() {
  return {
    headers: {
      authorization: 'Bearer token',
      'x-project-id': PROJECT_ID,
    },
    cookies: {},
    user: {
      userId: 'user-1',
      email: 'test@example.com',
      name: 'Test',
      currentOrgId: ORGANIZATION_ID,
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
    },
    ip: '127.0.0.1',
  } as any;
}

const params = {
  eli5: 'Creates a plan for review.',
  designDocMarkdown: '# Plan\n\nDeliver the reviewed capability.',
  planTitle: 'Reviewed plan',
  parentFeatureId: FEATURE_ID,
};

describe('createPlanParameters', () => {
  it('describes the PRD-facing plan-document sections', () => {
    const description =
      createPlanParameters.shape.designDocMarkdown.description;

    expect(description).toContain('Problem Statement & Context');
    expect(description).toContain('Goals and Non-Goals');
    expect(description).toContain('Target Users & Use Cases');
    expect(description).toContain('User Experience (UX) & Design');
    expect(description).toContain('User Stories & Acceptance Criteria');
    expect(description).toContain('Success Metrics');
    expect(description).toContain('Assumptions, Constraints & Dependencies');
    expect(description).toContain('Technical Requirements');
    expect(description).toContain('Technical Approach');
    expect(description).toContain('Implementation Breakdown');
    expect(description).toContain('Integration Contracts');
    expect(description).toContain(
      'Detailed Data Flows and Downstream Task Convergence',
    );
    expect(description).not.toContain('Executive Summary');
    expect(description).not.toContain('Outcomes & AC');
    expect(description).not.toContain('Explicit Assumptions');
    expect(description).not.toContain('Scope Boundary');
  });
});

describe('create_plan authoring admission', () => {
  it('keeps the valid CONVERSATION proposal authorable through shared structural admission', async () => {
    const proposalCreate = jest
      .fn()
      .mockImplementation(async (_o, _p, _u, dto) => {
        expect(
          validateProposalStructure(dto, 0, { enforceAuthoringEnvelope: true }),
        ).toEqual([]);
        return {
          id: PROPOSAL_ID,
          status: 'DRAFT',
          action: 'CREATE',
          targetEntityType: 'CONVERSATION',
          targetEntityId: '00000000-0000-0000-0000-000000000000',
          createdAt: '2026-09-14T00:00:00.000Z',
        };
      });
    const provider = new PlanToolsProvider({
      create: proposalCreate,
    } as unknown as ProposalService);

    const result = await provider.createPlan(params, {} as any, request());

    expect(result).toMatchObject({
      id: PROPOSAL_ID,
      targetEntityType: 'CONVERSATION',
    });
    expect(proposalCreate).toHaveBeenCalledTimes(1);
  });

  it('returns every canonical validation issue from proposal admission', async () => {
    const issues = [
      {
        field: 'proposals[0].updates.parentFeatureId',
        code: 'entity_not_found',
        reason: 'The parent feature does not exist.',
        layer: 'referential',
        suggestion: 'Choose an active feature.',
        metadata: { targetType: 'FEATURE' },
      },
      {
        field: 'proposals[0].influences[0].entityId',
        code: 'entity_not_found',
        reason: 'The influence does not exist.',
        layer: 'referential',
      },
    ];
    const provider = new PlanToolsProvider({
      create: jest.fn().mockRejectedValue(
        new BadRequestException({
          message: 'Proposal authoring validation failed',
          errors: issues,
        }),
      ),
    } as unknown as ProposalService);

    const result = await provider.createPlan(params, {} as any, request());

    expect(result).toEqual({ status: 'invalid_change_set', issues });
  });
});
