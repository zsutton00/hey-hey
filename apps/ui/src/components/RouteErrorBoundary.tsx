import React from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router-dom";

export const RouteErrorBoundary: React.FC = () => {
  const error = useRouteError();
  const navigate = useNavigate();

  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "Unexpected application error";

  const message = isRouteErrorResponse(error)
    ? typeof error.data === "string"
      ? error.data
      : "An unexpected routing error occurred."
    : error instanceof Error
      ? error.message
      : "An unknown error occurred.";

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: "auto" }}>
      <Stack spacing={2}>
        <Alert severity="error">
          <Typography variant="subtitle1">{title}</Typography>
          <Typography variant="body2">{message}</Typography>
        </Alert>
        <Button variant="outlined" onClick={() => navigate("/")}>
          Return to home
        </Button>
      </Stack>
    </Box>
  );
};
