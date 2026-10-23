import { ArtifactType as DbArtifactType } from '@prisma/client';
import {
  ArtifactData,
  ArtifactResponseDto,
  ArtifactSourceType,
  ArtifactType,
  InitiativeArtifactData,
  InsightData,
  QAPairData,
} from '../generated';

/**
 * Formats an artifact for inclusion in LLM prompts as JSON array
 * Handles different artifact types and extracts content appropriately
 * Returns array of 2 objects for QA_PAIR (system question, user answer)
 * Returns array of 1 object for other types
 */
type PromptFormatOptions = {
  includeTimestamp?: boolean;
  includeType?: boolean;
  includeTitle?: boolean;
  includeContentHeader?: boolean;
};

function buildPromptEntries(
  artifact: ArtifactResponseDto,
  options: PromptFormatOptions = {},
): Record<string, unknown>[] {
  const {
    includeTimestamp = true,
    includeType = true,
    includeTitle = true,
  } = options;

  // Handle QA_PAIR specially: return two separate objects
  if (artifact.type === 'QA_PAIR' && isQaPairData(artifact.data)) {
    const qaPair = artifact.data;

    const systemMessage: Record<string, unknown> = {
      role: 'system',
      entityId: qaPair.systemMessageId || null,
      content: qaPair.question,
    };

    const userMessage: Record<string, unknown> = {
      role: 'user',
      entityId: qaPair.userMessageId || null,
      content: qaPair.answer,
    };

    // Add optional fields to both messages
    if (includeTimestamp && artifact.createdAt) {
      systemMessage.timestamp = artifact.createdAt;
      userMessage.timestamp = artifact.createdAt;
    }

    if (includeType) {
      systemMessage.type = artifact.type;
      userMessage.type = artifact.type;
    }

    if (includeTitle) {
      systemMessage.title = artifact.title || 'Untitled';
      userMessage.title = artifact.title || 'Untitled';
    }

    return [systemMessage, userMessage];
  }

  // For all other types, return single-element array
  const result: Record<string, unknown> = {};

  // Add title
  if (includeTitle) {
    result.title = artifact.title || 'Untitled';
  }

  // Add entityId from sourceId
  result.entityId = artifact.sourceId || null;

  // Extract and add content
  result.content = extractArtifactContent(artifact, true);

  // Add timestamp if requested
  if (includeTimestamp && artifact.createdAt) {
    result.timestamp = artifact.createdAt;
  }

  // Add type if requested
  if (includeType) {
    result.type = artifact.type;
  }

  return [result];
}

export function formatArtifactForPrompt(
  artifact: ArtifactResponseDto,
  options: PromptFormatOptions = {},
): string {
  const entries = buildPromptEntries(artifact, options);
  return JSON.stringify(entries, null, 2);
}

export type ReconstructedConversationEntry = {
  role: 'system' | 'user';
  entityId: string | null;
  content: string | undefined;
  timestamp?: string;
  type?: string;
  artifactId?: string;
  title?: string;
};

export function reconstructConversationFromQaPairs(
  artifacts: ArtifactResponseDto[],
  options: {
    includeTimestamp?: boolean;
    includeType?: boolean;
    includeTitle?: boolean;
  } = {},
): ReconstructedConversationEntry[] {
  const {
    includeTimestamp = true,
    includeType = true,
    includeTitle = true,
  } = options;

  if (!artifacts || artifacts.length === 0) {
    return [];
  }

  const entries: ReconstructedConversationEntry[] = [];
  const seenSystemMessageIds = new Set<string>();

  for (const artifact of artifacts) {
    if (artifact.type !== 'QA_PAIR' || !isQaPairData(artifact.data)) {
      continue;
    }

    const qaPair = artifact.data;
    const systemMessageId = qaPair.systemMessageId || null;
    const systemResponse =
      typeof qaPair.systemResponse === 'string'
        ? qaPair.systemResponse.trim()
        : '';
    const question = qaPair.question;
    const includeSystemResponse =
      !!systemResponse &&
      (!systemMessageId || !seenSystemMessageIds.has(systemMessageId));

    if (systemMessageId && includeSystemResponse) {
      seenSystemMessageIds.add(systemMessageId);
    }

    const systemContentParts: string[] = [];
    if (includeSystemResponse) {
      systemContentParts.push(systemResponse);
    }
    if (question) {
      systemContentParts.push(
        includeSystemResponse ? `Q: ${question}` : question,
      );
    }

    const systemMessage: ReconstructedConversationEntry = {
      role: 'system',
      entityId: systemMessageId,
      content: systemContentParts.length
        ? systemContentParts.join('\n\n')
        : undefined,
    };

    const userMessage: ReconstructedConversationEntry = {
      role: 'user',
      entityId: qaPair.userMessageId || null,
      content: qaPair.answer,
    };

    if (includeTimestamp && artifact.createdAt) {
      systemMessage.timestamp = artifact.createdAt;
      userMessage.timestamp = artifact.createdAt;
    }

    if (includeType) {
      systemMessage.type = artifact.type;
      userMessage.type = artifact.type;
    }

    if (includeTitle) {
      systemMessage.title = artifact.title || 'Untitled';
      userMessage.title = artifact.title || 'Untitled';
    }

    entries.push(systemMessage, userMessage);
  }

  return entries;
}

