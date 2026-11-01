import { MenuItem, Stack, TextField } from "@mui/material";
import {
  FeatureTag,
  TaskPriority,
  WorkStatus,
  type ProposalResponseDto,
} from "../../api";
import { AssigneeSelector } from "../Selectors/AssigneeSelector";
import { TaskSelector } from "../Selectors/TaskSelector";
import { DueDateSelector } from "../Selectors/DueDateSelector";
import { DiffRenderer } from "../SuggestedContent/DiffRenderer";

export function ManualReconciliationFields({
  proposal,
  result,
  current,
  disabled,
  onChange,
}: {
  proposal: ProposalResponseDto;
  result: Record<string, unknown>;
  current: Record<string, unknown>;
  disabled: boolean;
  onChange: (key: string, value: string | string[] | null) => void;
}) {
  const selections = [
    { key: "priority", values: Object.values(TaskPriority) },
    { key: "tag", values: Object.values(FeatureTag) },
    ...(proposal.action === "VERSIONED_UPDATE"
      ? []
      : [{ key: "status", values: Object.values(WorkStatus) }]),
  ];
  return (
    <Stack spacing={2}>
      {["name", "summary"]
        .filter(
          (key) => typeof result[key] === "string" || result[key] === null,
        )
        .map((key) => (
          <Stack key={key} spacing={1}>
            <DiffRenderer
              oldContent={typeof current[key] === "string" ? current[key] : ""}
              newContent={typeof result[key] === "string" ? result[key] : ""}
              defaultViewMode="split"
            />
            <TextField
              label={key}
              value={result[key] ?? ""}
              disabled={disabled}
              onChange={(event) => onChange(key, event.target.value)}
            />
          </Stack>
        ))}
      {selections
        .filter((field) => field.key in result)
        .map((field) => (
          <TextField
            key={field.key}
            select
            label={field.key}
            value={result[field.key] ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange(field.key, event.target.value || null)
            }
          >
            <MenuItem value="">None</MenuItem>
            {field.values.map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
        ))}
      {Array.isArray(result.tags) && (
        <TextField
          label="Tags"
          value={result.tags.join(", ")}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              "tags",
              event.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            )
          }
        />
      )}
      {"parentTaskId" in result &&
        (typeof result.parentTaskId === "string" ||
          result.parentTaskId === null) && (
          <TaskSelector
            label="Parent"
            organizationId={proposal.organizationId}
            projectId={proposal.projectId}
            value={result.parentTaskId}
            disabled={disabled}
            includeNone
            excludeTaskIds={[proposal.targetEntityId]}
            onChange={(value) => onChange("parentTaskId", value)}
          />
        )}
      {"assigneeId" in result &&
        (typeof result.assigneeId === "string" ||
          result.assigneeId === null) && (
          <AssigneeSelector
            organizationId={proposal.organizationId}
            value={result.assigneeId}
            disabled={disabled}
            onChange={(value) => onChange("assigneeId", value)}
          />
        )}
      {"dueDate" in result &&
        (typeof result.dueDate === "string" || result.dueDate === null) && (
          <DueDateSelector
            value={result.dueDate}
            disabled={disabled}
            onChange={(value) => onChange("dueDate", value)}
          />
        )}
    </Stack>
  );
}
