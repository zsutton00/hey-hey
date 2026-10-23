import { Injectable, Logger } from '@nestjs/common';
import {
  ArtifactData,
  QAPairData,
  DecisionData,
  RequirementData,
  DocumentData,
  NoteData,
  IssueData,
  BugData,
  CommentData,
  InsightData,
  TaskOriginalArtifactData,
  InitiativeArtifactData,
} from '../../generated';

// Type guard utilities (recreated from local types)
export function isQAPairData(data: ArtifactData): data is QAPairData {
  return data.type === 'QA_PAIR';
}

export function isDecisionData(data: ArtifactData): data is DecisionData {
  return data.type === 'DECISION';
}

export function isRequirementData(data: ArtifactData): data is RequirementData {
  return data.type === 'REQUIREMENT';
}

export function isDocumentData(data: ArtifactData): data is DocumentData {
  return data.type === 'DOCUMENT';
}

export function isNoteData(data: ArtifactData): data is NoteData {
  return data.type === 'NOTE';
}

export function isTaskOriginalData(
  data: ArtifactData,
): data is TaskOriginalArtifactData {
  return data.type === 'TASK_ORIGINAL';
}

export function isIssueData(data: ArtifactData): data is IssueData {
  return data.type === 'ISSUE';
}

export function isBugData(data: ArtifactData): data is BugData {
  return data.type === 'BUG';
}

export function isCommentData(data: ArtifactData): data is CommentData {
  return data.type === 'COMMENT';
}

export function isInsightData(data: ArtifactData): data is InsightData {
  return data.type === 'INSIGHT';
}

export function isInitiativeArtifactData(
  data: ArtifactData,
): data is InitiativeArtifactData {
  return (
    data.type === 'INITIATIVE_ORIGINAL' || data.type === 'INITIATIVE_REFINED'
  );
}

export class ArtifactDataValidationError extends Error {
  constructor(
    public readonly artifactType: string,
    public readonly field: string,
    message: string,
  ) {
    super(`Invalid ${artifactType} data: ${field} - ${message}`);
    this.name = 'ArtifactDataValidationError';
  }
}

@Injectable()
export class ArtifactDataValidators {
  private readonly logger = new Logger(ArtifactDataValidators.name);

  validateArtifactData(data: ArtifactData, correlationId?: string): void {
    this.logger.debug('[validateArtifactData] Starting validation', {
      artifactType: data.type,
      correlationId,
      dataKeys: Object.keys(data),
    });

    try {
      switch (data.type) {
        case 'QA_PAIR':
          this.validateQAPairData(data);
          break;
        case 'DECISION':
          this.validateDecisionData(data);
          break;
        case 'REQUIREMENT':
          this.validateRequirementData(data);
          break;
        case 'DOCUMENT':
          this.validateDocumentData(data);
          break;
        case 'NOTE':
          this.validateNoteData(data);
          break;
        case 'TASK_ORIGINAL':
          this.validateTaskOriginalData(data);
          break;
        case 'ISSUE':
          this.validateIssueData(data);
          break;
        case 'BUG':
          this.validateBugData(data);
          break;
        case 'COMMENT':
          this.validateCommentData(data);
          break;
        case 'INSIGHT':
          this.validateInsightData(data);
          break;
        case 'INITIATIVE_ORIGINAL':
        case 'INITIATIVE_REFINED':
          this.validateInitiativeArtifactData(data);
          break;
        default:
          throw new ArtifactDataValidationError(
            data.type,
            'type',
            `Unsupported artifact type: ${data.type}`,
          );
      }

      this.logger.debug('[validateArtifactData] Validation completed', {
        artifactType: data.type,
        correlationId,
        valid: true,
      });
    } catch (error) {
      this.logger.error('[validateArtifactData] Validation failed', {
        artifactType: data.type,
        correlationId,
        error: error instanceof Error ? error.message : JSON.stringify(error),
      });
      throw error;
    }
  }

  private validateQAPairData(data: ArtifactData): asserts data is QAPairData {
    if (!isQAPairData(data)) {
      throw new ArtifactDataValidationError(
        data.type,
        'type',
        'Data does not match QA_PAIR structure',
      );
    }

    if (!data.question || typeof data.question !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'question',
        'Question is required and must be a string',
      );
    }

