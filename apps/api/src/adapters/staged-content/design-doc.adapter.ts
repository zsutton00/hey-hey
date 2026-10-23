/**
 * Design Document Staged Content Adapter
 *
 * Bridges Design Document entities to the generic staged content framework.
 * Uses type-safe approach with StagedDesignDoc - no translation needed.
 */

import { Injectable, Logger } from '@nestjs/common';
import { DesignDocResponseDto, UpdateDesignDocDto } from '../../generated';
import { StagedContentAdapter } from '../../interfaces/staged-content-adapter.interface';
import { ConversationService } from '../../services/conversation.service';
import { DesignDocService } from '../../services/design-doc/design-doc.service';
import { OrganizationId, ProjectId } from '../../types';
import {
  getCurrentSectionForTemplate,
  TEMPLATE_STAGE_SPECS,
} from '../../types/design-doc.types';
import { ValidationError } from '../../types/staged-content.types';
import { StagedDesignDoc } from '../../types/staged-design-doc.types';

@Injectable()
export class DesignDocStagedContentAdapter
  implements StagedContentAdapter<StagedDesignDoc>
{
  private readonly logger = new Logger(DesignDocStagedContentAdapter.name);

  constructor(
    private readonly designDocService: DesignDocService,
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * Find design document by ID
   * Uses existing service boundaries - no direct database access
   * Returns properly typed StagedDesignDoc with no translation
   */
  async findEntity(
    entityId: string,
    organizationId: string,
  ): Promise<StagedDesignDoc | null> {
    this.logger.log(
      `Finding design document entity: ${entityId} in org: ${organizationId}`,
    );

    try {
      const designDoc = await this.designDocService.findOne(
        entityId,
        organizationId as OrganizationId,
      );

      if (designDoc) {
        return this.mapDesignDocToStagedDesignDoc(designDoc);
      }

      return null;
    } catch (error) {
      this.logger.error(
        `Error finding design document entity ${entityId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Update design document entity with partial updates
   * Routes to existing service with type-safe updates - no translation
   */
  async updateEntity(
    entityId: string,
    updates: Partial<StagedDesignDoc>,
    organizationId: string,
  ): Promise<StagedDesignDoc> {
    this.logger.log(
      `Updating design document entity: ${entityId} with updates:`,
      updates,
    );

    try {
      const designDocUpdates: UpdateDesignDocDto = {
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.tags !== undefined && { tags: updates.tags }),
      };

      const updatedDesignDoc = await this.designDocService.update(
        entityId,
        designDocUpdates,
        organizationId as OrganizationId,
      );

      return this.mapDesignDocToStagedDesignDoc(updatedDesignDoc);
    } catch (error) {
      this.logger.error(
        `Error updating design document entity ${entityId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Create conversation for design document
   * Uses existing conversation service
   */
  async createConversation(
    entityId: string,
    organizationId: string,
    projectId: string,
    planId?: string,
  ): Promise<{ id: string; workflowId?: string }> {
    this.logger.log(`Creating conversation for design document: ${entityId}`);

    try {
      const designDoc = await this.designDocService.findOne(
        entityId,
        organizationId as OrganizationId,
      );
      if (!designDoc) {
        throw new Error(`Design document ${entityId} not found`);
      }

      const workflowName = this.getWorkflowNameForTemplate(designDoc.template);

      const conversation = await this.conversationService.createConversation(
        {
          organizationId: organizationId as OrganizationId,
          projectId: projectId as ProjectId,
          status: 'STARTED',
          title: `Design Document Refinement - ${entityId}`,
          workflowName,
          workflowAboutType: 'design-doc',
          initiatedBy: 'USER',
          triggerEvent: 'staged_content_session_created',
          workflowAboutId: entityId, // Use workflowAboutId for the design document ID
          context: {},
        },
        organizationId as OrganizationId,
      );
      if (!conversation) {
        throw new Error('Failed to create conversation');
      }

      return {
        id: conversation.id,
        workflowId: conversation.workflowId || undefined,
      };
    } catch (error) {
      this.logger.error(
        `Error creating conversation for design document ${entityId}:`,
        error,
      );
      throw new Error(
        `Failed to create conversation for design document: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async findActiveConversation(
    entityId: string,
    organizationId: string,
    projectId?: string | null,
  ): Promise<{ id: string; workflowId?: string } | null> {
    try {
      const designDoc = await this.designDocService.findOne(
        entityId,
        organizationId as OrganizationId,
      );
      if (!designDoc) {
        return null;
      }

      const workflowName = this.getWorkflowNameForTemplate(designDoc.template);
      const result =
        await this.conversationService.getConversationsByWorkflowEntityFromAdapter(
          organizationId as OrganizationId,
          (projectId ?? null) as ProjectId,
          entityId,
          workflowName,
          {
            limit: 1,
            sortBy: 'updatedAt',
            sortOrder: 'desc',
          },
        );

      const conversation = result?.data?.[0];
      if (!conversation) {
        return null;
      }

      return {
        id: conversation.id,
        workflowId: conversation.workflowId || undefined,
      };
    } catch (error) {
      this.logger.error(
        `Error finding active conversation for design document ${entityId}:`,
        error,
      );
      return null;
    }
  }

  private getWorkflowNameForTemplate(
    template?: string,
  ): 'decision-refinement' | 'brainstorm-refinement' | 'adr' {
    switch (template) {
      case 'DECISION':
      case 'PLAN_DOCUMENT':
        return 'decision-refinement';
      case 'BRAINSTORM':
        return 'brainstorm-refinement';
      case 'ADR':
        return 'adr';
      default:
        throw new Error(`Unsupported design doc template: ${template}`);
    }
  }

  /**
   * Map Design Document Response DTO to Staged Design Doc
   * Direct field mapping - no translation needed since fields match semantically
   */
  private mapDesignDocToStagedDesignDoc(
    designDoc: DesignDocResponseDto,
  ): StagedDesignDoc {
    const sections: Record<string, string> = {};
    (designDoc.sections ?? []).forEach((section) => {
      sections[section.key] = section.materializedMarkdown || '';
    });

    return {
      id: designDoc.id,
      name: designDoc.name,
      template: designDoc.template,
      sections,
      // Legacy fields mapped from sections for backward compatibility
      content: sections['content'] || '',
      context: sections['context'] || '',
      decision: sections['decision'] || '',
      consequences: sections['consequences'] || '',
      statusNotes: sections['statusNotes'] || '',
      organizationId: designDoc.organizationId as OrganizationId,
      projectId: designDoc.projectId
        ? (designDoc.projectId as ProjectId)
        : undefined,
      currentStage: getCurrentSectionForTemplate(
        designDoc.template,
        designDoc.status,
      ),
      status: designDoc.status,
      tags: designDoc.tags,
      createdAt: designDoc.createdAt,
      updatedAt: designDoc.updatedAt,
    };
  }

  private getSectionContent(
    designDoc: DesignDocResponseDto,
    key: string,
  ): string {
    const section = designDoc.sections?.find((s) => s.key === key);
    return section?.materializedMarkdown ?? '';
  }

  /**
   * Validate design document content for a specific stage
   */
  async validateStageContent(
    entityId: string,
    stageId: string,
    organizationId: string,
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    try {
      const designDoc = await this.designDocService.findOne(
        entityId,
        organizationId as OrganizationId,
      );

      if (!designDoc) {
        errors.push({
          field: 'entity',
          rule: 'field_required',
          message: `Design document ${entityId} not found`,
          code: 'ENTITY_NOT_FOUND',
          severity: 'error',
        });
        return errors;
      }

      const validStages =
        TEMPLATE_STAGE_SPECS[
          designDoc.template as keyof typeof TEMPLATE_STAGE_SPECS
        ];
      if (!validStages) {
        errors.push({
          field: 'template',
          rule: 'invalid_stage',
          message: `Template ${designDoc.template} is not supported`,
          code: 'INVALID_TEMPLATE',
          severity: 'error',
        });
        return errors;
      }

      if (!validStages.includes(stageId)) {
        errors.push({
          field: 'stage',
          rule: 'invalid_stage',
          message: `Stage ${stageId} is not valid for template ${designDoc.template}`,
          code: 'INVALID_STAGE',
          severity: 'error',
        });
        return errors;
      }

      // Validation logic based on template
      if (designDoc.template === 'ADR') {
        // Validate based on stage requirements
        switch (stageId) {
          case 'context': {
            const context = this.getSectionContent(designDoc, 'context');
            if (!context || context.length < 80) {
              errors.push({
                field: 'context',
                rule: 'min_length',
                message: context
                  ? 'Context must be at least 80 characters'
                  : 'Context is empty or does not exist',
                code: 'MIN_LENGTH_VIOLATION',
                severity: 'error',
              });
            }
            break;
          }

          case 'decision': {
            const decision = this.getSectionContent(designDoc, 'decision');
            if (!decision || decision.length < 50) {
              errors.push({
                field: 'decision',
                rule: 'min_length',
                message: 'Decision must be at least 50 characters',
                code: 'MIN_LENGTH_VIOLATION',
                severity: 'error',
              });
            }
            break;
          }

          case 'consequences': {
            const consequences = this.getSectionContent(
              designDoc,
              'consequences',
            );
            if (!consequences || consequences.length < 80) {
              errors.push({
                field: 'consequences',
                rule: 'min_length',
                message: 'Consequences must be at least 80 characters',
                code: 'MIN_LENGTH_VIOLATION',
                severity: 'error',
              });
            }
            break;
          }

          case 'review': {
            const statusNotes = this.getSectionContent(
              designDoc,
              'statusNotes',
            );
            if (!statusNotes || statusNotes.length < 40) {
              errors.push({
                field: 'statusNotes',
                rule: 'min_length',
                message: 'Status notes must be at least 40 characters',
                code: 'MIN_LENGTH_VIOLATION',
                severity: 'error',
              });
            }
            break;
          }
        }
      } else if (
        designDoc.template === 'DECISION' ||
        designDoc.template === 'BRAINSTORM' ||
        designDoc.template === 'PLAN_DOCUMENT'
      ) {
        const content = this.getSectionContent(designDoc, 'content');
        if (!content || content.length < 10) {
          errors.push({
            field: 'content',
            rule: 'min_length',
            message: 'Content must be at least 10 characters',
            code: 'MIN_LENGTH_VIOLATION',
            severity: 'error',
          });
        }
      } else {
        errors.push({
          field: 'template',
          rule: 'invalid_template',
          message: `Template ${designDoc.template} is not supported`,
          code: 'INVALID_TEMPLATE',
          severity: 'error',
        });
      }

      return errors;
    } catch (error) {
      this.logger.error(
        `Error validating stage content for ${entityId}:`,
        error,
      );
      errors.push({
        field: 'validation',
        rule: 'custom_function',
        message: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'VALIDATION_ERROR',
        severity: 'error',
      });
      return errors;
    }
  }
}
