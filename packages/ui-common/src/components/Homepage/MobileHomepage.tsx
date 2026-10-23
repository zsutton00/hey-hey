import React from "react";
import { Box, Typography, Button, Stack } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useUserIdentity } from "../../hooks";
import { HeyHeyBranding } from "./";
import { FadeIn, StaggerChildren } from "../../animations";
import type { LayoutConfig } from "./ResponsiveHandler";

interface MobileHomepageProps {
  config: LayoutConfig;
}

const MobileHomepage: React.FC<MobileHomepageProps> = ({ config: _config }) => {
  const navigate = useNavigate();
  const user = useUserIdentity();

  const handleGetStarted = () => {
    navigate("/onboarding");
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        pt: 0, // No padding top, let sections handle their own spacing
      }}
    >
      {/* Hero Section */}
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          px: 3,
          py: 4,
          backgroundColor: "primary.main",
          color: "white",
          textAlign: "center",
        }}
      >
        <StaggerChildren stagger={0.2}>
          <FadeIn delay={0.1}>
            <Typography variant="h3" component="h1" gutterBottom>
              <HeyHeyBranding variant="hero" />
            </Typography>
          </FadeIn>

          <FadeIn delay={0.3}>
            <Typography
              variant="h6"
              sx={{
                fontFamily: '"Monoton", sans-serif',
                fontWeight: 400,
                letterSpacing: "0.10em",
                mb: 3,
              }}
            >
              {user ? `Welcome back, ${user.name}` : "Welcome"}
            </Typography>
          </FadeIn>

          <FadeIn delay={0.5}>
            <Typography variant="h5" sx={{ mb: 4, maxWidth: "90%" }}>
              Take your software product from idea to launch with AI-powered
              guidance
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
                px: 4,
                py: 2,
                fontSize: "1.1rem",
                borderRadius: 2,
                fontWeight: 600,
                textTransform: "none",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                "&:hover": {
                  bgcolor: "rgba(255,255,255,0.95)",
                  boxShadow: "0 6px 16px rgba(0, 0, 0, 0.2)",
                },
              }}
            >
              Get Started
            </Button>
          </FadeIn>
        </StaggerChildren>
      </Box>

      {/* Features Sections */}
      <Stack spacing={0}>
        {/* Project Planning Section */}
        <Box
          sx={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            px: 3,
            py: 6,
            backgroundColor: "background.paper",
          }}
        >
          <StaggerChildren stagger={0.15}>
            <FadeIn>
              <Typography
                variant="h4"
                component="h2"
                gutterBottom
                align="center"
              >
                AI-Powered Planning
              </Typography>
            </FadeIn>

            <FadeIn delay={0.2}>
              <Typography
                variant="body1"
                align="center"
                sx={{ mb: 4, maxWidth: "85%" }}
              >
                Our AI helps analyze your project idea and provides a complete
                roadmap for engineering, marketing, and sales.
              </Typography>
            </FadeIn>

            <FadeIn delay={0.4}>
              <Box
                component="img"
                src="https://picsum.photos/350/250?random=1"
                alt="Project Planning Illustration"
                sx={{
                  width: "100%",
                  maxWidth: 350,
                  height: "auto",
                  borderRadius: 3,
                  boxShadow: 3,
                  mb: 3,
                }}
              />
            </FadeIn>

            <FadeIn delay={0.6}>
              <Box sx={{ textAlign: "center" }}>
                <Typography variant="h6" gutterBottom>
                  Why Choose AI Planning?
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  • Comprehensive market analysis
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  • Technical roadmap generation
                </Typography>
                <Typography variant="body2">
                  • Resource optimization strategies
                </Typography>
              </Box>
            </FadeIn>
          </StaggerChildren>
        </Box>

        {/* Integration Section */}
        <Box
          sx={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            px: 3,
            py: 6,
            backgroundColor: "background.default",
          }}
        >
          <StaggerChildren stagger={0.15}>
            <FadeIn>
              <Typography
                variant="h4"
                component="h2"
                gutterBottom
                align="center"
              >
                Seamless Integration
              </Typography>
            </FadeIn>

            <FadeIn delay={0.2}>
              <Typography
                variant="body1"
                align="center"
                sx={{ mb: 4, maxWidth: "85%" }}
              >
                Connect with your existing tools like GitHub, Google Analytics,
                and more to streamline your development process.
              </Typography>
            </FadeIn>

            <FadeIn delay={0.4}>
              <Box
                component="img"
                src="https://picsum.photos/350/250?random=2"
                alt="Integration Support Illustration"
                sx={{
                  width: "100%",
                  maxWidth: 350,
                  height: "auto",
                  borderRadius: 3,
                  boxShadow: 3,
                  mb: 3,
                }}
              />
            </FadeIn>

            <FadeIn delay={0.6}>
              <Box sx={{ textAlign: "center" }}>
                <Typography variant="h6" gutterBottom>
                  Popular Integrations
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  GitHub • Google Analytics • Slack
                </Typography>
                <Typography variant="body2">Figma • Linear • Notion</Typography>
              </Box>
            </FadeIn>
          </StaggerChildren>
        </Box>

        {/* Real-time Feedback Section */}
        <Box
          sx={{
            minHeight: "80vh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            px: 3,
            py: 6,
            backgroundColor: "background.paper",
          }}
        >
          <StaggerChildren stagger={0.15}>
            <FadeIn>
              <Typography
                variant="h4"
                component="h2"
                gutterBottom
                align="center"
              >
                Real-time Feedback
              </Typography>
            </FadeIn>

            <FadeIn delay={0.2}>
              <Typography
                variant="body1"
                align="center"
                sx={{ mb: 4, maxWidth: "85%" }}
              >
                Get instant feedback on your project plan and make iterative
                improvements with our AI-powered analysis.
              </Typography>
            </FadeIn>

            <FadeIn delay={0.4}>
              <Button
                variant="outlined"
                size="large"
                onClick={handleGetStarted}
                sx={{
                  borderColor: "primary.main",
                  color: "primary.main",
                  px: 4,
                  py: 1.5,
                  fontSize: "1rem",
                  borderRadius: 2,
                  fontWeight: 600,
                  textTransform: "none",
                  "&:hover": {
                    backgroundColor: "primary.main",
                    color: "white",
                  },
                }}
              >
                Start Your Journey
              </Button>
            </FadeIn>
          </StaggerChildren>
        </Box>
      </Stack>
    </Box>
  );
};

export default MobileHomepage;
