import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import { Button, CircularProgress, type Theme } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

const PROJECT_TOPOLOGY_BUTTON_LABEL = "Potential project sync issue";

const projectTopologyButtonSx = (theme: Theme) => {
  const topologyPalette = theme.palette.heyhey ?? theme.palette.primary;
  const topologyMain = topologyPalette.main;
  const topologyDark = topologyPalette.dark;

  return {
    backgroundColor: topologyMain,
    color: theme.palette.getContrastText(topologyMain),
    "&:hover": {
      backgroundColor: topologyDark,
      color: theme.palette.getContrastText(topologyDark),
    },
    "&.Mui-disabled": {
      backgroundColor: theme.palette.action.disabledBackground,
      color: theme.palette.action.disabled,
    },
  };
};

export interface ProjectTopologyButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

/**
 * Shared presentation for actions that ask the user to review project
 * topology after implementation work. The consuming surface owns the action
 * lifecycle; this control only reports the user's click.
 */
export const ProjectTopologyButton = ({
  onClick,
  disabled = false,
  loading = false,
}: ProjectTopologyButtonProps) => (
  <Button
    type="button"
    data-testid="project-topology-button"
    color="heyhey"
    variant="contained"
    disabled={disabled || loading}
    aria-busy={loading}
    aria-label={PROJECT_TOPOLOGY_BUTTON_LABEL}
    onClick={onClick}
    startIcon={
      loading ? (
        <CircularProgress size={18} color="inherit" />
      ) : (
        <AccountTreeOutlinedIcon />
      )
    }
    sx={projectTopologyButtonSx}
  >
    {PROJECT_TOPOLOGY_BUTTON_LABEL}
  </Button>
);

/**
 * The topology button once the action it offered has been started: same
 * appearance, with a check icon, linking to the session that was created.
 */
export const ProjectTopologyViewSessionButton = ({ to }: { to: string }) => (
  <Button
    component={RouterLink}
    to={to}
    data-testid="verify-feature-started-link"
    color="heyhey"
    variant="contained"
    startIcon={<CheckCircleOutlineIcon />}
    sx={projectTopologyButtonSx}
  >
    View session
  </Button>
);
