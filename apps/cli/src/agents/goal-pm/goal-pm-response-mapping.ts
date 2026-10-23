import type {
  GoalPmCreateMissingWorkOption,
  GoalPmExistingConversationOption,
  GoalPmPlanTarget,
  GoalPmProposalOption,
  GoalPmRefineSearchOption,
  GoalPmRoutingEvidence,
  GoalPmRoutingOption,
  GoalPmRoutingPayload,
  GoalPmStartNewConversationOption,
  GoalPmTaskTarget,
  GoalPmTrackExistingWorkOption,
} from '../../shared/api/index';
import type {
  LocalGoalPmRoutingEvidence,
  LocalGoalPmRoutingOption,
  LocalGoalPmRoutingResponse,
  LocalGoalPmWorkTarget,
} from '../../shared/agent-bridge-contract/index';

const mapEvidence = (evidence: LocalGoalPmRoutingEvidence): GoalPmRoutingEvidence => ({
  messageId: evidence.messageId,
  excerpt: evidence.excerpt,
  rationale: evidence.rationale,
});

const mapWorkTarget = (target: LocalGoalPmWorkTarget): GoalPmTaskTarget | GoalPmPlanTarget => {
  switch (target.entityType) {
    case 'TASK':
      return {
        entityType: target.entityType,
        entityId: target.entityId,
        title: target.title,
      };
    case 'PLAN':
      return {
        entityType: target.entityType,
        entityId: target.entityId,
        title: target.title,
      };
  }
};

const mapExistingConversation = (
  option: Extract<LocalGoalPmRoutingOption, { kind: 'existingConversation' }>,
): GoalPmExistingConversationOption => ({
  optionId: option.optionId,
  kind: option.kind,
  conversationId: option.conversationId,
  title: option.title,
  evidence: option.evidence.map(mapEvidence),
  rationale: option.rationale,
});

const mapStartNewConversation = (
  option: Extract<LocalGoalPmRoutingOption, { kind: 'startNewConversation' }>,
): GoalPmStartNewConversationOption => ({
  optionId: option.optionId,
  kind: option.kind,
  title: option.title,
  rationale: option.rationale,
  requiresConfirmation: option.requiresConfirmation,
});

const mapRefineSearch = (
  option: Extract<LocalGoalPmRoutingOption, { kind: 'refineSearch' }>,
): GoalPmRefineSearchOption => ({
  optionId: option.optionId,
  kind: option.kind,
  title: option.title,
  prompt: option.prompt,
  rationale: option.rationale,
});

const mapTrackExistingWork = (
  option: Extract<LocalGoalPmRoutingOption, { kind: 'trackExistingWork' }>,
): GoalPmTrackExistingWorkOption => ({
  optionId: option.optionId,
  kind: option.kind,
  target: mapWorkTarget(option.target),
  rationale: option.rationale,
  requiresSelection: option.requiresSelection,
});

const mapCreateMissingWork = (
  option: Extract<LocalGoalPmRoutingOption, { kind: 'createMissingWork' }>,
): GoalPmCreateMissingWorkOption => ({
  optionId: option.optionId,
  kind: option.kind,
  parentFeatureId: option.parentFeatureId,
  workItemType: option.workItemType,
  title: option.title,
  description: option.description,
  acceptanceCriteria: option.acceptanceCriteria,
  authoringMode: option.authoringMode,
  rationale: option.rationale,
  requiresSelection: option.requiresSelection,
});

const mapProposal = (
  option: Extract<LocalGoalPmRoutingOption, { kind: 'proposal' }>,
): GoalPmProposalOption => ({
  optionId: option.optionId,
  kind: option.kind,
  proposalId: option.proposalId,
  title: option.title,
  rationale: option.rationale,
  requiresSelection: option.requiresSelection,
});

const mapOption = (option: LocalGoalPmRoutingOption): GoalPmRoutingOption => {
  switch (option.kind) {
    case 'existingConversation':
      return mapExistingConversation(option);
    case 'startNewConversation':
      return mapStartNewConversation(option);
    case 'refineSearch':
      return mapRefineSearch(option);
    case 'trackExistingWork':
      return mapTrackExistingWork(option);
    case 'createMissingWork':
      return mapCreateMissingWork(option);
    case 'proposal':
      return mapProposal(option);
  }
};

export const mapGoalPmRouting = (response: LocalGoalPmRoutingResponse): GoalPmRoutingPayload => {
  const payload = {
    goalId: response.goalId,
    options: response.options.map(mapOption),
  } satisfies GoalPmRoutingPayload;
  return payload;
};
