import type { OrganizationId, ProjectId } from 'src/types';
import type { AuthenticatedUser } from 'src/auth/strategies/jwt.strategy';
import type {
  CreateProposalDto,
  CreateProposalRequestDto,
} from 'src/generated';
import type { ProposalValidationIssue as GeneratedProposalValidationIssue } from 'src/generated/model/proposalValidationIssue';
import type { ProposalValidationLayer } from 'src/generated/model/proposalValidationLayer';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';

/**
 * The three validation layers the engine evaluates, in order.
 */
export type ValidationLayer = ProposalValidationLayer;

/**
 * A single validation issue with field path, machine-readable code,
 * human-readable reason, and an optional remediation suggestion.
 */
export type ProposalValidationIssue = GeneratedProposalValidationIssue;

/**
 * Validation result for a single proposal within a batch.
 */
export interface SingleProposalValidationResult {
  index: number;
  valid: boolean;
  errors: ProposalValidationIssue[];
  warnings: ProposalValidationIssue[];
}

/**
 * Top-level validation result returned by the engine.
 * For single proposals, `proposals` has one entry.
 * For batch proposals, each entry corresponds to one DTO by index.
 */
export interface ProposalValidationResult {
  valid: boolean;
  proposals: SingleProposalValidationResult[];
}

/**
 * Context needed by the engine to run referential and permission checks.
 */
export interface ProposalValidationContext {
  organizationId: OrganizationId;
  projectId: ProjectId;
  requestor: AuthenticatedUser;
  /**
   * Finalization supplies its transaction client so validation observes the
   * same locked revision that will be frozen.
   */
  db?: AnyTransactionClient;
  /**
   * Explicitly scoped identities reserved by CREATE members in one BUILDING
   * group. Ordinary proposal validation omits this context and therefore
   * continues to require materialized entities.
   */
  group?: {
    groupId: string;
    reservedEntities: ReadonlyArray<{
      entityId: string;
      entityType: string;
      workItemType?: string;
    }>;
  };
}

/**
 * Input to the engine: one or more DTOs plus the surrounding context.
 */
export interface ValidateProposalsInput {
  proposals: CreateProposalDto[];
  context: ProposalValidationContext;
}

export interface ValidateProposalAuthoringCandidatesInput<
  TProposal extends CreateProposalRequestDto = CreateProposalRequestDto,
> {
  proposals: TProposal[];
  context: Omit<ProposalValidationContext, 'requestor'>;
}
