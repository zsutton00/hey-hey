import {
  ArtifactType,
  CreateArtifactDto,
  CreateUserMessage,
  MessageResponseDto,
  QAPairData,
  ArtifactSourceType,
  Influence,
} from '../generated';
import { ConversationId, MessageId, OrganizationId } from '../types';
import { QuestionAnswerPair } from '../utils/response-question-matcher.util';
import { generateQAPairTitle } from '../utils/sanitization.util';

export interface ArtifactMappingContext {
  conversationId: ConversationId;
  userMessage: CreateUserMessage;
  parentMessage: MessageResponseDto;
  messageId: MessageId;
  organizationId: OrganizationId;
  nodeId?: string;
  availableArtifacts?: Array<{
    id: string;
    title: string;
    type: string;
    data: Record<string, unknown>;
    createdAt: string;
  }>;
}

/**
 * Maps a QuestionAnswerPair to CreateArtifactDto for artifact creation
 */
export function mapQuestionAnswerPairToArtifactDto(
  questionAnswerPair: QuestionAnswerPair,
  context: ArtifactMappingContext,
): CreateArtifactDto {
  const {
    userMessage,
    parentMessage,
    messageId,
    conversationId,
    organizationId,
  } = context;
  const {
    questionField: responseKey,
    answer: responseValue,
    question: questionDescription,
    round,
    artifactType,
  } = questionAnswerPair;
  const systemResponse =
    typeof parentMessage.data?.response === 'string'
      ? parentMessage.data.response
      : undefined;

  // Create typed data based on artifact type
  // For now, most user responses will be QA_PAIR type
  const typedData: QAPairData = {
    type: 'QA_PAIR',
    question: questionDescription,
    answer: responseValue,
    questionField: responseKey,
    systemResponse,
    // Include message references for traceability
    systemMessageId: parentMessage.id,
    userMessageId: messageId,
    // Include nodeId for flow node traceability
    nodeId: context.nodeId,
  };

  return {
    projectId: userMessage.projectId,
    organizationId,
    type: artifactType as ArtifactType,
    title: generateQAPairTitle(questionDescription),
    data: typedData,
    sourceType: ArtifactSourceType.Conversation,
    sourceId: conversationId,
    generateEmbedding: true,
    tags: [`round-${round}`, 'user-response', artifactType.toLowerCase()],
    category: 'user_response',
    status: 'ACTIVE' as const,
  };
}

/**
 * Extracts artifact influences from the LLM-generated uiElement
 * Phase 4: LLM now includes influences directly in uiElements, so we extract them from there
 */
export function generateArtifactInfluences(
  questionAnswerPair: QuestionAnswerPair,
): Influence[] {
  // Extract influences from the uiElement if present
  if (questionAnswerPair.uiElement?.influences) {
    return questionAnswerPair.uiElement.influences;
  }

  // Default to empty array for green field questions or when no influences are provided
  return [];
}

/**
 * Enhanced mapping function that includes influence generation
 */
export function mapQuestionAnswerPairToArtifactDtoWithInfluences(
  questionAnswerPair: QuestionAnswerPair,
  context: ArtifactMappingContext,
): CreateArtifactDto {
  const baseDto = mapQuestionAnswerPairToArtifactDto(
    questionAnswerPair,
    context,
  );

  // Generate influences if artifacts are available
  const influences = generateArtifactInfluences(questionAnswerPair);

  return {
    ...baseDto,
    influences,
  };
}

/**
 * Maps multiple QuestionAnswerPairs to CreateArtifactDto array with influences
 */
export function mapQuestionAnswerPairsToArtifactDtos(
  questionAnswerPairs: QuestionAnswerPair[],
  context: ArtifactMappingContext,
): CreateArtifactDto[] {
  return questionAnswerPairs.map((pair) =>
    mapQuestionAnswerPairToArtifactDtoWithInfluences(pair, context),
  );
}
