import { Stack, Typography } from "@mui/material";
import React from "react";
import { ReportPanel } from "./reportPrimitives";
import type { ReportSectionItem } from "./reportSectionUtils";

export interface ReportSectionProps {
  title: string;
  testId: string;
  items: ReportSectionItem[];
  maxItems?: number;
  emptyMessage: string;
}

export const ReportSection: React.FC<ReportSectionProps> = ({
  title,
  testId,
  items,
  maxItems,
  emptyMessage,
}) => {
  const visibleItems =
    maxItems !== undefined ? items.slice(0, maxItems) : items;

  return (
    <ReportPanel
      emptyMessage={emptyMessage}
      isEmpty={visibleItems.length === 0}
      testId={testId}
      title={title}
    >
      <Stack
        component="ul"
        data-testid={`${testId}-list`}
        spacing={0.75}
        sx={{ m: 0, p: 0, listStyle: "none" }}
      >
        {visibleItems.map((item) => (
          <Stack
            component="li"
            data-testid={`${testId}-item-${item.id}`}
            key={item.id}
            spacing={0.25}
          >
            <Typography variant="body2">{item.title}</Typography>
            {item.detail ? (
              <Typography color="text.secondary" variant="caption">
                {item.detail}
              </Typography>
            ) : null}
          </Stack>
        ))}
      </Stack>
    </ReportPanel>
  );
};
