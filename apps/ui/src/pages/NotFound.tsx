import { Box, Button, Container, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export default function NotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Container maxWidth="md">
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
          textAlign: "center",
          gap: 3,
        }}
      >
        <Typography variant="h1" component="h1" sx={{ fontSize: "6rem", fontWeight: 700 }}>
          404
        </Typography>
        <Typography variant="h4" component="h2" gutterBottom>
          {t("notFound.title", "Page Not Found")}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          {t("notFound.message", "The page you are looking for does not exist.")}
        </Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={() => navigate("/")}
          size="large"
        >
          {t("notFound.goHome", "Go to Home")}
        </Button>
      </Box>
    </Container>
  );
}
