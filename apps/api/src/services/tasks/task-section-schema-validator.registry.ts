import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DIAGRAM_METADATA_SCHEMA_REF,
  DIAGRAM_ELEMENT_METADATA_SCHEMA_REF,
  diagramMetadataSchema,
  diagramElementMetadataSchema,
  parseDiagramJson,
} from './diagram-metadata';
import {
  DIAGRAM_GROUPS_SCHEMA_REF,
  formatDiagramGroupsIssues,
  parseDiagramGroupsContent,
  validateDiagramGroups,
} from './diagram-groups';
import type { WorkItemTypeSectionDefinition } from '../../generated/model/workItemTypeSectionDefinition';
import {
  TASK_MONITOR_EXECUTION_DEFINITION_SCHEMA_REF,
  validateTaskMonitorExecutionDefinitionContent,
} from './task-monitor-execution-definition.validator';
import {
  validateWorkItemGraphLayoutContent,
  validateWorkItemGraphLayoutPreferenceContent,
  WORK_ITEM_GRAPH_LAYOUT_PREFERENCE_SCHEMA_REF,
  WORK_ITEM_GRAPH_LAYOUT_SCHEMA_REF,
} from './work-item-graph-layout.validator';
import {
  RELATIONSHIP_METADATA_SCHEMA_REF,
  validateRelationshipMetadataContent,
} from './relationship-metadata.validator';
import {
  validateWorkItemGraphNodePresentationContent,
  WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_REF,
} from './work-item-graph-node-presentation.validator';
import { validateWorkItemStructuredMockupContent } from './work-item-structured-mockup.validator';
import {
  PLAN_CONFIGURATION_SCHEMA_REF,
  validatePlanConfigurationContent,
} from './plan-configuration.validator';
import { validateWorkItemHtmlCssContent } from './work-item-html-css.validator';
import {
  PROJECT_MODE_FILES_SCHEMA_REF,
  validateProjectModeFilesContent,
} from './project-mode-files.validator';
import {
  PROJECT_MODE_SETTINGS_SCHEMA_REF,
  validateProjectModeSettingsContent,
} from './project-mode-settings.validator';
import {
  IMAGE_SECTION_CONTENT_SCHEMA_REF,
  validateImageSectionContent,
} from './image-section-content.validator';
import {
  FEATURE_REQUIREMENTS_SCHEMA_REF,
  validateFeatureRequirementsSection,
} from './feature-requirements-section.validator';

export type TaskSectionSchemaValidationResult =
  | {
      success: true;
      canonicalContent: string;
    }
  | {
      success: false;
      code:
        | 'invalid_section_content'
        | 'invalid_json_section'
        | 'invalid_html_css_section'
        | 'invalid_structured_mockup_section'
        | 'unsupported_json_section_schema';
      message: string;
      path?: Array<string | number>;
    };

export type WorkItemSectionContentKind =
  | 'markdown'
  | 'json'
  | 'html/css'
  | 'structured-mockup';

export function resolveWorkItemSectionContentKind(
  sectionDefinition: WorkItemTypeSectionDefinition,
): WorkItemSectionContentKind {
  if (sectionDefinition.kind === 'html/css') return 'html/css';
  if (sectionDefinition.kind === 'structured-mockup') {
    return 'structured-mockup';
  }
  if (
    sectionDefinition.kind === 'json' ||
    typeof sectionDefinition.schemaRef === 'string'
  ) {
    return 'json';
  }
  return 'markdown';
}

type JsonSectionValidator = (
  content: unknown,
) => TaskSectionSchemaValidationResult;

