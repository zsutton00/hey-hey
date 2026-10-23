import type {
  ProjectedWorkItem,
  ProjectedWorkItemRelationship,
  WorkItemChangeSetIdentity,
  WorkItemChangeSetRelationshipIdentity,
} from 'src/generated';
import type { ProjectedTopologySemantics } from 'src/services/tasks/work-item-type-registry.service';
import type { LintFinding } from './proposal-lint';

export const TOPOLOGY_LINT_CODES = {
  missingFulfillment: 'workflow_step_missing_fulfillment',
  missingContractDependency: 'feature_contract_missing_step_dependency',
  containerOnlyContractAttachment:
    'workflow_contract_container_only_attachment',
  wrongContractRelationship: 'contract_participation_wrong_relationship_type',
} as const;

export interface ProjectedTopologyLintInput {
  nodes: readonly ProjectedWorkItem[];
  relationships: readonly ProjectedWorkItemRelationship[];
  semantics: ProjectedTopologySemantics;
  featureContractCitations: ReadonlyMap<string, ReadonlySet<string>>;
  participatingFeatureByWorkflowNode: ReadonlyMap<string, string>;
}

export function workItemIdentityKey(
  identity: WorkItemChangeSetIdentity | undefined,
): string {
  if (!identity) return '';
  return identity.refType === 'existing'
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;
}

function relationshipIdentityKey(
  identity: WorkItemChangeSetRelationshipIdentity,
): string {
  return identity.refType === 'existing'
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;
}

function warning(
  rule: (typeof TOPOLOGY_LINT_CODES)[keyof typeof TOPOLOGY_LINT_CODES],
  path: string,
  message: string,
  suggestion: string,
): LintFinding {
  return { rule, severity: 'warning', path, message, suggestion };
}

export function lintProjectedTopology(
  input: ProjectedTopologyLintInput,
): LintFinding[] {
  const nodes = input.nodes.filter((node) => !node.deleted);
  const relationships = input.relationships.filter(
    (relationship) => !relationship.deleted,
  );
  const nodeByKey = new Map(
    nodes.map((node) => [workItemIdentityKey(node.identity), node]),
  );
  const findings: LintFinding[] = [];

  for (const step of nodes.filter(input.semantics.isWorkflowStep)) {
    const stepKey = workItemIdentityKey(step.identity);
    const hasFulfillment = relationships.some(
      (relationship) =>
        workItemIdentityKey(relationship.source) === stepKey &&
        input.semantics.isFulfillment(relationship),
    );
    if (!hasFulfillment) {
      findings.push(
        warning(
          TOPOLOGY_LINT_CODES.missingFulfillment,
          `projected.nodes[${stepKey}].relationships`,
          `Workflow step "${step.name}" has no projected FULFILLED_BY implementation evidence.`,
          'Add a FULFILLED_BY relationship from this workflow step to its implementing STANDARD task.',
        ),
      );
    }
  }

  for (const [featureKey, contractKeys] of input.featureContractCitations) {
    const participatingKeys = new Set(
      [...input.participatingFeatureByWorkflowNode]
        .filter(([, ownerFeatureKey]) => ownerFeatureKey === featureKey)
        .map(([workflowNodeKey]) => workflowNodeKey),
    );
    if (participatingKeys.size === 0) continue;

    const participatingStepKeys = new Set(
      [...participatingKeys].filter((key) => {
        const node = nodeByKey.get(key);
        return node !== undefined && input.semantics.isWorkflowStep(node);
      }),
    );
    for (const contractKey of contractKeys) {
      const hasResponsibleStep = relationships.some(
        (relationship) =>
          participatingStepKeys.has(workItemIdentityKey(relationship.source)) &&
          workItemIdentityKey(relationship.target) === contractKey &&
          input.semantics.isContractDependency(relationship),
      );
      if (!hasResponsibleStep) {
        findings.push(
          warning(
            TOPOLOGY_LINT_CODES.missingContractDependency,
            `projected.features[${featureKey}].requirements.contracts[${contractKey}]`,
            'A workflow-participating feature cites this Contract, but no participating workflow step originates DEPENDS_ON to it.',
            'Attach DEPENDS_ON only to the workflow step responsible for authoring or enforcing the agreement.',
          ),
        );
      }
    }
  }

  const contractKeys = new Set(
    nodes
      .filter(input.semantics.isContract)
      .map((node) => workItemIdentityKey(node.identity)),
  );
  for (const cited of input.featureContractCitations.values()) {
    cited.forEach((contractKey) => contractKeys.add(contractKey));
  }

  for (const relationship of relationships) {
    if (!contractKeys.has(workItemIdentityKey(relationship.target))) continue;
    const source = nodeByKey.get(workItemIdentityKey(relationship.source));
    if (!source) continue;
    const path = `projected.relationships[${relationshipIdentityKey(
      relationship.identity,
    )}]`;
    if (input.semantics.isWorkflow(source)) {
      findings.push(
        warning(
          TOPOLOGY_LINT_CODES.containerOnlyContractAttachment,
          path,
          'A workflow-container Contract attachment does not identify the responsible workflow step.',
          'Keep broad workflow context if useful, and add DEPENDS_ON from the responsible workflow step.',
        ),
      );
    }
    if (
      (input.semantics.isWorkflow(source) ||
        input.semantics.isWorkflowStep(source)) &&
      (input.semantics.isFlow(relationship) ||
        input.semantics.isFulfillment(relationship))
    ) {
      findings.push(
        warning(
          TOPOLOGY_LINT_CODES.wrongContractRelationship,
          `${path}.edgeType`,
          'Flow and fulfillment relationships do not represent Contract participation.',
          'Use workflow_step DEPENDS_ON Contract for the responsible agreement dependency.',
        ),
      );
    }
  }

  return findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.rule.localeCompare(right.rule),
  );
}
