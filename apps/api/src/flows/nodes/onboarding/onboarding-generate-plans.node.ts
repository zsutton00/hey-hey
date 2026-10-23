import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  ExtendedUIFieldType,
  OnboardingPlanStageProposalReviewUserSubmission,
  OnboardingPlanCandidateReviewPayload,
  SecondaryActionConfig,
  SecondaryActionHandler,
  UIElement,
} from '../../../generated';
import { ClaudeModel, LLMProviderName } from '../../../services/llm/llm-shared';
import { StandardPlaceholders as P } from '../../../services/llm/placeholders';
import {
  CompensationContext,
  CompensationResult,
  FlowUserMessage,
  GenerateNodeBase,
  IntermediateSystemMessageData,
  OnboardingPlanCandidate,
  OnboardingFlowContext,
  ProcessLlmResult,
} from '../../../types/flow-internal.types';
import { MessageContentExtractor } from '../../../utils/message-content-extractor';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { SHARED_NODES } from '../../constants/node-ids';

const onboardingPlanCandidateSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  outcome: z.string().min(1),
  evidenceWeight: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

const onboardingPlanGenerationResponseSchema = z
  .object({
    response: z.string().min(1),
    plans: z.array(onboardingPlanCandidateSchema).min(1).max(3),
  })
  .passthrough();

type OnboardingPlanGenerationResponse = z.infer<
  typeof onboardingPlanGenerationResponseSchema
>;

@Injectable()
export class OnboardingGeneratePlansNode extends GenerateNodeBase<OnboardingFlowContext> {
  readonly id = SHARED_NODES.GENERATE_PLANS;
  readonly title = 'Propose Initial Plans';
  readonly startMessage = 'Generating candidate plans...';

  readonly promptConfig = {
    modelCriteria: {
      model: ClaudeModel.CLAUDE_5_HAIKU_5,
      provider: LLMProviderName.CLAUDE,
    },
    timeout: 240000,
    maxTokens: 12000,
    systemPromptTemplate: (
      context: OnboardingFlowContext,
      userMessage?: FlowUserMessage,
    ) => this.buildSystemPrompt(context, userMessage),
    responseSchema: onboardingPlanGenerationResponseSchema,
  };

  async processUserResponse(
    tracker: MutableContextHandle<OnboardingFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const structured = this.getPlanStageProposalUserMessage(userMessage);
    if (!structured) {
      return;
    }

    if (structured.action === 'REFINE') {
      tracker.mutate((draft) => {
        if (!draft.onboardingPlanProposal) {
          return;
        }
        draft.onboardingPlanProposal.acceptedCandidateIds = undefined;
        draft.onboardingPlanProposal.feedbackError = undefined;
      });
      return;
    }

    if (structured.action !== 'APPROVED') {
      return;
    }

    const proposal = tracker.getContext().onboardingPlanProposal;
    if (!proposal?.candidates.length) {
      return;
    }

    const acceptedBySequence = new Set<number>();
    for (const feedback of structured.payload.stageFeedback) {
      if (feedback.action === 'accept') {
        acceptedBySequence.add(feedback.sequenceOrder);
      }
    }

    if (!acceptedBySequence.size) {
      tracker.mutate((draft) => {
        if (!draft.onboardingPlanProposal) {
          return;
        }
        draft.onboardingPlanProposal.acceptedCandidateIds = undefined;
        draft.onboardingPlanProposal.feedbackError =
          'Select at least one plan with action=accept before continuing.';
      });
      return;
    }

    const acceptedCandidateIds: string[] = [];
    let hasInvalidSequence = false;
    for (const sequenceOrder of acceptedBySequence) {
      const candidate = proposal.candidates[sequenceOrder - 1];
      if (!candidate) {
        hasInvalidSequence = true;
        continue;
      }
      acceptedCandidateIds.push(candidate.id);
    }

    if (hasInvalidSequence) {
      tracker.mutate((draft) => {
        if (!draft.onboardingPlanProposal) {
          return;
        }
        draft.onboardingPlanProposal.acceptedCandidateIds = undefined;
        draft.onboardingPlanProposal.feedbackError =
          'Invalid candidate selection detected. Please refresh selections and try again.';
      });
      return;
    }

    tracker.mutate((draft) => {
      if (!draft.onboardingPlanProposal) {
        return;
      }
      draft.onboardingPlanProposal.acceptedCandidateIds = acceptedCandidateIds;
      draft.onboardingPlanProposal.feedbackError = undefined;
    });
  }

