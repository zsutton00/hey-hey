import React from "react";
import { Box, Skeleton, useTheme } from "@mui/material";
import type { ExtendedUIFieldType } from "../../api";

export interface FieldSkeletonProps {
  /** The type of field to render skeleton for */
  type: ExtendedUIFieldType;
  /** Whether this field is required (affects styling) */
  required?: boolean;
  /** Index for subtle animation delays */
  index?: number;
}

export const FieldSkeleton: React.FC<FieldSkeletonProps> = ({
  type,
  required = false,
  index = 0,
}) => {
  const theme = useTheme();

  // Subtle animation delay based on index
  const animationDelay = index * 0.1;

  const getSkeletonForType = (): React.ReactNode => {
    switch (type as ExtendedUIFieldType | "adr_context_starter") {
      case "text_input":
        return (
          <Box sx={{ mb: 2 }}>
            {/* Input field skeleton */}
            <Skeleton
              variant="rounded"
              width="100%"
              height={40}
              sx={{
                animationDelay: `${animationDelay + 0.05}s`,
                borderRadius: 1,
              }}
            />
          </Box>
        );

      case "textarea":
      case "adr_context_starter":
        return (
          <Box sx={{ mb: 2 }}>
            {/* Textarea skeleton with header */}
            <Box
              sx={{
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              {/* Header section */}
              <Box
                sx={{
                  display: "flex",
                  minHeight: 48,
                  borderBottom: `1px solid ${theme.palette.divider}`,
                }}
              >
                <Box sx={{ flex: 1, p: 1 }}>
                  <Skeleton
                    variant="text"
                    width="60%"
                    height={20}
                    sx={{
                      animationDelay: `${animationDelay + 0.15}s`,
                      borderRadius: 1,
                    }}
                  />
                </Box>
              </Box>
              {/* Content area */}
              <Skeleton
                variant="rectangular"
                width="100%"
                height={120}
                sx={{ animationDelay: `${animationDelay + 0.2}s` }}
              />
            </Box>
          </Box>
        );

      case "select":
      case "datepicker":
        return (
          <Box sx={{ mb: 2 }}>
            {/* Field label skeleton */}
            <Skeleton
              variant="text"
              width="35%"
              height={20}
              sx={{
                mb: 0.5,
                animationDelay: `${animationDelay}s`,
                borderRadius: 1,
              }}
            />
            {/* Select field skeleton */}
            <Skeleton
              variant="rounded"
              width="100%"
              height={40}
              sx={{
                animationDelay: `${animationDelay + 0.05}s`,
                borderRadius: 1,
              }}
            />
          </Box>
        );

      case "checkbox":
        return (
          <Box sx={{ mb: 2, display: "flex", alignItems: "center" }}>
            {/* Checkbox skeleton */}
            <Skeleton
              variant="rounded"
              width={20}
              height={20}
              sx={{
                mr: 1,
                animationDelay: `${animationDelay}s`,
                borderRadius: 0.5,
              }}
            />
            {/* Label skeleton */}
            <Skeleton
              variant="text"
              width="50%"
              height={20}
              sx={{
                animationDelay: `${animationDelay + 0.05}s`,
                borderRadius: 1,
              }}
            />
          </Box>
        );

      case "integration_selector":
        return (
          <Box sx={{ mb: 2 }}>
            {/* Field label skeleton */}
            <Skeleton
              variant="text"
              width="50%"
              height={20}
              sx={{
                mb: 0.5,
                animationDelay: `${animationDelay}s`,
                borderRadius: 1,
              }}
            />
            {/* Integration cards skeleton */}
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {[1, 2, 3].map((i) => (
                <Skeleton
                  key={i}
                  variant="rounded"
                  width={80}
                  height={60}
                  sx={{
                    animationDelay: `${animationDelay + i * 0.1}s`,
                    borderRadius: 1,
                  }}
                />
              ))}
            </Box>
          </Box>
        );

      case "team_members":
        return (
          <Box sx={{ mb: 2 }}>
            {/* Field label skeleton */}
            <Skeleton
              variant="text"
              width="40%"
              height={20}
              sx={{
                mb: 0.5,
                animationDelay: `${animationDelay}s`,
                borderRadius: 1,
              }}
            />
            {/* Team member chips skeleton */}
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 1 }}>
              {[1, 2].map((i) => (
                <Skeleton
                  key={i}
                  variant="rounded"
                  width={100}
                  height={32}
                  sx={{
                    animationDelay: `${animationDelay + i * 0.1}s`,
                    borderRadius: 2,
                  }}
                />
              ))}
            </Box>
            {/* Add input skeleton */}
            <Skeleton
              variant="rounded"
              width="100%"
              height={40}
              sx={{
                animationDelay: `${animationDelay + 0.2}s`,
                borderRadius: 1,
              }}
            />
          </Box>
        );

      case "initiative_list":
        return (
          <Box sx={{ mb: 2 }}>
            {/* Field label skeleton */}
            <Skeleton
              variant="text"
              width="45%"
              height={20}
              sx={{
                mb: 0.5,
                animationDelay: `${animationDelay}s`,
                borderRadius: 1,
              }}
            />
            {/* Initiative items skeleton */}
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {[1, 2].map((i) => (
                <Skeleton
                  key={i}
                  variant="rounded"
                  width="100%"
                  height={60}
                  sx={{
                    animationDelay: `${animationDelay + i * 0.1}s`,
                    borderRadius: 1,
                  }}
                />
              ))}
            </Box>
          </Box>
        );

      default:
        // Fallback skeleton for unknown types
        return (
          <Box sx={{ mb: 2 }}>
            <Skeleton
              variant="text"
              width="40%"
              height={20}
              sx={{
                mb: 0.5,
                animationDelay: `${animationDelay}s`,
                borderRadius: 1,
              }}
            />
            <Skeleton
              variant="rounded"
              width="100%"
              height={40}
              sx={{
                animationDelay: `${animationDelay + 0.05}s`,
                borderRadius: 1,
              }}
            />
          </Box>
        );
    }
  };

  return (
    <Box
      data-testid={`field-skeleton-${type}-${index}`}
      sx={{
        opacity: required ? 1 : 0.8,
        filter: required ? "none" : "brightness(0.95)",
      }}
    >
      {getSkeletonForType()}
    </Box>
  );
};
