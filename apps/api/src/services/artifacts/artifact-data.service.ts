import { Injectable, Logger } from '@nestjs/common';
import {
  ArtifactData,
  ArtifactType,
  BugData,
  CommentData,
  DecisionData,
  DocumentData,
  IssueData,
  NoteData,
  QAPairData,
  RequirementData,
  TaskOriginalArtifactData,
} from '../../generated';

@Injectable()
export class ArtifactDataService {
  private readonly logger = new Logger(ArtifactDataService.name);

  // Type-specific query helpers
  getQueryFields(artifactType: ArtifactType): string[] {
    switch (artifactType) {
      case 'QA_PAIR':
        return ['question', 'answer'];
      case 'DECISION':
        return ['title', 'rationale', 'outcome'];
      case 'REQUIREMENT':
        return ['title', 'description'];
      case 'DOCUMENT':
        return ['title', 'content'];
      case 'NOTE':
        return ['title', 'content'];
      case 'TASK_ORIGINAL':
        return ['name', 'description', 'acceptanceCriteria'];
      case 'ISSUE':
        return ['title', 'description'];
      case 'BUG':
        return ['title', 'description', 'expectedBehavior', 'actualBehavior'];
      case 'COMMENT':
        return ['content'];
      default:
        return ['content'];
    }
  }

  // Sanitize artifact data by trimming strings and deduplicating arrays
  sanitizeArtifactData(
    data: ArtifactData,
    correlationId?: string,
  ): ArtifactData {
    this.logger.debug('[sanitizeArtifactData] Starting data sanitization', {
      artifactType: data.type,
      correlationId,
    });

    try {
      const sanitized = { ...data };

      // Sanitize based on type
      switch (data.type) {
        case 'QA_PAIR':
          return this.sanitizeQAPairData(sanitized as QAPairData);
        case 'DECISION':
          return this.sanitizeDecisionData(sanitized as DecisionData);
        case 'REQUIREMENT':
          return this.sanitizeRequirementData(sanitized as RequirementData);
        case 'DOCUMENT':
          return this.sanitizeDocumentData(sanitized as DocumentData);
        case 'NOTE':
          return this.sanitizeNoteData(sanitized as NoteData);
        case 'TASK_ORIGINAL':
          return this.sanitizeTaskOriginalData(
            sanitized as TaskOriginalArtifactData,
          );
        case 'ISSUE':
          return this.sanitizeIssueData(sanitized as IssueData);
        case 'BUG':
          return this.sanitizeBugData(sanitized as BugData);
        case 'COMMENT':
          return this.sanitizeCommentData(
            sanitized as CommentData,
            correlationId,
          );
        default:
          return sanitized;
      }
    } catch (error) {
      this.logger.error('[sanitizeArtifactData] Sanitization failed', {
        artifactType: data.type,
        error: error instanceof Error ? error.message : String(error),
        correlationId,
      });
      throw error;
    }
  }

  private sanitizeQAPairData(data: QAPairData): QAPairData {
    return {
      ...data,
      question: data.question.trim(),
      answer: data.answer.trim(),
      systemResponse: data.systemResponse?.trim(),
      systemMessageId: data.systemMessageId?.trim(),
      userMessageId: data.userMessageId?.trim(),
      questionField: data.questionField?.trim(),
    };
  }

  private sanitizeDecisionData(data: DecisionData): DecisionData {
    return {
      ...data,
      title: data.title.trim(),
      rationale: data.rationale.trim(),
      outcome: data.outcome.trim(),
      alternatives: this.deduplicateAndTrimArray(data.alternatives),
      stakeholders: data.stakeholders
        ? this.deduplicateAndTrimArray(data.stakeholders)
        : undefined,
      relatedArtifactIds: data.relatedArtifactIds
        ? this.deduplicateAndTrimArray(data.relatedArtifactIds)
        : undefined,
      sourceConversationId: data.sourceConversationId?.trim(),
    };
  }

  private sanitizeRequirementData(data: RequirementData): RequirementData {
    return {
      ...data,
      title: data.title.trim(),
      description: data.description.trim(),
      acceptanceCriteria: data.acceptanceCriteria
        ? this.deduplicateAndTrimArray(data.acceptanceCriteria)
        : undefined,
      sourceMessageId: data.sourceMessageId?.trim(),
      relatedRequirements: data.relatedRequirements
        ? this.deduplicateAndTrimArray(data.relatedRequirements)
        : undefined,
    };
  }

  private sanitizeDocumentData(data: DocumentData): DocumentData {
    return {
      ...data,
      title: data.title.trim(),
      content: data.content.trim(),
      sections: data.sections?.map((section) => ({
        ...section,
        title: section.title.trim(),
        content: section.content.trim(),
      })),
      sourceDocumentId: data.sourceDocumentId?.trim(),
      relatedDocuments: data.relatedDocuments
        ? this.deduplicateAndTrimArray(data.relatedDocuments)
        : undefined,
    };
  }