export function artifactTypeToFriendlyType(type: ArtifactType) {
  switch (type) {
    case DbArtifactType.QA_PAIR:
      return 'Message';
    case DbArtifactType.DOCUMENT:
      return 'Document';
    case DbArtifactType.DOCUMENT_SECTION:
      return 'Document Section';
    case DbArtifactType.COMMENT:
      return 'Comment';
    case DbArtifactType.TASK_ORIGINAL:
      return 'Task';
    case DbArtifactType.WORKSTREAM:
      return 'Initiative';
    case DbArtifactType.INSIGHT:
      return 'Insight';
    case DbArtifactType.REFERENCE:
      return 'Reference';
    case DbArtifactType.NOTE:
      return 'Note';
    case DbArtifactType.DECISION:
      return 'Decision';
    case DbArtifactType.REQUIREMENT:
      return 'Requirement';
    case DbArtifactType.INITIATIVE_ORIGINAL:
      return 'Initiative';
    default:
      return 'Artifact';
  }
}

const SOURCE_IDENTIFIER_LABELS: Partial<Record<ArtifactSourceType, string>> = {
  [ArtifactSourceType.Conversation]: 'conversationId',
  [ArtifactSourceType.Integration]: 'integrationId',
  [ArtifactSourceType.GithubReadme]: 'githubReadmeId',
  [ArtifactSourceType.GithubDocs]: 'githubDocsId',
  [ArtifactSourceType.GithubIssue]: 'githubIssueId',
  [ArtifactSourceType.GithubPullRequest]: 'githubPullRequestId',
  [ArtifactSourceType.Initiative]: 'initiativeId',
  [ArtifactSourceType.System]: 'systemId',
  [ArtifactSourceType.Task]: 'taskId',
  [ArtifactSourceType.Adr]: 'adrId',
  [ArtifactSourceType.Rfc]: 'rfcId',
  [ArtifactSourceType.Message]: 'messageId',
};

export function formatArtifactSourceIdentifier(
  sourceType?: ArtifactSourceType | null,
  sourceId?: string | null,
): string | null {
  if (!sourceType || !sourceId) {
    return null;
  }

  const label = SOURCE_IDENTIFIER_LABELS[sourceType] || 'sourceId';

  return `${label}: ${sourceId}`;
}

export function isQaPairData(data: ArtifactData): data is QAPairData {
  return data.type === 'QA_PAIR';
}

export function isInsightData(data: ArtifactData): data is InsightData {
  return data.type === 'INSIGHT';
}

export function isOriginalInitiativeData(
  data: ArtifactData,
): data is InitiativeArtifactData {
  return data.type === 'INITIATIVE_ORIGINAL';
}

/**
 * Extracts content from an artifact based on its type and data structure
 */
export function extractArtifactContent(
  artifact: ArtifactResponseDto,
  includeId: boolean,
): string {
  const data = artifact.data;

  if (!data) {
    return 'No content';
  }

  // Handle QA_PAIR type specifically
  if (isQaPairData(data)) {
    if (includeId) {
      return `Message ID: ${data.systemMessageId}\nQ: ${data.question}\nMessage ID: ${data.userMessageId}\nA: ${data.answer}`;
    }
    return `Q: ${data.question}\nA: ${data.answer}`;
  }

  // Handle INSIGHT type with structured data
  if (isInsightData(data)) {
    return data.content || 'No insight content';
  }

  // Handle INITIATIVE_ORIGINAL type with JSON content
  if (isOriginalInitiativeData(data)) {
    return data.content || 'No content';
  }

  // Fallback: try to find content property in any data type
  if (data && 'content' in data) {
    return (data as { content: string }).content || 'No content';
  }

  return 'No content';
}

/**
 * Formats multiple artifacts for prompt inclusion as flattened JSON array
 * Each artifact may produce multiple objects (e.g., QA_PAIR produces 2)
 * All objects are flattened into a single array
 */
export function formatArtifactsForPrompt(
  artifacts: ArtifactResponseDto[],
  options: PromptFormatOptions = {},
): string {
  if (!artifacts || artifacts.length === 0) {
    return '';
  }

  const entries = artifacts.flatMap((artifact) =>
    buildPromptEntries(artifact, options),
  );
  return JSON.stringify(entries, null, 2);
}
