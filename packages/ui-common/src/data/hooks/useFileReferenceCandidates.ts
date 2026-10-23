import type { FileTouchReferenceCandidateDto } from "../../api";
import {
  fileReferenceCandidatesQueryOptions,
  type FileReferenceScope,
} from "../collections/fileReferenceCandidates";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export type { FileReferenceScope } from "../collections/fileReferenceCandidates";
export type { FileTouchReferenceCandidateDto } from "../../api";

export interface FileReferenceCandidatesInput {
  organizationId?: string;
  projectId?: string;
  scope?: FileReferenceScope;
  active: boolean;
}

export type FileReferenceCandidatesState =
  | { status: "disabled"; candidates: readonly []; isFetching: false }
  | { status: "loading"; candidates: readonly []; isFetching: true }
  | {
      status: "updating";
      candidates: readonly FileTouchReferenceCandidateDto[];
      isFetching: true;
    }
  | {
      status: "ready";
      candidates: readonly FileTouchReferenceCandidateDto[];
      isFetching: false;
    }
  | { status: "empty"; candidates: readonly []; isFetching: false }
  | {
      status: "error";
      candidates: readonly [];
      isFetching: false;
      error: Error;
    };

export const useFileReferenceCandidates = ({
  organizationId,
  projectId,
  scope,
  active,
}: FileReferenceCandidatesInput): FileReferenceCandidatesState => {
  const enabled = active && !!organizationId && !!projectId && !!scope;
  const { result, state: query } = useDataLayerQuery(
    fileReferenceCandidatesQueryOptions(
      organizationId ?? "__noop__",
      projectId ?? "__noop__",
      scope ?? { kind: "task", taskId: "__noop__" }
    ),
    { enabled }
  );
  if (!enabled)
    return { status: "disabled", candidates: [], isFetching: false };
  const candidates = result.data ?? [];
  if (query.error)
    return {
      status: "error",
      candidates: [],
      isFetching: false,
      error: query.error,
    };
  if (query.isFetching && candidates.length > 0)
    return { status: "updating", candidates, isFetching: true };
  if (query.isLoading || !query.isFetched)
    return { status: "loading", candidates: [], isFetching: true };
  if (candidates.length === 0)
    return { status: "empty", candidates: [], isFetching: false };
  return { status: "ready", candidates, isFetching: false };
};
