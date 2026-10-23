import React from "react";
import { ServicesPage } from "./ServicesPage";

export const ServicesCollection: React.FC<{ organizationId: string; projectId: string }> = (props) => (
  <ServicesPage {...props} preview />
);
