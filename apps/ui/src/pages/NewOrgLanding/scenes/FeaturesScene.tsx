import { useEffect, useMemo, useState } from "react";
import { Box, Button, Paper, Stack, Typography, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";

import {
  FEATURES_NARRATIVE_TEXT,
  FEATURES_PRIMARY_ACTION_LABEL,
  FEATURES_RESPONSE_TEXT,
  FEATURES_SECONDARY_ACTION_LABEL,
  FEATURES_TOP_LEVELS,
} from "../newOrgLandingFixture";

const CHILD_REVEAL_INTERVAL_MS = 280;

interface FeaturesSceneProps {
  /** Natural width of the scene; matches the surrounding `MiniDemoPlayer`. */
  sceneWidth: number;
  /** Natural height of the scene; matches the surrounding `MiniDemoPlayer`. */
  sceneHeight: number;
  /** Override the per-child reveal cadence for tests using fake timers. */
  childRevealIntervalMs?: number;
}

interface FlatChild {
  topLevelId: string;
  childId: string;
  name: string;
}

const flattenChildren = (): FlatChild[] => {
  const flat: FlatChild[] = [];
  for (const topLevel of FEATURES_TOP_LEVELS) {
    for (const child of topLevel.children) {
      flat.push({
        topLevelId: topLevel.id,
        childId: child.id,
        name: child.name,
      });
    }
  }
  return flat;
};

interface FeatureChildRowProps {
  name: string;
  testId: string;
}

const FeatureChildRow: React.FC<FeatureChildRowProps> = ({ name, testId }) => {
  const theme = useTheme();
  return (
    <Box
      data-testid={testId}
      sx={{
        position: "relative",
        pl: 2.5,
        py: 0.25,
        opacity: 0,
        animation: "newOrgLandingFeatureChildEnter 320ms ease-out forwards",
        "@keyframes newOrgLandingFeatureChildEnter": {
          from: { opacity: 0, transform: "translateY(-4px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        "&::before": {
          content: '""',
          position: "absolute",
          left: 0,
          top: "0.85em",
          width: 12,
          height: 1,
          bgcolor: theme.palette.heyhey?.main ?? "rgb(8, 126, 139)",
        },
      }}
    >
      <Typography variant="body2" sx={{ fontSize: "0.9rem", fontWeight: 500 }}>
        {name}
      </Typography>
    </Box>
  );
};

interface FeatureTopLevelCardProps {
  topLevelId: string;
  name: string;
  description: string;
  revealedChildIds: ReadonlyArray<string>;
  childItems: ReadonlyArray<{ id: string; name: string }>;
}

const FeatureTopLevelCard: React.FC<FeatureTopLevelCardProps> = ({
  topLevelId,
  name,
  description,
  revealedChildIds,
  childItems,
}) => {
  const theme = useTheme();
  const revealedSet = useMemo(
    () => new Set(revealedChildIds),
    [revealedChildIds],
  );
  const visibleChildren = childItems.filter((child) =>
    revealedSet.has(child.id),
  );
  return (
    <Paper
      elevation={0}
      data-testid={`new-org-landing-features-section-${topLevelId}`}
      sx={{
        borderRadius: `${theme.shape.borderRadius}px`,
        overflow: "hidden",
        border: `1px solid ${theme.palette.divider}`,
        bgcolor: "background.paper",
        px: 2,
        py: 1.5,
      }}
    >
      <Typography
        variant="subtitle1"
        sx={{ fontWeight: 700, fontSize: "1rem", lineHeight: 1.3 }}
      >
        {name}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ fontSize: "0.85rem", mb: visibleChildren.length > 0 ? 1 : 0 }}
      >
        {description}
      </Typography>
      {visibleChildren.length > 0 && (
        <Box
          sx={{
            ml: 1,
            pl: 1.5,
            borderLeft: `1px solid ${theme.palette.heyhey?.main ?? "rgb(8, 126, 139)"}`,
          }}
        >
          <Stack spacing={0.5}>
            {visibleChildren.map((child) => (
              <FeatureChildRow
                key={child.id}
                name={child.name}
                testId={`new-org-landing-features-child-${child.id}`}
              />
            ))}
          </Stack>
        </Box>
      )}
    </Paper>
  );
};

export const FeaturesScene: React.FC<FeaturesSceneProps> = ({
  sceneWidth,
  sceneHeight,
  childRevealIntervalMs = CHILD_REVEAL_INTERVAL_MS,
}) => {
  const { t } = useTranslation();
  const flatChildren = useMemo(() => flattenChildren(), []);
  const totalChildren = flatChildren.length;
  const [revealedChildCount, setRevealedChildCount] = useState(0);

  useEffect(() => {
    setRevealedChildCount(0);
    let cancelled = false;
    let nextIndex = 0;
    const intervalId = window.setInterval(() => {
      if (cancelled) return;
      nextIndex += 1;
      setRevealedChildCount(nextIndex);
      if (nextIndex >= totalChildren) {
        window.clearInterval(intervalId);
      }
    }, childRevealIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [childRevealIntervalMs, totalChildren]);

  const revealedChildIds = useMemo(
    () => flatChildren.slice(0, revealedChildCount).map((c) => c.childId),
    [flatChildren, revealedChildCount],
  );

  const responseText = t(
    "newOrgLanding.features.responseIntro",
    FEATURES_RESPONSE_TEXT,
  );
  const narrativeText = t(
    "newOrgLanding.features.narrative",
    FEATURES_NARRATIVE_TEXT,
  );
  const primaryActionLabel = t(
    "newOrgLanding.features.primaryAction",
    FEATURES_PRIMARY_ACTION_LABEL,
  );
  const secondaryActionLabel = t(
    "newOrgLanding.features.secondaryAction",
    FEATURES_SECONDARY_ACTION_LABEL,
  );

  return (
    <Box
      data-testid="new-org-landing-features-scene"
      data-revealed-child-count={revealedChildCount}
      sx={{
        width: sceneWidth,
        height: sceneHeight,
        pointerEvents: "none",
        overflow: "hidden",
        backgroundColor: "background.default",
        px: 6,
        py: 4,
      }}
    >
      <Stack spacing={2} sx={{ maxWidth: 980, mx: "auto" }}>
        <Typography
          variant="body1"
          data-testid="new-org-landing-features-response"
          color="text.primary"
          sx={{ fontSize: "1rem", lineHeight: 1.55 }}
        >
          {responseText}
        </Typography>
        <Typography
          variant="body2"
          data-testid="new-org-landing-features-narrative"
          color="text.secondary"
          sx={{ fontSize: "0.95rem", lineHeight: 1.5 }}
        >
          {narrativeText}
        </Typography>
        <Stack spacing={1.25}>
          {FEATURES_TOP_LEVELS.map((topLevel) => (
            <FeatureTopLevelCard
              key={topLevel.id}
              topLevelId={topLevel.id}
              name={topLevel.name}
              description={topLevel.description}
              revealedChildIds={revealedChildIds}
              childItems={topLevel.children.map((child) => ({
                id: child.id,
                name: child.name,
              }))}
            />
          ))}
        </Stack>
        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 1,
            pt: 0.5,
          }}
        >
          <Button
            variant="outlined"
            size="small"
            disableRipple
            data-testid="new-org-landing-features-secondary-action"
            sx={{ textTransform: "none" }}
          >
            {secondaryActionLabel}
          </Button>
          <Button
            variant="contained"
            size="small"
            disableRipple
            data-testid="new-org-landing-features-primary-action"
            sx={{ textTransform: "none", minWidth: 140 }}
          >
            {primaryActionLabel}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
};
