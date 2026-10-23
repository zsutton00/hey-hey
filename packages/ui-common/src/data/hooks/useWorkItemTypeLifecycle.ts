import { useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  OrganizationsOrganizationIdProjectsProjectIdWorkItemTypesPost201Response,
  ProposalResponseDto,
  WorkItemTypeCascadeImpactConflictDto,
  WorkItemTypeCascadeImpactDto,
  WorkItemTypeSectionContentImpactDto,
  WorkItemTypeArchiveRequestDto,
  WorkItemTypeDefinitionDto,
  WorkItemTypeEditRequestDto,
  WorkItemTypeTrackingLinkRevocationImpactDto,
} from "../../api";
import {
  getWorkItemTypesApi,
  workItemTypeKeys,
} from "../collections/workItemTypes";
import { workItemKeys } from "../collections/workItemLists";
import type { WorkItemResponseDto } from "../collections/workItems";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";

export interface EditWorkItemTypeVariables {
  organizationId: string;
  projectId: string;
  typeKey: string;
  definition: WorkItemTypeDefinitionDto;
  acknowledgeCanonicalCustomization?: boolean;
}

export interface ArchiveWorkItemTypeVariables {
  organizationId: string;
  projectId: string;
  typeKey: string;
  reason?: string | null;
}

export interface RestoreWorkItemTypeVariables {
  organizationId: string;
  projectId: string;
  definition: WorkItemTypeDefinitionDto;
}

export interface RefreshWorkItemTypeVariables {
  organizationId: string;
  projectId: string;
  typeKey: string;
}

export interface ResetWorkItemTypeVariables {
  organizationId: string;
  projectId: string;
  typeKey: string;
}

function buildResetRequestKey({
  organizationId,
  projectId,
  typeKey,
}: ResetWorkItemTypeVariables): string {
  return [organizationId, projectId, typeKey].join("\u0000");
}

function buildRefreshRequestKey({
  organizationId,
  projectId,
  typeKey,
}: RefreshWorkItemTypeVariables): string {
  return [organizationId, projectId, typeKey].join("\u0000");
}

export interface HardDeleteWorkItemTypeVariables {
  organizationId: string;
  projectId: string;
  typeKey: string;
  confirmedItemCount: number;
  confirmedEdgeCount: number;
}

export type UseEditWorkItemTypeOptions = MutationOptions<ProposalResponseDto>;
export type UseArchiveWorkItemTypeOptions =
  MutationOptions<ProposalResponseDto>;
export type UseRestoreWorkItemTypeOptions = MutationOptions<ProposalResponseDto>;
export type UseRefreshWorkItemTypeOptions =
  MutationOptions<ProposalResponseDto>;
export type UseResetWorkItemTypeOptions =
  MutationOptions<ProposalResponseDto>;
export type UseHardDeleteWorkItemTypeOptions =
  MutationOptions<ProposalResponseDto>;
export type UseWorkItemTypeSectionContentImpactOptions =
  CollectionHookOptions<WorkItemTypeSectionContentImpactDto>;
export type UseWorkItemTypeTrackingLinkRevocationImpactOptions =
  CollectionHookOptions<WorkItemTypeTrackingLinkRevocationImpactDto>;

type WorkItemTypeImpactKind = "section-content" | "tracking-link-revocation";

interface WorkItemTypeImpactHookInput {
  organizationId: string | undefined;
  projectId: string | undefined;
  typeKey: string | undefined;
  removedKeys: readonly string[] | undefined;
  enabled: boolean;
}

interface WorkItemTypeImpactState<TImpact> {
  data: TImpact | null;
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  error: Error | null;
  isStale: boolean;
}

type WorkItemTypeImpactFetcher<TImpact> = (
  organizationId: string,
  projectId: string,
  typeKey: string,
  removedKeys: Set<string>,
  signal: AbortSignal,
) => Promise<TImpact>;

