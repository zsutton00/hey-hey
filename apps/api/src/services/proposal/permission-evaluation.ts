import type { ProjectApprovalPolicy } from './project-approval-policy.service';

export interface ApprovalConfig {
  requiresProposal: boolean;
  threshold: number;
  /** Whether a user-source proposal author contributes one approval. */
  allowsProposerApproval: boolean;
}

export interface EntityContext {
  type: string;
  parentTaskId: string | null;
  initiativeId: string | null;
}

export interface ProposalContext {
  source: 'user' | 'agent';
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  authorId: string;
  /** Server-resolved users who may contribute an approval in this project. */
  eligibleProjectMemberIds: readonly string[];
  /**
   * The `requestorContext.toolName` of the proposal's author — the MCP tool
   * name for agent-via-MCP proposals, the flow node id for agent-via-flow
   * proposals, `null` for user-source proposals. Rules may use this to match
   * a policy to one specific authoring boundary.
   */
  toolName: string | null;
  /**
   * The set of canonical field paths the proposal touches. Used to gate
   * which top-level FEATURE edits require multi-human approval. Field names
   * use dot paths (e.g. `'sections.description'`). Pass an empty array
   * when the proposal targets an entity for which changedFields are not
   * defined (e.g. CREATE proposals or non-task entities); the evaluator
   * treats the absence of content fields as "no content change".
   */
  changedFields: readonly string[];
}

export interface EntityMatch {
  type?: string;
  topLevel?: boolean;
}

export interface ProposalMatch {
  source?: 'user' | 'agent';
  action?: 'CREATE' | 'UPDATE' | 'DELETE';
  toolName?: string;
  hasContentChange?: boolean;
  statusOnlyChange?: boolean;
}

export interface PermissionRule {
  match: {
    entity?: EntityMatch;
    proposal?: ProposalMatch;
  };
  config: RuleApprovalConfig;
}

/** Proposal is applied immediately at creation time — no human approval step. */
export const AUTO_APPROVED = 0;
export type RuleThreshold =
  | { readonly policy: 'IMMEDIATE' }
  | { readonly policy: 'PROJECT_REQUIRED' }
  | { readonly policy: 'FIXED_REQUIRED'; readonly requiredApprovals: number };

export type RuleApprovalConfig = Omit<ApprovalConfig, 'threshold'> & {
  threshold: RuleThreshold;
};

/**
 * Canonical field paths classified as top-level FEATURE content. The generic
 * matcher exposes this classification through `hasContentChange`; the
 * resolved project policy owns every outcome associated with it.
 */
export const TOP_LEVEL_FEATURE_CONTENT_FIELDS: readonly string[] = [
  'name',
  'sections.description',
  'sections.requirements',
  'sections.acceptanceCriteria',
] as const;

function hasContentChange(changedFields: readonly string[]): boolean {
  return changedFields.some((field) =>
    TOP_LEVEL_FEATURE_CONTENT_FIELDS.includes(field),
  );
}

function isStatusOnlyChange(changedFields: readonly string[]): boolean {
  return changedFields.length === 1 && changedFields[0] === 'status';
}

export function matchesRule(
  entity: EntityContext,
  proposal: ProposalContext,
  match: PermissionRule['match'],
): boolean {
  if (match.entity) {
    if (match.entity.type !== undefined && match.entity.type !== entity.type) {
      return false;
    }
    if (match.entity.topLevel !== undefined) {
      // FEATUREs sit at the product-structure root: a FEATURE with no
      // parentTaskId is top-level even when grouped under an initiative.
      // For non-FEATURE entities, an initiativeId counts as a parent — a
      // plan-embedded task with only an initiative is not "orphan".
      const isTopLevel =
        entity.parentTaskId === null &&
        (entity.type === 'FEATURE' || entity.initiativeId === null);
      if (match.entity.topLevel !== isTopLevel) {
        return false;
      }
    }
  }

  if (match.proposal) {
    if (
      match.proposal.action !== undefined &&
      match.proposal.action !== proposal.action
    ) {
      return false;
    }
    if (
      match.proposal.source !== undefined &&
      match.proposal.source !== proposal.source
    ) {
      return false;
    }
    if (
      match.proposal.toolName !== undefined &&
      match.proposal.toolName !== proposal.toolName
    ) {
      return false;
    }
    if (match.proposal.hasContentChange !== undefined) {
      if (
        match.proposal.hasContentChange !==
        hasContentChange(proposal.changedFields)
      ) {
        return false;
      }
    }
    if (match.proposal.statusOnlyChange !== undefined) {
      if (
        match.proposal.statusOnlyChange !==
        isStatusOnlyChange(proposal.changedFields)
      ) {
        return false;
      }
    }
  }

  return true;
}

export function evaluatePermissions(
  entity: EntityContext,
  proposal: ProposalContext,
  projectPolicy: ProjectApprovalPolicy,
): ApprovalConfig {
  if (
    !Array.isArray(proposal.eligibleProjectMemberIds) ||
    proposal.eligibleProjectMemberIds.length === 0
  ) {
    throw new Error(
      'Permission evaluation requires at least one server-resolved eligible project member',
    );
  }
  if (!proposal.action) {
    throw new Error('Permission evaluation requires a proposal action');
  }

  for (const rule of projectPolicy.rules) {
    if (matchesRule(entity, proposal, rule.match)) {
      return resolveApprovalConfig(rule.config, proposal, projectPolicy);
    }
  }
  return resolveApprovalConfig(projectPolicy.fallback, proposal, projectPolicy);
}

function resolveApprovalConfig(
  config: RuleApprovalConfig,
  proposal: ProposalContext,
  projectPolicy: ProjectApprovalPolicy,
): ApprovalConfig {
  const resolvedThreshold = resolveRuleThreshold(
    config.threshold,
    projectPolicy,
  );
  return {
    ...config,
    threshold:
      proposal.eligibleProjectMemberIds.length === 1
        ? Math.min(resolvedThreshold, 1)
        : resolvedThreshold,
    allowsProposerApproval:
      config.allowsProposerApproval &&
      proposal.source === 'user' &&
      proposal.eligibleProjectMemberIds.includes(proposal.authorId),
  };
}

function resolveRuleThreshold(
  threshold: RuleThreshold,
  projectPolicy: ProjectApprovalPolicy,
): number {
  switch (threshold.policy) {
    case 'IMMEDIATE':
      return AUTO_APPROVED;
    case 'PROJECT_REQUIRED':
      if (
        !Number.isInteger(projectPolicy.requiredApprovals) ||
        projectPolicy.requiredApprovals < 1
      ) {
        throw new Error(
          'Project approval requirements must be positive integers',
        );
      }
      return projectPolicy.requiredApprovals;
    case 'FIXED_REQUIRED':
      if (
        !Number.isInteger(threshold.requiredApprovals) ||
        threshold.requiredApprovals < 1
      ) {
        throw new Error(
          'Fixed approval requirements must be positive integers',
        );
      }
      return threshold.requiredApprovals;
  }
}
