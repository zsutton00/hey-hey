import { MenuItem } from "@mui/material";
import type { TaskMonitorLaunchMethod } from "../../api";

export const LAUNCH_METHOD_LABELS: Record<TaskMonitorLaunchMethod, string> = {
  plan: "Plan",
  open: "Open",
  quick: "Quick",
};

/**
 * MUI Select only recognises direct `MenuItem` children, so this returns an
 * array rather than a wrapper component. The node's current method stays
 * listed even if its kind no longer allows it, so a stored value never renders
 * as an empty select.
 */
export const taskMonitorLaunchMethodOptions = (
  allowed: readonly TaskMonitorLaunchMethod[],
  current: TaskMonitorLaunchMethod,
) => {
  const methods = allowed.includes(current) ? allowed : [...allowed, current];

  return methods.map((method) => (
    <MenuItem key={method} value={method}>
      {LAUNCH_METHOD_LABELS[method]}
    </MenuItem>
  ));
};
