import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  type SelectChangeEvent,
} from "@mui/material";
import React, { useCallback } from "react";

export type AgentSessionUserFilterValue = "all" | "mine";

export interface AgentSessionUserFilterProps {
  value: AgentSessionUserFilterValue;
  onChange: (value: AgentSessionUserFilterValue) => void;
}

export const AgentSessionUserFilter: React.FC<AgentSessionUserFilterProps> = ({
  value,
  onChange,
}) => {
  const handleChange = useCallback(
    (event: SelectChangeEvent<AgentSessionUserFilterValue>) => {
      const nextValue = event.target.value;
      if (nextValue === "all" || nextValue === "mine") {
        onChange(nextValue);
      }
    },
    [onChange]
  );

  return (
    <FormControl size="small" sx={{ minWidth: 120 }}>
      <InputLabel id="agent-session-user-filter-label">User</InputLabel>
      <Select<AgentSessionUserFilterValue>
        data-testid="agent-session-user-filter"
        label="User"
        labelId="agent-session-user-filter-label"
        onChange={handleChange}
        value={value}
      >
        <MenuItem value="all">All</MenuItem>
        <MenuItem value="mine">Me</MenuItem>
      </Select>
    </FormControl>
  );
};
