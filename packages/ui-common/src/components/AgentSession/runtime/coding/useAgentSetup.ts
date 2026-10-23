import { useServices } from "../../../../data";
import { useMachineRepoBindings } from "../../../../data/hooks/useMachineRepoBindings";
import { useLocalRepoBindings } from "../../../../data/hooks/useLocalRepoBindings";
import {
  isConflictError,
  useCreateAgentSessionConversation,
} from "../../../../data/hooks/useCreateAgentSessionConversation";
import { writeAgentSession } from "../../../../data/collections/agentSessions";
import { useQueryClient } from "@tanstack/react-query";
import {
  AgentSessionConfigV2TypeEnum,
  ProjectModeSelectionSchemaVersionEnum,
  WorkflowName,
  type ProjectModeSelection,
  type MachineDto,
  type ServiceDto,
} from "../../../../api";
import { resolveCodingSessionWorkflowType } from "../../../../agents/prompts.js";
import type { AgentSessionMethod } from "../../../../agents/prompts.js";
import type { SessionMethodSelection } from "../../../../agents/coordination/types";
import {
  isProjectModeSelectionEligible,
  type ProjectModeCatalogEntry,
} from "../../../../agents/coordination/projectModeCatalog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentProvider, ReasoningEffort, RepoBinding } from "../types";
import {
  CODING_SETUP_SURFACE_ID,
  buildDefaultSurfaceSelection,
  readSurfaceSelection,
  reconcileSurfaceSelection,
  writeSurfaceSelection,
  type SurfaceSelection,
} from "../../surfaceSelectionMemory";
import {
  buildAgentSetupDraftContextKey,
  readAgentSetupDraft,
  upsertAgentSetupDraft,
  type AgentSetupDraftInput,
} from "../../agentSetupDraftMemory";
import { supportsFastMode } from "../../capabilityCatalog";
import { useRuntimeModelCatalog } from "../../useRuntimeModelCatalog";
import { updateAgentSessionRecord } from "./update-agent-session-record";

export type {
  AgentSessionMethod,
  SessionMethod,
} from "../../../../agents/prompts.js";
export type { SessionMethodSelection } from "../../../../agents/coordination/types";

export type CodingSetupStep = "session-method" | "selection" | "prompt";

export interface UseAgentSetupInput {
  runtimeReady: boolean;
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  userId: string | null;
  boundServiceId: string | null;
  taskServiceIds: string[];
  boundProvider: AgentProvider | null;
  taskName: string | null;
  lockedWorktreeBranch: string | null;
  skipServiceSelection?: boolean;
  selectedMachine: MachineDto | null;
  projectModeCatalog: readonly ProjectModeCatalogEntry[];
}

const DEFAULT_SESSION_METHOD_SELECTION: SessionMethodSelection = {
  method: "plan",
  serviceIds: [],
  services: [],
};

export interface UseAgentSetupResult {
  services: ServiceDto[];
  repoBindings: RepoBinding[];
  selectedServiceId: string | null;
  selectedServiceIds: string[];
  launchServiceId: string | null;
  selectedProvider: AgentProvider | null;
  selectedBinding: RepoBinding | null;
  directoryPath: string;
  directoryPaths: Record<string, string>;
  worktreeBranch: string | null;
  worktreeLocked: boolean;
  step: CodingSetupStep;
  sessionMethodSelection: SessionMethodSelection;
  isMultiServiceMode: boolean;
  canStart: boolean;
  loadingServices: boolean;
  /** Why the Service list could not be loaded; null when the load succeeded. */
  servicesError: string | null;
  starting: boolean;
  error: string | null;
  selectService: (id: string) => void;
  toggleService: (id: string) => void;
  setLaunchServiceId: (id: string) => void;
  selectProvider: (provider: AgentProvider) => void;
  selectedModel: string | null;
  selectModel: (model: string | null) => void;
  selectedReasoningEffort: ReasoningEffort | null;
  selectReasoningEffort: (effort: ReasoningEffort | null) => void;
  selectedFastMode: boolean;
  selectFastMode: (fastMode: boolean) => void;
  goToSessionMethod: () => void;
  goToSelection: () => void;
  goToPrompt: () => void;
  selectSessionMethod: (method: AgentSessionMethod) => void;
  selectProjectMode: (selection: ProjectModeSelection) => void;
  projectModeSelection: ProjectModeSelection | null;
  validateProjectModeSelection: () => boolean;
  promptDraft: string;
  setPromptDraft: (value: string) => void;
  setWorktreeBranch: (branch: string | null) => void;
  mapDirectory: () => Promise<boolean>;
  start: () => Promise<{ ok: true } | { ok: false; error: string }>;
}

export const filterCodingSessionServices = (
  services: readonly ServiceDto[],
  projectId: string,
): ServiceDto[] =>
  services.filter(
    (service) =>
      service.projectId === projectId &&
      service.status !== "ARCHIVED" &&
      !service.archivedAt,
  );

const slugifyTaskName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export interface ResolveWorktreeBranchChangeInput {
  currentBranch: string | null;
  requestedBranch: string | null;
  lockedWorktreeBranch: string | null;
  taskName: string | null;
}

export const resolveWorktreeBranchChange = ({
  currentBranch,
  requestedBranch,
  lockedWorktreeBranch,
  taskName,
}: ResolveWorktreeBranchChangeInput): string | null => {
  if (lockedWorktreeBranch !== null) return lockedWorktreeBranch;
  if (requestedBranch === null) return null;
  if (requestedBranch.trim().length > 0 || currentBranch !== null) {
    return requestedBranch;
  }
  return taskName ? slugifyTaskName(taskName) : "";
};

