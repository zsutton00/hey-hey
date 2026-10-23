import { Alert, Box, Typography } from "@mui/material";
import React, { useMemo } from "react";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type JsonSectionContentState =
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "valid"; formatted: string; value: JsonValue };

const isJsonValue = (
  value: unknown,
  ancestors: ReadonlySet<object> = new Set()
): value is JsonValue => {
  if (value === null) return true;

  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      break;
    default:
      return false;
  }

  if (ancestors.has(value)) return false;
  const nextAncestors = new Set(ancestors).add(value);

  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry, nextAncestors));
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;

  return Object.values(value).every((entry) =>
    isJsonValue(entry, nextAncestors)
  );
};

const normalizeJsonSectionContent = (
  content: unknown
): JsonSectionContentState => {
  if (content === undefined) return { status: "empty" };

  if (typeof content === "string") {
    if (!content.trim()) return { status: "empty" };

    try {
      content = JSON.parse(content) as unknown;
    } catch {
      return { status: "invalid" };
    }
  }

  if (!isJsonValue(content)) return { status: "invalid" };

  try {
    const formatted = JSON.stringify(content, null, 2);
    return formatted === undefined
      ? { status: "invalid" }
      : { status: "valid", formatted, value: content };
  } catch {
    return { status: "invalid" };
  }
};

export interface JsonSectionRendererProps {
  content: unknown;
}

export const JsonSectionRenderer: React.FC<JsonSectionRendererProps> = ({
  content,
}) => {
  const normalized = useMemo(
    () => normalizeJsonSectionContent(content),
    [content]
  );

  if (normalized.status === "empty") {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        fontStyle="italic"
        data-testid="json-section-empty"
      >
        Not provided
      </Typography>
    );
  }

  if (normalized.status === "invalid") {
    return (
      <Alert severity="warning" data-testid="json-section-invalid-content">
        This structured section contains invalid JSON and cannot be rendered.
      </Alert>
    );
  }

  return (
    <Box
      data-testid="json-section-renderer"
      sx={{
        maxHeight: 480,
        maxWidth: "100%",
        overflow: "auto",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "action.hover",
        p: 1.5,
      }}
    >
      <Box
        component="pre"
        data-testid="json-section-content"
        sx={{
          m: 0,
          color: "text.primary",
          fontFamily: "monospace",
          fontSize: "0.8125rem",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {normalized.formatted}
      </Box>
    </Box>
  );
};
