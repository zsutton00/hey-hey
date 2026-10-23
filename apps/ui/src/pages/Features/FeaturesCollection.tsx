import React from "react";
import { FeaturesPage } from "./FeaturesPage";

export const FeaturesCollection: React.FC<{ organizationId: string; projectId: string }> = (props) => (
  <FeaturesPage {...props} preview />
);