interface ResolveCodingSetupStateInput {
  boundServiceId: string | null;
  selectedServiceId: string | null;
  boundProvider: AgentProvider | null;
  selectedProvider: AgentProvider | null;
  repoBindings: RepoBinding[];
}

interface ResolveCodingSetupStateResult {
  selectedServiceId: string | null;
  selectedProvider: AgentProvider | null;
  selectedBinding: RepoBinding | null;
  isDirectoryMapped: boolean;
  canStart: boolean;
}

interface CodingSetupSelectionState {
  agentSessionId: string;
  selectedServiceId: string | null;
  selectedProvider: AgentProvider | null;
}

interface AgentSetupDraftValues {
  sessionMethod: AgentSessionMethod | null;
  projectModeSelection: ProjectModeSelection | null;
  serviceIds: string[];
  launchServiceId: string | null;
  worktreeBranch: string | null;
  // Null / undefined until the user chooses: nothing is chosen for them before
  // the picked machine's CLI has reported what it offers.
  provider: AgentProvider | null;
  model: string | null;
  reasoningEffort: ReasoningEffort | null | undefined;
}

interface ResolveCodingSetupSelectionInput {
  selection: CodingSetupSelectionState;
  agentSessionId: string;
  boundServiceId: string | null;
  taskServiceIds: string[];
  boundProvider: AgentProvider | null;
}

interface ResolveCodingSetupSelectionResult {
  selectedServiceId: string | null;
  selectedProvider: AgentProvider | null;
}

export interface InitialServiceSelectionInput {
  usableTaskServiceIds: readonly string[];
  usableServiceIds: ReadonlySet<string>;
  boundServiceId: string | null;
  persistedServiceIds: readonly string[] | null;
  persistedLaunchServiceId: string | null;
}

export interface InitialServiceSelection {
  selectedServiceIds: string[];
  launchServiceId: string | null;
}

/**
 * Resolve the complete Service scope for a task launch before the setup UI
 * renders. Explicit persisted or bound scope wins; an unbound launch starts
 * with every usable task-linked Service and always keeps its launch anchor in
 * that set.
 */
export const resolveInitialServiceSelection = ({
  usableTaskServiceIds,
  usableServiceIds,
  boundServiceId,
  persistedServiceIds,
  persistedLaunchServiceId,
}: InitialServiceSelectionInput): InitialServiceSelection => {
  const scope = (ids: readonly string[]) =>
    ids.filter(
      (id, index) => usableServiceIds.has(id) && ids.indexOf(id) === index,
    );
  const explicitSelection = scope(persistedServiceIds ?? []);
  // A persisted empty selection is an explicit choice and is kept as-is.
  const hasExplicitSelection =
    persistedServiceIds !== null &&
    (persistedServiceIds.length === 0 || explicitSelection.length > 0);
  // Mirror the picker's offered set: usable task-linked Services when the task
  // has any, otherwise the project's usable Services when exactly one exists.
  const taskCandidates = scope(usableTaskServiceIds);
  const defaultSelection =
    taskCandidates.length > 0
      ? taskCandidates
      : usableServiceIds.size === 1
        ? [...usableServiceIds]
        : [];
  const selectedServiceIds =
    boundServiceId && usableServiceIds.has(boundServiceId)
      ? [boundServiceId]
      : hasExplicitSelection
        ? explicitSelection
        : defaultSelection;
  const launchCandidate = boundServiceId ?? persistedLaunchServiceId;
  const launchServiceId =
    launchCandidate && selectedServiceIds.includes(launchCandidate)
      ? launchCandidate
      : (selectedServiceIds[0] ?? null);

  return { selectedServiceIds, launchServiceId };
};

export const resolveCodingSetupSelection = ({
  selection,
  agentSessionId,
  boundServiceId,
  taskServiceIds,
  boundProvider,
}: ResolveCodingSetupSelectionInput): ResolveCodingSetupSelectionResult => {
  const preferredTaskServiceId =
    taskServiceIds.length === 1 ? taskServiceIds[0] : null;
  const preferredServiceId = boundServiceId ?? preferredTaskServiceId;

  if (selection.agentSessionId !== agentSessionId) {
    return {
      selectedServiceId: preferredServiceId,
      selectedProvider: boundProvider,
    };
  }

  return {
    selectedServiceId: selection.selectedServiceId ?? preferredServiceId,
    selectedProvider: selection.selectedProvider,
  };
};

export const resolveCodingSetupState = ({
  boundServiceId,
  selectedServiceId,
  boundProvider,
  selectedProvider,
  repoBindings,
}: ResolveCodingSetupStateInput): ResolveCodingSetupStateResult => {
  const resolvedServiceId = boundServiceId ?? selectedServiceId;
  const resolvedProvider = boundProvider ?? selectedProvider;
  const resolvedBinding = resolvedServiceId
    ? (repoBindings.find(
        (binding) => binding.serviceId === resolvedServiceId,
      ) ?? null)
    : null;
  const isDirectoryMapped = Boolean(resolvedBinding?.repositoryPath.trim());

  return {
    selectedServiceId: resolvedServiceId,
    selectedProvider: resolvedProvider,
    selectedBinding: resolvedBinding,
    isDirectoryMapped,
    canStart: Boolean(
      resolvedServiceId && isDirectoryMapped && resolvedProvider,
    ),
  };
};

