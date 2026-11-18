import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAgentSession,
  useAgentSessionTitleOptions,
} from "@hey-hey/ui-common/data";
import {
  Autocomplete,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

const SEARCH_DEBOUNCE_MS = 250;

type SessionOption =
  | { kind: "session"; id: string; title: string }
  | { kind: "footer"; id: "__session_footer__"; title: "" };

const FOOTER: SessionOption = {
  kind: "footer",
  id: "__session_footer__",
  title: "",
};

export function SessionFilter({
  organizationId,
  projectId,
  value,
  onChange,
}: {
  organizationId: string;
  projectId: string;
  value: string | null;
  onChange: (agentSessionId: string | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const footerActivatedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(draft.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  const results = useAgentSessionTitleOptions(organizationId, projectId, {
    search,
    enabled: open,
  });
  const { agentSession: selected } = useAgentSession(
    organizationId,
    projectId,
    value ?? "",
    { enabled: !!value },
  );

  const selectedOption = useMemo<SessionOption | null>(
    () =>
      selected
        ? { kind: "session", id: selected.id, title: selected.title }
        : null,
    [selected],
  );
  const options = useMemo<SessionOption[]>(() => {
    const sessions = results.options.map((option): SessionOption => ({
      kind: "session",
      ...option,
    }));
    const showFooter =
      results.hasNextPage ||
      results.isFetchingNextPage ||
      results.nextPageError !== null;
    return showFooter ? [...sessions, FOOTER] : sessions;
  }, [
    results.options,
    results.hasNextPage,
    results.isFetchingNextPage,
    results.nextPageError,
  ]);

  const searching = results.isLoading || draft.trim() !== search;

  const noOptionsText = results.initialError ? (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="body2" color="error">
        {t("changes.sessionLoadFailed")}
      </Typography>
      <Button
        size="small"
        onClick={results.retry}
        data-testid="changes-session-retry"
      >
        {t("changes.sessionRetry")}
      </Button>
    </Stack>
  ) : (
    t("changes.sessionNoResults")
  );

  const renderFooter = () => {
    if (results.nextPageError) {
      return (
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" color="error">
            {t("changes.sessionLoadMoreFailed")}
          </Typography>
          <Button
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              results.retry();
            }}
            data-testid="changes-session-retry-more"
          >
            {t("changes.sessionRetry")}
          </Button>
        </Stack>
      );
    }
    if (results.isFetchingNextPage) {
      return (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">
            {t("changes.sessionLoadingMore")}
          </Typography>
        </Stack>
      );
    }
    return (
      <Button
        size="small"
        onClick={(event) => {
          event.stopPropagation();
          results.loadNextPage();
        }}
        data-testid="changes-session-load-more"
      >
        {t("changes.sessionLoadMore")}
      </Button>
    );
  };

  return (
    <Autocomplete<SessionOption>
      sx={{ minWidth: 200, flex: 1 }}
      options={options}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => {
        if (footerActivatedRef.current) {
          // Keyboard activation of the Load more / Retry row keeps the list open.
          footerActivatedRef.current = false;
          return;
        }
        setOpen(false);
        setDraft("");
        setSearch("");
      }}
      filterOptions={(all) => all}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      getOptionLabel={(option) => option.title}
      getOptionKey={(option) => option.id}
      value={selectedOption}
      onInputChange={(_, text, reason) => {
        if (reason === "input") {
          setDraft(text);
        }
      }}
      clearText={t("changes.clearSession")}
      onChange={(_, option) => {
        if (option?.kind === "footer") {
          footerActivatedRef.current = true;
          if (results.nextPageError) {
            results.retry();
          } else if (!results.isFetchingNextPage) {
            results.loadNextPage();
          }
          return;
        }
        onChange(option?.id ?? null);
      }}
      loading={searching}
      loadingText={t("changes.sessionLoading")}
      noOptionsText={noOptionsText}
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string };
        if (option.kind === "footer") {
          return (
            <li key={key} {...rest}>
              {renderFooter()}
            </li>
          );
        }
        return (
          <li key={key} {...rest}>
            {option.title}
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={t("changes.session")}
          data-testid="changes-session-filter"
          helperText={
            value && !selectedOption && !open
              ? t("changes.sessionUnavailable")
              : undefined
          }
        />
      )}
    />
  );
}
