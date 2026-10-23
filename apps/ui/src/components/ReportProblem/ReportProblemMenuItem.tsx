import BugReportOutlinedIcon from "@mui/icons-material/BugReportOutlined";
import { ListItemIcon, ListItemText, MenuItem } from "@mui/material";

interface ReportProblemMenuItemProps {
  onSelect: () => void;
}

export const ReportProblemMenuItem = ({
  onSelect,
}: ReportProblemMenuItemProps) => (
  <MenuItem onClick={onSelect} data-testid="report-problem-menu-item">
    <ListItemIcon>
      <BugReportOutlinedIcon fontSize="small" />
    </ListItemIcon>
    <ListItemText>Report a problem</ListItemText>
  </MenuItem>
);
