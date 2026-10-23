import type {
  ProjectedWorkItem,
  ProjectedWorkItemRelationship,
} from '../../generated';
import {
  lintProjectedTopology,
  TOPOLOGY_LINT_CODES,
} from '../tools/proposal-topology-lint';
import { WorkItemChangeSetProjectorService } from '../../services/proposal/work-item-change-set-projector.service';

const existing = (id: string) => ({ refType: 'existing' as const, id });
const node = (
  id: string,
  type: string,
  parent?: string,
): ProjectedWorkItem => ({
  identity: existing(id),
  label: id,
  name: id,
  type,
  ...(parent ? { parent: existing(parent) } : {}),
  sections: [],
  deleted: false,
});
const relationship = (
  id: string,
  source: string,
  target: string,
  edgeType: ProjectedWorkItemRelationship['edgeType'],
  category: ProjectedWorkItemRelationship['category'] = 'meta',
): ProjectedWorkItemRelationship => ({
  identity: existing(id),
  label: edgeType,
  source: existing(source),
  target: existing(target),
  edgeType,
  category,
  deleted: false,
});

const semantics = {
  isFeature: (candidate: ProjectedWorkItem) => candidate.type === 'FEATURE',
  isWorkflow: (candidate: ProjectedWorkItem) => candidate.type === 'workflow',
  isWorkflowStep: (candidate: ProjectedWorkItem) =>
    candidate.type === 'workflow_step',
  isContract: (candidate: ProjectedWorkItem) => candidate.type === 'CONTRACT',
  isFulfillment: (candidate: ProjectedWorkItemRelationship) =>
    candidate.edgeType === 'FULFILLED_BY',
  isContractDependency: (candidate: ProjectedWorkItemRelationship) =>
    candidate.edgeType === 'DEPENDS_ON',
  isFlow: (candidate: ProjectedWorkItemRelationship) =>
    candidate.category === 'flow',
};

describe('projected proposal topology lint', () => {
  const featureId = '00000000-0000-4000-8000-000000000001';
  const workflowId = '00000000-0000-4000-8000-000000000002';
  const stepId = '00000000-0000-4000-8000-000000000003';
  const contractId = '00000000-0000-4000-8000-000000000004';
  const taskId = '00000000-0000-4000-8000-000000000005';
  const featureKey = `existing:${featureId}`;
  const workflowKey = `existing:${workflowId}`;
  const stepKey = `existing:${stepId}`;
  const contractKey = `existing:${contractId}`;
  const nodes = [
    node(featureId, 'FEATURE'),
    node(workflowId, 'workflow', featureId),
    node(stepId, 'workflow_step', workflowId),
    node(contractId, 'CONTRACT'),
    node(taskId, 'STANDARD'),
  ];

  function lint(relationships: ProjectedWorkItemRelationship[]) {
    return lintProjectedTopology({
      nodes,
      relationships,
      semantics,
      featureContractCitations: new Map([[featureKey, new Set([contractKey])]]),
      participatingFeatureByWorkflowNode: new Map([
        [workflowKey, featureKey],
        [stepKey, featureKey],
      ]),
    });
  }

  it('emits stable warnings for missing fulfillment and responsible dependency', () => {
    expect(lint([])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: TOPOLOGY_LINT_CODES.missingFulfillment,
          severity: 'warning',
          path: `projected.nodes[${stepKey}].relationships`,
        }),
        expect.objectContaining({
          rule: TOPOLOGY_LINT_CODES.missingContractDependency,
          severity: 'warning',
          path: `projected.features[${featureKey}].requirements.contracts[${contractKey}]`,
        }),
      ]),
    );
  });

  it('retains fulfillment edges whose implementation target is outside the graph boundary', async () => {
    const fulfillmentId = '00000000-0000-4000-8000-000000000006';
    const projector = new WorkItemChangeSetProjectorService(
      {
        db: { task: { findMany: jest.fn().mockResolvedValue([]) } },
      } as any,
      {} as any,
      {} as any,
      {
        findIncident: jest.fn().mockResolvedValue([
          {
            id: fulfillmentId,
            sourceNodeId: stepId,
            sourceEntityType: 'TASK',
            targetNodeId: taskId,
            targetEntityType: 'TASK',
            type: 'FULFILLED_BY',
            category: 'meta',
            reasoning: 'Implementation evidence',
          },
        ]),
      } as any,
      (() => 'service-token') as any,
    );
    const topology = await projector.composeTopology({
      organizationId: '00000000-0000-4000-8000-000000000010' as any,
      projectId: '00000000-0000-4000-8000-000000000011' as any,
      projection: {
        valid: true,
        projectedRoot: node(workflowId, 'workflow'),
        children: [node(stepId, 'workflow_step', workflowId)],
        sections: [],
        incidentRelationships: [],
        identityLabels: {},
        issues: [],
        warnings: [],
      },
    });

    expect(
      lintProjectedTopology({
        ...topology,
        semantics,
      }).map((finding) => finding.rule),
    ).not.toContain(TOPOLOGY_LINT_CODES.missingFulfillment);
    expect(topology.relationships).toEqual([
      expect.objectContaining({
        identity: existing(fulfillmentId),
        source: existing(stepId),
        target: existing(taskId),
        edgeType: 'FULFILLED_BY',
      }),
    ]);
  });

  it('accepts complete topology and does not impose participant cardinality', () => {
    const complete = [
      relationship('r1', stepId, taskId, 'FULFILLED_BY'),
      relationship('r2', stepId, contractId, 'DEPENDS_ON'),
      relationship('r3', stepId, contractId, 'DEPENDS_ON'),
    ];
    expect(lint(complete)).toEqual([]);
  });

  it('distinguishes container-only and wrong Contract relationships', () => {
    const findings = lint([
      relationship('r1', stepId, taskId, 'FULFILLED_BY'),
      relationship('r2', workflowId, contractId, 'RELATED_TO'),
      relationship('r3', stepId, contractId, 'STANDARD', 'flow'),
    ]);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: TOPOLOGY_LINT_CODES.containerOnlyContractAttachment,
          path: 'projected.relationships[existing:r2]',
        }),
        expect.objectContaining({
          rule: TOPOLOGY_LINT_CODES.wrongContractRelationship,
          path: 'projected.relationships[existing:r3].edgeType',
        }),
      ]),
    );
  });
});
