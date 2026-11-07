import type {
  ProjectApprovalPolicyRule,
  ProjectApprovalPolicySnapshot,
  ProjectApprovalPolicyEffectiveRule,
} from 'src/generated';
import {
  ProjectApprovalPolicyStore,
  type StoredProjectApprovalPolicy,
} from './project-approval-policy.store';
import { ProjectApprovalPolicyValidation } from './project-approval-policy.validation';
import { Injectable, Logger } from '@nestjs/common';
import type { ProjectId } from 'src/types';
import {
  ruleConditions,
  type PermissionRule,
  type RuleApprovalConfig,
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
      source: rule.source ?? (isFixed(rule) ? 'FIXED' : 'DEFAULT'),
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
  private readonly logger = new Logger(ProjectApprovalPolicyService.name);
  constructor(
    private readonly store: ProjectApprovalPolicyStore,
    private readonly validation: ProjectApprovalPolicyValidation,
  ) {}

  async resolve(projectId: ProjectId): Promise<ProjectApprovalPolicy> {
    const stored = await this.store.read(projectId);
    return this.effective(projectId, stored).policy;
  }

  async snapshot(projectId: ProjectId): Promise<ProjectApprovalPolicySnapshot> {
    return this.snapshotFromStored(projectId, await this.store.read(projectId));
  }

  snapshotFromStored(
    projectId: ProjectId,
    stored: StoredProjectApprovalPolicy,
  ): ProjectApprovalPolicySnapshot {
    const { policy, rules } = this.effective(projectId, stored);
    return {
      projectId,
      revision: stored.revision,
      hasProjectOverride: stored.rules !== null,
      rules,
      fallback: {
        source: 'DEFAULT',
        editable: false,
        requiresProposal: false,
        requirement: 'PROJECT_REQUIRED',
        requiredApprovals: policy.requiredApprovals,
        allowsProposerApproval: false,
      },
    };
  }

  private effective(
    projectId: ProjectId,
    stored: StoredProjectApprovalPolicy,
  ): {
    policy: ProjectApprovalPolicy;
    rules: ProjectApprovalPolicyEffectiveRule[];
  } {
    const defaults = createDefaultProjectApprovalPolicy();
    const projectRules =
      stored.rules === null
        ? null
        : this.validation.saved(stored.rules, projectId);
    const entries = defaults.rules.map(
      (rule) =>
        ({ rule, source: isFixed(rule) ? 'FIXED' : 'DEFAULT' }) as const,
    );
    const effectiveEntries =
      projectRules === null
        ? entries
        : [
            ...entries.filter((entry) => entry.source === 'FIXED'),
            ...projectRules.map(
              (rule) =>
                ({
                  rule: compileProjectRule(rule),
                  source: 'PROJECT',
                }) as const,
            ),
            ...entries.filter((entry) => entry.source === 'DEFAULT'),
          ];
    this.logger.debug('Project approval policy resolved', {
      projectId,
      revision: stored.revision,
      source: projectRules === null ? 'DEFAULT' : 'PROJECT',
    });
    return {
      policy: {
        ...defaults,
        rules: effectiveEntries.map(({ rule, source }) => ({
          ...rule,
          source,
        })),
      },
      rules: effectiveEntries.map(({ rule, source }, order) => ({
        order,
        source,
        editable: source === 'PROJECT',
        conditions: ruleConditions(rule),
        requirement: rule.config.threshold.policy,
        requiredApprovals:
          rule.config.threshold.policy === 'IMMEDIATE'
            ? 0
            : (rule.config.threshold.requiredApprovals ??
              defaults.requiredApprovals),
        allowsProposerApproval: rule.config.allowsProposerApproval,
      })),
    };
  }
}

function isFixed(rule: PermissionRule): boolean {
  return rule.config.threshold.policy === 'FIXED_REQUIRED';
}

function compileProjectRule(rule: ProjectApprovalPolicyRule): PermissionRule {
  return {
    match: {
      entity: {
        ...(rule.conditions.typeKey === undefined
          ? {}
          : { type: rule.conditions.typeKey }),
      },
      proposal: {
        ...(rule.conditions.author === undefined
          ? {}
          : { source: rule.conditions.author === 'USER' ? 'user' : 'agent' }),
        ...(rule.conditions.action === undefined
          ? {}
          : { action: rule.conditions.action }),
        ...(rule.conditions.change === 'STATUS_ONLY'
          ? { statusOnlyChange: true }
          : {}),
        ...(rule.conditions.change === 'CONTENT_CHANGE'
          ? { contentChange: true }
          : {}),
      },
    },
    config: {
      requiresProposal: true,
      threshold:
        rule.requirement === 'IMMEDIATE'
          ? { policy: 'IMMEDIATE' }
          : {
              policy: 'PROJECT_REQUIRED',
              requiredApprovals: rule.requiredApprovals,
            },
      allowsProposerApproval: rule.allowsProposerApproval,
    },
  };
}