  private sanitizeNoteData(data: NoteData): NoteData {
    return {
      ...data,
      title: data.title.trim(),
      content: data.content.trim(),
      tags: data.tags ? this.deduplicateAndTrimArray(data.tags) : undefined,
      sourceMessageId: data.sourceMessageId?.trim(),
      relatedNotes: data.relatedNotes
        ? this.deduplicateAndTrimArray(data.relatedNotes)
        : undefined,
    };
  }

  private sanitizeTaskOriginalData(
    data: TaskOriginalArtifactData,
  ): TaskOriginalArtifactData {
    return {
      ...data,
      name: data.name.trim(),
      description: data.description.trim(),
      acceptanceCriteria: data.acceptanceCriteria?.trim(),
      tags: data.tags ? this.deduplicateAndTrimArray(data.tags) : undefined,
      reasoning: data.reasoning?.trim(),
    };
  }

  private sanitizeIssueData(data: IssueData): IssueData {
    return {
      ...data,
      title: data.title.trim(),
      description: data.description.trim(),
      assignee: data.assignee?.trim(),
      sourceSystemId: data.sourceSystemId?.trim(),
      relatedIssues: data.relatedIssues
        ? this.deduplicateAndTrimArray(data.relatedIssues)
        : undefined,
    };
  }

  private sanitizeBugData(data: BugData): BugData {
    return {
      ...data,
      title: data.title.trim(),
      description: data.description.trim(),
      reproductionSteps: this.deduplicateAndTrimArray(data.reproductionSteps),
      expectedBehavior: data.expectedBehavior.trim(),
      actualBehavior: data.actualBehavior.trim(),
      sourceCommitId: data.sourceCommitId?.trim(),
      relatedBugs: data.relatedBugs
        ? this.deduplicateAndTrimArray(data.relatedBugs)
        : undefined,
    };
  }

  private sanitizeCommentData(
    data: CommentData,
    correlationId?: string,
  ): CommentData {
    const sanitized = {
      ...data,
      content: data.content.trim(),
      author: data.author?.trim(),
      timestamp: data.timestamp?.trim(),
      parentArtifactId: data.parentArtifactId?.trim(),
      sourceMessageId: data.sourceMessageId?.trim(),
    };

    // Warn if content is empty after sanitization
    if (!sanitized.content) {
      this.logger.warn(
        '[sanitizeArtifactData] Empty content after sanitization',
        {
          artifactType: 'COMMENT',
          correlationId,
        },
      );
    }

    return sanitized;
  }

  private deduplicateAndTrimArray(arr: string[]): string[] {
    return [
      ...new Set(
        arr.map((item) => item.trim()).filter((item) => item.length > 0),
      ),
    ];
  }

  // Validation helper
  validateDataStructure(data: ArtifactData): boolean {
    try {
      // Check that all required fields are present based on type
      const requiredFields = this.getRequiredFields(data.type);
      return requiredFields.every(
        (field) =>
          data[field as keyof ArtifactData] !== undefined &&
          data[field as keyof ArtifactData] !== null,
      );
    } catch {
      return false;
    }
  }

  private getRequiredFields(_artifactType: ArtifactType): string[] {
    switch (_artifactType) {
      case 'QA_PAIR':
        return ['type', 'question', 'answer'];
      case 'DECISION':
        return ['type', 'title', 'rationale', 'alternatives', 'outcome'];
      case 'REQUIREMENT':
        return ['type', 'title', 'description', 'priority', 'status'];
      case 'DOCUMENT':
        return ['type', 'title', 'content'];
      case 'NOTE':
        return ['type', 'title', 'content'];
      case 'TASK_ORIGINAL':
        return ['type', 'taskType', 'name', 'description', 'priority'];
      case 'ISSUE':
        return ['type', 'title', 'description', 'status', 'severity'];
      case 'BUG':
        return [
          'type',
          'title',
          'description',
          'reproductionSteps',
          'expectedBehavior',
          'actualBehavior',
          'status',
          'severity',
        ];
      case 'COMMENT':
        return ['type', 'content'];
      default:
        return ['type'];
    }
  }

  // Helper to determine if an artifact type supports sections/structure
  supportsStructuredContent(_artifactType: ArtifactType): boolean {
    return ['DOCUMENT', 'REQUIREMENT', 'BUG'].includes(_artifactType);
  }

  // Helper to determine if an artifact type supports references
  supportsReferences(_artifactType: ArtifactType): boolean {
    // All types support some form of references
    return true;
  }

  // TODO: Add artifact relationship tracking
  // TODO: Implement graph database integration for semantic relationships
  // TODO: Add performance caching for frequently accessed references
  // TODO: Implement artifact versioning and change tracking
  // TODO: Add embedding generation for semantic search on typed data
}
