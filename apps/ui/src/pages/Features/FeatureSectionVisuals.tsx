import { VisualArtifactCard } from "@hey-hey/ui-common/components";
import { Box } from "@mui/material";
import { useEffect, useRef, useState } from "react";

import { useFeatureSectionVisualArtifacts } from "./useFeatureSectionVisualArtifacts";

interface FeatureSectionVisualsProps {
  organizationId: string;
  projectId: string;
  featureId: string;
  // True while the Document is positioning to a selected section; the panel is
  // hidden but still laid out, so visibility alone cannot be trusted.
  suspended?: boolean;
}

/**
 * Each section discovers only its own artifacts, shortly before they enter
 * view and never while the Document is positioning.
 */
export const FeatureSectionVisuals = ({
  organizationId,
  projectId,
  featureId,
  suspended = false,
}: FeatureSectionVisualsProps) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [isNear, setIsNear] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (isNear || !anchor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNear(true);
          observer.disconnect();
        }
      },
      {
        root: anchor.closest('[data-testid="features-wiki-document-panel"]'),
        rootMargin: "240px 0px",
      },
    );
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [isNear]);

  useEffect(() => {
    if (isNear && !suspended) setIsLoaded(true);
  }, [isNear, suspended]);

  return (
    <>
      <Box ref={anchorRef} data-testid={`feature-section-visuals-anchor-${featureId}`} />
      {/* The query hooks mount only once loading starts: every mounted query
          hook does per-render cache work, even while disabled. */}
      {isLoaded && !!organizationId && !!projectId && !!featureId && (
        <SectionVisualCards
          organizationId={organizationId}
          projectId={projectId}
          featureId={featureId}
        />
      )}
    </>
  );
};

const SectionVisualCards = ({
  organizationId,
  projectId,
  featureId,
}: Omit<FeatureSectionVisualsProps, "suspended">) => {
  const artifacts = useFeatureSectionVisualArtifacts(
    organizationId,
    projectId,
    featureId,
    true,
  );
  if (artifacts.length === 0) return null;
  return (
    <Box
      data-testid={`feature-section-visuals-${featureId}`}
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 2,
        mt: 2,
        minWidth: 0,
      }}
    >
      {artifacts.map((artifact) => (
        <VisualArtifactCard
          key={artifact.entityId}
          artifact={artifact}
          organizationId={organizationId}
          projectId={projectId}
        />
      ))}
    </Box>
  );
};
