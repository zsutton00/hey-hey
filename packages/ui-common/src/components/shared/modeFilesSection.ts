export const isModeFilesSection = (input: {
  typeKey: string | undefined;
  key: string;
  kind: string | undefined;
}): boolean =>
  input.typeKey === "MODE" && input.key === "files" && input.kind === "json";

export const MODE_SETTINGS_SCHEMA_REF =
  "#/components/schemas/ProjectModeSettings";
const MODE_SETTINGS_SCHEMA_VERSION = "project-mode-settings.v1";

export const isModeSettingsSection = (input: {
  typeKey: string | undefined;
  key: string;
  kind: string | undefined;
}): boolean =>
  input.typeKey === "MODE" && input.key === "settings" && input.kind === "json";

export type ModeProjectAssistantSetting =
  | {
      status: "valid";
      enabled: boolean;
      /**
       * The MODE's own eligible work-item type keys, or null when the MODE has
       * no list and keeps the shared MODE type's legacy eligibility.
       */
      eligibleWorkItemTypeKeys: string[] | null;
    }
  | { status: "invalid" };

const DEFAULT_MODE_SETTING: ModeProjectAssistantSetting = {
  status: "valid",
  enabled: true,
  eligibleWorkItemTypeKeys: null,
};

/**
 * Reads the stored MODE settings. An absent settings section means the MODE
 * predates the setting, which the platform treats as Project Assistant enabled
 * with legacy type eligibility.
 */
export const readModeProjectAssistantSetting = (
  content: unknown
): ModeProjectAssistantSetting => {
  let decoded = content;
  if (decoded === undefined || decoded === null) {
    return DEFAULT_MODE_SETTING;
  }
  if (typeof decoded === "string") {
    if (!decoded.trim()) return DEFAULT_MODE_SETTING;
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      return { status: "invalid" };
    }
  }
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    Array.isArray(decoded)
  ) {
    return { status: "invalid" };
  }
  const record = decoded as Record<string, unknown>;
  const projectAssistant = record.projectAssistant as
    | Record<string, unknown>
    | undefined;
  if (
    record.schemaVersion !== MODE_SETTINGS_SCHEMA_VERSION ||
    typeof projectAssistant !== "object" ||
    projectAssistant === null ||
    typeof projectAssistant.enabled !== "boolean"
  ) {
    return { status: "invalid" };
  }
  const keys = record.eligibleWorkItemTypeKeys;
  if (
    keys !== undefined &&
    (!Array.isArray(keys) ||
      keys.length === 0 ||
      !keys.every((key) => typeof key === "string" && key.length > 0))
  ) {
    return { status: "invalid" };
  }
  return {
    status: "valid",
    enabled: projectAssistant.enabled,
    eligibleWorkItemTypeKeys: keys === undefined ? null : [...keys].sort(),
  };
};

/**
 * Serializes the MODE settings section. An empty or null type list is omitted
 * so the MODE keeps its legacy eligibility rather than becoming unlaunchable.
 */
export const serializeModeSettings = (
  projectAssistantEnabled: boolean,
  eligibleWorkItemTypeKeys: readonly string[] | null = null
): string =>
  JSON.stringify({
    schemaVersion: MODE_SETTINGS_SCHEMA_VERSION,
    projectAssistant: { enabled: projectAssistantEnabled },
    ...(eligibleWorkItemTypeKeys && eligibleWorkItemTypeKeys.length > 0
      ? {
          eligibleWorkItemTypeKeys: Array.from(
            new Set(eligibleWorkItemTypeKeys)
          ).sort(),
        }
      : {}),
  });