@Injectable()
export class TaskSectionSchemaValidatorRegistry {
  private readonly validators: ReadonlyMap<string, JsonSectionValidator> =
    new Map([
      ...[DIAGRAM_METADATA_SCHEMA_REF, DIAGRAM_ELEMENT_METADATA_SCHEMA_REF].map(
        (ref): [string, JsonSectionValidator] => [
          ref,
          (content) => {
            try {
              const schema =
                ref === DIAGRAM_METADATA_SCHEMA_REF
                  ? diagramMetadataSchema
                  : diagramElementMetadataSchema;
              const result = schema.safeParse(parseDiagramJson(content));
              return result.success
                ? {
                    success: true,
                    canonicalContent: JSON.stringify(result.data),
                  }
                : {
                    success: false,
                    code: 'invalid_json_section',
                    message: result.error.message,
                  };
            } catch (error) {
              return {
                success: false,
                code: 'invalid_json_section',
                message:
                  error instanceof Error
                    ? error.message
                    : 'Invalid Diagram metadata.',
              };
            }
          },
        ],
      ),
      [
        DIAGRAM_GROUPS_SCHEMA_REF,
        (content: unknown): TaskSectionSchemaValidationResult => {
          const parsed = parseDiagramGroupsContent(content);
          if (!parsed.success) {
            return {
              success: false,
              code: 'invalid_json_section',
              message: parsed.message,
            };
          }
          // Element resolution needs the Diagram's children; callers that
          // know them (TaskService, change-set projector) check membership.
          const issues = validateDiagramGroups(parsed.value);
          return issues.length === 0
            ? {
                success: true,
                canonicalContent: JSON.stringify(parsed.value),
              }
            : {
                success: false,
                code: 'invalid_json_section',
                message: formatDiagramGroupsIssues(issues),
              };
        },
      ],
      [
        FEATURE_REQUIREMENTS_SCHEMA_REF,
        (content: unknown): TaskSectionSchemaValidationResult => {
          const result = validateFeatureRequirementsSection(content);
          return result.success
            ? { success: true, canonicalContent: result.canonicalContent }
            : {
                success: false,
                code: 'invalid_json_section',
                message: result.message,
              };
        },
      ],
      [
        TASK_MONITOR_EXECUTION_DEFINITION_SCHEMA_REF,
        (content: unknown): TaskSectionSchemaValidationResult => {
          const result = validateTaskMonitorExecutionDefinitionContent(content);
          if (!result.success) {
            return {
              success: false,
              code: 'invalid_json_section',
              message: result.message,
            };
          }
          return {
            success: true,
            canonicalContent: result.canonicalContent,
          };
        },
      ],
      [
        WORK_ITEM_GRAPH_LAYOUT_PREFERENCE_SCHEMA_REF,
        (content: unknown): TaskSectionSchemaValidationResult => {
          const result = validateWorkItemGraphLayoutPreferenceContent(content);
          return result.success
            ? { success: true, canonicalContent: result.canonicalContent }
            : {
                success: false,
                code: 'invalid_json_section',
                message: result.message,
              };
        },
      ],
      [
        WORK_ITEM_GRAPH_LAYOUT_SCHEMA_REF,
        (content: unknown): TaskSectionSchemaValidationResult => {
          const result = validateWorkItemGraphLayoutContent(content);
          if (!result.success) {
            return {
              success: false,
              code: 'invalid_json_section',
              message: result.message,
            };
          }
          return {
            success: true,
            canonicalContent: result.canonicalContent,
          };
        },
      ],
      [
        RELATIONSHIP_METADATA_SCHEMA_REF,
        (content: unknown): TaskSectionSchemaValidationResult => {
          const result = validateRelationshipMetadataContent(content);
          return result.success
            ? result
            : {
                success: false,
                code: 'invalid_json_section',
                message: result.message,
              };
        },
      ],
      [
        WORK_ITEM_GRAPH_NODE_PRESENTATION_SCHEMA_REF,
        (content: unknown): TaskSectionSchemaValidationResult => {
          const result = validateWorkItemGraphNodePresentationContent(content);
          return result.success
            ? result
            : {
                success: false,
                code: 'invalid_json_section',
                message: result.message,
              };
        },
      ],
      [
        PLAN_CONFIGURATION_SCHEMA_REF,
        (content: unknown): TaskSectionSchemaValidationResult => {
          const result = validatePlanConfigurationContent(content);
          return result.success
            ? result
            : {
                success: false,
                code: 'invalid_json_section',
                message: result.message,
              };
        },
      ],
      [
        PROJECT_MODE_FILES_SCHEMA_REF,
        (content: unknown): TaskSectionSchemaValidationResult => {
          const result = validateProjectModeFilesContent(content);
          return result.success
            ? { success: true, canonicalContent: result.canonicalContent }
            : {
                success: false,
                code: 'invalid_json_section',
                message: result.message,
              };
        },
      ],
      [
        IMAGE_SECTION_CONTENT_SCHEMA_REF,
        (content: unknown): TaskSectionSchemaValidationResult => {
          const result = validateImageSectionContent(content);
          return result.success
            ? result
            : {
                success: false,
                code: 'invalid_json_section',
                message: result.message,
              };
        },
      ],
      [
        PROJECT_MODE_SETTINGS_SCHEMA_REF,
        (content: unknown): TaskSectionSchemaValidationResult => {
          const result = validateProjectModeSettingsContent(content);
          return result.success
            ? { success: true, canonicalContent: result.canonicalContent }
            : {
                success: false,
                code: 'invalid_json_section',
                message: result.message,
              };
        },
      ],
    ]);

