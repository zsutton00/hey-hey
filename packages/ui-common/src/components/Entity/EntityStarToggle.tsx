import Star from "@mui/icons-material/Star";
import StarBorder from "@mui/icons-material/StarBorder";
import { Box, CircularProgress, IconButton } from "@mui/material";
import React, { useCallback } from "react";
import type { EntityType } from "../../api";
import { useEntityStar } from "../../data/hooks/useEntityStars";

export interface EntityStarToggleProps {
  organizationId: string;
  entityType: EntityType;
  entityId: string;
  size?: "small" | "medium" | "large";
  disabled?: boolean;
  className?: string;
  testId?: string;
}

export const EntityStarToggle: React.FC<EntityStarToggleProps> = ({
  organizationId,
  entityType,
  entityId,
  size = "small",
  disabled = false,
  className,
  testId = "entity-star-toggle",
}) => {
  const { isStarred, isLoading, isMutating, error, mutationError, toggle } =
    useEntityStar(organizationId, entityType, entityId);
  const isPending = isLoading || isMutating;
  const isLoadError = Boolean(error && !mutationError);

  const handleClick = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled || isPending || isLoadError) {
        return;
      }

      try {
        await toggle();
      } catch {
        // The hook retains the error so the shared control can expose a
        // stable, user-facing failure state without swallowing the state.
      }
    },
    [disabled, isLoadError, isPending, toggle],
  );

  return (
    <Box
      component="span"
      className={className}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        position: "relative",
        flexShrink: 0,
      }}
      data-testid={`${testId}-container`}
    >
      <IconButton
        type="button"
        size={size}
        aria-label={isStarred ? "Unstar" : "Star"}
        aria-pressed={isStarred}
        aria-busy={isPending}
        title={isStarred ? "Unstar" : "Star"}
        disabled={disabled || isPending || isLoadError}
        onClick={handleClick}
        data-testid={testId}
      >
        {isPending ? (
          <CircularProgress size={size === "large" ? 24 : 18} />
        ) : isStarred ? (
          <Star fontSize={size} />
        ) : (
          <StarBorder fontSize={size} />
        )}
      </IconButton>
      {error && (
        <Box
          component="span"
          role="alert"
          data-testid={`${testId}-error`}
          sx={{
            position: "absolute",
            top: "100%",
            right: 0,
            whiteSpace: "nowrap",
            color: "error.main",
            fontSize: "0.7rem",
          }}
        >
          {mutationError ? "Unable to update star" : "Unable to load star state"}
        </Box>
      )}
    </Box>
  );
};
