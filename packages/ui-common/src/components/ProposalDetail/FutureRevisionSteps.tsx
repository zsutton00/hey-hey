import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";

/** "✓ Approved" / "✓ Applied" — plain completed-stage labels, never versioned. */
export function FutureStepDone({ children }: { children: ReactNode }) {
  return (
    <Typography
      component="span"
      variant="body2"
      color="success.main"
      fontWeight={600}
    >
      ✓ {children}
    </Typography>
  );
}

/**
 * A future revision's stages as a numbered list: 1. Approve, 2. Condition(s),
 * 3. Apply, followed by one explainer line. Presentation only; callers own
 * approval, readiness and Apply. The condition stage is omitted when the
 * revision has no linked work.
 */
export function FutureRevisionSteps({
  approve,
  conditions,
  conditionCount,
  apply,
}: {
  approve: ReactNode;
  conditions?: ReactNode;
  conditionCount: number;
  apply: ReactNode;
}) {
  const steps: [string, ReactNode, string][] = [
    ["Approve", approve, "future-step-approve"],
    ...(conditionCount > 0
      ? [
          [
            conditionCount > 1 ? "Conditions" : "Condition",
            conditions,
            "future-step-condition",
          ] as [string, ReactNode, string],
        ]
      : []),
    ["Apply", apply, "future-step-apply"],
  ];
  return (
    <Box
      data-testid="future-review-sequence"
      sx={{ minWidth: 0, overflow: "hidden" }}
    >
      <Box
        component="ol"
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          m: 0,
          p: 0,
          listStyle: "none",
        }}
      >
        {steps.map(([label, body, testId], index) => (
          <Box
            component="li"
            key={label}
            data-testid={testId}
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "22px minmax(0, 1fr)",
                sm: "22px 92px minmax(0, 1fr)",
              },
              alignItems: "center",
              columnGap: 1.25,
              rowGap: 0.5,
              minHeight: 34,
            }}
          >
            <Box
              component="span"
              aria-hidden
              sx={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 22,
                height: 22,
                borderRadius: "50%",
                bgcolor: "action.hover",
                color: "text.secondary",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {index + 1}
            </Box>
            <Typography component="span" variant="body2" fontWeight={600}>
              {label}
            </Typography>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.25,
                minWidth: 0,
                gridColumn: { xs: 2, sm: "auto" },
              }}
            >
              {body}
            </Box>
          </Box>
        ))}
      </Box>
      {conditionCount > 0 && (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="future-explainer"
          sx={{ mt: 1 }}
        >
          {conditionCount > 1
            ? "An update that can be applied when the conditions are met."
            : "An update that can be applied when the condition is met."}
        </Typography>
      )}
    </Box>
  );
}