  async processLlmResponse(
    planData: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContextHandle<OnboardingFlowContext>,
  ): Promise<ProcessLlmResult> {
    const parsed = this.requireValidResponse(planData);
    const rankedCandidates = this.rankCandidates(parsed);
    const round = (tracker.getContext().onboardingPlanProposal?.round ?? 0) + 1;

    tracker.mutate((draft) => {
      draft.onboardingPlanProposal = {
        round,
        response: parsed.response,
        candidates: rankedCandidates,
      };
    });

    const responseFieldId = 'onboarding_plan_candidate_proposals';
    const uiElements: UIElement[] = [
      {
        id: responseFieldId,
        type: ExtendedUIFieldType.PlanStageProposal,
        label: 'Review the proposed plans',
        placeholder: '',
        submitText: 'Approve Selected',
        multiline: false,
        required: false,
        influences: [],
        payload: this.buildStageProposalPayload(parsed, rankedCandidates),
        secondaryAction: {
          id: uuidv4(),
          type: SecondaryActionConfig.TypeEnum.FieldAction,
          presentation: SecondaryActionConfig.PresentationEnum.Button,
          label: 'Continue Revising',
          handler: SecondaryActionHandler.PlanStageContinueRevising,
          fieldId: responseFieldId,
          disabled: false,
          payload: {
            handlerType: 'plan_stage_continue_revising',
          },
        },
      },
    ];

    return {
      modifiedResult: {
        type: 'QUESTIONS',
        title: this.title,
        response:
          'Here are candidate plans ranked by evidence. Accept one or more plans, or continue revising.',
        detectedIntent: 'onboarding_plan_candidates_proposed',
        intentConfidence: 1,
        uiElements,
      },
    };
  }

  async determineRoutingFromUserMessage(
    context: Readonly<OnboardingFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    const structured = this.getPlanStageProposalUserMessage(userMessage);
    if (!structured) {
      return this.id;
    }

    if (structured.action === 'REFINE') {
      return this.id;
    }

    if (structured.action === 'APPROVED') {
      if (context.onboardingPlanProposal?.feedbackError) {
        return this.id;
      }
      if (!context.onboardingPlanProposal?.acceptedCandidateIds?.length) {
        return this.id;
      }
      return SHARED_NODES.CREATE_PLANS;
    }

    return this.id;
  }

