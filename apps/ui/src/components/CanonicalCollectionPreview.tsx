import type { ProjectCollectionKind } from "@hey-hey/ui-common/context";
import React from "react";
import { FeaturesCollection } from "../pages/Features/FeaturesCollection";
import { GoalsCollection } from "../pages/Goals/GoalsCollection";
import { PlansCollection } from "../pages/Plans/PlansCollection";
import { ServicesCollection } from "../pages/Services/ServicesCollection";

export interface CanonicalCollectionPreviewProps {
  collection: ProjectCollectionKind;
  organizationId: string;
  projectId: string;
}

export const CanonicalCollectionPreview: React.FC<CanonicalCollectionPreviewProps> = ({
  collection,
  organizationId,
  projectId,
}) => {
  const props = { organizationId, projectId };
  switch (collection) {
    case "features": return <FeaturesCollection {...props} />;
    case "goals": return <GoalsCollection {...props} />;
    case "plans": return <PlansCollection {...props} />;
    case "services": return <ServicesCollection {...props} />;
    default: return assertNever(collection);
  }
};

const assertNever = (value: never): never => {
  throw new Error(`Unsupported collection Preview: ${JSON.stringify(value)}`);
};