export const useAgentSetup = ({
  runtimeReady,
  organizationId,
  projectId,
  agentSessionId,
  userId,
  boundServiceId,
  taskServiceIds,
  boundProvider,
  taskName,
  lockedWorktreeBranch,
  skipServiceSelection,
  selectedMachine,
  projectModeCatalog,
}: UseAgentSetupInput): UseAgentSetupResult => {
  const setupContextKey = buildAgentSetupDraftContextKey(
    organizationId,
    projectId,
    agentSessionId,
  );
  const restoredDraft = useMemo(
    () => readAgentSetupDraft(userId, setupContextKey),
    [setupContextKey, userId],
  );
  const servicesQuery = useServices(organizationId, {
    projectId,
    enabled: runtimeReady,
  });
  const services = useMemo(
    () => filterCodingSessionServices(servicesQuery.services, projectId),
    [projectId, servicesQuery.services],
  );
  const selectableServiceIds = useMemo(
    () => new Set(services.map((service) => service.id)),
    [services],
  );
  const scopedBoundServiceId =
    boundServiceId && selectableServiceIds.has(boundServiceId)
      ? boundServiceId
      : null;
  const queryClient = useQueryClient();
  const availableTaskServiceIds = useMemo(
    () =>
      taskServiceIds.filter((taskServiceId) =>
        services.some((service) => service.id === taskServiceId),
      ),
    [services, taskServiceIds],
  );

  const liveRepoBindings = useMachineRepoBindings(selectedMachine?.machineId);
  const localRepoBindings = useLocalRepoBindings();
  const repoBindings = useMemo(() => {
    const machineBindings = liveRepoBindings ?? selectedMachine?.bindings ?? [];
    if (
      localRepoBindings.status !== "ready" &&
      localRepoBindings.status !== "fetching"
    ) {
      return machineBindings;
    }

    const localByServiceId = localRepoBindings.bindingsByServiceId;
    const merged = machineBindings.map(
      (binding) => localByServiceId[binding.serviceId] ?? binding,
    );
    const machineServiceIds = new Set(
      machineBindings.map((binding) => binding.serviceId),
    );
    return [
      ...merged,
      ...localRepoBindings.bindings.filter(
        (binding) => !machineServiceIds.has(binding.serviceId),
      ),
    ];
  }, [liveRepoBindings, localRepoBindings, selectedMachine]);
  const [step, setStep] = useState<CodingSetupStep>("session-method");

  // The CLI on the picked machine decides what can be chosen, so there is no
  // initial selection until its catalog has loaded.
  const catalogState = useRuntimeModelCatalog(
    selectedMachine
      ? { organizationId, projectId, machineId: selectedMachine.machineId }
      : null,
  );
  const initialSurfaceSelection = useMemo<SurfaceSelection | null>(() => {
    if (catalogState.status !== "ready") return null;
    const stored =
      readSurfaceSelection(CODING_SETUP_SURFACE_ID) ??
      buildDefaultSurfaceSelection();
    if (!stored) return null;
    const restored = restoredDraft
      ? reconcileSurfaceSelection({
          provider: restoredDraft.provider,
          model: restoredDraft.model,
          reasoningEffort: restoredDraft.reasoningEffort,
        })
      : null;
    const source = restored ?? stored;
    const selection = boundProvider
      ? reconcileSurfaceSelection({
          provider: boundProvider,
          model: source.model,
          reasoningEffort: source.reasoningEffort,
        })
      : source;
    return { ...(selection ?? stored), fastMode: stored.fastMode ?? false };
  }, [boundProvider, catalogState, restoredDraft, userId]);
  const initialSurfaceSelectionRef = useRef(initialSurfaceSelection);
  initialSurfaceSelectionRef.current = initialSurfaceSelection;

  const initialSelectedServiceIds = useMemo(
    () =>
      scopedBoundServiceId
        ? [scopedBoundServiceId]
        : (restoredDraft?.serviceIds ?? []),
    [restoredDraft, scopedBoundServiceId],
  );
  const initialLaunchServiceId =
    scopedBoundServiceId ?? restoredDraft?.launchServiceId ?? null;
  const initialSessionMethodSelection = useMemo<SessionMethodSelection>(() => {
    const restoredProjectModeSelection =
      restoredDraft?.projectModeSelection ?? null;
    if (
      restoredProjectModeSelection &&
      isProjectModeSelectionEligible(
        restoredProjectModeSelection,
        projectModeCatalog,
      )
    ) {
      return {
        method: undefined,
        projectModeSelection: restoredProjectModeSelection,
        serviceIds: initialSelectedServiceIds,
        services: [],
      };
    }
    return {
      method:
        restoredDraft?.sessionMethod ?? DEFAULT_SESSION_METHOD_SELECTION.method,
      serviceIds: initialSelectedServiceIds,
      services: [],
    };
  }, [initialSelectedServiceIds, projectModeCatalog, restoredDraft]);
  const initialDraftValues = useMemo<AgentSetupDraftValues>(
    () => ({
      sessionMethod: initialSessionMethodSelection.method ?? null,
      projectModeSelection:
        initialSessionMethodSelection.projectModeSelection ?? null,
      serviceIds: initialSelectedServiceIds,
      launchServiceId: initialLaunchServiceId,
      worktreeBranch:
        lockedWorktreeBranch ?? restoredDraft?.worktreeBranch ?? null,
      provider: boundProvider,
      model: null,
      reasoningEffort: undefined,
    }),
    [
      boundProvider,
      initialLaunchServiceId,
      initialSelectedServiceIds,
      initialSessionMethodSelection.method,
      lockedWorktreeBranch,
      restoredDraft,
    ],
  );

  const [selectionState, setSelectionState] =
    useState<CodingSetupSelectionState>({
      agentSessionId,
      selectedServiceId: scopedBoundServiceId,
      selectedProvider: boundProvider,
    });
  const [selectedServiceIdsState, setSelectedServiceIds] = useState<string[]>(
    initialSelectedServiceIds,
  );
  const selectedServiceIds = useMemo(
    () =>
      selectedServiceIdsState.filter((serviceId) =>
        selectableServiceIds.has(serviceId),
      ),
    [selectableServiceIds, selectedServiceIdsState],
  );
  const [launchServiceIdState, setLaunchServiceIdState] = useState<
    string | null
  >(initialLaunchServiceId);
  const [sessionMethodSelection, setSessionMethodSelection] =
    useState<SessionMethodSelection>(initialSessionMethodSelection);
  const [directoryPaths, setDirectoryPaths] = useState<Record<string, string>>(
    {},
  );
  const [worktreeBranch, setWorktreeBranchState] = useState<string | null>(
    initialDraftValues.worktreeBranch,
  );
  // What the user chose; anything not yet chosen follows the initial selection
  // derived from the CLI's catalog.
  const [chosenModel, setSelectedModel] = useState<string | null>(null);
  const [chosenReasoningEffort, setSelectedReasoningEffort] = useState<
    ReasoningEffort | null | undefined
  >(undefined);
  const [chosenFastMode, setSelectedFastMode] = useState<boolean | undefined>(
    undefined,
  );
  const selectedModel = chosenModel ?? initialSurfaceSelection?.model ?? null;
  const selectedReasoningEffort =
    chosenReasoningEffort !== undefined
      ? chosenReasoningEffort
      : (initialSurfaceSelection?.reasoningEffort ?? null);
  const selectedFastMode =
    chosenFastMode ?? initialSurfaceSelection?.fastMode ?? false;
  const surfaceSelectionRef = useRef<SurfaceSelection | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState<string>("");
  const initializedServiceSelectionRef = useRef<string | null>(null);
  const serviceSelectionTouchedRef = useRef(false);
  const sessionMethodTouchedRef = useRef(false);
  const draftValuesRef = useRef<AgentSetupDraftValues>(initialDraftValues);
  const previousLockedWorktreeBranchRef = useRef(lockedWorktreeBranch);

  const { mutate: createAgentSessionConversation } =
    useCreateAgentSessionConversation();

  const resolvedSelection = useMemo(
    () =>
      resolveCodingSetupSelection({
        selection: selectionState,
        agentSessionId,
        boundServiceId: scopedBoundServiceId,
        taskServiceIds: availableTaskServiceIds,
        boundProvider,
      }),
    [
      selectionState,
      agentSessionId,
      scopedBoundServiceId,
      availableTaskServiceIds,
      boundProvider,
    ],
  );

  const scopedResolvedSelection = useMemo(() => {
    if (
      resolvedSelection.selectedServiceId === null ||
      selectableServiceIds.has(resolvedSelection.selectedServiceId)
    ) {
      return resolvedSelection;
    }

    return {
      ...resolvedSelection,
      selectedServiceId: null,
    };
  }, [resolvedSelection, selectableServiceIds]);

  const initialProvider = initialSurfaceSelection?.provider ?? null;
  const resolvedState = useMemo(
    () =>
      resolveCodingSetupState({
        boundServiceId: scopedBoundServiceId,
        selectedServiceId: scopedResolvedSelection.selectedServiceId,
        boundProvider,
        selectedProvider:
          scopedResolvedSelection.selectedProvider ?? initialProvider,
        repoBindings,
      }),
    [
      scopedBoundServiceId,
      scopedResolvedSelection.selectedServiceId,
      boundProvider,
      scopedResolvedSelection.selectedProvider,
      initialProvider,
      repoBindings,
    ],
  );

  useEffect(() => {
    setStep("session-method");
    setSelectionState({
      agentSessionId,
      selectedServiceId: initialLaunchServiceId,
      selectedProvider: boundProvider,
    });
    setSelectedServiceIds(initialSelectedServiceIds);
    setLaunchServiceIdState(initialLaunchServiceId);
    setSessionMethodSelection(initialSessionMethodSelection);
    setDirectoryPaths({});
    setWorktreeBranchState(initialDraftValues.worktreeBranch);
    setSelectedModel(null);
    setSelectedReasoningEffort(undefined);
    setSelectedFastMode(undefined);
    surfaceSelectionRef.current = null;
    draftValuesRef.current = initialDraftValues;
    previousLockedWorktreeBranchRef.current = lockedWorktreeBranch;
    initializedServiceSelectionRef.current = null;
    serviceSelectionTouchedRef.current = false;
    sessionMethodTouchedRef.current = false;
    setError(null);
    setPromptDraft("");
  }, [agentSessionId, userId]);

  useEffect(() => {
    const restoredProjectModeSelection =
      restoredDraft?.projectModeSelection ?? null;
    if (
      sessionMethodTouchedRef.current ||
      !restoredProjectModeSelection ||
      !isProjectModeSelectionEligible(
        restoredProjectModeSelection,
        projectModeCatalog,
      )
    ) {
      return;
    }
    setSessionMethodSelection((current) => ({
      ...current,
      method: undefined,
      projectModeSelection: restoredProjectModeSelection,
    }));
    draftValuesRef.current = {
      ...draftValuesRef.current,
      sessionMethod: null,
      projectModeSelection: restoredProjectModeSelection,
    };
  }, [projectModeCatalog, restoredDraft]);

  // Multi-select is on for every coding-session mode. The flag is kept on the
  // result so consumers can branch their UI affordances (toggle vs. radio
  // semantics, "Launch from" picker visibility), even though the underlying
  // state machine no longer has a single-service code path.
  const isMultiServiceMode = true;

  const serviceSelectionInitializationKey = useMemo(
    () =>
      `${agentSessionId}:${
        scopedBoundServiceId ?? ""
      }:${availableTaskServiceIds.join(",")}`,
    [agentSessionId, availableTaskServiceIds, scopedBoundServiceId],
  );

  useEffect(() => {
    if (
      initializedServiceSelectionRef.current ===
      serviceSelectionInitializationKey
    ) {
      return;
    }
    if (!servicesQuery.isFetched) return;
    // Task relations can arrive after the Service catalog. Keep the
    // initialization open until the usable task scope is available, otherwise
    // an unbound task launch can be incorrectly initialized with no Services.
    // A project with exactly one usable Service has a deterministic single
    // candidate, so it can initialize without waiting on task relations.
    if (
      !scopedBoundServiceId &&
      availableTaskServiceIds.length === 0 &&
      selectableServiceIds.size !== 1
    ) {
      return;
    }

    const initialSelection = resolveInitialServiceSelection({
      usableTaskServiceIds: availableTaskServiceIds,
      usableServiceIds: selectableServiceIds,
      boundServiceId: scopedBoundServiceId,
      persistedServiceIds: restoredDraft?.serviceIds ?? null,
      persistedLaunchServiceId: restoredDraft?.launchServiceId ?? null,
    });
    initializedServiceSelectionRef.current = serviceSelectionInitializationKey;
    draftValuesRef.current = {
      ...draftValuesRef.current,
      serviceIds: initialSelection.selectedServiceIds,
      launchServiceId: initialSelection.launchServiceId,
    };
    if (!serviceSelectionTouchedRef.current) {
      setSelectedServiceIds(initialSelection.selectedServiceIds);
      setLaunchServiceIdState(initialSelection.launchServiceId);
      setSessionMethodSelection((current) => ({
        ...current,
        serviceIds: initialSelection.selectedServiceIds,
        services: initialSelection.selectedServiceIds.flatMap((serviceId) => {
          const service = services.find(
            (candidate) => candidate.id === serviceId,
          );
          return service ? [{ id: service.id, name: service.name }] : [];
        }),
      }));
    }
    setSelectionState((current) => ({
      ...current,
      agentSessionId,
      selectedServiceId: initialSelection.launchServiceId,
    }));
  }, [
    agentSessionId,
    availableTaskServiceIds,
    scopedBoundServiceId,
    serviceSelectionInitializationKey,
    services,
    selectableServiceIds,
    servicesQuery.isFetched,
    restoredDraft,
  ]);

  useEffect(() => {
    setSelectedServiceIds((current) => {
      const scoped = current.filter((serviceId) =>
        selectableServiceIds.has(serviceId),
      );
      return scoped.length === current.length ? current : scoped;
    });
    setLaunchServiceIdState((current) =>
      current && selectableServiceIds.has(current) ? current : null,
    );
    setSelectionState((current) =>
      current.selectedServiceId === null ||
      selectableServiceIds.has(current.selectedServiceId)
        ? current
        : { ...current, selectedServiceId: null },
    );
    setSessionMethodSelection((current) => {
      const serviceIds = current.serviceIds.filter((serviceId) =>
        selectableServiceIds.has(serviceId),
      );
      if (serviceIds.length === current.serviceIds.length) return current;
      return {
        ...current,
        serviceIds,
        services: current.services.filter((service) =>
          selectableServiceIds.has(service.id),
        ),
      };
    });
  }, [selectableServiceIds]);

  useEffect(() => {
    if (lockedWorktreeBranch !== null) {
      setWorktreeBranchState(lockedWorktreeBranch);
    } else if (previousLockedWorktreeBranchRef.current !== null) {
      setWorktreeBranchState(null);
    }
    previousLockedWorktreeBranchRef.current = lockedWorktreeBranch;
  }, [lockedWorktreeBranch]);

  // Keep the read-only setup paths aligned with the current repo bindings. The
  // local CLI can replace a machine-reported binding after the initial render,
  // so only seeding empty entries would leave the setup using a stale path.
  useEffect(() => {
    setDirectoryPaths((current) => {
      let next = current;
      let mutated = false;
      for (const id of selectedServiceIds) {
        const seed =
          repoBindings.find((b) => b.serviceId === id)?.repositoryPath ?? "";
        if (next[id] === seed) continue;
        if (!mutated) {
          next = { ...current };
          mutated = true;
        }
        next[id] = seed;
      }
      for (const id of Object.keys(next)) {
        if (!selectedServiceIds.includes(id)) {
          if (!mutated) {
            next = { ...current };
            mutated = true;
          }
          delete next[id];
        }
      }
      return mutated ? next : current;
    });
  }, [selectedServiceIds, repoBindings]);

  // Default launchServiceId tracks the first selected service. Once the user
  // explicitly picks a launch service via setLaunchServiceId, that wins until
  // the chosen service leaves the selection set.
  const launchServiceId: string | null = (() => {
    if (
      launchServiceIdState &&
      selectedServiceIds.includes(launchServiceIdState)
    ) {
      return launchServiceIdState;
    }
    return selectedServiceIds[0] ?? null;
  })();

  // Changes build on what the user already chose, else on the initial
  // selection; with neither (catalog not loaded) there is nothing to change.
  const persistSurfaceSelection = useCallback(
    (patch: Partial<SurfaceSelection>) => {
      const base =
        surfaceSelectionRef.current ?? initialSurfaceSelectionRef.current;
      if (!base) return;
      const next = { ...base, ...patch };
      surfaceSelectionRef.current = next;
      writeSurfaceSelection(CODING_SETUP_SURFACE_ID, next);
    },
    [],
  );

  const persistDraft = useCallback(
    (updates: Partial<AgentSetupDraftValues>) => {
      const next = { ...draftValuesRef.current, ...updates };
      const serviceIds = next.serviceIds.filter((serviceId) =>
        selectableServiceIds.has(serviceId),
      );
      const launchServiceId =
        next.launchServiceId && serviceIds.includes(next.launchServiceId)
          ? next.launchServiceId
          : (serviceIds[0] ?? null);
      const normalized: AgentSetupDraftValues = {
        ...next,
        projectModeSelection: next.projectModeSelection ?? null,
        serviceIds,
        launchServiceId,
      };
      draftValuesRef.current = normalized;
      // A draft carries a complete runtime choice; what the user has not
      // chosen yet follows the initial selection, and with no catalog loaded
      // there is none to carry, so nothing is stored.
      const initial = initialSurfaceSelectionRef.current;
      const provider =
        normalized.provider ?? boundProvider ?? initial?.provider ?? null;
      const model = normalized.model ?? initial?.model ?? null;
      if (!provider || !model) return;
      const persisted: AgentSetupDraftInput = {
        ...normalized,
        provider,
        model,
        reasoningEffort:
          normalized.reasoningEffort !== undefined
            ? normalized.reasoningEffort
            : (initial?.reasoningEffort ?? null),
        setupContextKey,
      };
      upsertAgentSetupDraft(userId, persisted);
    },
    [boundProvider, selectableServiceIds, setupContextKey, userId],
  );

  const toggleService = useCallback(
    (id: string) => {
      if (!selectableServiceIds.has(id)) return;
      serviceSelectionTouchedRef.current = true;
      const scoped = selectedServiceIds.filter((serviceId) =>
        selectableServiceIds.has(serviceId),
      );
      const adding = !scoped.includes(id);
      const nextSelectedServiceIds = adding
        ? [...scoped, id]
        : scoped.filter((serviceId) => serviceId !== id);
      const nextLaunchServiceId =
        launchServiceId && nextSelectedServiceIds.includes(launchServiceId)
          ? launchServiceId
          : (nextSelectedServiceIds[0] ?? null);
      setSelectedServiceIds(nextSelectedServiceIds);
      persistDraft({
        serviceIds: nextSelectedServiceIds,
        launchServiceId: nextLaunchServiceId,
      });
      setSessionMethodSelection((prev) => {
        const adding = !prev.serviceIds.includes(id);
        if (!adding) {
          return {
            ...prev,
            serviceIds: prev.serviceIds.filter((sid) => sid !== id),
            services: prev.services.filter((s) => s.id !== id),
          };
        }
        const service = services.find((s) => s.id === id);
        return {
          ...prev,
          serviceIds: [...prev.serviceIds, id],
          services: service
            ? [...prev.services, { id: service.id, name: service.name }]
            : prev.services,
        };
      });
      setSelectionState((prev) => ({
        ...prev,
        selectedServiceId:
          prev.selectedServiceId === id
            ? null
            : prev.selectedServiceId &&
                selectableServiceIds.has(prev.selectedServiceId)
              ? prev.selectedServiceId
              : id,
      }));
    },
    [
      launchServiceId,
      persistDraft,
      selectableServiceIds,
      selectedServiceIds,
      services,
    ],
  );

  // selectService maps to "select exactly this one service". Kept as a
  // backward-compatible affordance for surfaces that pass a single bound
  // service in; toggleService is the primary multi-select control.
  const selectService = useCallback(
    (id: string) => {
      if (!selectableServiceIds.has(id)) return;
      serviceSelectionTouchedRef.current = true;
      setSelectedServiceIds([id]);
      setLaunchServiceIdState(id);
      setSelectionState({
        agentSessionId,
        selectedServiceId: id,
        selectedProvider: scopedResolvedSelection.selectedProvider,
      });
      setSessionMethodSelection((prev) => {
        const service = services.find((s) => s.id === id);
        return {
          ...prev,
          serviceIds: [id],
          services: service ? [{ id: service.id, name: service.name }] : [],
        };
      });
      persistDraft({ serviceIds: [id], launchServiceId: id });
    },
    [
      agentSessionId,
      persistDraft,
      scopedResolvedSelection.selectedProvider,
      selectableServiceIds,
      services,
    ],
  );

  const setLaunchServiceId = useCallback(
    (id: string) => {
      if (!selectableServiceIds.has(id) || !selectedServiceIds.includes(id)) {
        return;
      }
      serviceSelectionTouchedRef.current = true;
      setLaunchServiceIdState(id);
      persistDraft({ launchServiceId: id });
    },
    [persistDraft, selectableServiceIds, selectedServiceIds],
  );

  const setWorktreeBranch = useCallback(
    (branch: string | null) => {
      const nextBranch = resolveWorktreeBranchChange({
        currentBranch: worktreeBranch,
        requestedBranch: branch,
        lockedWorktreeBranch,
        taskName,
      });
      setWorktreeBranchState(nextBranch);
      persistDraft({ worktreeBranch: nextBranch });
    },
    [lockedWorktreeBranch, persistDraft, taskName, worktreeBranch],
  );

  const selectProvider = useCallback(
    (provider: AgentProvider) => {
      setSelectionState({
        agentSessionId,
        selectedServiceId: scopedResolvedSelection.selectedServiceId,
        selectedProvider: provider,
      });
      persistSurfaceSelection({ provider });
      persistDraft({ provider });
    },
    [
      agentSessionId,
      persistDraft,
      scopedResolvedSelection.selectedServiceId,
      persistSurfaceSelection,
    ],
  );

  const selectModel = useCallback(
    (model: string | null) => {
      setSelectedModel(model);
      if (model !== null) {
        persistSurfaceSelection({ model });
        persistDraft({ model });
      }
    },
    [persistDraft, persistSurfaceSelection],
  );

  const selectReasoningEffort = useCallback(
    (effort: ReasoningEffort | null) => {
      setSelectedReasoningEffort(effort);
      persistSurfaceSelection({ reasoningEffort: effort });
      persistDraft({ reasoningEffort: effort });
    },
    [persistDraft, persistSurfaceSelection],
  );

  const selectFastMode = useCallback(
    (fastMode: boolean) => {
      setSelectedFastMode(fastMode);
      persistSurfaceSelection({ fastMode });
    },
    [persistSurfaceSelection],
  );

  const goToSessionMethod = useCallback(() => {
    setError(null);
    setStep("session-method");
  }, []);

  const selectSessionMethod = useCallback(
    (method: AgentSessionMethod) => {
      // Multi-service selection is now shared across every coding-session mode,
      // so the chosen service set survives a method change. Validation has its
      // own launch path that bypasses this state entirely; no need to clear
      // the set on the transition into validation.
      sessionMethodTouchedRef.current = true;
      setSessionMethodSelection((prev) => ({
        method,
        projectModeSelection: undefined,
        serviceIds: prev.serviceIds,
        services: prev.services,
      }));
      persistDraft({ sessionMethod: method, projectModeSelection: null });
    },
    [persistDraft],
  );

  const selectProjectMode = useCallback(
    (selection: ProjectModeSelection) => {
      if (!isProjectModeSelectionEligible(selection, projectModeCatalog)) {
        return;
      }
      sessionMethodTouchedRef.current = true;
      setSessionMethodSelection((prev) => ({
        method: undefined,
        projectModeSelection: selection,
        serviceIds: prev.serviceIds,
        services: prev.services,
      }));
      persistDraft({ sessionMethod: null, projectModeSelection: selection });
    },
    [persistDraft, projectModeCatalog],
  );

  const projectModeSelection =
    sessionMethodSelection.projectModeSelection ?? null;
  const validateProjectModeSelection = useCallback(
    () =>
      !projectModeSelection ||
      isProjectModeSelectionEligible(projectModeSelection, projectModeCatalog),
    [projectModeCatalog, projectModeSelection],
  );

  const goToSelection = useCallback(() => {
    setError(null);
    setStep("selection");
  }, []);

  const goToPrompt = useCallback(() => {
    setError(null);
    setStep("prompt");
  }, []);

  const mapDirectory = useCallback(async () => {
    if (selectedServiceIds.length === 0) {
      setError("Select at least one service before mapping a repository.");
      return false;
    }
    const unmapped = selectedServiceIds.filter(
      (id) =>
        !(
          repoBindings.find((binding) => binding.serviceId === id)
            ?.repositoryPath ?? ""
        ).trim(),
    );
    if (unmapped.length > 0) {
      setError(
        unmapped.length === 1
          ? "Enter a repository path for every selected service."
          : `Enter repository paths for every selected service (${String(
              unmapped.length,
            )} missing).`,
      );
      return false;
    }
    setError(null);
    return true;
  }, [repoBindings, selectedServiceIds]);

  const start = useCallback(async (): Promise<
    { ok: true } | { ok: false; error: string }
  > => {
    if (sessionMethodSelection.method === "validation") {
      return {
        ok: false,
        error:
          "Validation sessions are launched outside the coding start flow.",
      };
    }
    if (!validateProjectModeSelection()) {
      const error =
        "The selected project mode is no longer available for this task. Choose an available mode before starting.";
      setError(error);
      return { ok: false, error };
    }
    if (!selectedMachine?.machineId) {
      const error = "Select a paired machine before starting.";
      setError(error);
      return { ok: false, error };
    }
    if (!skipServiceSelection && selectedServiceIds.length === 0) {
      return { ok: false, error: "Service must be selected before starting." };
    }
    if (
      !skipServiceSelection &&
      selectedServiceIds.length > 1 &&
      !launchServiceId
    ) {
      return {
        ok: false,
        error: "Pick a launch service when multiple services are selected.",
      };
    }
    if (!resolvedState.selectedProvider) {
      return { ok: false, error: "Provider must be selected before starting." };
    }
    if (!selectedModel) {
      return { ok: false, error: "Model must be selected before starting." };
    }
    const selectedWorktreeBranch = worktreeBranch?.trim() ?? null;
    if (worktreeBranch !== null && !selectedWorktreeBranch) {
      const error = "Worktree branch must be entered before starting.";
      setError(error);
      return { ok: false, error };
    }

    setStarting(true);
    setError(null);

    const effectiveLaunchServiceId =
      launchServiceId ?? selectedServiceIds[0] ?? null;
    const updateResult = await updateAgentSessionRecord({
      organizationId,
      projectId,
      agentSessionId,
      machineId: selectedMachine.machineId,
      ...(selectedServiceIds.length > 0
        ? { serviceIds: selectedServiceIds }
        : {}),
      ...(effectiveLaunchServiceId
        ? { launchServiceId: effectiveLaunchServiceId }
        : {}),
      provider: resolvedState.selectedProvider,
      config: {
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: "v2",
        ...(projectModeSelection
          ? {
              projectModeSelection: {
                schemaVersion:
                  ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1,
                modeId: projectModeSelection.modeId,
              },
            }
          : { method: sessionMethodSelection.method }),
        model: selectedModel,
        ...(selectedReasoningEffort ? { effort: selectedReasoningEffort } : {}),
        ...(supportsFastMode(resolvedState.selectedProvider, selectedModel)
          ? { fastMode: selectedFastMode }
          : {}),
        ...(selectedWorktreeBranch ? { worktree: selectedWorktreeBranch } : {}),
      },
    });

    if (!updateResult.ok) {
      setStarting(false);
      setError(updateResult.error);
      return { ok: false, error: updateResult.error };
    }

    // Push the PATCH response straight into the agent-session cache so the
    // next render of CodingSession sees the freshly-persisted `config` (and
    // any other server-rewritten fields). This is also important for project
    // modes: the API owns the captured snapshot, so the client must preserve
    // the returned config instead of constructing a local snapshot. Without
    // this, `mode` flips to "active" via the URL update before the background
    // refetch lands, and CodingSessionActive mounts with stale config.
    writeAgentSession(
      queryClient,
      organizationId,
      projectId,
      updateResult.session,
    );

    if (!updateResult.session.conversationId) {
      const workflowType = projectModeSelection
        ? WorkflowName.AgentSession
        : resolveCodingSessionWorkflowType(
            sessionMethodSelection.method ?? "open",
          );
      try {
        await createAgentSessionConversation({
          organizationId,
          projectId,
          agentSessionId,
          body: {
            workflowType,
            workflowAboutType: "agent-session",
            workflowAboutId: agentSessionId,
          },
        });
      } catch (err) {
        // 409 means a parallel writer linked the conversation first; the hook
        // already marked the agent session stale so the next read refetches.
        if (!isConflictError(err)) {
          const message =
            err instanceof Error && err.message.trim().length > 0
              ? err.message
              : "Failed to create agent session conversation.";
          setStarting(false);
          setError(message);
          return { ok: false, error: message };
        }
      }
    }

    setStarting(false);
    return { ok: true };
  }, [
    skipServiceSelection,
    selectedServiceIds,
    launchServiceId,
    resolvedState.selectedProvider,
    selectedModel,
    selectedReasoningEffort,
    selectedFastMode,
    worktreeBranch,
    organizationId,
    projectId,
    agentSessionId,
    sessionMethodSelection.method,
    projectModeSelection,
    projectModeCatalog,
    validateProjectModeSelection,
    selectedMachine,
    createAgentSessionConversation,
    queryClient,
  ]);

  const canonicalServiceId = launchServiceId ?? selectedServiceIds[0] ?? null;
  const focusedDirectoryPath = canonicalServiceId
    ? (directoryPaths[canonicalServiceId] ?? "")
    : "";
  const allSelectedHavePaths =
    selectedServiceIds.length > 0 &&
    selectedServiceIds.every(
      (id) => (directoryPaths[id] ?? "").trim().length > 0,
    );
  const launchSelectionValid =
    selectedServiceIds.length === 0 ||
    selectedServiceIds.length === 1 ||
    Boolean(launchServiceId && selectedServiceIds.includes(launchServiceId));

  return {
    services,
    repoBindings,
    selectedServiceId: canonicalServiceId,
    selectedServiceIds,
    launchServiceId,
    selectedProvider: resolvedState.selectedProvider,
    selectedBinding: resolvedState.selectedBinding,
    directoryPath: focusedDirectoryPath,
    directoryPaths,
    worktreeBranch,
    worktreeLocked: lockedWorktreeBranch !== null,
    step,
    sessionMethodSelection,
    isMultiServiceMode,
    canStart: Boolean(
      (skipServiceSelection || canonicalServiceId) &&
      resolvedState.selectedProvider &&
      selectedModel &&
      (skipServiceSelection || (allSelectedHavePaths && launchSelectionValid)),
    ),
    loadingServices: servicesQuery.isLoading || !servicesQuery.isFetched,
    servicesError: servicesQuery.error?.message ?? null,
    starting,
    error,
    selectService,
    toggleService,
    setLaunchServiceId,
    selectProvider,
    selectedModel,
    selectModel,
    selectedReasoningEffort,
    selectReasoningEffort,
    selectedFastMode,
    selectFastMode,
    goToSessionMethod,
    goToSelection,
    goToPrompt,
    selectSessionMethod,
    selectProjectMode,
    projectModeSelection,
    validateProjectModeSelection,
    promptDraft,
    setPromptDraft,
    setWorktreeBranch,
    mapDirectory,
    start,
  };
};
