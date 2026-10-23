import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { OpenItemsTriageItem, OpenItemsTriagePayload } from "../../../api";
import type { TriageApplicationCoordinator } from "../../../data/triage/application";
import { OpenItemsTriageSuggestionCard } from "./OpenItemsTriageSuggestionCard";
const noSubscription = () => () => {};
const idleSnapshot = () => 0;
export interface OpenItemsTriageSuggestionsProps {
  payload: OpenItemsTriagePayload;
  scope: string;
  triageApplication: TriageApplicationCoordinator | undefined;
  triageItemHref: (item: OpenItemsTriageItem) => string;
  disabled: boolean;
}
export function OpenItemsTriageSuggestions({
  payload,
  scope,
  triageApplication,
  triageItemHref,
  disabled,
}: OpenItemsTriageSuggestionsProps) {
  const { t } = useTranslation();
  useSyncExternalStore(
    triageApplication?.subscribe ?? noSubscription,
    triageApplication?.snapshot ?? idleSnapshot,
    idleSnapshot
  );
  const [selection, setSelection] = useState<Set<string> | null>(null);
  useEffect(() => {
    setSelection(null);
  }, [scope]);
  useEffect(() => {
    payload.suggestions.forEach((suggestion) =>
      triageApplication?.observe(scope, suggestion)
    );
  }, [triageApplication, scope, payload]);
  const selected =
    selection ??
    new Set(payload.suggestions.map((suggestion) => suggestion.suggestionId));
  const unavailable = disabled || !triageApplication;
  return (
    <Stack spacing={2} data-testid="open-items-triage-field">
      <Typography>{payload.summary}</Typography>
      {payload.suggestions.map((suggestion) => (
        <OpenItemsTriageSuggestionCard
          key={suggestion.suggestionId}
          suggestion={suggestion}
          outcome={
            triageApplication?.outcome(scope, suggestion) ?? {
              state: "idle",
              items: [],
            }
          }
          selected={selected.has(suggestion.suggestionId)}
          disabled={unavailable}
          itemHref={triageItemHref}
          onSelect={() => {
            const next = new Set(selected);
            if (next.has(suggestion.suggestionId))
              next.delete(suggestion.suggestionId);
            else next.add(suggestion.suggestionId);
            setSelection(next);
          }}
          onApply={() => {
            void triageApplication?.apply(scope, suggestion);
          }}
        />
      ))}
      <Stack direction="row" justifyContent="flex-end">
        <Button
          data-testid="triage-apply-all"
          variant="contained"
          size="small"
          disabled={
            unavailable ||
            selected.size === 0 ||
            payload.suggestions.some(
              (suggestion) =>
                triageApplication?.outcome(scope, suggestion).state ===
                "pending"
            )
          }
          onClick={() => {
            void triageApplication?.applyAll(
              scope,
              payload.suggestions.filter((suggestion) =>
                selected.has(suggestion.suggestionId)
              )
            );
          }}
        >
          {t("triage.applyAll", "Apply all selected")}
        </Button>
      </Stack>
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="triage-apply-note"
      >
        {t(
          "triage.applyNote",
          "Each suggestion is applied independently. Promotion asks you to confirm its name and optional date."
        )}
      </Typography>
    </Stack>
  );
}
