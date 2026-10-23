import { Logger } from '@nestjs/common';
import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import {
  ArtifactType,
  CodingPromptUserMessage,
  ExtendedUIFieldType,
  OnboardingFeatureListReviewUserSubmission,
  OnboardingPlanStageProposalReviewUserSubmission,
  PlanApprovalUserMessage,
  PlanStageProposalUserMessage,
  QAPairData,
  SuggestedActionUserMessage,
  SystemMessageData,
  UIElement,
} from '../generated';
import { isQuestionSystemMessageData } from './type-checks';

export interface QuestionAnswerPair
  extends Omit<QAPairData, 'type' | 'userMessageId' | 'systemMessageId'> {
  uiElement: UIElement | null;
  round: number;
  artifactType: string;
  question: string;
  answer: string;
  questionField?: string;
}

export interface ProcessedUserResponses {
  validResponses: QuestionAnswerPair[];
  skippedResponses: {
    key: string;
    reason: 'empty' | 'too_short' | 'invalid_type';
    value: unknown;
  }[];
}

type ResponseTextExtractor = (value: unknown) => string | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractUserMessageText(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const userMessage = value.userMessage;
  if (typeof userMessage !== 'string') {
    return undefined;
  }
  const trimmed = userMessage.trim();
  return trimmed ? trimmed : undefined;
}

function isPlanStageProposalUserMessage(
  value: unknown,
): value is PlanStageProposalUserMessage {
  return (
    isRecord(value) &&
    value.type === PlanStageProposalUserMessage.TypeEnum.PlanStageProposal
  );
}

function extractPlanStageProposalText(value: unknown): string | undefined {
  if (isOnboardingPlanStageProposalReview(value)) {
    const parts: string[] = [];
    const userMessage = value.payload.userMessage?.trim();
    if (userMessage) {
      parts.push(userMessage);
    }

    for (const feedback of value.payload.stageFeedback) {
      const comment = feedback.comment?.trim();
      const actionLabel =
        feedback.action && feedback.action !== 'pending'
          ? ` [${feedback.action}]`
          : '';
      if (!comment && !actionLabel) {
        continue;
      }
      const commentText = comment ? `: ${comment}` : '';
      parts.push(
        `Stage ${feedback.sequenceOrder} (${feedback.title})${actionLabel}${commentText}`,
      );
    }

    return parts.length > 0 ? parts.join('\n') : undefined;
  }

  if (!isPlanStageProposalUserMessage(value)) {
    return undefined;
  }

  const parts: string[] = [];
  const userMessage = value.userMessage?.trim();
  if (userMessage) {
    parts.push(userMessage);
  }

  for (const feedback of value.stageFeedback ?? []) {
    const comment = feedback.comment?.trim();
    const actionLabel =
      feedback.action && feedback.action !== 'pending'
        ? ` [${feedback.action}]`
        : '';
    if (!comment && !actionLabel) {
      continue;
    }
    const commentText = comment ? `: ${comment}` : '';
    parts.push(
      `Stage ${feedback.sequenceOrder} (${feedback.title})${actionLabel}${commentText}`,
    );
  }

  return parts.length > 0 ? parts.join('\n') : undefined;
}

function isOnboardingFeatureListReview(
  value: unknown,
): value is OnboardingFeatureListReviewUserSubmission {
  return (
    isRecord(value) &&
    (value.action === 'REFINE' || value.action === 'APPROVED') &&
    isRecord(value.payload)
  );
}

function isOnboardingPlanStageProposalReview(
  value: unknown,
): value is OnboardingPlanStageProposalReviewUserSubmission {
  return (
    isRecord(value) &&
    (value.action === 'REFINE' || value.action === 'APPROVED') &&
    isRecord(value.payload)
  );
}

