import AddIcon from "@mui/icons-material/Add";
import {
  Box,
  ClickAwayListener,
  IconButton,
  Popper,
  TextField,
} from "@mui/material";
import React, { useCallback, useRef, useState } from "react";
import type {
  EntitySearchScope,
  SearchEntity,
} from "../SmarterTextAreaCard/types";
import { SlashEntitySearchPopup } from "../SmarterTextAreaCard/slashCommands/SlashEntitySearchPopup";
import {
  NO_CACHED_CONVERSATION_MENTION_OPTIONS,
  NO_SLASH_FOCAL_ENTITY,
} from "../SmarterTextAreaCard/slashCommands/types";
import {
  canSelectInlineSearchResults,
  INLINE_SEARCH_RESULTS_FRESHNESS,
  type InlineSearchResultsFreshness,
} from "../SmarterTextAreaCard/inlineSearchResults";

export interface RequirementCitationPickerProps {
  /** Accessible name of the slot, e.g. "Designed by". */
  slotLabel: string;
  searchScope: EntitySearchScope;
  /** Project-scoped search, already filtered to what this slot may cite. */
  onSearchEntities: (
    query: string,
    searchScope: EntitySearchScope
  ) => Promise<SearchEntity[]>;
  onSelectEntity: (entity: SearchEntity) => void;
  organizationId: string;
  projectId: string;
  disabled: boolean;
}

/**
 * A quiet "+" that opens the compact inline search for one citation slot.
 * Result ordering, keyboard selection, and stale-result handling come from
 * the shared inline search list.
 */
export const RequirementCitationPicker: React.FC<
  RequirementCitationPickerProps
> = ({
  slotLabel,
  searchScope,
  onSearchEntities,
  onSelectEntity,
  organizationId,
  projectId,
  disabled,
}) => {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const resultsRef = useRef<{
    results: SearchEntity[];
    freshness: InlineSearchResultsFreshness;
  }>({ results: [], freshness: INLINE_SEARCH_RESULTS_FRESHNESS.settled });

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const select = useCallback(
    (entity: SearchEntity) => {
      onSelectEntity(entity);
      close();
    },
    [close, onSelectEntity]
  );

  const handleResultsChange = useCallback(
    (results: SearchEntity[], freshness: InlineSearchResultsFreshness) => {
      resultsRef.current = { results, freshness };
      setSelectedIndex((index) =>
        results.length === 0 ? 0 : Math.min(index, results.length - 1)
      );
    },
    []
  );

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const { results, freshness } = resultsRef.current;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setSelectedIndex(
        (index) => (index - 1 + results.length) % results.length
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const entity = results[selectedIndex];
      if (entity && canSelectInlineSearchResults(freshness)) select(entity);
    }
  };

  return (
    <>
      <IconButton
        ref={anchorRef}
        size="small"
        aria-label={`Add ${slotLabel.toLowerCase()} citation`}
        data-testid="requirement-citation-add"
        onClick={() => setOpen(true)}
        disabled={disabled}
        sx={{ p: 0.25, color: "text.secondary" }}
      >
        <AddIcon sx={{ fontSize: 16 }} />
      </IconButton>
      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement="bottom-start"
        sx={{ zIndex: (theme) => theme.zIndex.modal }}
      >
        <ClickAwayListener onClickAway={close}>
          <Box data-testid="requirement-citation-search">
            <TextField
              autoFocus
              fullWidth
              size="small"
              placeholder={`Search ${slotLabel.toLowerCase()}`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              inputProps={{
                "aria-label": `Search ${slotLabel.toLowerCase()} citations`,
                "data-testid": "requirement-citation-search-input",
              }}
              sx={{ bgcolor: "background.paper", mb: 0.5 }}
            />
            <SlashEntitySearchPopup
              query={query}
              onSearchEntities={onSearchEntities}
              searchScope={searchScope}
              organizationId={organizationId}
              projectId={projectId}
              focalEntity={NO_SLASH_FOCAL_ENTITY}
              cachedConversationMentionOptions={
                NO_CACHED_CONVERSATION_MENTION_OPTIONS
              }
              selectedIndex={selectedIndex}
              onSelectedIndexChange={setSelectedIndex}
              onSelectEntity={select}
              onResultsChange={handleResultsChange}
              maxHeight={320}
            />
          </Box>
        </ClickAwayListener>
      </Popper>
    </>
  );
};
