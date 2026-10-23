import {
  Badge,
  Box,
  SvgIcon,
  type SxProps,
  type Theme,
} from "@mui/material";
import { AgentSessionOutputAttentionState } from "../../api";

export interface AgentSessionOutputAttentionIndicatorProps {
  state: AgentSessionOutputAttentionState | undefined;
  sx?: SxProps<Theme>;
}

export const AgentSessionOutputAttentionIndicator = ({
  state,
  sx,
}: AgentSessionOutputAttentionIndicatorProps) => {
  if (state !== AgentSessionOutputAttentionState.MessageReady) {
    return null;
  }

  return (
    <Box
      aria-label="New response"
      aria-live="polite"
      data-output-attention-state={state}
      data-testid="agent-session-output-attention-indicator"
      sx={[
        {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "info.main",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Badge
        aria-hidden="true"
        badgeContent={1}
        color="warning"
        overlap="rectangular"
        sx={{
          "& .MuiBadge-badge": {
            border: 1.5,
            borderColor: "background.paper",
            fontSize: 8,
            fontWeight: 700,
            height: 13,
            lineHeight: 1,
            minWidth: 13,
            p: 0,
          },
        }}
      >
        <SvgIcon fontSize="small" viewBox="0 0 512 512">
          <path d="M160 368c26.5 0 48 21.5 48 48v16l72.5-54.4c8.3-6.2 18.4-9.6 28.8-9.6H448c8.8 0 16-7.2 16-16V64c0-8.8-7.2-16-16-16H64c-8.8 0-16 7.2-16 16v288c0 8.8 7.2 16 16 16zm48 124l-.2.2l-5.1 3.8l-17.1 12.8c-4.8 3.6-11.3 4.2-16.8 1.5s-8.8-8.2-8.8-14.3v-80H64c-35.3 0-64-28.7-64-64V64C0 28.7 28.7 0 64 0h384c35.3 0 64 28.7 64 64v288c0 35.3-28.7 64-64 64H309.3z" />
        </SvgIcon>
      </Badge>
    </Box>
  );
};
