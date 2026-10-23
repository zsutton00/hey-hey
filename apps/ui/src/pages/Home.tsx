import { FadeIn, StaggerChildren } from "@hey-hey/ui-common/animations";
import { HeyHeyBranding } from "@hey-hey/ui-common/components";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { Box, Button, Container, Stack, Typography } from "@mui/material";
import { lazy, Suspense, type MouseEvent } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { useNavigate } from "react-router-dom";
import { LandingHeroVideos, LandingWhyHeyHey } from "../components/Homepage";
import { landingPageCopy } from "../components/Homepage/landingPageCopy";
import {
  getLandingCtaState,
  landingCtaByState,
} from "../components/Homepage/landingPageCta";
import { useDemoSandboxAvailable } from "../components/Homepage/useDemoSandboxAvailable";

const outlinedCtaSx = {
  color: "white",
  borderColor: "rgba(255,255,255,0.5)",
  px: 4,
  py: 1.5,
  fontWeight: 500,
  textTransform: "none",
  "&:hover": {
    borderColor: "white",
    bgcolor: "rgba(255,255,255,0.08)",
  },
} as const;

const WelcomeSignInForm = lazy(() => import("./Welcome/WelcomeSignInForm"));

const Home = () => {
  const navigate = useNavigate();
  const user = useUserIdentity();
  const [welcome] = useQueryState("welcome", parseAsString.withDefault(""));
  const isWelcomeFlow = welcome.length > 0;
  const demoAvailable = useDemoSandboxAvailable() === true;
  const landingCtaState = getLandingCtaState({
    isWelcomeFlow,
    user: user ?? null,
  });
  const primaryCta =
    landingCtaState === "authenticated"
      ? landingCtaByState.authenticated.primary
      : landingCtaByState["signed-out"].primary;

  return (
    <Box component="main" data-testid="landing-page" sx={{ bgcolor: "#fff" }}>
      <Box
        component="section"
        data-testid="landing-hero"
        sx={{
          minHeight: { xs: "auto", sm: "82vh" },
          display: "flex",
          alignItems: "center",
          bgcolor: "#333",
          color: "white",
          py: { xs: 8, md: 12 },
        }}
      >
        <Container maxWidth="md">
          <StaggerChildren stagger={0.2}>
            <FadeIn delay={0.1}>
              <Typography
                variant="h2"
                component="h1"
                align="center"
                gutterBottom
                sx={{
                  "& > .MuiTypography-root": {
                    color: "common.white",
                  },
                }}
              >
                <HeyHeyBranding variant="hero" />
              </Typography>
            </FadeIn>
            {!isWelcomeFlow && (
              <FadeIn delay={0.5}>
                <Typography
                  variant="h3"
                  component="h2"
                  align="center"
                  sx={{
                    mb: 2,
                    mt: -2,
                    fontSize: { xs: "2rem", md: "2.5rem" },
                    fontFamily:
                      '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
                    fontWeight: 900,
                    textTransform: "uppercase",
                  }}
                >
                  {landingPageCopy.hero.title}
                </Typography>
                <Typography
                  variant="h5"
                  component="p"
                  align="center"
                  sx={{
                    mb: 4,
                    maxWidth: 760,
                    mx: "auto",
                    fontSize: "1rem",
                    color: "rgba(255, 255, 255, 0.76)",
                  }}
                >
                  {landingPageCopy.hero.description}
                </Typography>
              </FadeIn>
            )}
            {isWelcomeFlow ? (
              <FadeIn
                delay={0.5}
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <Suspense fallback={null}>
                  <WelcomeSignInForm />
                </Suspense>
              </FadeIn>
            ) : (
              <FadeIn delay={0.7}>
                <Stack
                  direction={{ xs: "column", sm: "row-reverse" }}
                  spacing={1.5}
                  justifyContent="center"
                  alignItems="center"
                >
                  <Button
                    variant="contained"
                    size="large"
                    onClick={() => navigate(primaryCta.path)}
                    sx={{
                      bgcolor: "white",
                      color: "#333",
                      px: 4,
                      py: 1.5,
                      fontWeight: 600,
                      textTransform: "none",
                      "&:hover": { bgcolor: "rgba(255,255,255,0.95)" },
                    }}
                  >
                    {primaryCta.label}
                  </Button>
                  {landingCtaState === "signed-out" && demoAvailable && (
                    <Button
                      component="a"
                      href={landingCtaByState["signed-out"].demo.path}
                      variant="outlined"
                      size="large"
                      data-testid="landing-view-demo"
                      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                        if (
                          !event.ctrlKey &&
                          !event.metaKey &&
                          !event.shiftKey
                        ) {
                          event.preventDefault();
                          navigate(landingCtaByState["signed-out"].demo.path);
                        }
                      }}
                      sx={outlinedCtaSx}
                    >
                      {landingCtaByState["signed-out"].demo.label}
                    </Button>
                  )}
                  {landingCtaState === "signed-out" && (
                    <Button
                      variant="outlined"
                      size="large"
                      onClick={() =>
                        navigate(landingCtaByState["signed-out"].secondary.path)
                      }
                      sx={outlinedCtaSx}
                    >
                      {landingCtaByState["signed-out"].secondary.label}
                    </Button>
                  )}
                </Stack>
              </FadeIn>
            )}
            {!isWelcomeFlow && (
              <FadeIn delay={0.9}>
                <LandingHeroVideos />
              </FadeIn>
            )}
          </StaggerChildren>
        </Container>
      </Box>

      {!isWelcomeFlow && (
        <>
          <LandingWhyHeyHey />
          <Box
            component="section"
            data-testid="landing-beta-cta"
            sx={{
              py: { xs: 10, md: 15 },
              px: 3,
              textAlign: "center",
              bgcolor: "#fff",
              color: "#1d1d1f",
            }}
          >
            <Typography variant="h3" component="h2" gutterBottom>
              {landingPageCopy.beta.title}
            </Typography>
            <Typography
              variant="h6"
              sx={{ mb: 4, maxWidth: 800, mx: "auto", color: "#515154" }}
            >
              {landingPageCopy.beta.description}
            </Typography>
            <Button
              variant="contained"
              size="large"
              onClick={() => navigate(user ? "/home" : "/request-access")}
              sx={{ px: 6, py: 2, borderRadius: 2 }}
            >
              {user ? "Start Your Journey" : landingPageCopy.beta.action}
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
};

export default Home;
