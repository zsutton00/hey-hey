import { useMemo, type ReactNode } from "react";
import { Box, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";

import { HeyHeyBranding, MiniDemoPlayer } from "@hey-hey/ui-common/components";

import welcomeMascot from "../../assets/welcome.gif";
import { type NewOrgLandingSectionId } from "./newOrgLandingFixture";
import { FeaturesScene } from "./scenes/FeaturesScene";
import { FollowupsScene } from "./scenes/FollowupsScene";
import { ProjectDescriptionScene } from "./scenes/ProjectDescriptionScene";

const SCENE_WIDTH = 1280;
const SCENE_HEIGHT = 720;
const PLAYER_WIDTH_DESKTOP = 720;
const PLAYER_WIDTH_TABLET = 560;
const PLAYER_WIDTH_MOBILE = 320;
const DESCRIPTION_MAX_WIDTH = 420;
const OUTER_MAX_WIDTH = 1280;

interface SectionScaffold {
  /** Stable id used as the MiniDemoScene id and as a test hook. */
  id: NewOrgLandingSectionId;
  /** Description shown alongside the player. */
  caption: string;
  /**
   * Scene content rendered inside the `MiniDemoPlayer`. Each section provides
   * its own composed node so per-section animations can diverge without the
   * page wiring needing to know the shape.
   */
  sceneContent: ReactNode;
  /** How long the scene is on screen at full opacity. */
  durationMs: number;
}

const useSections = (): SectionScaffold[] => {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        id: "project-description",
        caption: t(
          "newOrgLanding.sections.projectDescription.caption",
          "Describe your project — more detail is better, but a paragraph is enough to get started.",
        ),
        sceneContent: (
          <ProjectDescriptionScene
            sceneWidth={SCENE_WIDTH}
            sceneHeight={SCENE_HEIGHT}
          />
        ),
        durationMs: 4200,
      },
      {
        id: "followups",
        caption: t(
          "newOrgLanding.sections.followups.caption",
          "We'll ask follow-up questions to understand goals; you can answer N/A to skip any question you don't want to answer.",
        ),
        sceneContent: (
          <FollowupsScene sceneWidth={SCENE_WIDTH} sceneHeight={SCENE_HEIGHT} />
        ),
        durationMs: 4200,
      },
      {
        id: "features",
        caption: t(
          "newOrgLanding.sections.features.caption",
          "At the end of the conversation, Hey Hey breaks the project down into a starter set of features.",
        ),
        sceneContent: (
          <FeaturesScene sceneWidth={SCENE_WIDTH} sceneHeight={SCENE_HEIGHT} />
        ),
        durationMs: 5400,
      },
    ],
    [t],
  );
};

interface OrientationContentProps {
  /**
   * Optional call-to-action rendered below the demo sections. The new-org
   * landing page passes its project-creation button here; surfaces that only
   * orient the user (e.g. the in-project Help view) omit it.
   */
  cta?: ReactNode;
  heading?: ReactNode;
}

/**
 * Presentational orientation content: the HeyHey welcome intro and the three
 * scripted demo sections. Carries no first-sign-in gate and no
 * project-creation logic so it can be reused both on the new-org landing page
 * and inside a project.
 */
export const OrientationContent: React.FC<OrientationContentProps> = ({
  cta,
  heading,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const isTabletOrLarger = useMediaQuery(theme.breakpoints.up("sm"));
  const sections = useSections();

  const playerWidth = isDesktop
    ? PLAYER_WIDTH_DESKTOP
    : isTabletOrLarger
      ? PLAYER_WIDTH_TABLET
      : PLAYER_WIDTH_MOBILE;

  return (
    <Stack
      spacing={{ xs: 5, md: 7 }}
      alignItems="center"
      sx={{ width: "100%", maxWidth: OUTER_MAX_WIDTH }}
    >
      <Box
        sx={{
          "& > .MuiTypography-root": {
            color:
              theme.palette.mode === "dark"
                ? "common.white"
                : "text.primary",
          },
        }}
      >
        <HeyHeyBranding variant="hero" />
      </Box>
      <Typography variant="h4" textAlign="center">
        {heading ?? t("newOrgLanding.header", "Creating your first project")}
      </Typography>
      <Stack spacing={2} alignItems="center" data-testid="new-org-landing-intro">
        <Box
          component="img"
          src={welcomeMascot}
          alt={t("newOrgLanding.intro.mascotAlt", "Hey Hey mascot waving hello")}
          data-testid="new-org-landing-intro-mascot"
          sx={{
            width: { xs: 140, md: 180 },
            height: { xs: 140, md: 180 },
          }}
        />
        <Typography
          variant="h5"
          textAlign="center"
          data-testid="new-org-landing-intro-heading"
        >
          {t("newOrgLanding.intro.heading", "Welcome to Hey Hey!")}
        </Typography>
        <Typography
          variant="body1"
          color="text.secondary"
          textAlign="center"
          data-testid="new-org-landing-intro-body"
          sx={{ maxWidth: 560, lineHeight: 1.6 }}
        >
          {t(
            "newOrgLanding.intro.body",
            "Here's how it works: tell Hey Hey about your project, answer a few follow-up questions, and we'll turn it into a a new structured project. Watch the steps below, then start when you're ready.",
          )}
        </Typography>
      </Stack>
      {sections.map((section) => (
        <Stack
          key={section.id}
          direction={{ xs: "column", md: "row" }}
          spacing={{ xs: 2, md: 6 }}
          alignItems="center"
          justifyContent="center"
          sx={{ width: "100%" }}
          data-testid={`new-org-landing-section-${section.id}`}
        >
          <Typography
            variant="body1"
            color="text.primary"
            data-testid={`new-org-landing-section-description-${section.id}`}
            sx={{
              flex: { md: 1 },
              maxWidth: { md: DESCRIPTION_MAX_WIDTH },
              textAlign: { xs: "center", md: "left" },
              fontSize: { xs: "1rem", md: "1.125rem" },
              lineHeight: 1.6,
            }}
          >
            {section.caption}
          </Typography>
          <Box sx={{ flexShrink: 0 }}>
            <MiniDemoPlayer
              scenes={[
                {
                  id: section.id,
                  content: section.sceneContent,
                  durationMs: section.durationMs,
                },
              ]}
              loop
              sceneWidth={SCENE_WIDTH}
              sceneHeight={SCENE_HEIGHT}
              containerWidth={playerWidth}
            />
          </Box>
        </Stack>
      ))}
      {cta}
    </Stack>
  );
};
