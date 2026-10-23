import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  DiagramCanonicalReferenceEntityTypeEnum,
  DiagramKind,
  DiagramLevel,
  EntityType,
  UnifiedEmbeddingsSearchOptionsQueryModeEnum,
  UnifiedSearchIntent,
  type DiagramCanonicalReference,
  type DiagramElementMetadata,
  type DiagramElementPolicy,
  type DiagramMetadata,
  type UnifiedSearchResult,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";

const humanize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());

export const parseDiagramMetadata = (value: unknown): DiagramMetadata => {
  if (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "level" in value
  ) {
    const candidate = value as { kind: unknown; level: unknown };
    if (
      Object.values(DiagramKind).includes(
        candidate.kind as DiagramMetadata["kind"]
      ) &&
      Object.values(DiagramLevel).includes(
        candidate.level as DiagramMetadata["level"]
      )
    ) {
      return candidate as DiagramMetadata;
    }
  }
  return { kind: DiagramKind.General, level: DiagramLevel.Overview };
};

export const isValidDiagramMetadata = (value: DiagramMetadata): boolean =>
  value.level === DiagramLevel.Overview ||
  value.kind === DiagramKind.Architecture;

export const parseDiagramElementMetadata = (
  value: unknown
): DiagramElementMetadata => {
  if (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    typeof value.role === "string"
  ) {
    const reference =
      "canonicalReference" in value ? value.canonicalReference : undefined;
    return {
      role: value.role,
      ...(reference !== undefined
        ? { canonicalReference: reference as DiagramCanonicalReference | null }
        : {}),
    };
  }
  return { role: "GENERIC" };
};

