import { useEffect, useMemo, useState, type FC } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import {
  FeatureTag,
  WorkItemTypeScalarField,
  WorkItemTypeSectionDefinitionKindEnum,
  type ProjectedWorkItem,
  type WorkItemTypeDefinitionDto,
} from "../../api";
import {
  formatLocalDateInputValue,
  localDateInputToISOString,
} from "../../utils/dateTime";
import {
  buildAuthoredWorkflowStepPresentation,
  getAuthoredWorkflowStepColor,
  isWorkflowStepGraphPresentationSection,
} from "./workflowGraphNodePresentation";
import {
  DiagramElementFields,
  DiagramMetadataFields,
  isValidDiagramElementMetadata,
  isValidDiagramMetadata,
  parseDiagramElementMetadata,
  parseDiagramMetadata,
  parseDiagramSectionInput,
} from "./DiagramFields";

export interface WorkItemGraphNodeDialogValue {
  name: string;
  dueDate?: string;
  tag?: (typeof FeatureTag)[keyof typeof FeatureTag];
  sections: Readonly<Record<string, unknown>>;
  clearSections?: readonly string[];
}

export interface WorkItemGraphNodeDialogProps {
  open: boolean;
  typeDefinition: WorkItemTypeDefinitionDto;
  node?: ProjectedWorkItem | null;
  organizationId?: string | null;
  projectId?: string | null;
  onCancel: () => void;
  onCommit: (value: WorkItemGraphNodeDialogValue) => void;
}

function initialSectionValues(
  definition: WorkItemTypeDefinitionDto,
  node: ProjectedWorkItem | null | undefined
): Record<string, string> {
  const contentByKey = new Map(
    (node?.sections ?? []).map((section) => [
      section.key,
      typeof section.content === "string"
        ? section.content
        : JSON.stringify(section.content ?? {}, null, 2),
    ])
  );
  return Object.fromEntries(
    definition.sections.map((section) => [
      section.key,
      contentByKey.get(section.key) ?? "",
    ])
  );
}

