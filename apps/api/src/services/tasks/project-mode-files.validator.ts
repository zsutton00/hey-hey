import { BadRequestException } from '@nestjs/common';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import {
  type ProjectModeFiles,
  type ProjectModeSelection,
  ProjectModeSnapshot,
} from '../../generated';
import {
  projectModeFilesJsonSchema,
  projectModeSelectionJsonSchema,
  projectModeSnapshotJsonSchema,
} from '../../generated/project-mode-contract.schema';

export const PROJECT_MODE_TYPE_KEY = 'MODE';
export const PROJECT_MODE_DESCRIPTION_SECTION_KEY = 'description';
export const PROJECT_MODE_FILES_SECTION_KEY = 'files';
export const PROJECT_MODE_FILES_SCHEMA_REF =
  '#/components/schemas/ProjectModeFiles';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv);

const validateFilesStructure: ValidateFunction<ProjectModeFiles> =
  ajv.compile<ProjectModeFiles>(projectModeFilesJsonSchema);
const validateSelectionStructure: ValidateFunction<ProjectModeSelection> =
  ajv.compile<ProjectModeSelection>(projectModeSelectionJsonSchema);
const validateSnapshotStructure: ValidateFunction<ProjectModeSnapshot> =
  ajv.compile<ProjectModeSnapshot>(projectModeSnapshotJsonSchema);

export type ProjectModeValidationResult<T> =
  | { success: true; value: T; canonicalContent: string }
  | { success: false; message: string };

export function validateProjectModeFilesContent(
  content: unknown,
): ProjectModeValidationResult<ProjectModeFiles> {
  const parsed = parseJsonContent(content);
  if ('error' in parsed) return { success: false, message: parsed.error };
  if (!validateFilesStructure(parsed.value)) {
    return {
      success: false,
      message: formatStructuralIssues(validateFilesStructure.errors),
    };
  }

  const value: ProjectModeFiles = {
    schemaVersion: parsed.value.schemaVersion,
    files: Object.fromEntries(
      Object.entries(parsed.value.files).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ) as ProjectModeFiles['files'],
  };
  return { success: true, value, canonicalContent: JSON.stringify(value) };
}

export function canonicalizeProjectModeFilesContent(content: unknown): string {
  const result = validateProjectModeFilesContent(content);
  if (!result.success) {
    throw new BadRequestException(
      `Invalid project MODE files: ${result.message}`,
    );
  }
  return result.canonicalContent;
}

export function validateProjectModeSelection(
  content: unknown,
): ProjectModeValidationResult<ProjectModeSelection> {
  if (!validateSelectionStructure(content)) {
    return {
      success: false,
      message: formatStructuralIssues(validateSelectionStructure.errors),
    };
  }
  const value: ProjectModeSelection = {
    schemaVersion: content.schemaVersion,
    modeId: content.modeId,
  };
  return { success: true, value, canonicalContent: JSON.stringify(value) };
}

export function validateProjectModeSnapshot(
  content: unknown,
): ProjectModeValidationResult<ProjectModeSnapshot> {
  if (!validateSnapshotStructure(content)) {
    return {
      success: false,
      message: formatStructuralIssues(validateSnapshotStructure.errors),
    };
  }
  const isV2 =
    content.schemaVersion ===
    ProjectModeSnapshot.SchemaVersionEnum.ProjectModeSnapshotV2;
  if (isV2 && content.projectAssistant === undefined) {
    return {
      success: false,
      message: '/projectAssistant: is required for project-mode-snapshot.v2',
    };
  }
  if (!isV2 && content.projectAssistant !== undefined) {
    return {
      success: false,
      message: `/projectAssistant: is not allowed for ${content.schemaVersion}`,
    };
  }
  const files = validateProjectModeFilesContent(content.files);
  if (!files.success) return { success: false, message: files.message };
  const value: ProjectModeSnapshot = {
    schemaVersion: content.schemaVersion,
    modeId: content.modeId,
    catalogDescription: content.catalogDescription,
    applicableWorkItemTypeKeys: [...content.applicableWorkItemTypeKeys],
    files: files.value,
    ...(content.projectAssistant
      ? { projectAssistant: { enabled: content.projectAssistant.enabled } }
      : {}),
    snapshotHash: content.snapshotHash,
  };
  return { success: true, value, canonicalContent: JSON.stringify(value) };
}

function parseJsonContent(
  content: unknown,
): { value: unknown } | { error: string } {
  if (typeof content !== 'string') return { value: content };
  try {
    return { value: JSON.parse(content) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `content is not valid JSON: ${error.message}`
          : 'content is not valid JSON',
    };
  }
}

function formatStructuralIssues(
  errors: ErrorObject[] | null | undefined,
): string {
  return (errors ?? [])
    .map((error) => {
      const path = error.instancePath || 'root';
      return `${path}: ${error.message ?? 'is invalid'}`;
    })
    .join('; ');
}