  validateSchema(
    schemaRef: string,
    content: unknown,
  ): TaskSectionSchemaValidationResult {
    const validator = this.validators.get(schemaRef);
    if (!validator) {
      return {
        success: false,
        code: 'unsupported_json_section_schema',
        message: `Unsupported deployed schema '${schemaRef}'.`,
      };
    }
    return validator(content);
  }

  validate(
    sectionDefinition: WorkItemTypeSectionDefinition,
    content: unknown,
  ): TaskSectionSchemaValidationResult {
    const kind = resolveWorkItemSectionContentKind(sectionDefinition);
    if (kind === 'markdown') {
      return typeof content === 'string'
        ? { success: true, canonicalContent: content }
        : {
            success: false,
            code: 'invalid_section_content',
            message: `Markdown section '${sectionDefinition.key}' requires string content.`,
          };
    }
    if (kind === 'html/css') {
      return this.validateHtmlCss(sectionDefinition, content);
    }
    if (kind === 'structured-mockup') {
      const result = validateWorkItemStructuredMockupContent(
        content,
        new Set(sectionDefinition.sizeProfiles?.map(({ key }) => key) ?? []),
      );
      return result.success
        ? result
        : {
            success: false,
            code: 'invalid_structured_mockup_section',
            message: result.message,
            path: result.path,
          };
    }

    const schemaRef = sectionDefinition.schemaRef ?? undefined;
    if (!schemaRef) {
      return {
        success: false,
        code: 'unsupported_json_section_schema',
        message: `JSON section '${sectionDefinition.key}' is missing schemaRef.`,
      };
    }

    const result = this.validateSchema(schemaRef, content);
    return result.success || result.code !== 'unsupported_json_section_schema'
      ? result
      : {
          ...result,
          message:
            `Unsupported JSON section schema '${schemaRef}' ` +
            `for section '${sectionDefinition.key}'.`,
        };
  }

  canonicalize(
    sectionDefinition: WorkItemTypeSectionDefinition,
    content: unknown,
  ): string {
    const result = this.validate(sectionDefinition, content);
    if (result.success) {
      return result.canonicalContent;
    }

    const kind = resolveWorkItemSectionContentKind(sectionDefinition);
    const prefix =
      kind === 'json'
        ? `Invalid JSON section '${sectionDefinition.key}' (${sectionDefinition.schemaRef ?? 'missing schemaRef'})`
        : kind === 'html/css'
          ? `Invalid HTML/CSS section '${sectionDefinition.key}'`
          : kind === 'structured-mockup'
            ? `Invalid structured mockup section '${sectionDefinition.key}'`
            : `Invalid markdown section '${sectionDefinition.key}'`;
    throw new BadRequestException(`${prefix}: ${result.message}`);
  }

  private validateHtmlCss(
    sectionDefinition: WorkItemTypeSectionDefinition,
    content: unknown,
  ): TaskSectionSchemaValidationResult {
    const result = validateWorkItemHtmlCssContent(
      content,
      new Set(sectionDefinition.sizeProfiles?.map(({ key }) => key) ?? []),
    );
    return result.success
      ? result
      : {
          success: false,
          code: 'invalid_html_css_section',
          message: result.message,
          path: result.path,
        };
  }
}
