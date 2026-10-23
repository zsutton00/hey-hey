import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  Button,
  Menu,
  MenuItem,
  Tab,
  Tabs,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import type { ResponsiveTab, ResponsiveTabsProps } from "./types";
import { MINI_DEMO_TARGETS } from "../MiniDemoPlayer/types";

const TABS_SX = { borderBottom: 1, borderColor: "divider", mb: 3 } as const;
const FADE_WIDTH = 32;
const MORE_LABEL = "More";

export const ResponsiveTabs = <T extends string = string>({
  value,
  onChange,
  tabs,
  overflow = "scroll",
}: ResponsiveTabsProps<T>): React.ReactElement => {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));

  const handleSelect = useCallback(
    (next: string) => {
      void onChange(next as T);
    },
    [onChange]
  );

  if (!isCompact) {
    return (
      <Tabs
        value={value}
        onChange={(_, newValue) => handleSelect(String(newValue))}
        sx={TABS_SX}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.value}
            label={tab.label}
            value={tab.value}
            data-tab-value={tab.value}
            data-demo-target={
              tab.value === "agent-sessions"
                ? MINI_DEMO_TARGETS.codingSessionsTab
                : undefined
            }
          />
        ))}
      </Tabs>
    );
  }

  if (overflow === "menu") {
    return (
      <ResponsiveTabsMenu value={value} tabs={tabs} onSelect={handleSelect} />
    );
  }

  return (
    <ResponsiveTabsScroll value={value} tabs={tabs} onSelect={handleSelect} />
  );
};

interface CompactProps {
  value: string;
  tabs: ResponsiveTab[];
  onSelect: (next: string) => void;
}

const ResponsiveTabsScroll: React.FC<CompactProps> = ({
  value,
  tabs,
  onSelect,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  const updateFade = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const { scrollLeft, clientWidth, scrollWidth } = scroller;
    setShowLeftFade(scrollLeft > 1);
    setShowRightFade(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scroller =
      container.querySelector<HTMLDivElement>(".MuiTabs-scroller");
    scrollerRef.current = scroller;
    if (!scroller) return;

    updateFade();

    const onScroll = (): void => updateFade();
    scroller.addEventListener("scroll", onScroll, { passive: true });

    const observer = new ResizeObserver(() => updateFade());
    observer.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [updateFade, tabs.length]);

  return (
    <Box
      ref={containerRef}
      sx={{ position: "relative", ...TABS_SX }}
      data-testid="responsive-tabs-scroll"
    >
      <Tabs
        value={value}
        onChange={(_, newValue) => onSelect(String(newValue))}
        variant="scrollable"
        scrollButtons={false}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.value}
            label={tab.label}
            value={tab.value}
            data-tab-value={tab.value}
            data-demo-target={
              tab.value === "agent-sessions"
                ? MINI_DEMO_TARGETS.codingSessionsTab
                : undefined
            }
          />
        ))}
      </Tabs>
      <Box
        data-testid="responsive-tabs-fade-left"
        aria-hidden
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: FADE_WIDTH,
          pointerEvents: "none",
          opacity: showLeftFade ? 1 : 0,
          transition: "opacity 120ms ease",
          background:
            "linear-gradient(to right, var(--mui-palette-background-default, #fff), rgba(255,255,255,0))",
        }}
      />
      <Box
        data-testid="responsive-tabs-fade-right"
        aria-hidden
        sx={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: FADE_WIDTH,
          pointerEvents: "none",
          opacity: showRightFade ? 1 : 0,
          transition: "opacity 120ms ease",
          background:
            "linear-gradient(to left, var(--mui-palette-background-default, #fff), rgba(255,255,255,0))",
        }}
      />
    </Box>
  );
};