    if (!data.answer || typeof data.answer !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'answer',
        'Answer is required and must be a string',
      );
    }

    if (
      data.systemResponse !== undefined &&
      typeof data.systemResponse !== 'string'
    ) {
      throw new ArtifactDataValidationError(
        data.type,
        'systemResponse',
        'System response must be a string',
      );
    }

    if (data.confidence !== undefined && typeof data.confidence !== 'number') {
      throw new ArtifactDataValidationError(
        data.type,
        'confidence',
        'Confidence must be a number',
      );
    }

    if (
      data.confidence !== undefined &&
      (data.confidence < 0 || data.confidence > 1)
    ) {
      throw new ArtifactDataValidationError(
        data.type,
        'confidence',
        'Confidence must be between 0 and 1',
      );
    }
  }

  private validateDecisionData(
    data: ArtifactData,
  ): asserts data is DecisionData {
    if (!isDecisionData(data)) {
      throw new ArtifactDataValidationError(
        data.type,
        'type',
        'Data does not match DECISION structure',
      );
    }

    if (!data.title || typeof data.title !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'title',
        'Title is required and must be a string',
      );
    }

    if (!data.rationale || typeof data.rationale !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'rationale',
        'Rationale is required and must be a string',
      );
    }

    if (!Array.isArray(data.alternatives)) {
      throw new ArtifactDataValidationError(
        data.type,
        'alternatives',
        'Alternatives must be an array',
      );
    }

    if (!data.outcome || typeof data.outcome !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'outcome',
        'Outcome is required and must be a string',
      );
    }
  }

  private validateRequirementData(
    data: ArtifactData,
  ): asserts data is RequirementData {
    if (!isRequirementData(data)) {
      throw new ArtifactDataValidationError(
        data.type,
        'type',
        'Data does not match REQUIREMENT structure',
      );
    }

    if (!data.title || typeof data.title !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'title',
        'Title is required and must be a string',
      );
    }

    if (!data.description || typeof data.description !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'description',
        'Description is required and must be a string',
      );
    }

    const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    if (!validPriorities.includes(data.priority)) {
      throw new ArtifactDataValidationError(
        data.type,
        'priority',
        `Priority must be one of: ${validPriorities.join(', ')}`,
      );
    }

    const validStatuses = ['DRAFT', 'APPROVED', 'IMPLEMENTED', 'DEPRECATED'];
    if (!validStatuses.includes(data.status)) {
      throw new ArtifactDataValidationError(
        data.type,
        'status',
        `Status must be one of: ${validStatuses.join(', ')}`,
      );
    }
  }

  private validateDocumentData(
    data: ArtifactData,
  ): asserts data is DocumentData {
    if (!isDocumentData(data)) {
      throw new ArtifactDataValidationError(
        data.type,
        'type',
        'Data does not match DOCUMENT structure',
      );
    }

    if (!data.title || typeof data.title !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'title',
        'Title is required and must be a string',
      );
    }

    if (!data.content || typeof data.content !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'content',
        'Content is required and must be a string',
      );
    }

    if (data.sections !== undefined) {
      if (!Array.isArray(data.sections)) {
        throw new ArtifactDataValidationError(
          data.type,
          'sections',
          'Sections must be an array',
        );
      }

      data.sections.forEach((section, index) => {
        if (!section.title || typeof section.title !== 'string') {
          throw new ArtifactDataValidationError(
            data.type,
            `sections[${index}].title`,
            'Section title is required and must be a string',
          );
        }
        if (!section.content || typeof section.content !== 'string') {
          throw new ArtifactDataValidationError(
            data.type,
            `sections[${index}].content`,
            'Section content is required and must be a string',
          );
        }
        if (typeof section.order !== 'number') {
          throw new ArtifactDataValidationError(
            data.type,
            `sections[${index}].order`,
            'Section order is required and must be a number',
          );
        }
      });
    }
  }

  private validateNoteData(data: ArtifactData): asserts data is NoteData {
    if (!isNoteData(data)) {
      throw new ArtifactDataValidationError(
        data.type,
        'type',
        'Data does not match NOTE structure',
      );
    }

    if (!data.title || typeof data.title !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'title',
        'Title is required and must be a string',
      );
    }

    if (!data.content || typeof data.content !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'content',
        'Content is required and must be a string',
      );
    }
  }

  private validateTaskOriginalData(
    data: ArtifactData,
  ): asserts data is TaskOriginalArtifactData {
    if (!isTaskOriginalData(data)) {
      throw new ArtifactDataValidationError(
        data.type,
        'type',
        'Data does not match TASK_ORIGINAL structure',
      );
    }

    if (!data.name || typeof data.name !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'name',
        'Name is required and must be a string',
      );
    }

    if (!data.description || typeof data.description !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'description',
        'Description is required and must be a string',
      );
    }

    if (
      !data.taskType ||
      (data.taskType !== 'STANDARD' && data.taskType !== 'BUG')
    ) {
      throw new ArtifactDataValidationError(
        data.type,
        'taskType',
        'Task type must be STANDARD or BUG',
      );
    }

    if (
      data.taskType === 'STANDARD' &&
      typeof data.acceptanceCriteria !== 'string'
    ) {
      throw new ArtifactDataValidationError(
        data.type,
        'acceptanceCriteria',
        'STANDARD task acceptance criteria are required and must be a string',
      );
    }

    if (
      data.taskType === 'BUG' &&
      data.acceptanceCriteria !== undefined &&
      data.acceptanceCriteria.trim().length > 0
    ) {
      throw new ArtifactDataValidationError(
        data.type,
        'acceptanceCriteria',
        'BUG task artifacts must not include acceptance criteria',
      );
    }

    const validPriorities = ['low', 'medium', 'high', 'critical'];
    if (!validPriorities.includes(data.priority)) {
      throw new ArtifactDataValidationError(
        data.type,
        'priority',
        `Priority must be one of: ${validPriorities.join(', ')}`,
      );
    }
  }

  private validateIssueData(data: ArtifactData): asserts data is IssueData {
    if (!isIssueData(data)) {
      throw new ArtifactDataValidationError(
        data.type,
        'type',
        'Data does not match ISSUE structure',
      );
    }

    if (!data.title || typeof data.title !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'title',
        'Title is required and must be a string',
      );
    }

    if (!data.description || typeof data.description !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'description',
        'Description is required and must be a string',
      );
    }

    const validStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    if (!validStatuses.includes(data.status)) {
      throw new ArtifactDataValidationError(
        data.type,
        'status',
        `Status must be one of: ${validStatuses.join(', ')}`,
      );
    }

    const validSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    if (!validSeverities.includes(data.severity)) {
      throw new ArtifactDataValidationError(
        data.type,
        'severity',
        `Severity must be one of: ${validSeverities.join(', ')}`,
      );
    }
  }

  private validateBugData(data: ArtifactData): asserts data is BugData {
    if (!isBugData(data)) {
      throw new ArtifactDataValidationError(
        data.type,
        'type',
        'Data does not match BUG structure',
      );
    }

    if (!data.title || typeof data.title !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'title',
        'Title is required and must be a string',
      );
    }

    if (!data.description || typeof data.description !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'description',
        'Description is required and must be a string',
      );
    }

    if (!Array.isArray(data.reproductionSteps)) {
      throw new ArtifactDataValidationError(
        data.type,
        'reproductionSteps',
        'Reproduction steps must be an array',
      );
    }

    if (!data.expectedBehavior || typeof data.expectedBehavior !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'expectedBehavior',
        'Expected behavior is required and must be a string',
      );
    }

    if (!data.actualBehavior || typeof data.actualBehavior !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'actualBehavior',
        'Actual behavior is required and must be a string',
      );
    }

    const validStatuses = ['OPEN', 'IN_PROGRESS', 'FIXED', 'CLOSED'];
    if (!validStatuses.includes(data.status)) {
      throw new ArtifactDataValidationError(
        data.type,
        'status',
        `Status must be one of: ${validStatuses.join(', ')}`,
      );
    }

    const validSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    if (!validSeverities.includes(data.severity)) {
      throw new ArtifactDataValidationError(
        data.type,
        'severity',
        `Severity must be one of: ${validSeverities.join(', ')}`,
      );
    }
  }

  private validateCommentData(data: ArtifactData): asserts data is CommentData {
    if (!isCommentData(data)) {
      throw new ArtifactDataValidationError(
        data.type,
        'type',
        'Data does not match COMMENT structure',
      );
    }

    if (!data.content || typeof data.content !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'content',
        'Content is required and must be a string',
      );
    }
  }

  private validateInsightData(data: ArtifactData): asserts data is InsightData {
    if (!isInsightData(data)) {
      throw new ArtifactDataValidationError(
        data.type,
        'type',
        'Data does not match INSIGHT structure',
      );
    }

    if (typeof data.confidence !== 'number') {
      throw new ArtifactDataValidationError(
        data.type,
        'confidence',
        'Confidence is required and must be a number',
      );
    }

    if (data.confidence < 0 || data.confidence > 1) {
      throw new ArtifactDataValidationError(
        data.type,
        'confidence',
        'Confidence must be between 0.0 and 1.0',
      );
    }

    if (!data.reasoning || typeof data.reasoning !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'reasoning',
        'Reasoning is required and must be a string',
      );
    }

    if (!data.content || typeof data.content !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'content',
        'Content is required and must be a string',
      );
    }
  }

  private validateInitiativeArtifactData(
    data: ArtifactData,
  ): asserts data is InitiativeArtifactData {
    if (!isInitiativeArtifactData(data)) {
      throw new ArtifactDataValidationError(
        data.type,
        'type',
        'Data does not match INITIATIVE artifact structure',
      );
    }

    if (typeof data.confidence !== 'number') {
      throw new ArtifactDataValidationError(
        data.type,
        'confidence',
        'Confidence is required and must be a number',
      );
    }

    if (data.confidence < 0 || data.confidence > 1) {
      throw new ArtifactDataValidationError(
        data.type,
        'confidence',
        'Confidence must be between 0.0 and 1.0',
      );
    }

    if (!data.reasoning || typeof data.reasoning !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'reasoning',
        'Reasoning is required and must be a string',
      );
    }

    if (!data.content || typeof data.content !== 'string') {
      throw new ArtifactDataValidationError(
        data.type,
        'content',
        'Content is required and must be a string',
      );
    }
  }

  // Helper method to check if artifact data has referential context
  hasReferentialData(data: ArtifactData): boolean {
    const referentialFields = [
      'systemMessageId',
      'userMessageId',
      'sourceMessageId',
      'relatedArtifactIds',
      'sourceConversationId',
      'relatedRequirements',
      'sourceDocumentId',
      'relatedDocuments',
      'relatedNotes',
      'relatedTasks',
      'sourceSystemId',
      'relatedIssues',
      'sourceCommitId',
      'relatedBugs',
      'parentArtifactId',
    ];

    return referentialFields.some(
      (field) => data[field as keyof ArtifactData] !== undefined,
    );
  }

  // Helper method to extract reference IDs from artifact data
  extractReferenceIds(data: ArtifactData): string[] {
    const references: string[] = [];

    // Add individual reference fields
    const singleRefFields = [
      'systemMessageId',
      'userMessageId',
      'sourceMessageId',
      'sourceConversationId',
      'sourceDocumentId',
      'sourceSystemId',
      'sourceCommitId',
      'parentArtifactId',
    ];

    singleRefFields.forEach((field) => {
      const value = data[field as keyof ArtifactData];
      if (typeof value === 'string') {
        references.push(value);
      }
    });

    // Add array reference fields
    const arrayRefFields = [
      'relatedArtifactIds',
      'relatedRequirements',
      'relatedDocuments',
      'relatedNotes',
      'relatedTasks',
      'relatedIssues',
      'relatedBugs',
    ];

    arrayRefFields.forEach((field) => {
      const value = data[field as keyof ArtifactData];
      if (Array.isArray(value)) {
        references.push(
          ...value.filter((id): id is string => typeof id === 'string'),
        );
      }
    });

    // TODO: Add special handling for conversation data messageIds when ConversationData is added
    // if (isConversationData(data) && Array.isArray(data.messageIds)) {
    //   references.push(...data.messageIds);
    // }

    return references;
  }
}
