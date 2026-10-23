import { Injectable } from '@nestjs/common';
import type { ProjectId } from 'src/types';
import type {
  PermissionRule,
  RuleApprovalConfig,
} from './permission-evaluation';

export interface ProjectApprovalPolicy {
  readonly requiredApprovals: number;
  readonly rules: readonly PermissionRule[];
  readonly fallback: RuleApprovalConfig;
}

const IMMEDIATE = { policy: 'IMMEDIATE' } as const;
const PROJECT_REQUIRED = { policy: 'PROJECT_REQUIRED' } as const;

export const DEFAULT_PROJECT_APPROVAL_POLICY: ProjectApprovalPolicy = {
  requiredApprovals: 1,
  rules: [
    {
      match: {
        entity: { type: 'GOAL' },
        proposal: { source: 'user', action: 'UPDATE', statusOnlyChange: true },
      },
      config: {
        requiresProposal: true,
        threshold: IMMEDIATE,
        allowsProposerApproval: true,
      },
    },
    {
      match: {
        entity: { type: 'GOAL' },
        proposal: { source: 'user', action: 'UPDATE' },
      },
      config: {
        requiresProposal: true,
        threshold: PROJECT_REQUIRED,
        allowsProposerApproval: true,
      },
    },
    {
      match: {
        entity: { type: 'DESIGN_DOC' },
        proposal: { source: 'user' },
      },
      config: {
        requiresProposal: true,
        threshold: IMMEDIATE,
        allowsProposerApproval: true,
      },
    },
    {
      match: {
        entity: { type: 'DESIGN_DOC' },
        proposal: { source: 'agent' },
      },
      config: {
        requiresProposal: true,
        threshold: PROJECT_REQUIRED,
        allowsProposerApproval: false,
      },
    },
    {
      match: {
        entity: { type: 'PLAN_STAGE' },
        proposal: { source: 'user' },
      },
      config: {
        requiresProposal: true,
        threshold: IMMEDIATE,
        allowsProposerApproval: true,
      },
    },
    {
      match: {
        entity: { type: 'PLAN_STAGE' },
        proposal: { source: 'agent' },
      },
      config: {
        requiresProposal: true,
        threshold: PROJECT_REQUIRED,
        allowsProposerApproval: false,
      },
    },
    {
      match: {
        entity: { type: 'WORK_ITEM_TYPE' },
        proposal: { source: 'user' },
      },
      config: {
        requiresProposal: true,
        threshold: IMMEDIATE,
        allowsProposerApproval: true,
      },
    },
    {
      match: {
        entity: { type: 'WORK_ITEM_TYPE' },
        proposal: { source: 'agent' },
      },
      config: {
        requiresProposal: true,
        threshold: PROJECT_REQUIRED,
        allowsProposerApproval: false,
      },
    },
    {
      // User-authenticated monitor runtime maintenance must stay immediate.
      // Keep this source-qualified and UPDATE-only to avoid an agent bypass.
      match: {
        entity: { type: 'TASK_MONITOR' },
        proposal: { source: 'user', action: 'UPDATE' },
      },
      config: {
        requiresProposal: true,
        threshold: IMMEDIATE,
        allowsProposerApproval: true,
      },
    },
    {
      // The onboarding generator and its user confirmation share one flow.
      // Keep its explicit one-human requirement ahead of general FEATURE rules.
      match: {
        entity: { type: 'FEATURE', topLevel: true },
        proposal: { source: 'agent', toolName: 'shared-generate-features' },
      },
      config: {
        requiresProposal: true,
        threshold: { policy: 'FIXED_REQUIRED', requiredApprovals: 1 },
        allowsProposerApproval: false,
      },
    },
    {
      match: {
        entity: { type: 'FEATURE', topLevel: true },
        proposal: { source: 'user', hasContentChange: true },
      },
      config: {
        requiresProposal: true,
        threshold: IMMEDIATE,
        allowsProposerApproval: true,
      },
    },
    {
      match: {
        entity: { type: 'FEATURE', topLevel: true },
        proposal: { hasContentChange: true },
      },
      config: {
        requiresProposal: true,
        threshold: PROJECT_REQUIRED,
        allowsProposerApproval: false,
      },
    },
    {
      match: {
        entity: { type: 'FEATURE', topLevel: true },
        proposal: { source: 'user', hasContentChange: false },
      },
      config: {
        requiresProposal: true,
        threshold: IMMEDIATE,
        allowsProposerApproval: true,
      },
    },
    {
      match: {
        entity: { type: 'FEATURE', topLevel: true },
        proposal: { source: 'agent', hasContentChange: false },
      },
      config: {
        requiresProposal: true,
        threshold: PROJECT_REQUIRED,
        allowsProposerApproval: false,
      },
    },
    {
      match: {
        entity: { topLevel: false },
        proposal: { source: 'user' },
      },
      config: {
        requiresProposal: true,
        threshold: IMMEDIATE,
        allowsProposerApproval: true,
      },
    },
    {
      match: {
        entity: { topLevel: false },
        proposal: { source: 'agent' },
      },
      config: {
        requiresProposal: true,
        threshold: PROJECT_REQUIRED,
        allowsProposerApproval: false,
      },
    },
  ],
  fallback: {
    requiresProposal: false,
    threshold: PROJECT_REQUIRED,
    allowsProposerApproval: false,
  },
};

export function createDefaultProjectApprovalPolicy(
  requiredApprovals = DEFAULT_PROJECT_APPROVAL_POLICY.requiredApprovals,
): ProjectApprovalPolicy {
  return {
    requiredApprovals,
    rules: DEFAULT_PROJECT_APPROVAL_POLICY.rules.map((rule) => ({
      match: {
        ...(rule.match.entity
          ? { entity: { ...rule.match.entity } }
          : undefined),
        ...(rule.match.proposal
          ? { proposal: { ...rule.match.proposal } }
          : undefined),
      },
      config: {
        ...rule.config,
        threshold: { ...rule.config.threshold },
      },
    })),
    fallback: {
      ...DEFAULT_PROJECT_APPROVAL_POLICY.fallback,
      threshold: { ...DEFAULT_PROJECT_APPROVAL_POLICY.fallback.threshold },
    },
  };
}

@Injectable()
export class ProjectApprovalPolicyService {
  async resolve(_projectId: ProjectId): Promise<ProjectApprovalPolicy> {
    return createDefaultProjectApprovalPolicy();
  }
}
