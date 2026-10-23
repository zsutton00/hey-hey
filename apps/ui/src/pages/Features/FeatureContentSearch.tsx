import React, { useEffect, useRef, useState } from "react";
import {
  SearchInputs,
  type SearchMode as SharedSearchMode,
} from "@hey-hey/ui-common/components/AdvancedSearch/SearchInputs";
import { SearchInputsSurface } from "../../components/SearchInputsSurface";

export type FeatureSearchMode = "title" | "content" | "agent";

export interface FeatureContentSearchProps {
  mode: FeatureSearchMode;
  titleQuery: string;
  contentQuery: string;
  agentQuery: string;
  isAgentSearching?: boolean;
  onModeChange: (mode: FeatureSearchMode) => void;
  onTitleQueryChange: (value: string) => void;
  onContentSearchSubmit: (value: string) => void;
  onContentSearchClear: () => void;
  onAgentQueryChange: (value: string) => void;
  onAgentSearchSubmit: (value: string) => void;
  onFocusChange?: (focused: boolean) => void;
}

const resolveQueryForMode = (
  mode: FeatureSearchMode,
  titleQuery: string,
  contentQuery: string,
  agentQuery: string,
): string => {
  if (mode === "title") return titleQuery;
  if (mode === "content") return contentQuery;
  return agentQuery;
};

export const FeatureContentSearch: React.FC<FeatureContentSearchProps> = ({
  mode,
  titleQuery,
  contentQuery,
  agentQuery,
  isAgentSearching = false,
  onModeChange,
  onTitleQueryChange,
  onContentSearchSubmit,
  onContentSearchClear,
  onAgentQueryChange,
  onAgentSearchSubmit,
  onFocusChange,
}) => {
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const activeQuery = resolveQueryForMode(
    mode,
    titleQuery,
    contentQuery,
    agentQuery,
  );
  const [draftQuery, setDraftQuery] = useState(activeQuery);

  useEffect(() => {
    setDraftQuery(activeQuery);
  }, [activeQuery, mode]);

  const handleQueryChange = (query: string): void => {
    setDraftQuery(query);
    if (mode === "title") {
      onTitleQueryChange(query);
    } else if (mode === "agent") {
      onAgentQueryChange(query);
    }
  };

  const handleSearch = (nextMode?: SharedSearchMode): void => {
    const targetMode = nextMode ?? mode;
    if (targetMode === "title") {
      onTitleQueryChange(draftQuery);
      return;
    }
    if (targetMode === "content") {
      if (draftQuery.trim()) {
        onContentSearchSubmit(draftQuery);
      } else {
        onContentSearchClear();
      }
      return;
    }
    onAgentSearchSubmit(draftQuery);
  };

  const focusSearchInput = (): void => {
    const searchInput = searchContainerRef.current?.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >("input:not([type='hidden']):not([disabled]), textarea:not([disabled])");
    searchInput?.focus();
  };

  const handleSearchControlClick = (
    event: React.MouseEvent<HTMLDivElement>,
  ): void => {
    if (!(event.target instanceof HTMLElement)) return;

    if (
      event.target.closest(
        "input, textarea, button, [role='button'], [aria-haspopup='listbox'], select",
      )
    ) {
      return;
    }

    focusSearchInput();
  };

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      onFocusChange?.(false);
    }
  };

  const handleFocus = (): void => {
    onFocusChange?.(true);
  };

  return (
    <SearchInputsSurface
      ref={searchContainerRef}
      onClick={handleSearchControlClick}
      onFocus={handleFocus}
      onBlur={handleBlur}
      sx={{
        position: "relative",
        zIndex: 1,
      }}
    >
      <SearchInputs
        titleQuery={draftQuery}
        onTitleQueryChange={handleQueryChange}
        searchMode={mode}
        onSearchModeChange={onModeChange}
        isLoading={isAgentSearching}
        onSearch={handleSearch}
      />
    </SearchInputsSurface>
  );
};
