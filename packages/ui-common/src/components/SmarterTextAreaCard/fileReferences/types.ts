import type { FileReferenceScope } from "../../../data/hooks/useFileReferenceCandidates";
import type { FileTouchReferenceCandidateDto } from "../../../api";

export interface FileReferenceConfig {
  organizationId: string;
  projectId: string;
  scope: FileReferenceScope;
}

export const resolveFileReferenceScope = (
  workItemType: string | undefined,
  workItemId: string
): FileReferenceScope | null => {
  const normalizedWorkItemId = workItemId.trim();
  if (!normalizedWorkItemId) return null;

  switch (workItemType) {
    case "STANDARD":
      return { kind: "task", taskId: normalizedWorkItemId };
    case "FEATURE":
      return { kind: "feature", featureId: normalizedWorkItemId };
    default:
      return null;
  }
};

export interface FileReferenceTextRange {
  nodeKey: string;
  sliceStart: number;
  cursorOffset: number;
}

export interface FileReferenceTriggerMatch {
  query: string;
  range: FileReferenceTextRange;
}

export interface FileReferencePopupPosition {
  top: number;
  left: number;
}

export interface FileReferenceValueV1 {
  version: 1;
  serviceId: string;
  serviceName: string;
  normalizedPath: string;
}

export type FileReferenceValue = FileReferenceValueV1;

export interface SerializedFileReferenceNode {
  type: "file-reference";
  version: 1;
  fileReference: FileReferenceValueV1;
}

export const fileReferenceCandidateKey = (
  candidate: FileTouchReferenceCandidateDto
): string => `${candidate.serviceId}:${candidate.normalizedPath}`;

export const candidateToFileReferenceValue = (
  candidate: FileTouchReferenceCandidateDto
): FileReferenceValueV1 => ({
  version: 1,
  serviceId: candidate.serviceId,
  serviceName: candidate.serviceName,
  normalizedPath: candidate.normalizedPath,
});
