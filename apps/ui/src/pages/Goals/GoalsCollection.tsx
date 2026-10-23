import React from "react";
import { GoalsPage } from "./GoalsPage";

export const GoalsCollection: React.FC<{ organizationId: string; projectId: string }> = (props) => (
  <GoalsPage {...props} preview />
);
