import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EvalCaseInputs, EvalCaseTextMessageInput } from "../../api";
import {
  MarkdownRenderer,
  type MarkdownRendererMentionConfig,
} from "./MarkdownRenderer";

export const EVAL_CASE_INPUTS_SCHEMA_REF =
  "#/components/schemas/EvalCaseInputs";

/**
 * A stored input. Only the text message kind is known today; any other kind
 * or field is carried through untouched so the inputs object can grow.
 */
type StoredInput = EvalCaseInputs["inputs"][number] | Record<string, unknown>;

type ParsedInputs =
  { status: "valid"; inputs: StoredInput[] } | { status: "invalid" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTextMessage = (input: StoredInput): input is EvalCaseTextMessageInput =>
  input.kind === "text_message" && typeof input.text === "string";

const parseInputs = (content: unknown): ParsedInputs => {
  let decoded = content;
  if (typeof content === "string") {
    try {
      decoded = JSON.parse(content);
    } catch {
      return { status: "invalid" };
    }
  }
  if (!isRecord(decoded) || !Array.isArray(decoded.inputs)) {
    return { status: "invalid" };
  }
  if (!decoded.inputs.every(isRecord)) {
    return { status: "invalid" };
  }

  return { status: "valid", inputs: decoded.inputs };
};

const serialize = (inputs: StoredInput[]): string => JSON.stringify({ inputs });

export interface EvalCaseInputsSectionProps {
  /** The stored section: JSON text or the already decoded object. */
  content: unknown;
  /** When provided the list is editable and receives the re-serialized section. */
  onChange?: (content: string) => void;
  disabled?: boolean;
  mentionConfig?: MarkdownRendererMentionConfig;
  /** `run` renders the frozen, read-only block shown on the Eval run page. */
  surface?: "case" | "run";
}

/**
 * Shows an Eval Case's ordered user messages, and edits them when `onChange`
 * is given. The last message is the one judged; a single message is a plain
 * Request without numbering.
 */
export const EvalCaseInputsSection: React.FC<EvalCaseInputsSectionProps> = ({
  content,
  onChange,
  disabled = false,
  mentionConfig,
  surface = "case",
}) => {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseInputs(content), [content]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  if (parsed.status === "invalid") {
    return (
      <Alert severity="warning" data-testid="eval-case-inputs-unavailable">
        {t("eval.case.inputs.invalid")}
      </Alert>
    );
  }

  const { inputs } = parsed;
  const editable = Boolean(onChange) && surface === "case";
  const isRun = surface === "run";
  const isSingle = inputs.length === 1;
  const onlyMessage = inputs.length <= 1;
  const prefix = isRun ? "run-input" : "input";

  const commit = (next: StoredInput[]) => onChange?.(serialize(next));

  const move = (index: number, delta: -1 | 1) => {
    const next = [...inputs];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    commit(next);
  };

  const remove = (index: number) => {
    commit(inputs.filter((_, i) => i !== index));
  };

  const add = () => {
    // The new message is only committed by Done, so a blank one never saves.
    setEditingIndex(inputs.length);
    setDraft("");
  };

  const startEdit = (index: number, input: EvalCaseTextMessageInput) => {
    setEditingIndex(index);
    setDraft(input.text);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
  };

  const finishEdit = (index: number) => {
    const text = draft;
    const next = [...inputs];
    if (index === inputs.length) {
      next.push({ kind: "text_message", text });
    } else {
      next[index] = { ...next[index], text };
    }
    setEditingIndex(null);
    commit(next);
  };

  const renderBody = (input: StoredInput) =>
    isTextMessage(input) ? (
      <MarkdownRenderer mentionConfig={mentionConfig}>
        {input.text}
      </MarkdownRenderer>
    ) : (
      <Typography variant="body2" color="text.secondary">
        {t("eval.case.inputs.unsupported", { kind: String(input.kind ?? "") })}
      </Typography>
    );

  const renderEditor = (index: number, singleId?: string) => {
    const editorId = singleId ?? `${prefix}-${index + 1}-editor`;

    return (
      <Stack spacing={1} data-hh-id={editorId} data-testid={editorId}>
        <TextField
          multiline
          minRows={3}
          fullWidth
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          inputProps={{ "aria-label": t("eval.case.inputs.textareaLabel") }}
        />
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="contained"
            disabled={draft.trim().length === 0}
            onClick={() => finishEdit(index)}
          >
            {t("eval.case.inputs.done")}
          </Button>
          <Button size="small" onClick={cancelEdit}>
            {t("eval.case.inputs.cancel")}
          </Button>
        </Stack>
      </Stack>
    );
  };

  const addButton = editable && (
    <Button
      size="small"
      data-hh-id="add-input"
      data-testid="add-input"
      disabled={disabled || editingIndex !== null}
      onClick={add}
    >
      {t("eval.case.inputs.add")}
    </Button>
  );

  if (isRun) {
    return (
      <Box data-hh-id="run-inputs" data-testid="run-inputs">
        <Typography variant="subtitle2">
          {t("eval.run.inputs.heading")}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p">
          {t("eval.run.inputs.frozenNote")}
        </Typography>
        {isSingle ? (
          <Box
            data-hh-id="run-inputs-single-note"
            data-testid="run-inputs-single-note"
          >
            {renderBody(inputs[0])}
          </Box>
        ) : (
          <Stack
            component="ol"
            spacing={1}
            sx={{ pl: 3, m: 0 }}
            data-hh-id="run-inputs-list"
            data-testid="run-inputs-list"
          >
            {inputs.map((input, index) => (
              <li
                key={index}
                data-hh-id={`run-input-${index + 1}`}
                data-testid={`run-input-${index + 1}`}
              >
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <Box sx={{ flex: 1 }}>{renderBody(input)}</Box>
                  {index === inputs.length - 1 && (
                    <Chip
                      size="small"
                      color="primary"
                      label={t("eval.case.inputs.judged")}
                      data-hh-id="run-input-judged-badge"
                      data-testid="run-input-judged-badge"
                    />
                  )}
                </Stack>
              </li>
            ))}
          </Stack>
        )}
      </Box>
    );
  }

  const removeDisabled = disabled || onlyMessage;

  const controls = (index: number, input: StoredInput, ids: string) => (
    <Stack direction="row" spacing={0.5} flexWrap="wrap">
      {!isSingle && (
        <>
          <Button
            size="small"
            data-hh-id={`${ids}-up`}
            data-testid={`${ids}-up`}
            disabled={disabled || index === 0}
            onClick={() => move(index, -1)}
          >
            {t("eval.case.inputs.moveUp")}
          </Button>
          <Button
            size="small"
            data-hh-id={`${ids}-down`}
            data-testid={`${ids}-down`}
            disabled={disabled || index === inputs.length - 1}
            onClick={() => move(index, 1)}
          >
            {t("eval.case.inputs.moveDown")}
          </Button>
        </>
      )}
      <Button
        size="small"
        data-hh-id={`${ids}-edit`}
        data-testid={`${ids}-edit`}
        disabled={disabled || editingIndex !== null || !isTextMessage(input)}
        onClick={() => isTextMessage(input) && startEdit(index, input)}
      >
        {t("eval.case.inputs.edit")}
      </Button>
      <Button
        size="small"
        color="error"
        data-hh-id={`${ids}-remove`}
        data-testid={`${ids}-remove`}
        disabled={removeDisabled || editingIndex !== null}
        onClick={() => remove(index)}
      >
        {t("eval.case.inputs.remove")}
      </Button>
    </Stack>
  );

  if (isSingle) {
    const [only] = inputs;
    const editing = editable && editingIndex === 0;

    return (
      <Paper
        variant="outlined"
        sx={{ p: 2 }}
        data-hh-id="case-request-single"
        data-testid="case-request-single"
      >
        <Typography variant="subtitle2">
          {t("eval.case.inputs.request")}
        </Typography>
        {editing ? renderEditor(0, "single-input-editor") : renderBody(only)}
        {editable && !editing && (
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button
              size="small"
              data-hh-id="single-input-edit"
              data-testid="single-input-edit"
              disabled={
                disabled || editingIndex !== null || !isTextMessage(only)
              }
              onClick={() => isTextMessage(only) && startEdit(0, only)}
            >
              {t("eval.case.inputs.edit")}
            </Button>
            <Button
              size="small"
              color="error"
              data-hh-id="single-input-remove"
              data-testid="single-input-remove"
              disabled
            >
              {t("eval.case.inputs.remove")}
            </Button>
            {addButton}
          </Stack>
        )}
        {editable && editingIndex === 1 && renderEditor(1)}
        <Typography variant="caption" color="text.secondary" component="p">
          {t("eval.case.inputs.singleNote")}
        </Typography>
        {editable && (
          <Typography
            variant="caption"
            color="text.secondary"
            component="p"
            data-hh-id="inputs-empty-error"
            data-testid="inputs-empty-error"
          >
            {t("eval.case.inputs.minimum")}
          </Typography>
        )}
      </Paper>
    );
  }

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="p">
        {t("eval.case.inputs.listNote")}
      </Typography>
      <Stack
        component="ol"
        spacing={1}
        sx={{ pl: 3, m: 0 }}
        data-hh-id="inputs-list"
        data-testid="inputs-list"
      >
        {inputs.map((input, index) => (
          <li
            key={index}
            data-hh-id={`input-${index + 1}`}
            data-testid={`input-${index + 1}`}
          >
            {editable && editingIndex === index ? (
              renderEditor(index)
            ) : (
              <Stack spacing={0.5}>
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <Box sx={{ flex: 1 }}>{renderBody(input)}</Box>
                  {index === inputs.length - 1 && (
                    <Chip
                      size="small"
                      color="primary"
                      label={t("eval.case.inputs.judged")}
                      data-hh-id="input-judged-badge"
                      data-testid="input-judged-badge"
                    />
                  )}
                </Stack>
                {editable && controls(index, input, `input-${index + 1}`)}
              </Stack>
            )}
          </li>
        ))}
        {editable && editingIndex === inputs.length && (
          <li>{renderEditor(inputs.length)}</li>
        )}
      </Stack>
      {editable && <Box sx={{ mt: 1 }}>{addButton}</Box>}
    </Box>
  );
};
