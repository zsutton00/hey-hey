import React from "react";
import { Breadcrumbs as MuiBreadcrumbs, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { BreadcrumbLink } from "../BreadcrumbLink";
import type { BreadcrumbItem } from "../../utils/breadcrumbs";

import { CompactBreadcrumbs } from "./CompactBreadcrumbs";
import { collapseFeatureAncestors } from "./collapseFeatureAncestors";
import { CollapsedFeatureBreadcrumb } from "./CollapsedFeatureBreadcrumb";

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  onBack?: () => void;
  ariaLabel?: string;
  testIdPrefix?: string;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  items,
  ariaLabel = "breadcrumb",
  testIdPrefix = "breadcrumbs",
}) => {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));
  if (items.length === 0) {
    return null;
  }

  if (!isCompact) {
    return (
      <MuiBreadcrumbs
        maxItems={items.length + 1}
        aria-label={ariaLabel}
        data-testid={testIdPrefix}
        sx={{
          bgcolor: "background.default",
          minWidth: 0,
          overflow: "hidden",
          width: "100%",
          "& .MuiBreadcrumbs-ol": {
            flexWrap: "nowrap",
            minWidth: 0,
            overflow: "hidden",
          },
          "& .MuiBreadcrumbs-li": {
            flexShrink: 1,
            minWidth: 0,
          },
          "& .MuiBreadcrumbs-separator": {
            flexShrink: 0,
          },
        }}
      >
        {collapseFeatureAncestors(items).map((entry) => {
          if (entry.kind === "collapsed") {
            return (
              <CollapsedFeatureBreadcrumb
                key={`collapsed-${entry.index}`}
                items={entry.items}
              />
            );
          }
          const { item, index } = entry;
          return (
            <BreadcrumbLink
              key={`${item.entityId ?? item.label}-${index}`}
              to={item.to}
              isCurrentPage={item.isCurrent}
              type={item.type}
              typeLabel={item.typeLabel}
              entityId={item.entityId}
              data-testid={`${testIdPrefix}-item-${index}`}
            >
              {item.label}
            </BreadcrumbLink>
          );
        })}
      </MuiBreadcrumbs>
    );
  }

  return (
    <CompactBreadcrumbs
      ariaLabel={ariaLabel}
      items={items}
      testIdPrefix={testIdPrefix}
    />
  );
};
