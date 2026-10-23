import React from "react";
import { PlansPage } from "./PlansPage";

export const PlansCollection: React.FC<{ organizationId: string; projectId: string }> = (props) => (
  <PlansPage {...props} preview />
);
