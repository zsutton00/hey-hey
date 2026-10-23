import { CircularProgress, Stack, Typography } from "@mui/material";

export const SharedLoading = () => (
  <Stack
    alignItems="center"
    spacing={2}
    sx={{ py: 8 }}
    data-testid="data-state-boundary-loading"
    role="status"
  >
    <CircularProgress />
    <Typography color="text.secondary">Loading…</Typography>
  </Stack>
);
