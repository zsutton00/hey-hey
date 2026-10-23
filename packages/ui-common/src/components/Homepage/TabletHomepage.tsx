import React from "react";
import { Box, Typography, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useUserIdentity } from "../../hooks";
import {
  HeyHeyBranding,
  ColumnScrollContainer,
  ColumnContent,
  ScrollProgress,
} from "./";
import { useColumnScroll } from "../../hooks/useColumnScroll";
import { FadeIn, StaggerChildren } from "../../animations";
import type { LayoutConfig } from "./ResponsiveHandler";

interface TabletHomepageProps {
  config: LayoutConfig;
}

const TabletHomepage: React.FC<TabletHomepageProps> = ({ config }) => {
  const navigate = useNavigate();
  const user = useUserIdentity();
  const { scrollState } = useColumnScroll(
    config.enableScrolling,
    config.touchOptimized
  );

  const handleGetStarted = () => {
    navigate("/onboarding");
  };

  return (
    <>
      <ColumnScrollContainer>
        {/* Left Column - Simplified content for tablet */}
        <ColumnContent
          isActive={scrollState.activeColumn === "left"}
          panelIndex={scrollState.panelPositions.left}
          panelProgress={scrollState.panelProgress.left}
          totalPanels={3}
          column="left"
          isTransitioning={scrollState.isTransitioning}
          panelHeight={scrollState.panelHeight}
        >
          <Box
            sx={{
              p: 3,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              minHeight: "100vh",
              backgroundColor: "background.paper",
            }}
          >
            <StaggerChildren stagger={0.12}>
              <FadeIn delay={0.1}>
                <Typography
                  variant="h5"
                  component="h2"
                  gutterBottom
                  align="center"
                >
                  AI Planning
                </Typography>
              </FadeIn>
              <FadeIn delay={0.3}>
                <Typography
                  variant="body2"
                  align="center"
                  sx={{ mb: 3, maxWidth: "90%" }}
                >
                  Comprehensive project roadmap with AI-powered insights for
                  engineering and marketing.
                </Typography>
              </FadeIn>
              <FadeIn delay={0.5}>
                <Box
                  component="img"
                  src="https://picsum.photos/280/200?random=1"
                  alt="Project Planning"
                  sx={{
                    width: "100%",
                    maxWidth: 280,
                    height: "auto",
                    borderRadius: 2,
                    boxShadow: 2,
                  }}
                />
              </FadeIn>
            </StaggerChildren>

            {/* Simplified additional content */}
            <Box sx={{ mt: 6, textAlign: "center" }}>
              <StaggerChildren stagger={0.08}>
                <FadeIn>
                  <Typography variant="subtitle1" gutterBottom>
                    Key Features
                  </Typography>
                </FadeIn>
                <FadeIn delay={0.1}>
                  <Typography
                    variant="caption"
                    display="block"
                    sx={{ mb: 0.5 }}
                  >
                    Market Analysis
                  </Typography>
                </FadeIn>
                <FadeIn delay={0.2}>
                  <Typography variant="caption" display="block">
                    Technical Roadmap
                  </Typography>
                </FadeIn>
              </StaggerChildren>
            </Box>
          </Box>
        </ColumnContent>

        {/* Center Column - Hero */}
        <ColumnContent
          isActive={scrollState.activeColumn === "center"}
          panelIndex={scrollState.panelPositions.center}
          panelProgress={scrollState.panelProgress.center}
          totalPanels={3}
          column="center"
          isTransitioning={scrollState.isTransitioning}
          panelHeight={scrollState.panelHeight}
        >
          <Box
            sx={{
              p: 3,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              minHeight: "100vh",
              backgroundColor: "primary.main",
              color: "white",
            }}
          >
            <StaggerChildren stagger={0.15}>
              <FadeIn delay={0.1}>
                <Typography
                  variant="h4"
                  component="h1"
                  gutterBottom
                  align="center"
                >
                  <HeyHeyBranding variant="hero" fontSize="2.5rem" />
                </Typography>
              </FadeIn>
              <FadeIn delay={0.3}>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontFamily: '"Monoton", sans-serif',
                    fontWeight: 400,
                    letterSpacing: "0.10em",
                    mb: 2,
                    textAlign: "center",
                  }}
                >
                  {user ? `Welcome, ${user.userId}` : "Welcome"}
                </Typography>
              </FadeIn>
              <FadeIn delay={0.5}>
                <Typography
                  variant="h6"
                  align="center"
                  sx={{ mb: 3, maxWidth: "85%" }}
                >
                  Transform your ideas into successful products with AI guidance
                </Typography>
              </FadeIn>
              <FadeIn delay={0.7}>
                <Button
                  variant="contained"
                  size="large"
                  onClick={handleGetStarted}
                  sx={{
                    bgcolor: "white",
                    color: "primary.main",
                    px: 3,
                    py: 1.5,
                    fontSize: "1rem",
                    borderRadius: 2,
                    fontWeight: 600,
                    textTransform: "none",
                    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
                    "&:hover": {
                      bgcolor: "rgba(255,255,255,0.95)",
                      transform: "translateY(-1px)",
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                    },
                  }}
                >
                  Get Started
                </Button>
              </FadeIn>
            </StaggerChildren>

            {/* Simplified additional content */}
            <Box sx={{ mt: 6, textAlign: "center" }}>
              <StaggerChildren stagger={0.1}>
                <FadeIn>
                  <Typography variant="subtitle2" gutterBottom>
                    Trusted by Innovators
                  </Typography>
                </FadeIn>
                <FadeIn delay={0.2}>
                  <Typography
                    variant="body2"
                    sx={{ opacity: 0.9, maxWidth: "80%" }}
                  >
                    Join entrepreneurs building successful products
                  </Typography>
                </FadeIn>
              </StaggerChildren>
            </Box>
          </Box>
        </ColumnContent>

        {/* Right Column - Features */}
        <ColumnContent
          isActive={scrollState.activeColumn === "right"}
          panelIndex={scrollState.panelPositions.right}
          panelProgress={scrollState.panelProgress.right}
          totalPanels={3}
          column="right"
          isTransitioning={scrollState.isTransitioning}
          panelHeight={scrollState.panelHeight}
        >
          <Box
            sx={{
              p: 3,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              minHeight: "100vh",
              backgroundColor: "background.paper",
            }}
          >
            <StaggerChildren stagger={0.12}>
              <FadeIn delay={0.1}>
                <Typography
                  variant="h5"
                  component="h2"
                  gutterBottom
                  align="center"
                >
                  Integration Hub
                </Typography>
              </FadeIn>
              <FadeIn delay={0.3}>
                <Typography
                  variant="body2"
                  align="center"
                  sx={{ mb: 3, maxWidth: "90%" }}
                >
                  Connect your favorite tools and get real-time feedback on your
                  progress.
                </Typography>
              </FadeIn>
              <FadeIn delay={0.5}>
                <Box
                  component="img"
                  src="https://picsum.photos/280/200?random=2"
                  alt="Integration Support"
                  sx={{
                    width: "100%",
                    maxWidth: 280,
                    height: "auto",
                    borderRadius: 2,
                    boxShadow: 2,
                  }}
                />
              </FadeIn>
            </StaggerChildren>

            {/* Additional content */}
            <Box sx={{ mt: 4, textAlign: "center" }}>
              <StaggerChildren stagger={0.08}>
                <FadeIn>
                  <Typography variant="subtitle2" gutterBottom>
                    Popular Tools
                  </Typography>
                </FadeIn>
                <FadeIn delay={0.1}>
                  <Typography
                    variant="caption"
                    display="block"
                    sx={{ mb: 0.5 }}
                  >
                    GitHub • Analytics • Slack
                  </Typography>
                </FadeIn>
                <FadeIn delay={0.2}>
                  <Typography variant="caption" display="block">
                    Figma • Linear • Notion
                  </Typography>
                </FadeIn>
              </StaggerChildren>
            </Box>
          </Box>
        </ColumnContent>
      </ColumnScrollContainer>

      {/* Progress Indicators - Smaller for tablet */}
      {config.showProgressBars && (
        <ScrollProgress
          panelProgress={scrollState.panelProgress}
          activeColumn={scrollState.activeColumn}
          isTransitioning={scrollState.isTransitioning}
          panelHeight={scrollState.panelHeight}
        />
      )}
    </>
  );
};

export default TabletHomepage;
