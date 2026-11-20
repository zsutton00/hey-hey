import { Box, CircularProgress, Stack } from "@mui/material";
import { CAPTION_SX, GIF_SIZE } from "../Conversation/Components/ThinkingText";

/**
 * Same footprint as the Starting state of the Run-state indicator, so the
 * hand-off from loading to the live indicator does not shift the layout.
 */
export const SharedLoading = () => (
  <Stack
    alignItems="center"
    spacing={1}
    sx={{ marginTop: "20px", marginBottom: "40px", color: "text.primary" }}
    data-testid="data-state-boundary-loading"
    role="status"
  >
    <Stack
      alignItems="center"
      justifyContent="center"
      sx={{ width: GIF_SIZE, height: GIF_SIZE }}
    >
      <CircularProgress size={GIF_SIZE / 2} color="inherit" />
    </Stack>
    <Box component="span" sx={CAPTION_SX}>
      Loading...
    </Box>
  </Stack>
);
