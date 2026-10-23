import React from "react";
import { Box, Stack, Paper, useTheme } from "@mui/material";
import { SlideUp, FadeIn, Pulse } from "../../animations";
import type { UIHints, UIHintsLayoutHintEnum } from "../../api";
import { FieldSkeleton } from "./FieldSkeleton";

export interface SkeletonFormProps {
  /** UI hints for rendering skeleton form */
  uiHints?: UIHints;
  /** Fallback skeleton count when hints not available */
  fallbackCount?: number;
  showButtons?: boolean;
  /** Number of UI elements that have already streamed in */
  deliveredElementCount?: number;
}

export const SkeletonForm: React.FC<SkeletonFormProps> = ({
  uiHints,
  fallbackCount = 3,
  showButtons = false,
  deliveredElementCount = 0,
}) => {
  const theme = useTheme();

  // Generate skeleton elements based on hints
  const generateSkeletonElements = (): React.ReactNode[] => {
    const deliveredCount = Math.max(deliveredElementCount, 0);

    if (!uiHints?.expectedElements) {
      // Fallback: render generic skeletons
      const remainingFallback = Math.max(fallbackCount - deliveredCount, 0);
      return Array.from({ length: remainingFallback }, (_, index) => (
        <FieldSkeleton
          key={`fallback-${index}`}
          type="text_input"
          index={index}
        />
      ));
    }

    const elements: React.ReactNode[] = [];
    let globalIndex = 0;
    const totalExpected = uiHints.expectedElements.reduce(
      (sum, hint) => sum + (hint.count ?? 0),
      0
    );
    const remainingExpected = Math.max(totalExpected - deliveredCount, 0);

    uiHints.expectedElements.forEach((hint, hintIndex) => {
      // Render the specified count for each hint type
      for (let i = 0; i < hint.count; i++) {
        if (elements.length >= remainingExpected) {
          return;
        }
        elements.push(
          <FieldSkeleton
            key={`${hint.type}-${hintIndex}-${i}`}
            type={hint.type}
            required={hint.required || false}
            index={globalIndex}
          />
        );
        globalIndex++;
      }
    });

    return elements;
  };

  const skeletonElements = generateSkeletonElements();

  // Render based on layout hint
  const renderByLayout = (
    layout: UIHintsLayoutHintEnum | null | undefined
  ): React.ReactNode => {
    switch (layout) {
      case "grid":
        return (
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "repeat(1, minmax(0, 1fr))",
                sm: "repeat(2, minmax(0, 1fr))",
                md: "repeat(3, minmax(0, 1fr))",
              },
            }}
          >
            {skeletonElements.map((element, index) => (
              <Box key={index}>{element}</Box>
            ))}
          </Box>
        );

      case "inline":
        return (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            {skeletonElements}
          </Box>
        );

      case "list":
        return <Stack spacing={1}>{skeletonElements}</Stack>;

      case "form":
      default:
        // Default form layout
        return <Stack spacing={3}>{skeletonElements}</Stack>;
    }
  };

  return (
    <SlideUp data-testid="skeleton-form" duration="medium">
      <Box
        sx={{
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Skeleton content */}
        <div data-testid="skeleton-form-content">
          {renderByLayout(uiHints?.layoutHint)}
        </div>

        {/* Skeleton action buttons area */}
        {showButtons && (
          <FadeIn
            data-testid="skeleton-form-buttons"
            delay={0.3}
            duration="medium"
          >
            <Paper
              elevation={2}
              sx={{
                borderRadius: 2,
                overflow: "hidden",
                border: `1px solid ${theme.palette.divider}`,
                mt: 3,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  bgcolor:
                    theme.palette.mode === "dark" ? "grey.900" : "grey.50",
                  minHeight: 48,
                }}
              >
                {/* Skip button skeleton */}
                <Box
                  sx={{
                    flex: 1,
                    borderRight: `1px solid ${theme.palette.divider}`,
                    p: 1,
                  }}
                >
                  <Pulse pulseScale={1} duration={1.5}>
                    <Box
                      sx={{
                        height: 32,
                        bgcolor:
                          theme.palette.mode === "dark"
                            ? "grey.800"
                            : "grey.300",
                        borderRadius: 1,
                      }}
                    />
                  </Pulse>
                </Box>

                {/* Next button skeleton */}
                <Box sx={{ flex: 1, p: 1 }}>
                  <Pulse pulseScale={1} duration={1.5}>
                    <Box
                      sx={{
                        height: 32,
                        bgcolor: theme.palette.actionable.main,
                        borderRadius: 1,
                        opacity: 0.6,
                      }}
                    />
                  </Pulse>
                </Box>
              </Box>
            </Paper>
          </FadeIn>
        )}
      </Box>
    </SlideUp>
  );
};
