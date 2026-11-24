import type { AdvancedSearchModalConfig } from "@hey-hey/ui-common/context";
import { AdvancedSearch } from "@hey-hey/ui-common/components/AdvancedSearch";
import { Box, CircularProgress, Tab, Tabs } from "@mui/material";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useExplorerSections } from "../hooks/useExplorerSections";
import { SearchBrowseTab, type SearchBrowseTarget } from "./SearchBrowseTab";

const SEARCH_TAB = "search";
const SERVICES_TAB = "services";
const TYPE_TAB_PREFIX = "work-item:";
const EDGE_FADE_PX = 24;

const lastTabStorageKey = (projectId: string): string =>
  `search_modal_last_tab:${projectId}`;

const readLastTab = (projectId: string): string => {
  try {
    return localStorage.getItem(lastTabStorageKey(projectId)) ?? SEARCH_TAB;
  } catch (error) {
    console.error("Failed to read last Search tab from localStorage:", error);
    return SEARCH_TAB;
  }
};

const writeLastTab = (projectId: string, tab: string): void => {
  try {
    localStorage.setItem(lastTabStorageKey(projectId), tab);
  } catch (error) {
    console.error("Failed to save last Search tab to localStorage:", error);
  }
};

interface TabDescriptor {
  id: string;
  label: string;
  target?: SearchBrowseTarget;
}

export interface SearchModalTabsProps {
  config: Omit<AdvancedSearchModalConfig, "type" | "browseTabs">;
  projectId: string;
  onClose: () => void;
  onHasContent: (hasContent: boolean) => void;
}

export const SearchModalTabs: React.FC<SearchModalTabsProps> = ({
  config,
  projectId,
  onClose,
  onHasContent,
}) => {
  const { organizationId } = config;
  const { isReady, workItemSections } = useExplorerSections(
    organizationId,
    projectId,
  );
  const [selectedTab, setSelectedTab] = useState(() => readLastTab(projectId));
  const [searchHasContent, setSearchHasContent] = useState(false);
  const [fade, setFade] = useState({ start: false, end: false });
  const tabsContainerRef = useRef<HTMLDivElement | null>(null);

  // Type tabs come only from the resolved registry; until then only Search.
  const tabs = useMemo<TabDescriptor[]>(() => {
    const searchTab: TabDescriptor = { id: SEARCH_TAB, label: "Search" };
    if (!isReady) {
      return [searchTab];
    }

    return [
      searchTab,
      ...workItemSections.map(({ key, label }) => ({
        id: `${TYPE_TAB_PREFIX}${key}`,
        label,
        target: { kind: "work-item", typeKey: key, label } as const,
      })),
      {
        id: SERVICES_TAB,
        label: "Services",
        target: { kind: "services", label: "Services" } as const,
      },
    ];
  }, [isReady, workItemSections]);

  const activeTab = tabs.find((tab) => tab.id === selectedTab) ?? tabs[0];
  const isSearchActive = activeTab.id === SEARCH_TAB;

  useEffect(() => {
    onHasContent(isSearchActive ? searchHasContent : true);
  }, [isSearchActive, onHasContent, searchHasContent]);

  const updateFade = useCallback(() => {
    const scroller =
      tabsContainerRef.current?.querySelector<HTMLElement>(".MuiTabs-scroller");
    if (!scroller) {
      return;
    }
    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    setFade({
      start: scroller.scrollLeft > 1,
      end: scroller.scrollLeft < maxScroll - 1,
    });
  }, []);

  useEffect(() => {
    const scroller =
      tabsContainerRef.current?.querySelector<HTMLElement>(".MuiTabs-scroller");
    if (!scroller) {
      return undefined;
    }
    updateFade();
    scroller.addEventListener("scroll", updateFade);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateFade);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", updateFade);
      observer?.disconnect();
    };
  }, [tabs, updateFade]);

  const handleTabChange = (_event: React.SyntheticEvent, tabId: string) => {
    setSelectedTab(tabId);
    writeLastTab(projectId, tabId);
  };

  const fadeMask = `linear-gradient(to right, ${
    fade.start ? "transparent" : "black"
  } 0, black ${fade.start ? EDGE_FADE_PX : 0}px, black calc(100% - ${
    fade.end ? EDGE_FADE_PX : 0
  }px), ${fade.end ? "transparent" : "black"} 100%)`;

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", height: "100%" }}
      data-testid="search-modal-tabs"
    >
      <Box
        ref={tabsContainerRef}
        sx={{
          display: "flex",
          alignItems: "center",
          borderBottom: 1,
          borderColor: "divider",
          px: 1,
        }}
      >
        <Tabs
          value={activeTab.id}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons={false}
          aria-label="Search sections"
          sx={{
            minWidth: 0,
            flex: 1,
            minHeight: 44,
            "& .MuiTabs-scroller": {
              maskImage: fadeMask,
              WebkitMaskImage: fadeMask,
            },
          }}
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              value={tab.id}
              label={tab.label}
              data-testid="search-modal-tab"
              data-tab-id={tab.id}
              sx={{
                minHeight: 44,
                minWidth: 44,
                textTransform: "none",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            />
          ))}
        </Tabs>
        {!isReady && (
          <CircularProgress
            size={16}
            sx={{ ml: 1, flexShrink: 0 }}
            aria-label="Loading sections"
            data-testid="search-modal-tabs-loading"
          />
        )}
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: isSearchActive ? "block" : "none",
        }}
      >
        <AdvancedSearch
          {...config}
          projectId={projectId}
          onClose={onClose}
          onHasContent={setSearchHasContent}
        />
      </Box>

      {!isSearchActive && activeTab.target && (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            p: 2,
          }}
        >
          <SearchBrowseTab
            key={activeTab.id}
            organizationId={organizationId}
            projectId={projectId}
            target={activeTab.target}
            onNavigated={onClose}
          />
        </Box>
      )}
    </Box>
  );
};