const initialImpactState = {
  data: null,
  isLoading: false,
  isFetching: false,
  isFetched: false,
  error: null,
  isStale: false,
} as const;

function unwrapWorkItemTypeReviewPayload(
  response: OrganizationsOrganizationIdProjectsProjectIdWorkItemTypesPost201Response,
  operation:
    | "edit"
    | "archive"
    | "restore"
    | "refresh"
    | "reset"
    | "hard-delete",
): ProposalResponseDto {
  const proposal = response.data;

  if (!proposal) {
    throw new Error(
      `No proposal returned from ${operation} work-item-type endpoint`,
    );
  }

  return proposal;
}

/** Extract the typed current impact returned when a deletion quote is stale. */
export function getCascadeImpactConflict(
  error: unknown,
): WorkItemTypeCascadeImpactDto | null {
  const response = (error as AxiosError<WorkItemTypeCascadeImpactConflictDto>)
    .response;

  if (response?.status !== 409) {
    return null;
  }

  return response.data?.data?.currentImpact ?? null;
}

function createMissingImpactPayloadError(kind: WorkItemTypeImpactKind): Error {
  return new Error(
    `No ${kind} impact payload returned from work-item-type endpoint`,
  );
}

function buildImpactRequestKey({
  organizationId,
  projectId,
  typeKey,
  removedKeys,
}: WorkItemTypeImpactHookInput): string {
  return [
    organizationId ?? "",
    projectId ?? "",
    typeKey ?? "",
    ...(removedKeys ?? []),
  ].join("\u0000");
}

function buildRemovedKeysSignature(
  removedKeys: readonly string[] | undefined,
): string {
  return removedKeys?.join("\u0000") ?? "";
}

function hasRequiredImpactContext({
  organizationId,
  projectId,
  typeKey,
  removedKeys,
  enabled,
}: WorkItemTypeImpactHookInput): boolean {
  return (
    enabled &&
    !!organizationId &&
    !!projectId &&
    !!typeKey &&
    !!removedKeys &&
    removedKeys.length > 0
  );
}

function createImpactReturn<TImpact>(
  state: WorkItemTypeImpactState<TImpact>,
  refetch: () => Promise<TImpact | null>,
  markStale: () => void,
): DataHookReturn<TImpact> {
  return {
    data: state.data,
    isLoading: state.isLoading,
    isFetching: state.isFetching,
    isFetched: state.isFetched,
    isReady: state.isFetched && !state.error,
    error: state.error,
    isStale: state.isStale,
    refetch,
    markStale,
  };
}