export const WorkItemGraphNodeDialog: FC<WorkItemGraphNodeDialogProps> = ({
  open,
  typeDefinition,
  node,
  organizationId = null,
  projectId = null,
  onCancel,
  onCommit,
}) => {
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [tag, setTag] = useState("");
  const [sections, setSections] = useState<Record<string, string>>({});
  const [authoredColor, setAuthoredColor] = useState("");
  const [jsonErrors, setJsonErrors] = useState<
    Readonly<Record<string, string>>
  >({});

  useEffect(() => {
    if (!open) return;
    setName(node?.name ?? "");
    setDueDate(formatLocalDateInputValue(node?.dueDate));
    setTag(node?.tag ?? "");
    setSections(initialSectionValues(typeDefinition, node));
    setAuthoredColor(getAuthoredWorkflowStepColor(node?.sections) ?? "");
    setJsonErrors({});
  }, [node, open, typeDefinition]);

  const requiresDueDate =
    typeDefinition.requiredScalars?.includes(WorkItemTypeScalarField.DueDate) ??
    false;
  const requiresTag =
    typeDefinition.requiredScalars?.includes(WorkItemTypeScalarField.Tag) ??
    false;
  const isValid = useMemo(
    () =>
      name.trim().length > 0 &&
      (!requiresDueDate || dueDate.length > 0) &&
      (!requiresTag || tag.length > 0) &&
      Object.keys(jsonErrors).length === 0 &&
      typeDefinition.sections.every((section) => {
        if (section.schemaRef?.endsWith("/DiagramMetadata"))
          return isValidDiagramMetadata(
            parseDiagramMetadata(
              parseDiagramSectionInput(sections[section.key] ?? "")
            )
          );
        if (
          section.schemaRef?.endsWith("/DiagramElementMetadata") &&
          section.diagramElementPolicy
        )
          return isValidDiagramElementMetadata(
            parseDiagramElementMetadata(
              parseDiagramSectionInput(sections[section.key] ?? "")
            ),
            section.diagramElementPolicy
          );
        return true;
      }),
    [
      dueDate,
      jsonErrors,
      name,
      requiresDueDate,
      requiresTag,
      sections,
      tag,
      typeDefinition,
    ]
  );

  const commit = () => {
    const parsedSections: Record<string, unknown> = {};
    const clearSections: string[] = [];
    const nextErrors: Record<string, string> = {};
    typeDefinition.sections.forEach((section) => {
      const value = sections[section.key] ?? "";
      const isOptional = section.required === false;
      const hasExistingSection = Boolean(
        node?.sections.some((candidate) => candidate.key === section.key)
      );
      if (isWorkflowStepGraphPresentationSection(section)) {
        if (authoredColor) {
          parsedSections[section.key] =
            buildAuthoredWorkflowStepPresentation(authoredColor);
        } else if (isOptional && hasExistingSection) {
          clearSections.push(section.key);
        }
        return;
      }
      if (section.kind === WorkItemTypeSectionDefinitionKindEnum.Json) {
        if (!value.trim() && isOptional) {
          if (hasExistingSection) clearSections.push(section.key);
          return;
        }
        try {
          parsedSections[section.key] = value.trim() ? JSON.parse(value) : {};
        } catch {
          nextErrors[section.key] = "Enter valid JSON.";
        }
      } else {
        parsedSections[section.key] = value;
      }
    });
    setJsonErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !isValid) return;
    const dueDateTimestamp = dueDate
      ? localDateInputToISOString(dueDate)
      : null;
    if (dueDate && !dueDateTimestamp) return;
    onCommit({
      name: name.trim(),
      ...(dueDateTimestamp ? { dueDate: dueDateTimestamp } : {}),
      ...(tag ? { tag: tag as WorkItemGraphNodeDialogValue["tag"] } : {}),
      sections: parsedSections,
      ...(clearSections.length > 0 ? { clearSections } : {}),
    });
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>
        {node ? `Edit ${typeDefinition.name}` : `Add ${typeDefinition.name}`}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            autoFocus
            required
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            inputProps={{ "data-testid": "work-item-graph-node-name" }}
          />
          {!typeDefinition.forbiddenScalars?.includes(
            WorkItemTypeScalarField.DueDate
          ) && (
            <TextField
              required={requiresDueDate}
              label="Due date"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          )}
          {!typeDefinition.forbiddenScalars?.includes(
            WorkItemTypeScalarField.Tag
          ) && (
            <TextField
              select
              required={requiresTag}
              label="Tag"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
            >
              <MenuItem value="">None</MenuItem>
              {Object.values(FeatureTag).map((value) => (
                <MenuItem key={value} value={value}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
          )}
          {typeDefinition.sections.map((section) => {
            if (section.schemaRef?.endsWith("/DiagramMetadata")) {
              const value = parseDiagramMetadata(
                parseDiagramSectionInput(sections[section.key] ?? "")
              );
              return (
                <DiagramMetadataFields
                  key={section.key}
                  value={value}
                  onChange={(next) =>
                    setSections((current) => ({
                      ...current,
                      [section.key]: JSON.stringify(next),
                    }))
                  }
                />
              );
            }
            if (
              section.schemaRef?.endsWith("/DiagramElementMetadata") &&
              section.diagramElementPolicy
            ) {
              const value = parseDiagramElementMetadata(
                parseDiagramSectionInput(sections[section.key] ?? "")
              );
              return (
                <DiagramElementFields
                  key={section.key}
                  value={value}
                  policy={section.diagramElementPolicy}
                  organizationId={organizationId}
                  projectId={projectId}
                  onChange={(next) =>
                    setSections((current) => ({
                      ...current,
                      [section.key]: JSON.stringify(next),
                    }))
                  }
                />
              );
            }
            if (isWorkflowStepGraphPresentationSection(section)) {
              return (
                <Stack
                  key={section.key}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                >
                  <TextField
                    label={section.label}
                    type="color"
                    value={authoredColor || "#ffffff"}
                    helperText={
                      authoredColor
                        ? section.writingStandard
                        : "No authored color; the neutral node style is used."
                    }
                    onChange={(event) => setAuthoredColor(event.target.value)}
                    inputProps={{
                      "data-testid": "work-item-graph-node-section",
                      "data-section-key": section.key,
                    }}
                    sx={{ flex: 1 }}
                  />
                  <Button
                    onClick={() => setAuthoredColor("")}
                    disabled={!authoredColor}
                  >
                    Clear
                  </Button>
                </Stack>
              );
            }

            return (
              <TextField
                key={section.key}
                label={section.label}
                value={sections[section.key] ?? ""}
                multiline
                minRows={3}
                error={Boolean(jsonErrors[section.key])}
                helperText={jsonErrors[section.key] ?? section.writingStandard}
                onChange={(event) => {
                  setSections((current) => ({
                    ...current,
                    [section.key]: event.target.value,
                  }));
                  setJsonErrors((current) => {
                    const { [section.key]: _removed, ...remaining } = current;
                    return remaining;
                  });
                }}
                inputProps={{
                  "data-testid": "work-item-graph-node-section",
                  "data-section-key": section.key,
                }}
              />
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!isValid}
          onClick={commit}
          data-testid="work-item-graph-node-commit"
        >
          {node ? "Save" : "Add"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
