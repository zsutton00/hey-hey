import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import React, { useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { usePathService } from "../../contexts";
import type { PathService } from "../../services";
import { resolvePreviewEntityType } from "../../utils/mentionFormatting";
import { EntityHoverCard } from "../SmarterTextAreaCard/EntityHoverCard";

const HOVER_OPEN_DELAY_MS = 300;
const HOVER_CLOSE_DELAY_MS = 150;

export interface EntityLinkWithPreviewProps {
  label: string;
  entityId: string;
  entityType: string;
  organizationId: string;
  projectId?: string;
  href?: string;
  sx?: SxProps<Theme>;
  testId?: string;
}

const buildEntityHref = (
  pathService: PathService,
  entityType: string,
  entityId: string,
  projectId?: string,
): string | undefined => {
  if (!projectId) {
    return undefined;
  }

  switch (entityType) {
    case "task":
      return pathService.task({ projectId, taskId: entityId });
    case "design_doc":
      return pathService.designDoc({ projectId, designDocId: entityId });
    case "initiative":
      return pathService.initiativeDetail({
        projectId,
        initiativeId: entityId,
      });
    case "service":
      return pathService.service({ projectId, serviceId: entityId });
    case "plan":
      return pathService.plan({ projectId, planId: entityId });
    case "user":
      return pathService.user({ projectId, userId: entityId });
    default:
      return undefined;
  }
};

export const EntityLinkWithPreview: React.FC<EntityLinkWithPreviewProps> = ({
  label,
  entityId,
  entityType,
  organizationId,
  projectId,
  href,
  sx,
  testId,
}) => {
  const pathService = usePathService();
  const [hoverAnchor, setHoverAnchor] = useState<HTMLElement | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const linkRef = useRef<HTMLSpanElement | HTMLAnchorElement>(null);

  const previewEntityType = resolvePreviewEntityType(entityType);
  const resolvedHref =
    href ??
    (previewEntityType
      ? buildEntityHref(pathService, previewEntityType, entityId, projectId)
      : undefined);

  const supportsHoverPreview = previewEntityType !== "user";

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    if (!supportsHoverPreview) {
      return;
    }
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoverAnchor(linkRef.current);
      hoverTimeoutRef.current = null;
    }, HOVER_OPEN_DELAY_MS);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (!hoverAnchor) {
      return;
    }
    closeTimeoutRef.current = window.setTimeout(() => {
      setHoverAnchor(null);
      closeTimeoutRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  };

  const handlePopoverMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const handlePopoverMouseLeave = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }
    setHoverAnchor(null);
    closeTimeoutRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const baseLinkSx = {
    fontWeight: 600,
    fontSize: "0.9rem",
    color: "text.primary",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
    "&:hover": {
      textDecoration: resolvedHref ? "underline" : "none",
    },
  };
  const linkSx: SxProps<Theme> = sx
    ? [baseLinkSx, ...(Array.isArray(sx) ? sx : [sx])]
    : baseLinkSx;

  const linkProps = resolvedHref
    ? { component: RouterLink, to: resolvedHref }
    : { component: "span" as const };

  return (
    <>
      <Box
        ref={linkRef}
        {...linkProps}
        data-testid={testId}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        sx={linkSx}
      >
        <Typography component="span" sx={{ font: "inherit", minWidth: 0 }}>
          {label}
        </Typography>
      </Box>

      {supportsHoverPreview && hoverAnchor && (
        <Box
          onMouseEnter={handlePopoverMouseEnter}
          onMouseLeave={handlePopoverMouseLeave}
        >
          <EntityHoverCard
            entityId={entityId}
            entityType={previewEntityType}
            organizationId={organizationId}
            projectId={projectId}
            anchorEl={hoverAnchor}
            onPopoverMouseEnter={handlePopoverMouseEnter}
            onPopoverMouseLeave={handlePopoverMouseLeave}
          />
        </Box>
      )}
    </>
  );
};
