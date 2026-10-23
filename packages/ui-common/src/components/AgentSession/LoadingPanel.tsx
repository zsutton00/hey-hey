import { CircularProgress, Paper, Stack, Typography } from "@mui/material";

import { useDataStateLoading } from "../shared/dataStateLoadingContext";

interface LoadingPanelProps {
  label?: string;
}

export const LoadingPanel = ({ label }: LoadingPanelProps) => {
  const coordinated = useDataStateLoading(true);
  if (coordinated) return null;
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2.5, border: "none", boxShadow: "none", background: "none" }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="center"
      >
        <CircularProgress size={18} />
        {label ? (
          <Typography variant="body2" color="text.secondary">
            {label}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
};