export const parseDiagramSectionInput = (value: string): unknown => {
  try {
    return value.trim() ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

export const isValidDiagramElementMetadata = (
  value: DiagramElementMetadata,
  policy: DiagramElementPolicy
): boolean => {
  if (!policy.roles.some((role) => role.key === value.role)) return false;
  const reference = value.canonicalReference;
  if (value.role === "DIAGRAM_REFERENCE") {
    return (
      reference?.entityType === DiagramCanonicalReferenceEntityTypeEnum.Task &&
      policy.referenceTargets.some(
        (rule) =>
          rule.entityType === reference.entityType &&
          rule.workItemTypeKeys?.includes("DIAGRAM")
      )
    );
  }
  if (!reference) return true;
  const rule = policy.referenceTargets.find(
    (candidate) => candidate.entityType === reference.entityType
  );
  return (
    Boolean(rule) &&
    !(
      reference.entityType === DiagramCanonicalReferenceEntityTypeEnum.Task &&
      rule?.workItemTypeKeys?.includes("DIAGRAM")
    )
  );
};

export function DiagramMetadataFields({
  value,
  onChange,
}: {
  value: DiagramMetadata;
  onChange: (value: DiagramMetadata) => void;
}) {
  const valid = isValidDiagramMetadata(value);
  return (
    <Stack spacing={2} data-testid="diagram-metadata-fields">
      <TextField
        select
        label="Diagram kind"
        value={value.kind}
        onChange={(event) =>
          onChange({
            ...value,
            kind: event.target.value as DiagramMetadata["kind"],
          })
        }
      >
        {Object.values(DiagramKind).map((kind) => (
          <MenuItem key={kind} value={kind}>
            {humanize(kind)}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Diagram level"
        value={value.level}
        error={!valid}
        helperText={
          !valid
            ? "Detailed C4 levels require an Architecture diagram."
            : undefined
        }
        onChange={(event) =>
          onChange({
            ...value,
            level: event.target.value as DiagramMetadata["level"],
          })
        }
      >
        {Object.values(DiagramLevel).map((level) => (
          <MenuItem key={level} value={level}>
            {humanize(level)}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}

interface ReferenceOption {
  entityId: string;
  entityType: DiagramCanonicalReference["entityType"];
  title: string;
  taskType?: string;
}

const taskTypeOf = (result: UnifiedSearchResult): string | undefined => {
  const metadata = result.embeddings?.metadata;
  return metadata &&
    "taskType" in metadata &&
    typeof metadata.taskType === "string"
    ? metadata.taskType
    : undefined;
};

export function DiagramCanonicalReferencePicker({
  organizationId,
  projectId,
  policy,
  value,
  onChange,
}: {
  organizationId: string | null;
  projectId: string | null;
  policy: DiagramElementPolicy;
  value: DiagramCanonicalReference | null | undefined;
  onChange: (value: DiagramCanonicalReference | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ReferenceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const allowedTypes = useMemo(
    () => [...new Set(policy.referenceTargets.map((rule) => rule.entityType))],
    [policy]
  );
  const allowedTaskTypes = useMemo(
    () => [
      ...new Set(
        policy.referenceTargets.flatMap((rule) => rule.workItemTypeKeys ?? [])
      ),
    ],
    [policy]
  );
  useEffect(() => {
    if (
      !organizationId ||
      !projectId ||
      !query.trim() ||
      allowedTypes.length === 0
    ) {
      setOptions([]);
      setLoading(false);
      setError(false);
      return;
    }
    let current = true;
    setLoading(true);
    setError(false);
    unifiedApiClient
      .unifiedSearch({
        organizationId,
        projectId,
        unifiedSearchRequest: {
          intent: UnifiedSearchIntent.Hybrid,
          query: query.trim(),
          common: {
            types: allowedTypes as EntityType[],
            ...(allowedTaskTypes.length ? { taskTypes: allowedTaskTypes } : {}),
          },
          graph: { size: 20 },
          embeddings: {
            maxResults: 20,
            queryMode: UnifiedEmbeddingsSearchOptionsQueryModeEnum.TitleFuzzy,
            hybridResultStrategy: "embeddingsRequired",
          },
        },
      })
      .then((response) => {
        if (!current) return;
        const next = (response.data?.data?.results ?? []).flatMap(
          (result): ReferenceOption[] => {
            if (
              !result.entityId ||
              !result.title ||
              !result.entityType ||
              !allowedTypes.includes(
                result.entityType as DiagramCanonicalReference["entityType"]
              )
            )
              return [];
            const taskType = taskTypeOf(result);
            const rule = policy.referenceTargets.find(
              (candidate) => candidate.entityType === result.entityType
            );
            if (
              result.entityType === EntityType.Task &&
              rule?.workItemTypeKeys?.length &&
              (!taskType || !rule.workItemTypeKeys.includes(taskType))
            )
              return [];
            return [
              {
                entityId: result.entityId,
                entityType:
                  result.entityType as DiagramCanonicalReference["entityType"],
                title: result.title,
                ...(taskType ? { taskType } : {}),
              },
            ];
          }
        );
        setOptions(next);
        setLoading(false);
      })
      .catch(() => {
        if (current) {
          setOptions([]);
          setLoading(false);
          setError(true);
        }
      });
    return () => {
      current = false;
    };
  }, [
    allowedTaskTypes,
    allowedTypes,
    organizationId,
    policy,
    projectId,
    query,
  ]);
  return (
    <Stack spacing={1} data-testid="diagram-canonical-reference-picker">
      <Autocomplete
        options={options}
        loading={loading}
        filterOptions={(items) => items}
        getOptionLabel={(option) => option.title}
        onInputChange={(_event, next) => setQuery(next)}
        onChange={(_event, option) =>
          onChange(
            option
              ? { entityId: option.entityId, entityType: option.entityType }
              : null
          )
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label="Canonical reference"
            helperText={
              value
                ? `Current ${value.entityType} reference selected`
                : "Optional project reference"
            }
            slotProps={{
              input: {
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loading ? <CircularProgress size={18} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
      />
      {value ? (
        <Button onClick={() => onChange(null)} sx={{ alignSelf: "flex-start" }}>
          Clear reference
        </Button>
      ) : null}
      {error ? (
        <Alert severity="error">
          Reference search failed. Your current selection is unchanged.
        </Alert>
      ) : null}
    </Stack>
  );
}

export function DiagramElementFields({
  value,
  policy,
  organizationId,
  projectId,
  onChange,
}: {
  value: DiagramElementMetadata;
  policy: DiagramElementPolicy;
  organizationId: string | null;
  projectId: string | null;
  onChange: (value: DiagramElementMetadata) => void;
}) {
  const valid = isValidDiagramElementMetadata(value, policy);
  return (
    <Stack spacing={2} data-testid="diagram-element-fields">
      <TextField
        select
        label="Element role"
        value={value.role}
        error={!valid}
        onChange={(event) => onChange({ ...value, role: event.target.value })}
      >
        {policy.roles.map((role) => (
          <MenuItem key={role.key} value={role.key}>
            {role.label} ({role.notation})
          </MenuItem>
        ))}
      </TextField>
      <DiagramCanonicalReferencePicker
        organizationId={organizationId}
        projectId={projectId}
        policy={policy}
        value={value.canonicalReference}
        onChange={(canonicalReference) =>
          onChange({ ...value, canonicalReference })
        }
      />
      {!valid ? (
        <Typography color="error" variant="caption">
          Diagram references require the Diagram reference role; that role
          requires a Diagram target. Correct the role or reference before
          saving.
        </Typography>
      ) : null}
    </Stack>
  );
}
