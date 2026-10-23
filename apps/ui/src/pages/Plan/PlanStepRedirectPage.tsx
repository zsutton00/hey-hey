import React from "react";
import { Navigate, useParams } from "react-router-dom";

export const PlanStepRedirectPage: React.FC = () => {
  const { projectId, planId } = useParams<{
    projectId: string;
    planId: string;
  }>();

  if (!projectId || !planId) {
    return null;
  }

  return <Navigate replace to={`/projects/${projectId}/plans/${planId}`} />;
};