function extractFeatureListReviewText(value: unknown): string | undefined {
  if (!isOnboardingFeatureListReview(value) || value.action !== 'REFINE') {
    return undefined;
  }

  const parts: string[] = [];
  const overall = value.payload.overall.trim();
  if (overall) {
    parts.push(overall);
  }

  for (const [section, feedback] of Object.entries(
    value.payload.sections,
  )) {
    const trimmed = feedback.trim();
    if (trimmed) {
      parts.push(`${section}: ${trimmed}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : undefined;
}

const RESPONSE_TEXT_EXTRACTORS: Record<string, ResponseTextExtractor> = {
  [ExtendedUIFieldType.FeatureList]: extractFeatureListReviewText,
  [ExtendedUIFieldType.PlanStageProposal]: extractPlanStageProposalText,
  [ExtendedUIFieldType.PlanApproval]: extractUserMessageText,
  [ExtendedUIFieldType.CodingPrompt]: extractUserMessageText,
  [ExtendedUIFieldType.TaskStub]: extractUserMessageText,
  [PlanStageProposalUserMessage.TypeEnum.PlanStageProposal]:
    extractPlanStageProposalText,
  [PlanApprovalUserMessage.TypeEnum.PlanApproval]: extractUserMessageText,
  [CodingPromptUserMessage.TypeEnum.CodingPrompts]: extractUserMessageText,
  [SuggestedActionUserMessage.TypeEnum.SuggestedActions]:
    extractUserMessageText,
};

function extractResponseText(
  responseValue: unknown,
  uiElement: UIElement | null,
): string | undefined {
  if (typeof responseValue === 'string') {
    return responseValue;
  }

  if (!isRecord(responseValue)) {
    return undefined;
  }

  const extractor =
    (uiElement?.type ? RESPONSE_TEXT_EXTRACTORS[uiElement.type] : undefined) ??
    (typeof responseValue.type === 'string'
      ? RESPONSE_TEXT_EXTRACTORS[responseValue.type]
      : undefined);

  if (!extractor) {
    return undefined;
  }

  return extractor(responseValue);
}

/**
 * Processes user responses against system questions to create question-answer pairs
 *
 * @param userResponses - Object containing user's responses (e.g., { "round1_concept": "AI dashboard" })
 * @param systemData - System message data containing questions array
 * @returns Processed responses with question context
 */
export function processUserResponsesWithQuestions(
  userResponses: Record<string, unknown>,
  systemData: SystemMessageData,
  logger?: Logger | ContextAwareLogger,
): ProcessedUserResponses {
  logger?.debug(`[processUserResponsesWithQuestions] starting`, {
    userResponses,
    systemData,
  });
  if (!isQuestionSystemMessageData(systemData)) {
    throw new Error('System message data is not a questions type');
  }

  if (!systemData.uiElements || systemData.uiElements.length === 0) {
    throw new Error('System message data has no UI elements');
  }

  const validResponses: QuestionAnswerPair[] = [];
  const skippedResponses: ProcessedUserResponses['skippedResponses'] = [];

  const responseKeys = Object.keys(userResponses);

  for (const responseKey of responseKeys) {
    const responseValue = userResponses[responseKey];

    const uiElement =
      systemData.uiElements?.find((el) => el.id === responseKey) || null;

    // Skip empty responses
    if (!responseValue) {
      skippedResponses.push({
        key: responseKey,
        reason: 'empty',
        value: responseValue,
      });
      continue;
    }

    const responseText = extractResponseText(responseValue, uiElement);
    if (responseText === undefined) {
      skippedResponses.push({
        key: responseKey,
        reason: 'invalid_type',
        value: responseValue,
      });
      continue;
    }

    const questionDescription = uiElement?.label || 'User response';

    const questionAnswerPair: QuestionAnswerPair = {
      uiElement,
      round: extractRoundFromField(responseKey),
      artifactType: ArtifactType.QaPair,
      question: questionDescription,
      answer: responseText.trim(),
      questionField: responseKey,
    };

    validResponses.push(questionAnswerPair);
  }

  return {
    validResponses,
    skippedResponses,
  };
}

/**
 * Extract round number from field name (e.g., "round2_project_concept" -> 2)
 */
export function extractRoundFromField(field: string): number {
  const match = field.match(/^round(\d+)_/);
  const round = match?.[1];
  return round ? parseInt(round, 10) : 1;
}
