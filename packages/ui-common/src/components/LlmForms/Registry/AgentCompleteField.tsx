import { Box } from "@mui/material";
import React from "react";
import type { FieldComponentProps } from "./types";

export type AgentCompleteFieldProps = FieldComponentProps<string>;

export const AgentCompleteField: React.FC<AgentCompleteFieldProps> = ({
  config,
}) => {
  return <Box data-testid={`agent-complete-field-${config.field}`} />;
};