function useWorkItemTypeImpact<TImpact>(
  input: WorkItemTypeImpactHookInput,
  fetchImpact: WorkItemTypeImpactFetcher<TImpact>,
): DataHookReturn<TImpact> {
  const { organizationId, projectId, typeKey, removedKeys } = input;
  const abortControllerRef = useRef<AbortController | null>(null);
  const removedKeysRef = useRef(removedKeys);
  removedKeysRef.current = removedKeys;
  const [state, setState] =
    useState<WorkItemTypeImpactState<TImpact>>(initialImpactState);

  const removedKeysSignature = buildRemovedKeysSignature(removedKeys);
  const requestKey = buildImpactRequestKey({
    organizationId,
    projectId,
    typeKey,
    removedKeys,
    enabled: input.enabled,
  });
  const isEnabled = hasRequiredImpactContext(input);

  const refetch = useCallback(async (): Promise<TImpact | null> => {
    const hasRequiredContext =
      input.enabled &&
      !!organizationId &&
      !!projectId &&
      !!typeKey &&
      !!removedKeysRef.current &&
      removedKeysRef.current.length > 0;

    if (!hasRequiredContext) {
      return null;
    }

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setState((current) => ({
      ...current,
      isLoading: !current.isFetched,
      isFetching: true,
      error: null,
    }));

    try {
      const impact = await fetchImpact(
        organizationId,
        projectId,
        typeKey,
        new Set(removedKeysRef.current),
        abortController.signal,
      );

      setState({
        data: impact,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        error: null,
        isStale: false,
      });

      return impact;
    } catch (error) {
      if (abortController.signal.aborted) {
        return null;
      }

      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      setState((current) => ({
        ...current,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        error: normalizedError,
      }));
      throw normalizedError;
    }
  }, [
    fetchImpact,
    input.enabled,
    organizationId,
    projectId,
    removedKeysSignature,
    typeKey,
  ]);

  const markStale = useCallback(() => {
    setState((current) => ({ ...current, isStale: true }));
  }, []);

  useEffect(() => {
    if (!isEnabled) {
      abortControllerRef.current?.abort();
      setState(initialImpactState);
      return;
    }

    void refetch().catch(() => undefined);

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [isEnabled, refetch, requestKey]);

  return createImpactReturn(state, refetch, markStale);
}

/**
 * Invalidates every project-scoped work-item-type read after a lifecycle
 * change. Lifecycle review creation and accepted review application share
 * this boundary so status-filtered, all-status, and single type consumers
 * cannot retain conflicting registry snapshots. Mounted reads refetch once;
 * unmounted ones re-read on their next mount.
 */
export function useMarkWorkItemTypeDataStale() {
  const queryClient = useQueryClient();

  return useCallback(
    // typeKey is kept for callers; the project prefix already covers it.
    (organizationId: string, projectId: string, _typeKey: string): void => {
      void queryClient.invalidateQueries({
        queryKey: workItemTypeKeys.all(organizationId, projectId),
      });
    },
    [queryClient],
  );
}

/**
 * Marks registry and cached work-item reads stale after cascade deletion:
 * every work-item list and hierarchy in the project, and single-item reads
 * whose cached item is in the project with the removed type (or, not yet
 * loaded, are keyed to the project). Other projects are untouched.
 */
export function useMarkHardDeletedWorkItemTypeDataStale() {
  const markWorkItemTypeDataStale = useMarkWorkItemTypeDataStale();
  const queryClient = useQueryClient();

  return useCallback(
    (organizationId: string, projectId: string, typeKey: string): void => {
      markWorkItemTypeDataStale(organizationId, projectId, typeKey);

      // Keys are [root, org, project, kind, ...]; single-item reads made
      // without a project are keyed under "" and matched by their item.
      void queryClient.invalidateQueries({
        queryKey: workItemKeys.all(organizationId),
        predicate: (query) => {
          const [, , keyProjectId, kind] = query.queryKey;
          if (kind !== "detail") return keyProjectId === projectId;
          const item = query.state.data as
            | WorkItemResponseDto
            | null
            | undefined;
          return item
            ? item.projectId === projectId && item.type === typeKey
            : keyProjectId === projectId;
        },
      });
    },
    [markWorkItemTypeDataStale, queryClient],
  );
}

export function useEditWorkItemType(options: UseEditWorkItemTypeOptions = {}) {
  const markWorkItemTypeDataStale = useMarkWorkItemTypeDataStale();

  const mutationFn = async ({
    organizationId,
    projectId,
    typeKey,
    definition,
    acknowledgeCanonicalCustomization,
  }: EditWorkItemTypeVariables): Promise<ProposalResponseDto> => {
    const request: WorkItemTypeEditRequestDto = {
      definition,
      ...(acknowledgeCanonicalCustomization === undefined
        ? {}
        : { acknowledgeCanonicalCustomization }),
    };
    const response =
      await getWorkItemTypesApi().organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyPatch(
        {
          organizationId: organizationId,
          projectId: projectId,
          typeKey: typeKey,
          workItemTypeEditRequestDto: request,
        },
      );

    const proposal = unwrapWorkItemTypeReviewPayload(response.data, "edit");
    markWorkItemTypeDataStale(organizationId, projectId, typeKey);
    return proposal;
  };

  return useMutation(mutationFn, options);
}

export function useArchiveWorkItemType(
  options: UseArchiveWorkItemTypeOptions = {},
) {
  const markWorkItemTypeDataStale = useMarkWorkItemTypeDataStale();

  const mutationFn = async ({
    organizationId,
    projectId,
    typeKey,
    reason,
  }: ArchiveWorkItemTypeVariables): Promise<ProposalResponseDto> => {
    const request: WorkItemTypeArchiveRequestDto = { reason };
    const response =
      await getWorkItemTypesApi().organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyDelete(
        {
          organizationId: organizationId,
          projectId: projectId,
          typeKey: typeKey,
          workItemTypeArchiveRequestDto: request,
        },
      );

    const proposal = unwrapWorkItemTypeReviewPayload(response.data, "archive");
    markWorkItemTypeDataStale(organizationId, projectId, typeKey);
    return proposal;
  };

  return useMutation(mutationFn, options);
}

export function useRestoreWorkItemType(
  options: UseRestoreWorkItemTypeOptions = {},
) {
  const markWorkItemTypeDataStale = useMarkWorkItemTypeDataStale();

  const mutationFn = async ({
    organizationId,
    projectId,
    definition,
  }: RestoreWorkItemTypeVariables): Promise<ProposalResponseDto> => {
    const response =
      await getWorkItemTypesApi().organizationsOrganizationIdProjectsProjectIdWorkItemTypesPost(
        {
          organizationId,
          projectId,
          workItemTypeDefinitionDto: definition,
        },
      );

    const proposal = unwrapWorkItemTypeReviewPayload(response.data, "restore");
    markWorkItemTypeDataStale(organizationId, projectId, definition.key);
    return proposal;
  };

  return useMutation(mutationFn, options);
}

/**
 * Keeps the historical refresh hook name used by the admin surface while
 * routing through the generated reset operation that replaced the refresh
 * endpoint in the project-owned registry contract.
 */
export function useRefreshWorkItemType(
  options: UseRefreshWorkItemTypeOptions = {},
) {
  const markWorkItemTypeDataStale = useMarkWorkItemTypeDataStale();
  const inFlightRef = useRef<Map<string, Promise<ProposalResponseDto>>>(
    new Map(),
  );

  const mutationFn = useCallback(
    async ({
      organizationId,
      projectId,
      typeKey,
    }: RefreshWorkItemTypeVariables): Promise<ProposalResponseDto> => {
      const response =
        await getWorkItemTypesApi().organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyResetPost(
          {
            organizationId,
            projectId,
            typeKey,
          },
        );

      const proposal = unwrapWorkItemTypeReviewPayload(
        response.data,
        "refresh",
      );
      markWorkItemTypeDataStale(organizationId, projectId, typeKey);
      return proposal;
    },
    [markWorkItemTypeDataStale],
  );

  const mutation = useMutation(mutationFn, options);
  const { mutate: runMutation } = mutation;
  const mutate = useCallback(
    (variables: RefreshWorkItemTypeVariables): Promise<ProposalResponseDto> => {
      const requestKey = buildRefreshRequestKey(variables);
      const pendingRequest = inFlightRef.current.get(requestKey);
      if (pendingRequest) {
        return pendingRequest;
      }

      const request = runMutation(variables);
      inFlightRef.current.set(requestKey, request);
      request.then(
        () => {
          if (inFlightRef.current.get(requestKey) === request) {
            inFlightRef.current.delete(requestKey);
          }
        },
        () => {
          if (inFlightRef.current.get(requestKey) === request) {
            inFlightRef.current.delete(requestKey);
          }
        },
      );
      return request;
    },
    [runMutation],
  );

  return { ...mutation, mutate };
}

export function useHardDeleteWorkItemType(
  options: UseHardDeleteWorkItemTypeOptions = {},
) {
  const markHardDeletedWorkItemTypeDataStale =
    useMarkHardDeletedWorkItemTypeDataStale();

  const mutationFn = async ({
    organizationId,
    projectId,
    typeKey,
    confirmedItemCount,
    confirmedEdgeCount,
  }: HardDeleteWorkItemTypeVariables): Promise<ProposalResponseDto> => {
    const response =
      await getWorkItemTypesApi().organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyDelete(
        {
          organizationId,
          projectId,
          typeKey,
          cascade: true,
          confirmedItemCount,
          confirmedEdgeCount,
        },
      );

    const proposal = unwrapWorkItemTypeReviewPayload(
      response.data,
      "hard-delete",
    );
    markHardDeletedWorkItemTypeDataStale(organizationId, projectId, typeKey);
    return proposal;
  };

  return useMutation(mutationFn, options);
}

export function useWorkItemTypeCascadeImpact(
  organizationId: string | undefined,
  projectId: string | undefined,
  typeKey: string | undefined,
  enabled: boolean,
): DataHookReturn<WorkItemTypeCascadeImpactDto> {
  const abortControllerRef = useRef<AbortController | null>(null);
  const [state, setState] =
    useState<WorkItemTypeImpactState<WorkItemTypeCascadeImpactDto>>(
      initialImpactState,
    );
  const isEnabled = enabled && !!organizationId && !!projectId && !!typeKey;
  const requestKey = [
    organizationId ?? "",
    projectId ?? "",
    typeKey ?? "",
    enabled,
  ].join("\u0000");

  const refetch = useCallback(async (): Promise<WorkItemTypeCascadeImpactDto | null> => {
    if (!isEnabled || !organizationId || !projectId || !typeKey) {
      return null;
    }

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setState((current) => ({
      ...current,
      isLoading: !current.isFetched,
      isFetching: true,
      error: null,
    }));

    try {
      const response =
        await getWorkItemTypesApi().organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyCascadeImpactGet(
          { organizationId, projectId, typeKey },
          { signal: abortController.signal },
        );
      const impact = response.data.data;

      if (!impact) {
        throw new Error(
          "No cascade impact payload returned from work-item-type endpoint",
        );
      }

      setState({
        data: impact,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        error: null,
        isStale: false,
      });
      return impact;
    } catch (error) {
      if (abortController.signal.aborted) {
        return null;
      }

      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      setState((current) => ({
        ...current,
        isLoading: false,
        isFetching: false,
        isFetched: true,
        error: normalizedError,
      }));
      throw normalizedError;
    }
  }, [isEnabled, organizationId, projectId, typeKey]);

  const markStale = useCallback(() => {
    setState((current) => ({ ...current, isStale: true }));
  }, []);

  useEffect(() => {
    if (!isEnabled) {
      abortControllerRef.current?.abort();
      setState(initialImpactState);
      return;
    }

    void refetch().catch(() => undefined);
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [isEnabled, refetch, requestKey]);

  return createImpactReturn(state, refetch, markStale);
}

/**
 * Starts the server-authored reset-to-canonical review. The generated
 * operation owns proposal construction, so this hook accepts only the
 * project/type identity and sends no body.
 * Repeated calls while the first request is pending share that request rather
 * than creating a second review.
 */
export function useResetWorkItemType(
  options: UseResetWorkItemTypeOptions = {},
) {
  const markWorkItemTypeDataStale = useMarkWorkItemTypeDataStale();
  const inFlightRef = useRef<Map<string, Promise<ProposalResponseDto>>>(
    new Map(),
  );

  const mutationFn = useCallback(
    async ({
      organizationId,
      projectId,
      typeKey,
    }: ResetWorkItemTypeVariables): Promise<ProposalResponseDto> => {
      const response =
        await getWorkItemTypesApi().organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyResetPost(
          {
            organizationId,
            projectId,
            typeKey,
          },
        );

      const proposal = unwrapWorkItemTypeReviewPayload(
        response.data,
        "reset",
      );
      markWorkItemTypeDataStale(organizationId, projectId, typeKey);
      return proposal;
    },
    [markWorkItemTypeDataStale],
  );

  const mutation = useMutation(mutationFn, options);
  const { mutate: runMutation } = mutation;
  const mutate = useCallback(
    (variables: ResetWorkItemTypeVariables): Promise<ProposalResponseDto> => {
      const requestKey = buildResetRequestKey(variables);
      const pendingRequest = inFlightRef.current.get(requestKey);
      if (pendingRequest) {
        return pendingRequest;
      }

      const request = runMutation(variables);
      inFlightRef.current.set(requestKey, request);
      request.then(
        () => {
          if (inFlightRef.current.get(requestKey) === request) {
            inFlightRef.current.delete(requestKey);
          }
        },
        () => {
          if (inFlightRef.current.get(requestKey) === request) {
            inFlightRef.current.delete(requestKey);
          }
        },
      );
      return request;
    },
    [runMutation],
  );

  return { ...mutation, mutate };
}

export function useWorkItemTypeSectionContentImpact(
  organizationId: string | undefined,
  projectId: string | undefined,
  typeKey: string | undefined,
  removedSectionKeys: readonly string[] | undefined,
  options: UseWorkItemTypeSectionContentImpactOptions = {},
): DataHookReturn<WorkItemTypeSectionContentImpactDto> {
  const input = useMemo(
    () => ({
      organizationId,
      projectId,
      typeKey,
      removedKeys: removedSectionKeys,
      enabled: options.enabled ?? true,
    }),
    [organizationId, options.enabled, projectId, removedSectionKeys, typeKey],
  );

  const fetchImpact = useCallback<
    WorkItemTypeImpactFetcher<WorkItemTypeSectionContentImpactDto>
  >(
    async (
      fetchOrganizationId,
      fetchProjectId,
      fetchTypeKey,
      fetchRemovedSectionKeys,
      signal,
    ) => {
      const response =
        await getWorkItemTypesApi().organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeySectionContentImpactGet(
          {
            organizationId: fetchOrganizationId,
            projectId: fetchProjectId,
            typeKey: fetchTypeKey,
            removedSectionKeys: fetchRemovedSectionKeys,
          },
          { signal },
        );

      const impact = response.data.data;
      if (!impact) {
        throw createMissingImpactPayloadError("section-content");
      }

      return impact;
    },
    [],
  );

  return useWorkItemTypeImpact(input, fetchImpact);
}

export function useWorkItemTypeTrackingLinkRevocationImpact(
  organizationId: string | undefined,
  projectId: string | undefined,
  typeKey: string | undefined,
  revokedTrackingSourceTypeKeys: readonly string[] | undefined,
  options: UseWorkItemTypeTrackingLinkRevocationImpactOptions = {},
): DataHookReturn<WorkItemTypeTrackingLinkRevocationImpactDto> {
  const input = useMemo(
    () => ({
      organizationId,
      projectId,
      typeKey,
      removedKeys: revokedTrackingSourceTypeKeys,
      enabled: options.enabled ?? true,
    }),
    [
      organizationId,
      options.enabled,
      projectId,
      revokedTrackingSourceTypeKeys,
      typeKey,
    ],
  );

  const fetchImpact = useCallback<
    WorkItemTypeImpactFetcher<WorkItemTypeTrackingLinkRevocationImpactDto>
  >(
    async (
      fetchOrganizationId,
      fetchProjectId,
      fetchTypeKey,
      fetchRevokedTrackingSourceTypeKeys,
      signal,
    ) => {
      const response =
        await getWorkItemTypesApi().organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyTrackingLinkRevocationImpactGet(
          {
            organizationId: fetchOrganizationId,
            projectId: fetchProjectId,
            typeKey: fetchTypeKey,
            revokedTrackingSourceTypeKeys: fetchRevokedTrackingSourceTypeKeys,
          },
          { signal },
        );

      const impact = response.data.data;
      if (!impact) {
        throw createMissingImpactPayloadError("tracking-link-revocation");
      }

      return impact;
    },
    [],
  );

  return useWorkItemTypeImpact(input, fetchImpact);
}
