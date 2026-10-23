import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Box, useMediaQuery, useTheme, type BoxProps } from "@mui/material";
import { Breadcrumbs } from "@hey-hey/ui-common/components";
import type { BreadcrumbItem } from "@hey-hey/ui-common/utils";
import { TERMS } from "@hey-hey/ui-common/i18n";
import { LAYOUT_CSS } from "../../constants/layout";
import { useMobileHeaderBreadcrumbSlot } from "./MobileHeaderBreadcrumbSlot";

const TYPE_LABELS: Record<string, string> = {
  project: "Project",
  initiative: "Initiative",
  task: TERMS.Task,
  feature: "Feature",
  bug: "Bug",
  plan: "Plan",
  step: "Step",
  service: "Service",
  goal: "Goal",
  organization: "Organization",
  workflow: "Workflow",
  workflow_step: "Workflow Step",
  proposal: "Proposal",
  "design-doc": "Design Doc",
  design_doc: "Design Doc",
};

const looksLikeUuid = (s: string): boolean => /^[0-9a-f]{8,}/i.test(s);

export interface PageBreadcrumbsProps {
  items: BreadcrumbItem[];
  onBack?: () => void;
  ariaLabel?: string;
  testIdPrefix?: string;
  sx?: BoxProps["sx"];
}

const baseSx: BoxProps["sx"] = {
  position: "sticky",
  top: `calc(${LAYOUT_CSS.MAIN_MARGIN_TOP} - 4px)`,
  zIndex: (theme) => theme.zIndex.appBar + 1,
  minHeight: 50,
  display: "flex",
  alignItems: "center",
  bgcolor: "background.default",
  backgroundImage: "none",
  borderBottom: 1,
  borderColor: "divider",
  boxShadow: 1,
  // Reserve room on the left for the floating mobile-nav hamburger (≤ md only)
  pl: { xs: "56px", md: 2 },
  pr: "250px", // Reserve space for the floating notification center controls
  py: 1,
  mb: 2,
};

export const PageBreadcrumbs: React.FC<PageBreadcrumbsProps> = ({
  items,
  onBack,
  ariaLabel = "breadcrumb",
  testIdPrefix = "breadcrumbs",
  sx,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const headerSlot = useMobileHeaderBreadcrumbSlot();

  useEffect(() => {
    const currentIdx = items.findIndex((item) => item.isCurrent);
    const resolvedIdx = currentIdx >= 0 ? currentIdx : items.length - 1;
    const currentItem = items[resolvedIdx];
    if (!currentItem) return;

    const { label, type } = currentItem;
    if (looksLikeUuid(label)) return;

    let title: string;
    if (type === "agent_session") {
      const prevLabel = resolvedIdx > 0 ? items[resolvedIdx - 1].label : label;
      title = `Agent - ${prevLabel}`;
    } else {
      const typeLabel = type ? (TYPE_LABELS[type] ?? "") : "";
      title = typeLabel ? `${typeLabel} - ${label}` : label;
    }

    document.title = title;
  }, [items]);

  const breadcrumbs = (
    <Breadcrumbs
      items={items}
      onBack={onBack}
      ariaLabel={ariaLabel}
      testIdPrefix={testIdPrefix}
    />
  );

  // On ≤ md, fold breadcrumbs into the persistent header so they pin reliably
  // instead of detaching inside AnimatedPageWrapper's transformed/clipped subtree.
  // No-op gracefully (fall back to the in-flow bar) when no slot is mounted.
  if (isMobile && headerSlot) {
    return createPortal(breadcrumbs, headerSlot);
  }

  const mergedSx = [baseSx, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])];

  return <Box sx={mergedSx}>{breadcrumbs}</Box>;
};
