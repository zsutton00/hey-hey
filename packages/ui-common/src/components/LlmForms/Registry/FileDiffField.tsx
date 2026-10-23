import CodeIcon from "@mui/icons-material/Code";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FileIcon from "@mui/icons-material/InsertDriveFileOutlined";
import {
  Card,
  CardContent,
  Collapse,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import React from "react";
import type { FileDiffEntry, FileDiffPayload } from "../../../api";
import { DiffRenderer } from "../../SuggestedContent/DiffRenderer";
import { getCodeLanguageFromFilePath } from "./codeLanguageUtils";
import type { FieldComponentProps, FieldConfig } from "./types";

interface FileDiffFieldConfig extends Omit<FieldConfig, "payload"> {
  payload: FileDiffPayload;
}

export interface FileDiffFieldProps
  extends Omit<FieldComponentProps<FileDiffPayload>, "config"> {
  config: FileDiffFieldConfig;
}

const hasContent = (value: string | null | undefined): boolean =>
  value != null && value.length > 0;

const formatChangeSummary = (entry: FileDiffEntry): string => {
  const before = entry.beforeContent ?? "";
  const after = entry.afterContent ?? "";
  const beforeLines = before ? before.split("\n").length : 0;
  const afterLines = after ? after.split("\n").length : 0;

  if (!hasContent(entry.beforeContent) && hasContent(entry.afterContent)) {
    return `${String(afterLines)} lines`;
  }
  if (hasContent(entry.beforeContent) && !hasContent(entry.afterContent)) {
    return `${String(beforeLines)} lines`;
  }

  const total = Math.max(beforeLines, afterLines);
  return `~${String(total)} lines`;
};

const EDIT_TYPE_LABELS: Record<string, string> = {
  create: "Created",
  modify: "Modified",
  delete: "Deleted",
};

const getEditTypeLabel = (editType: string): string =>
  EDIT_TYPE_LABELS[editType] ?? "Changed";

const getEditTypeColor = (
  editType: string
): "success.main" | "warning.main" | "error.main" | "text.secondary" => {
  switch (editType) {
    case "create":
      return "success.main";
    case "delete":
      return "error.main";
    case "modify":
      return "warning.main";
    default:
      return "text.secondary";
  }
};

const getFileName = (filePath: string): string => {
  const parts = filePath.split("/");
  return parts[parts.length - 1] ?? filePath;
};

interface FileDiffCardProps {
  entry: FileDiffEntry;
  index: number;
}

const inferEditType = (entry: FileDiffEntry): string => {
  const hasBefore = hasContent(entry.beforeContent);
  const hasAfter = hasContent(entry.afterContent);

  if (!hasBefore && hasAfter) {
    return "create";
  }
  if (hasBefore && !hasAfter) {
    return "delete";
  }
  return "modify";
};

const FileDiffCard: React.FC<FileDiffCardProps> = ({ entry, index }) => {
  const [expanded, setExpanded] = React.useState(false);
  const language = getCodeLanguageFromFilePath(entry.filePath);
  const changeSummary = formatChangeSummary(entry);
  const fileName = getFileName(entry.filePath);
  const editType = inferEditType(entry);

  const expandable =
    hasContent(entry.beforeContent) || hasContent(entry.afterContent);

  return (
    <Card
      variant="outlined"
      data-testid={`file-diff-card-${String(index)}`}
      sx={{
        borderLeft: 3,
        borderLeftColor: getEditTypeColor(editType),
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          px: 2,
          py: 1,
          cursor: expandable ? "pointer" : "default",
          "&:hover": expandable ? { bgcolor: "action.hover" } : {},
        }}
        onClick={() => {
          if (expandable) {
            setExpanded((prev) => !prev);
          }
        }}
        data-testid={`file-diff-header-${String(index)}`}
      >
        <CodeIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.5}
          sx={{ flex: 1, minWidth: 0 }}
        >
          <Typography
            variant="body2"
            sx={{
              fontFamily: "monospace",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            data-testid={`file-diff-filename-${String(index)}`}
          >
            {fileName}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              fontFamily: "monospace",
              color: "text.secondary",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={entry.filePath}
            data-testid={`file-diff-path-${String(index)}`}
          >
            {entry.filePath}
          </Typography>
        </Stack>
        <Typography
          variant="caption"
          sx={{ color: getEditTypeColor(editType), fontWeight: 500 }}
          data-testid={`file-diff-edit-type-${String(index)}`}
        >
          {getEditTypeLabel(editType)}
        </Typography>
        <Typography
          variant="caption"
          sx={{ fontFamily: "monospace", color: "text.secondary" }}
          data-testid={`file-diff-summary-${String(index)}`}
        >
          {changeSummary}
        </Typography>
        {expandable ? (
          <IconButton
            size="small"
            data-testid={`file-diff-toggle-${String(index)}`}
          >
            {expanded ? (
              <ExpandLessIcon fontSize="small" />
            ) : (
              <ExpandMoreIcon fontSize="small" />
            )}
          </IconButton>
        ) : null}
      </Stack>

      <Collapse
        in={expanded}
        data-testid={`file-diff-content-${String(index)}`}
      >
        <CardContent sx={{ pt: 0, pb: 1, "&:last-child": { pb: 1 } }}>
          <DiffRenderer
            oldContent={entry.beforeContent ?? ""}
            newContent={entry.afterContent ?? ""}
            defaultViewMode="split-code"
            codeLanguage={language}
            showViewModeToggle
          />
        </CardContent>
      </Collapse>
    </Card>
  );
};

export const FileDiffField: React.FC<FileDiffFieldProps> = ({ config }) => {
  const payload = config.payload;

  if (!payload?.diffs || payload.diffs.length === 0) {
    return null;
  }

  return (
    <Stack spacing={1} data-testid={`file-diff-field-${config.field}`}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <FileIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        <Typography variant="subtitle2">
          {payload.diffs.length === 1
            ? "File changed"
            : `${String(payload.diffs.length)} files changed`}
        </Typography>
      </Stack>
      {payload.diffs.map((entry, index) => (
        <FileDiffCard
          key={`${entry.filePath}-${String(index)}`}
          entry={entry}
          index={index}
        />
      ))}
    </Stack>
  );
};