  async compensate(
    _context: OnboardingFlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    if (errorClassification.type === 'TIMEOUT' && attemptCount < 3) {
      const delay = 8000 + attemptCount * 4000;
      return {
        action: 'RETRY',
        retryDelayMs: delay,
        reason: `Onboarding plan proposal timeout, retry ${attemptCount + 1}/3`,
      };
    }

    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 15000,
        reason: 'Onboarding plan proposal rate limited, retrying with delay',
      };
    }

    if (errorClassification.type === 'RETRYABLE' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 12000,
        reason: 'Onboarding plan proposal temporary failure, retrying',
      };
    }

    return { action: 'FAIL' };
  }

  private buildSystemPrompt(
    context: OnboardingFlowContext,
    userMessage?: FlowUserMessage,
  ): string {
    const sections: string[] = [
      'You are a principal product planner generating proposal-first onboarding plans.',
      `Conversation history:\n${P.CONVERSATION_HISTORY.insert({ includeTimestamp: false })}`,
      `Project maturity:\n${P.PROJECT_MATURITY.insert()}`,
      `Discovered insights:\n${P.INSIGHT_ARTIFACTS.insert()}`,
    ];

    const previousProposal = context.onboardingPlanProposal;
    if (previousProposal?.candidates.length) {
      sections.push(
        `Previous proposal (round ${previousProposal.round}):\n${previousProposal.candidates
          .map(
            (candidate, index) =>
              `${index + 1}. ${candidate.title} | ${candidate.description} | ${candidate.outcome} | score=${candidate.evidenceWeight.toFixed(2)} | rationale=${candidate.rationale}`,
          )
          .join('\n')}`,
      );
    }

    const feedback = this.getFeedbackSummary(
      userMessage,
      previousProposal?.candidates ?? [],
    );
    if (feedback) {
      sections.push(`Latest user feedback:\n${feedback}`);
    }

    sections.push(`Requirements:
- Return 1-3 candidate plans.
- Each plan must include exactly: title, description, outcome, evidenceWeight (0..1), rationale.
- Rank by evidenceWeight descending.
- Use concise, actionable wording and avoid proper names unless user provided them.
- If feedback requests revisions, refine the latest proposal and overwrite prior round candidates.

Return JSON:
{
  "response": "short message for the user",
  "plans": [
    {
      "title": "string",
      "description": "string",
      "outcome": "string",
      "evidenceWeight": 0.85,
      "rationale": "string"
    }
  ]
}`);

    return sections.join('\n\n');
  }

  private requireValidResponse(
    data: IntermediateSystemMessageData,
  ): OnboardingPlanGenerationResponse {
    const parsed = onboardingPlanGenerationResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(
        `Onboarding plan proposal response invalid: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  private rankCandidates(
    response: OnboardingPlanGenerationResponse,
  ): OnboardingPlanCandidate[] {
    const ranked = [...response.plans]
      .sort((a, b) => b.evidenceWeight - a.evidenceWeight)
      .slice(0, 3);

    return ranked.map((candidate) => ({
      id: uuidv4(),
      title: candidate.title,
      description: candidate.description,
      outcome: candidate.outcome,
      evidenceWeight: candidate.evidenceWeight,
      rationale: candidate.rationale,
    }));
  }

  private buildStageProposalPayload(
    response: OnboardingPlanGenerationResponse,
    candidates: OnboardingPlanCandidate[],
  ): OnboardingPlanCandidateReviewPayload {
    return {
      response: response.response,
      stages: candidates.map((candidate, index) => ({
        title: candidate.title,
        description: candidate.description,
        purpose: candidate.outcome,
        timing: `Evidence rank score: ${candidate.evidenceWeight.toFixed(2)}`,
        sequenceOrder: index + 1,
        itemCounts: {
          tasks: 0,
          designDocs: 0,
          services: 0,
        },
      })),
    };
  }

  private isPlanStageProposalUserMessage(
    data: unknown,
  ): data is OnboardingPlanStageProposalReviewUserSubmission {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return false;
    }

    const candidate = data as {
      action?: unknown;
      payload?: unknown;
    };
    return (
      (candidate.action === 'REFINE' || candidate.action === 'APPROVED') &&
      typeof candidate.payload === 'object' &&
      candidate.payload !== null &&
      !Array.isArray(candidate.payload)
    );
  }

  private getPlanStageProposalUserMessage(
    userMessage?: FlowUserMessage,
  ): OnboardingPlanStageProposalReviewUserSubmission | undefined {
    const userMessageData = userMessage?.data;
    if (!userMessageData) {
      return undefined;
    }

    for (const value of Object.values(userMessageData)) {
      if (this.isPlanStageProposalUserMessage(value)) {
        return value;
      }
    }

    return undefined;
  }

  private getFeedbackSummary(
    userMessage: FlowUserMessage | undefined,
    candidates: OnboardingPlanCandidate[],
  ): string {
    if (!userMessage) {
      return '';
    }

    const structured = this.getPlanStageProposalUserMessage(userMessage);
    if (!structured) {
      return this.extractMessageText(userMessage);
    }

    const lines: string[] = [];
    if (structured.payload.userMessage?.trim()) {
      lines.push(structured.payload.userMessage.trim());
    }

    for (const feedback of structured.payload.stageFeedback) {
      const candidate = candidates[feedback.sequenceOrder - 1];
      const candidateLabel = candidate?.title ?? feedback.title;
      const comment = feedback.comment?.trim();
      lines.push(
        comment
          ? `Candidate ${feedback.sequenceOrder} (${candidateLabel}) action=${feedback.action}: ${comment}`
          : `Candidate ${feedback.sequenceOrder} (${candidateLabel}) action=${feedback.action}`,
      );
    }

    return lines.join('\n').trim();
  }

  private extractMessageText(userMessage?: FlowUserMessage): string {
    if (!userMessage) {
      return '';
    }
    const extracted =
      MessageContentExtractor.extractMessageContent(userMessage);
    if (
      extracted === '[No response provided]' ||
      extracted === '[Unable to extract message content]'
    ) {
      return '';
    }
    return extracted.trim();
  }
}
