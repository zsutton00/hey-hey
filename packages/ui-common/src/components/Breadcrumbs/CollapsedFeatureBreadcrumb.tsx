import React, { useId, useState } from "react";
import { Box, Button, Popover, Stack } from "@mui/material";
import { BreadcrumbLink } from "../BreadcrumbLink";
import type { BreadcrumbItem } from "../../utils/breadcrumbs";

export const CollapsedFeatureBreadcrumb: React.FC<{
  items: BreadcrumbItem[];
}> = ({ items }) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const id = useId();
  return (
    <>
      <Button
        aria-label="Show hidden feature ancestors"
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? id : undefined}
        data-testid="breadcrumbs-feature-overflow"
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ minWidth: 0, px: 1, color: "text.primary" }}
      >
        …
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Stack
          id={id}
          component="nav"
          aria-label="Hidden feature ancestors"
          spacing={2}
          sx={{ p: 2, maxWidth: "min(400px, 90vw)" }}
        >
          {items.map((item, index) => (
            <Box
              key={`${item.entityId ?? item.label}-${index}`}
              onClick={() => setAnchor(null)}
              data-testid="breadcrumbs-hidden-feature"
              data-entity-id={item.entityId}
            >
              <BreadcrumbLink
                to={item.to}
                type={item.type}
                typeLabel={item.typeLabel}
                entityId={item.entityId}
                wrapLabel
              >
                {item.label}
              </BreadcrumbLink>
            </Box>
          ))}
        </Stack>
      </Popover>
    </>
  );
};