const ResponsiveTabsMenu: React.FC<CompactProps> = ({
  value,
  tabs,
  onSelect,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [tabWidths, setTabWidths] = useState<number[]>([]);
  const [moreWidth, setMoreWidth] = useState(0);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;
    const tabEls = measure.querySelectorAll<HTMLElement>("[data-measure-tab]");
    const widths: number[] = [];
    tabEls.forEach((el) => widths.push(el.offsetWidth));
    setTabWidths(widths);
    const moreEl = measure.querySelector<HTMLElement>("[data-measure-more]");
    setMoreWidth(moreEl ? moreEl.offsetWidth : 0);
  }, [tabs]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateWidth = (): void => {
      setContainerWidth(container.clientWidth);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const { inlineCount, overflowTabs, activeInOverflow } = useMemo(() => {
    if (containerWidth === 0 || tabWidths.length !== tabs.length) {
      return {
        inlineCount: tabs.length,
        overflowTabs: [] as ResponsiveTab[],
        activeInOverflow: false,
      };
    }
    const total = tabWidths.reduce((sum, w) => sum + w, 0);
    if (total <= containerWidth) {
      return {
        inlineCount: tabs.length,
        overflowTabs: [] as ResponsiveTab[],
        activeInOverflow: false,
      };
    }
    const budget = Math.max(0, containerWidth - moreWidth);
    let used = 0;
    let count = 0;
    for (let i = 0; i < tabWidths.length; i++) {
      const next = used + tabWidths[i];
      if (next > budget) break;
      used = next;
      count = i + 1;
    }
    const overflow = tabs.slice(count);
    const inOverflow = overflow.some((tab) => tab.value === value);
    return {
      inlineCount: count,
      overflowTabs: overflow,
      activeInOverflow: inOverflow,
    };
  }, [containerWidth, tabWidths, tabs, moreWidth, value]);

  const inlineTabs = tabs.slice(0, inlineCount);
  const inlineHasActive = inlineTabs.some((tab) => tab.value === value);
  const inlineTabsValue = inlineHasActive ? value : false;

  const handleOpenMenu = useCallback((): void => {
    setMenuAnchor(moreButtonRef.current);
  }, []);

  const handleCloseMenu = useCallback((): void => {
    setMenuAnchor(null);
  }, []);

  const handleMenuSelect = useCallback(
    (next: string): void => {
      setMenuAnchor(null);
      onSelect(next);
    },
    [onSelect]
  );

  return (
    <Box
      ref={containerRef}
      sx={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        ...TABS_SX,
      }}
      data-testid="responsive-tabs-menu"
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Tabs
          value={inlineTabsValue}
          onChange={(_, newValue) => onSelect(String(newValue))}
          variant="standard"
        >
          {inlineTabs.map((tab) => (
            <Tab
              key={tab.value}
              label={tab.label}
              value={tab.value}
              data-tab-value={tab.value}
              data-demo-target={
                tab.value === "agent-sessions"
                  ? MINI_DEMO_TARGETS.codingSessionsTab
                  : undefined
              }
            />
          ))}
        </Tabs>
      </Box>
      {overflowTabs.length > 0 && (
        <Button
          ref={moreButtonRef}
          size="small"
          color={activeInOverflow ? "primary" : "inherit"}
          variant={activeInOverflow ? "outlined" : "text"}
          endIcon={<ArrowDropDownIcon />}
          onClick={handleOpenMenu}
          aria-haspopup="menu"
          aria-expanded={menuAnchor ? "true" : "false"}
          data-testid="responsive-tabs-more"
          sx={{ flexShrink: 0, ml: 1 }}
        >
          {MORE_LABEL}
        </Button>
      )}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleCloseMenu}
      >
        {overflowTabs.map((tab) => (
          <MenuItem
            key={tab.value}
            selected={tab.value === value}
            onClick={() => handleMenuSelect(tab.value)}
            data-tab-value={tab.value}
            data-demo-target={
              tab.value === "agent-sessions"
                ? MINI_DEMO_TARGETS.codingSessionsTab
                : undefined
            }
          >
            {tab.label}
          </MenuItem>
        ))}
      </Menu>
      <Box
        ref={measureRef}
        aria-hidden
        sx={{
          position: "absolute",
          visibility: "hidden",
          pointerEvents: "none",
          top: 0,
          left: 0,
          height: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <Tabs value={false} onChange={() => undefined}>
          {tabs.map((tab) => (
            <Tab
              key={tab.value}
              label={tab.label}
              value={tab.value}
              data-measure-tab
            />
          ))}
        </Tabs>
        <Button size="small" endIcon={<ArrowDropDownIcon />} data-measure-more>
          {MORE_LABEL}
        </Button>
      </Box>
    </Box>
  );
};
