import { useEffect, useRef, useState } from "react";
import { Box, Button, Paper, Stack, Typography, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";

import {
  PROJECT_CONCEPT_PLACEHOLDER,
  PROJECT_CONCEPT_REFERENCE_TEXT,
  PROJECT_DESCRIPTION_LABELS,
  PROJECT_DESCRIPTION_REPRESENTATIVE_VALUES,
  PROJECT_DESCRIPTION_SELECT_OPTIONS,
  WELCOME_MESSAGE_TEXT,
  type ProjectDescriptionSelectKey,
} from "../newOrgLandingFixture";

const TYPE_INTERVAL_MS = 80;
const SELECT_REVEAL_DELAY_MS = 600;

interface ProjectDescriptionSceneProps {
  /** Natural width of the scene; matches the surrounding `MiniDemoPlayer`. */
  sceneWidth: number;
  /** Natural height of the scene; matches the surrounding `MiniDemoPlayer`. */
  sceneHeight: number;
  /**
   * Optional override for the typewriter target. Exposed for tests so they can
   * shorten the animation; the production caller relies on the i18n default.
   */
  conceptTarget?: string;
  /** Override the per-character interval for tests using fake timers. */
  typeIntervalMs?: number;
  /** Override the post-typing delay before selects resolve. */
  selectRevealDelayMs?: number;
}

interface FormCardProps {
  label: string;
  children: React.ReactNode;
}

const FormCard: React.FC<FormCardProps> = ({ label, children }) => {
  const theme = useTheme();
  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: `${theme.shape.borderRadius}px`,
        overflow: "hidden",
        border: `1px solid ${theme.palette.divider}`,
        bgcolor: "background.paper",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 2,
          py: 1.25,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Typography
          sx={{
            fontSize: "1.25rem",
            fontWeight: 700,
            color: theme.palette.heyhey?.main ?? "rgb(8, 126, 139)",
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          Q
        </Typography>
        <Typography
          variant="body2"
          color="text.primary"
          sx={{ flex: 1, fontSize: "0.95rem" }}
        >
          {label}
        </Typography>
      </Box>
      {children}
    </Paper>
  );
};

interface ConceptTextareaPreviewProps {
  typedConcept: string;
  showCursor: boolean;
  placeholder: string;
}

const ConceptTextareaPreview: React.FC<ConceptTextareaPreviewProps> = ({
  typedConcept,
  showCursor,
  placeholder,
}) => (
  <Box
    sx={{
      p: 2,
      minHeight: 96,
      fontSize: "1rem",
      lineHeight: 1.5,
      whiteSpace: "pre-wrap",
      color: typedConcept ? "text.primary" : "text.secondary",
    }}
  >
    {typedConcept || placeholder}
    {showCursor && (
      <Box
        component="span"
        data-testid="project-description-typing-cursor"
        sx={{
          display: "inline-block",
          width: "2px",
          height: "1.1em",
          backgroundColor: "text.primary",
          ml: "1px",
          verticalAlign: "text-bottom",
          animation: "newOrgLandingCursorBlink 1s step-end infinite",
          "@keyframes newOrgLandingCursorBlink": {
            "50%": { opacity: 0 },
          },
        }}
      />
    )}
  </Box>
);

interface SelectButtonsPreviewProps {
  options: ReadonlyArray<{ value: string; label: string }>;
  selectedValue: string | null;
}

const SelectButtonsPreview: React.FC<SelectButtonsPreviewProps> = ({
  options,
  selectedValue,
}) => (
  <Box sx={{ p: 1.5, display: "flex", flexWrap: "wrap", gap: 1 }}>
    {options.map((option) => {
      const isSelected = selectedValue === option.value;
      return (
        <Button
          key={option.value}
          variant={isSelected ? "contained" : "outlined"}
          size="small"
          disableRipple
          sx={{
            textTransform: "none",
            minWidth: "fit-content",
            transition: "background-color 200ms ease, color 200ms ease",
          }}
        >
          {option.label}
        </Button>
      );
    })}
  </Box>
);

const SELECT_KEYS: ReadonlyArray<{
  key: ProjectDescriptionSelectKey;
  labelKey: keyof typeof PROJECT_DESCRIPTION_LABELS;
}> = [
  { key: "projectMaturity", labelKey: "project_maturity" },
  { key: "teamSize", labelKey: "team_size" },
  { key: "orgContext", labelKey: "org_context" },
];

const SELECT_OPTIONS_BY_KEY: Record<
  ProjectDescriptionSelectKey,
  ReadonlyArray<{ value: string; label: string }>
> = {
  projectMaturity: PROJECT_DESCRIPTION_SELECT_OPTIONS.project_maturity,
  teamSize: PROJECT_DESCRIPTION_SELECT_OPTIONS.team_size,
  orgContext: PROJECT_DESCRIPTION_SELECT_OPTIONS.org_context,
};

export const ProjectDescriptionScene: React.FC<ProjectDescriptionSceneProps> = ({
  sceneWidth,
  sceneHeight,
  conceptTarget,
  typeIntervalMs = TYPE_INTERVAL_MS,
  selectRevealDelayMs = SELECT_REVEAL_DELAY_MS,
}) => {
  const { t } = useTranslation();
  const target =
    conceptTarget ??
    t(
      "newOrgLanding.projectDescription.conceptTarget",
      PROJECT_CONCEPT_REFERENCE_TEXT,
    );

  const [typedConcept, setTypedConcept] = useState("");
  const [selectsResolved, setSelectsResolved] = useState(false);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    setTypedConcept("");
    setSelectsResolved(false);
    let cancelled = false;
    let charIndex = 0;
    let revealId: number | null = null;
    const intervalId = window.setInterval(() => {
      if (cancelled) return;
      charIndex += 1;
      const next = targetRef.current.slice(0, charIndex);
      setTypedConcept(next);
      if (charIndex >= targetRef.current.length) {
        window.clearInterval(intervalId);
        revealId = window.setTimeout(() => {
          if (cancelled) return;
          setSelectsResolved(true);
        }, selectRevealDelayMs);
      }
    }, typeIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (revealId !== null) {
        window.clearTimeout(revealId);
      }
    };
  }, [target, typeIntervalMs, selectRevealDelayMs]);

  const resolvedSelectValues: Record<ProjectDescriptionSelectKey, string | null> =
    {
      projectMaturity: selectsResolved
        ? PROJECT_DESCRIPTION_REPRESENTATIVE_VALUES.projectMaturity
        : null,
      teamSize: selectsResolved
        ? PROJECT_DESCRIPTION_REPRESENTATIVE_VALUES.teamSize
        : null,
      orgContext: selectsResolved
        ? PROJECT_DESCRIPTION_REPRESENTATIVE_VALUES.orgContext
        : null,
    };

  return (
    <Box
      data-testid="new-org-landing-project-description-scene"
      data-typed-concept={typedConcept}
      data-project-maturity={resolvedSelectValues.projectMaturity ?? ""}
      data-team-size={resolvedSelectValues.teamSize ?? ""}
      data-org-context={resolvedSelectValues.orgContext ?? ""}
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
      <Stack spacing={2.5} sx={{ maxWidth: 980, mx: "auto" }}>
        <Typography
          variant="body1"
          color="text.primary"
          sx={{ fontSize: "1rem", lineHeight: 1.55 }}
        >
          {WELCOME_MESSAGE_TEXT}
        </Typography>
        <FormCard label={PROJECT_DESCRIPTION_LABELS.project_concept}>
          <ConceptTextareaPreview
            typedConcept={typedConcept}
            showCursor={!selectsResolved}
            placeholder={PROJECT_CONCEPT_PLACEHOLDER}
          />
        </FormCard>
        {SELECT_KEYS.map(({ key, labelKey }) => (
          <FormCard key={key} label={PROJECT_DESCRIPTION_LABELS[labelKey]}>
            <SelectButtonsPreview
              options={SELECT_OPTIONS_BY_KEY[key]}
              selectedValue={resolvedSelectValues[key]}
            />
          </FormCard>
        ))}
      </Stack>
    </Box>
  );
};
