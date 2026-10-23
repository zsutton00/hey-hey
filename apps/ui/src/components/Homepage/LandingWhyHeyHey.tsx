import ChecklistOutlinedIcon from "@mui/icons-material/ChecklistOutlined";
import { Box, Container, Typography } from "@mui/material";
import { landingPageCopy } from "./landingPageCopy";

export const LandingWhyHeyHey = () => {
  return (
    <Box
      component="section"
      aria-labelledby="landing-why-hey-hey-title"
      data-testid="landing-why-hey-hey"
    >
      <Box
        component="div"
        data-testid="landing-capabilities"
        sx={{
          bgcolor: "#fff",
          color: "#1d1d1f",
          py: { xs: 9, md: 14, lg: 18 },
        }}
      >
        <Container maxWidth="lg">
          <Typography
            id="landing-why-hey-hey-title"
            component="h2"
            sx={{
              mb: { xs: 4, md: 6 },
              fontSize: { xs: "2rem", md: "2.75rem" },
              fontFamily:
                '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
              fontWeight: 900,
              textTransform: "uppercase",
            }}
          >
            Why Hey Hey
          </Typography>

          <Box
            component="ul"
            data-testid="landing-capabilities-grid"
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                md: "repeat(2, minmax(0, 1fr))",
              },
              columnGap: { md: 7, lg: 10 },
              m: 0,
              p: 0,
              listStyle: "none",
            }}
          >
            {landingPageCopy.capabilities.map((capability) => (
              <Box
                component="li"
                key={capability.id}
                data-testid={`landing-capability-${capability.id}`}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0, 1fr)",
                  columnGap: 2,
                  alignItems: "start",
                  py: { xs: 3.5, md: 4.5 },
                  borderBottom: "1px solid rgba(29, 29, 31, 0.14)",
                }}
              >
                <ChecklistOutlinedIcon
                  aria-hidden="true"
                  focusable="false"
                  sx={{
                    mt: 0.25,
                    color: "#515154",
                    fontSize: { xs: "1.35rem", md: "1.5rem" },
                  }}
                />
                <Box>
                  <Typography
                    component="h3"
                    sx={{
                      mb: 1,
                      fontSize: { xs: "1.05rem", md: "1.15rem" },
                      fontWeight: 800,
                      lineHeight: 1.35,
                    }}
                  >
                    {capability.title}
                  </Typography>
                  <Typography
                    component="p"
                    sx={{
                      m: 0,
                      color: "#515154",
                      fontSize: { xs: "0.98rem", md: "1.05rem" },
                      lineHeight: 1.65,
                    }}
                  >
                    {capability.description}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Container>
      </Box>
    </Box>
  );
};
