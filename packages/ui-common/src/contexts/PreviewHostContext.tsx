import React, { createContext, useContext, useMemo, useRef } from "react";
import type { OpenItemEntity } from "../types/openItems";

export const PROJECT_COLLECTION_KINDS = [
  "features",
  "goals",
  "plans",
  "services",
] as const;

export type ProjectCollectionKind = (typeof PROJECT_COLLECTION_KINDS)[number];

export interface ProjectCollectionPreviewRequest {
  kind: "project_collection";
  collection: ProjectCollectionKind;
}

export type EntityPreviewRequest = OpenItemEntity;
export type PreviewRequest = EntityPreviewRequest | ProjectCollectionPreviewRequest;

export const createProjectCollectionPreviewRequest = (
  collection: ProjectCollectionKind
): ProjectCollectionPreviewRequest => ({ kind: "project_collection", collection });

export const isProjectCollectionPreviewRequest = (
  request: PreviewRequest
): request is ProjectCollectionPreviewRequest =>
  "kind" in request && request.kind === "project_collection";

export interface PreviewHost {
  openPreview: (request: PreviewRequest) => void;
}

export interface PreviewHostProviderProps {
  children: React.ReactNode;
  host: PreviewHost;
}

const missingPreviewHost: PreviewHost = {
  openPreview: () => {
    throw new Error(
      "PreviewHostProvider is required for previewable InteractionComponent entities."
    );
  },
};

const PreviewHostContext = createContext<PreviewHost>(missingPreviewHost);

export const PreviewHostProvider: React.FC<PreviewHostProviderProps> = ({
  children,
  host,
}) => {
  const hostRef = useRef(host);
  hostRef.current = host;

  const stableHost = useMemo<PreviewHost>(
    () => ({
      openPreview: (request) => {
        hostRef.current.openPreview(request);
      },
    }),
    []
  );

  return (
    <PreviewHostContext.Provider value={stableHost}>
      {children}
    </PreviewHostContext.Provider>
  );
};

export function usePreviewHost(): PreviewHost {
  return useContext(PreviewHostContext);
}
