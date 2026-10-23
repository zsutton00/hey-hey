import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import {
  projectModeSelectionJsonSchema,
  projectModeSnapshotJsonSchema,
} from '../../generated/project-mode-contract.schema';
import type {
  AgentSessionConfig,
  ProjectModeFiles,
  ProjectModeProjectAssistantSetting,
  ProjectModeSelection,
  ProjectModeSnapshot,
} from '../../shared/agent-bridge-contract/generated/api';

export type ValidatedProjectModeSnapshot = Omit<
  Readonly<ProjectModeSnapshot>,
  'applicableWorkItemTypeKeys' | 'files' | 'projectAssistant'
> & {
  readonly applicableWorkItemTypeKeys: readonly string[];
  readonly projectAssistant?: Readonly<ProjectModeProjectAssistantSetting>;
  /**
   * Whether the MODE author chose to run Project Assistant. v1 snapshots were
   * captured before the setting existed and every MODE then defaulted to on.
   */
  readonly projectAssistantEnabled: boolean;
  readonly files: Omit<Readonly<ProjectModeFiles>, 'files'> & {
    readonly files: Readonly<Record<string, string>> & { readonly 'MODE.md': string };
  };
};

export interface ValidatedProjectModeConfig {
  readonly selection: Readonly<ProjectModeSelection>;
  readonly snapshot: ValidatedProjectModeSnapshot;
}

export type ProjectModeConfigValidationResult =
  | { readonly ok: true; readonly value: ValidatedProjectModeConfig }
  | { readonly ok: false; readonly issues: readonly string[] };

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv);

const validateSelection: ValidateFunction<ProjectModeSelection> = ajv.compile<ProjectModeSelection>(
  projectModeSelectionJsonSchema,
);
const validateSnapshot: ValidateFunction<ProjectModeSnapshot> = ajv.compile<ProjectModeSnapshot>(
  projectModeSnapshotJsonSchema,
);

const formatIssue = (prefix: string, issue: ErrorObject): string => {
  const missingProperty =
    issue.keyword === 'required' && typeof issue.params['missingProperty'] === 'string'
      ? issue.params['missingProperty']
      : null;
  const path = missingProperty
    ? `${issue.instancePath}/${missingProperty}`
    : issue.instancePath || '/';
  return `${prefix}${path} ${issue.message ?? 'is invalid'}`;
};

/**
 * Whether a Run's captured config carries a project-mode selection or snapshot.
 * Fresh and restored Runs share this check so both decide mode-backing alike.
 */
export const hasCapturedProjectModeConfig = (
  config: AgentSessionConfig | null | undefined,
): boolean =>
  config?.type === 'CODING_SESSION' &&
  ('projectModeSelection' in config || 'projectModeSnapshot' in config);

/** Validate the immutable platform-captured pair used by the project-mode route. */
export const validateProjectModeConfig = (
  config: AgentSessionConfig | unknown,
): ProjectModeConfigValidationResult => {
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    !('type' in config) ||
    !('version' in config) ||
    config.type !== 'CODING_SESSION' ||
    config.version !== 'v2'
  ) {
    return {
      ok: false,
      issues: ['config must be a CODING_SESSION v2 configuration'],
    };
  }

  const rawSelection = 'projectModeSelection' in config ? config.projectModeSelection : undefined;
  const rawSnapshot = 'projectModeSnapshot' in config ? config.projectModeSnapshot : undefined;
  let selection: ProjectModeSelection | undefined;
  let snapshot: ProjectModeSnapshot | undefined;
  const issues: string[] = [];

  if (!rawSelection) {
    issues.push('config/projectModeSelection is required');
  } else if (validateSelection(rawSelection)) {
    selection = rawSelection;
  } else {
    issues.push(
      ...(validateSelection.errors ?? []).map((issue) =>
        formatIssue('config/projectModeSelection', issue),
      ),
    );
  }

  if (!rawSnapshot) {
    issues.push('config/projectModeSnapshot is required');
  } else if (validateSnapshot(rawSnapshot)) {
    snapshot = rawSnapshot;
  } else {
    issues.push(
      ...(validateSnapshot.errors ?? []).map((issue) =>
        formatIssue('config/projectModeSnapshot', issue),
      ),
    );
  }

  if (selection && snapshot && selection.modeId !== snapshot.modeId) {
    issues.push('config projectModeSelection.modeId must match projectModeSnapshot.modeId');
  }
  if (snapshot) {
    const isV2 = snapshot.schemaVersion === 'project-mode-snapshot.v2';
    if (isV2 && snapshot.projectAssistant === undefined) {
      issues.push(
        'config/projectModeSnapshot/projectAssistant is required for project-mode-snapshot.v2',
      );
    } else if (!isV2 && snapshot.projectAssistant !== undefined) {
      issues.push(
        `config/projectModeSnapshot/projectAssistant is not allowed for ${snapshot.schemaVersion}`,
      );
    }
  }

  if (issues.length > 0 || !selection || !snapshot) {
    return { ok: false, issues };
  }

  const capturedFiles: Record<string, string> = {};
  for (const [filePath, contents] of Object.entries(snapshot.files.files)) {
    if (typeof contents !== 'string') {
      return {
        ok: false,
        issues: [`config/projectModeSnapshot/files/files/${filePath} must be a string`],
      };
    }
    capturedFiles[filePath] = contents;
  }
  const modeEntry = capturedFiles['MODE.md'];
  if (!modeEntry) {
    return {
      ok: false,
      issues: ['config/projectModeSnapshot/files/files/MODE.md is required'],
    };
  }

  const immutableSelection = Object.freeze({ ...selection });
  const { projectAssistant, ...snapshotFields } = snapshot;
  const immutableSnapshot: ValidatedProjectModeSnapshot = Object.freeze({
    ...snapshotFields,
    ...(projectAssistant ? { projectAssistant: Object.freeze({ ...projectAssistant }) } : {}),
    projectAssistantEnabled: projectAssistant?.enabled ?? true,
    applicableWorkItemTypeKeys: Object.freeze([...snapshot.applicableWorkItemTypeKeys]),
    files: Object.freeze({
      ...snapshot.files,
      files: Object.freeze({ ...capturedFiles, 'MODE.md': modeEntry }),
    }),
  });

  return {
    ok: true,
    value: {
      selection: immutableSelection,
      snapshot: immutableSnapshot,
    },
  };
};
