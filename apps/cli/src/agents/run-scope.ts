import { findLaunchCheckoutConflict } from '../repo/launch-checkout';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { LOCAL_RUN_MODE, LOCAL_RUN_WORKSPACE_LAYOUT } from '../shared/agent-bridge-contract/contract';
import type {
  LocalWorktreeState,
  LocalWorktreeStateByService,
  ResolvedServiceBinding,
} from '../shared/agent-bridge-contract/contract';
import { toServiceId, type RepoMappingStore } from '../repo/index';
import type { ServerLogger } from '../server/logger';
import type { AgenticSession } from '../session/index';
import {
  attachWorktree,
  createWorktree,
  getBranchWorktreeState,
  toBranchSafeName,
  type BranchWorktreeState,
  type WorktreeInfo,
} from '../git/index';

const isWithinRoot = (candidatePath: string, rootPath: string): boolean => {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const pathsOverlap = (leftPath: string, rightPath: string): boolean =>
  isWithinRoot(leftPath, rightPath) || isWithinRoot(rightPath, leftPath);

const readNonEmpty = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toCanonicalPath = (inputPath: string): string =>
  path.isAbsolute(inputPath) ? path.normalize(inputPath) : path.resolve(process.cwd(), inputPath);

const areSamePath = (left: string, right: string): boolean =>
  toCanonicalPath(left) === toCanonicalPath(right);

const pathExists = async (inputPath: string): Promise<boolean> => {
  try {
    await fs.access(inputPath);
    return true;
  } catch {
    return false;
  }
};

const dedupePreservingOrder = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
};

type LogFields = NonNullable<Parameters<ServerLogger['debug']>[1]>;

const logDebug = (logger: ServerLogger | undefined, event: string, fields?: LogFields): void => {
  logger?.debug(event, fields);
};

const logWarn = (logger: ServerLogger | undefined, event: string, fields?: LogFields): void => {
  logger?.warn(event, fields);
};

const logError = (logger: ServerLogger | undefined, event: string, fields?: LogFields): void => {
  logger?.error(event, fields);
};

const getSessionLogFields = (session: AgenticSession): LogFields => ({
  sessionId: session.agentic_session_id,
  launchServiceId: session.launchServiceId,
  serviceIds: session.services.map((entry) => entry.id),
  serviceCount: session.services.length,
  hasScope: Boolean(session.scope),
  scopeMode: session.scope?.mode,
  worktreeEnabled: session.worktree?.enabled === true,
  worktreeBranch: session.worktree?.branch,
});

export type RunWorkspaceResolutionFailureCode = 'REPO_BINDING_MISSING' | 'RUN_SCOPE_INVALID';

export const RUN_WORKTREE_COLLISION_CODE =
  'BRANCH_CHECKED_OUT_IN_HOST_REPOSITORY' as const;

export type RunWorktreeCollisionAuthority = 'PLAN' | 'TASK_MONITOR';
export type RunWorktreeCollisionCorrectionMode = 'PLAN_LOCKED' | 'USER_EDITABLE';

export interface RunWorktreeCollision {
  readonly code: typeof RUN_WORKTREE_COLLISION_CODE;
  readonly message: string;
  readonly serviceId: string;
  readonly repositoryPath: string;
  readonly branch: string;
  readonly authority: RunWorktreeCollisionAuthority;
  readonly correctionMode: RunWorktreeCollisionCorrectionMode;
  readonly correctiveAction: string;
  readonly fingerprint: string;
}

const runWorktreeCollisionCorrectiveAction = (
  authority: RunWorktreeCollisionAuthority,
): { mode: RunWorktreeCollisionCorrectionMode; action: string } =>
  authority === 'PLAN'
    ? {
        mode: 'PLAN_LOCKED',
        action:
          'Resolve the checkout in the named repository while keeping the plan branch and worktree unchanged, then press Start to retry.',
      }
    : {
        mode: 'USER_EDITABLE',
        action:
          'Choose a different editable worktree or branch in Task Monitor settings, then press Start to retry.',
      };

export const runWorktreeCollisionFingerprint = (input: {
  readonly serviceId: string;
  readonly repositoryPath: string;
  readonly branch: string;
  readonly authority: RunWorktreeCollisionAuthority;
}): string => {
  const canonicalRepositoryPath = toCanonicalPath(input.repositoryPath);
  const canonicalIdentity = JSON.stringify([
    RUN_WORKTREE_COLLISION_CODE,
    input.serviceId,
    canonicalRepositoryPath,
    input.branch,
    input.authority,
  ]);
  return `sha256:${createHash('sha256').update(canonicalIdentity).digest('hex')}`;
};

export class RunWorktreeCollisionError extends Error {
  public readonly code = RUN_WORKTREE_COLLISION_CODE;
  public readonly serviceId: string;
  public readonly repositoryPath: string;
  public readonly branch: string;
  public readonly authority: RunWorktreeCollisionAuthority;
  public readonly correctionMode: RunWorktreeCollisionCorrectionMode;
  public readonly correctiveAction: string;
  public readonly fingerprint: string;
  public readonly failure: RunWorktreeCollision;

  public constructor(input: {
    readonly serviceId: string;
    readonly repositoryPath: string;
    readonly branch: string;
    readonly authority: RunWorktreeCollisionAuthority;
  }) {
    const repositoryPath = toCanonicalPath(input.repositoryPath);
    const message = `Branch ${input.branch} is already checked out in repository ${repositoryPath}; cannot materialize an isolated worktree for this service.`;
    const correction = runWorktreeCollisionCorrectiveAction(input.authority);
    const fingerprint = runWorktreeCollisionFingerprint({ ...input, repositoryPath });
    super(message);
    this.name = 'RunWorktreeCollisionError';
    this.serviceId = input.serviceId;
    this.repositoryPath = repositoryPath;
    this.branch = input.branch;
    this.authority = input.authority;
    this.correctionMode = correction.mode;
    this.correctiveAction = correction.action;
    this.fingerprint = fingerprint;
    this.failure = Object.freeze({
      code: RUN_WORKTREE_COLLISION_CODE,
      message,
      serviceId: this.serviceId,
      repositoryPath: this.repositoryPath,
      branch: this.branch,
      authority: this.authority,
      correctionMode: this.correctionMode,
      correctiveAction: this.correctiveAction,
      fingerprint: this.fingerprint,
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type RunWorkspaceResolution =
  | {
      ok: true;
      runMode: 'default' | 'cross_service_review';
      repositoryPathForRunStarted: string;
      cwd: string;
      allowedRepositoryRoots: string[];
      bindingRepositoryPath: string;
      workspaceRoot: string | null;
      worktree?: LocalWorktreeStateByService;
    }
  | {
      ok: false;
      code: RunWorkspaceResolutionFailureCode;
      message: string;
    };

export type ResolvedRunWorkspace = Extract<RunWorkspaceResolution, { ok: true }>;

export type ServiceBindingResolution =
  | { ok: true; services: ResolvedServiceBinding[] }
  | {
      ok: false;
      code: 'REPO_BINDING_MISSING';
      serviceId: string;
      message: string;
    };

export const selectWorktreeStateForSession = (
  session: AgenticSession,
): LocalWorktreeState | null => {
  const worktreeState = getWorktreeStateEntriesForSession(session);
  if (!worktreeState) return null;

  const launchEntry = session.launchServiceId
    ? worktreeState.entriesByService[session.launchServiceId]
    : undefined;
  if (launchEntry) {
    return launchEntry;
  }

  const launchPath = session.services.find((entry) => entry.id === session.launchServiceId)?.path;
  if (launchPath) {
    const matchingEntry = worktreeState.entries.find(
      (entry) => entry.repoPath === launchPath || entry.worktreePath === launchPath,
    );
    if (matchingEntry) return matchingEntry;
  }

  return worktreeState.entries[0] ?? null;
};

export const getWorktreeStateEntriesForSession = (
  session: AgenticSession,
): { entriesByService: LocalWorktreeStateByService; entries: LocalWorktreeState[] } | null => {
  const entriesByService = session.worktreeState;
  if (!entriesByService) return null;

  const entries = Object.values(entriesByService);
  return entries.length > 0 ? { entriesByService, entries } : null;
};

export const hasWorktreeStateEntriesForSession = (session: AgenticSession): boolean =>
  getWorktreeStateEntriesForSession(session) !== null;

const selectWorktreeStateForService = (
  session: AgenticSession,
  serviceId: string,
  repositoryPath: string,
): LocalWorktreeState | null => {
  const worktreeState = session.worktreeState;
  if (!worktreeState) return null;

  const exactEntry = worktreeState[serviceId];
  if (exactEntry) return exactEntry;

  return (
    Object.values(worktreeState).find(
      (entry) => entry.repoPath === repositoryPath || entry.worktreePath === repositoryPath,
    ) ?? null
  );
};

export const selectLaunchWorktreeState = (
  session: AgenticSession,
  worktreeState: LocalWorktreeStateByService,
): LocalWorktreeState | null => {
  if (session.launchServiceId) {
    const launchEntry = worktreeState[session.launchServiceId];
    if (launchEntry) return launchEntry;
  }

  const launchPath = session.services.find((entry) => entry.id === session.launchServiceId)?.path;
  if (launchPath) {
    const matchingEntry = Object.values(worktreeState).find(
      (entry) => entry.repoPath === launchPath || entry.worktreePath === launchPath,
    );
    if (matchingEntry) return matchingEntry;
  }

  return Object.values(worktreeState)[0] ?? null;
};

const resolveWorktreeForService = async (
  session: AgenticSession,
  serviceId: string,
  repositoryPath: string,
  logger?: ServerLogger,
): Promise<WorktreeInfo | null> => {
  if (!session.worktree?.enabled) {
    logDebug(logger, 'local.run_scope.worktree.service.skipped_disabled', {
      ...getSessionLogFields(session),
      serviceId,
      repoPath: repositoryPath,
    });
    return null;
  }

  const shortId = session.agentic_session_id.slice(0, 8);
  const branch = session.worktree.branch;
  const branchForPath = branch ?? `heyhey-run-${shortId}`;
  const worktreePath = path.join(repositoryPath, '.worktrees', toBranchSafeName(branchForPath));
  const baseFields = {
    ...getSessionLogFields(session),
    serviceId,
    repoPath: repositoryPath,
    worktreePath,
    branch,
  };

  logDebug(logger, 'local.run_scope.worktree.service.resolve_started', baseFields);

  const existingState = selectWorktreeStateForService(session, serviceId, repositoryPath);
  if (existingState) {
    logDebug(logger, 'local.run_scope.worktree.service.persisted_state_found', {
      ...baseFields,
      persistedRepoPath: existingState.repoPath,
      persistedWorktreePath: existingState.worktreePath,
      persistedBranch: existingState.branch,
    });

    const persistedState = await getPersistedWorktreeUsability(
      repositoryPath,
      existingState,
      branch,
    );
    if (persistedState.usable) {
      logDebug(logger, 'local.run_scope.worktree.service.persisted_state_reused', {
        ...baseFields,
        worktreePath: existingState.worktreePath,
        branch: existingState.branch,
      });
      return existingState;
    }

    logDebug(logger, 'local.run_scope.worktree.service.persisted_state_unusable', {
      ...baseFields,
      persistedRepoPath: existingState.repoPath,
      persistedWorktreePath: existingState.worktreePath,
      persistedBranch: existingState.branch,
      reason: persistedState.reason,
    });
  }

  if (!branch) {
    logDebug(logger, 'local.run_scope.worktree.service.create_started', baseFields);
    const created = await createWorktree({
      repoPath: repositoryPath,
      worktreePath,
    });
    logDebug(logger, 'local.run_scope.worktree.service.create_succeeded', {
      ...baseFields,
      branch: created.branch,
      worktreePath: created.worktreePath,
    });
    return created;
  }

  const branchState = await getBranchWorktreeState(repositoryPath, branch);
  logDebug(logger, 'local.run_scope.worktree.service.branch_state_read', {
    ...baseFields,
    branchExists: branchState.branchExists,
    checkedOutWorktreePath: branchState.checkedOutWorktree?.worktreePath,
    registeredWorktreeCount: branchState.worktrees.length,
  });

  const checkedOutWorktree = branchState.checkedOutWorktree;
  if (checkedOutWorktree) {
    if (!(await pathExists(checkedOutWorktree.worktreePath))) {
      logWarn(logger, 'local.run_scope.worktree.service.checked_out_worktree_missing', {
        ...baseFields,
        checkedOutWorktreePath: checkedOutWorktree.worktreePath,
      });
      throw new Error(
        `Branch ${branch} is registered to missing worktree ${checkedOutWorktree.worktreePath} for repository ${repositoryPath}.`,
      );
    }
    if (areSamePath(checkedOutWorktree.worktreePath, repositoryPath)) {
      logWarn(logger, 'local.run_scope.worktree.service.branch_checked_out_in_host_repo', {
        ...baseFields,
        checkedOutWorktreePath: checkedOutWorktree.worktreePath,
      });
      throw new RunWorktreeCollisionError({
        serviceId,
        repositoryPath,
        branch,
        authority: readNonEmpty(session.contextMetadata.launchPlanId) ? 'PLAN' : 'TASK_MONITOR',
      });
    }
    logDebug(logger, 'local.run_scope.worktree.service.checked_out_worktree_reused', {
      ...baseFields,
      worktreePath: checkedOutWorktree.worktreePath,
    });
    return {
      repoPath: repositoryPath,
      worktreePath: checkedOutWorktree.worktreePath,
      branch,
    };
  }

  if (branchState.branchExists) {
    logDebug(logger, 'local.run_scope.worktree.service.attach_started', baseFields);
    const attached = await attachWorktree({
      repoPath: repositoryPath,
      worktreePath,
      branch,
    });
    logDebug(logger, 'local.run_scope.worktree.service.attach_succeeded', {
      ...baseFields,
      worktreePath: attached.worktreePath,
    });
    return attached;
  }

  logDebug(logger, 'local.run_scope.worktree.service.create_started', baseFields);
  const created = await createWorktree({
    repoPath: repositoryPath,
    worktreePath,
    branch,
  });
  logDebug(logger, 'local.run_scope.worktree.service.create_succeeded', {
    ...baseFields,
    worktreePath: created.worktreePath,
  });
  return created;
};

const getPersistedWorktreeUsability = async (
  repositoryPath: string,
  state: LocalWorktreeState,
  expectedBranch: string | undefined,
): Promise<{ usable: true } | { usable: false; reason: string }> => {
  if (expectedBranch && state.branch !== expectedBranch) {
    return { usable: false, reason: 'branch_mismatch' };
  }
  if (!(await pathExists(state.worktreePath))) {
    return { usable: false, reason: 'worktree_path_missing' };
  }

  const branchState = await getBranchStateForPersistedWorktree(repositoryPath, state);
  if (!branchState) {
    return { usable: false, reason: 'branch_state_unavailable' };
  }

  const isRegistered = branchState.worktrees.some(
    (entry) => areSamePath(entry.worktreePath, state.worktreePath) && entry.branch === state.branch,
  );
  return isRegistered
    ? { usable: true }
    : { usable: false, reason: 'worktree_not_registered_for_branch' };
};

const getBranchStateForPersistedWorktree = async (
  repositoryPath: string,
  state: LocalWorktreeState,
): Promise<BranchWorktreeState | null> => {
  if (!state.branch) {
    return null;
  }
  return getBranchWorktreeState(repositoryPath, state.branch);
};

const resolveWorktreesForSession = async (
  session: AgenticSession,
  servicePaths: readonly ResolvedServicePath[],
  logger?: ServerLogger,
): Promise<LocalWorktreeStateByService | null> => {
  if (!session.worktree?.enabled) {
    logDebug(logger, 'local.run_scope.worktree.resolve.skipped_disabled', {
      ...getSessionLogFields(session),
    });
    return null;
  }

  logDebug(logger, 'local.run_scope.worktree.resolve.started', {
    ...getSessionLogFields(session),
    services: servicePaths,
  });

  const worktreeState: LocalWorktreeStateByService = {};
  for (const servicePath of servicePaths) {
    let worktree: WorktreeInfo | null;
    try {
      worktree = await resolveWorktreeForService(
        session,
        servicePath.serviceId,
        servicePath.repositoryPath,
        logger,
      );
    } catch (error) {
      logError(logger, 'local.run_scope.worktree.service.resolve_failed', {
        ...getSessionLogFields(session),
        serviceId: servicePath.serviceId,
        repoPath: servicePath.repositoryPath,
        error,
      });
      throw error;
    }
    if (worktree) {
      worktreeState[servicePath.serviceId] = worktree;
    }
  }

  const resolvedServiceIds = Object.keys(worktreeState);
  logDebug(logger, 'local.run_scope.worktree.resolve.succeeded', {
    ...getSessionLogFields(session),
    serviceIds: resolvedServiceIds,
    worktreeCount: resolvedServiceIds.length,
    worktreePaths: Object.values(worktreeState).map((entry) => entry.worktreePath),
  });

  return resolvedServiceIds.length > 0 ? worktreeState : null;
};

const replaceServiceRootsWithWorktrees = (
  allowedRoots: readonly string[],
  servicePaths: readonly ResolvedServicePath[],
  worktreeState: LocalWorktreeStateByService,
): string[] => {
  const worktreeRoots = Object.values(worktreeState).map((entry) => entry.worktreePath);
  const nonServiceRoots = allowedRoots.filter(
    (rootPath) =>
      !servicePaths.some((servicePath) => pathsOverlap(rootPath, servicePath.repositoryPath)),
  );
  return dedupePreservingOrder([...worktreeRoots, ...nonServiceRoots]);
};

/**
 * Resolve the launch service's repo path for the Run. Reads the path off
 * `session.services` when present (the post-refactor steady state where
 * `startAgenticSession` resolved every binding upfront); falls back to the
 * repoStore when the path is empty, which only happens for runs persisted
 * before the carrier widened to `services` and whose stored entries were
 * back-filled with empty paths on read.
 */
const resolveLaunchBinding = async (
  session: AgenticSession,
  repoStore: RepoMappingStore,
): Promise<{ launchServiceId: string; repositoryPath: string } | null> => {
  const services = session.services ?? [];
  if (services.length === 0) return null;
  const launchServiceId =
    session.launchServiceId && services.some((entry) => entry.id === session.launchServiceId)
      ? session.launchServiceId
      : services[0]!.id;
  const launchEntry = services.find((entry) => entry.id === launchServiceId) ?? services[0]!;
  if (launchEntry.path.length > 0) {
    return { launchServiceId, repositoryPath: launchEntry.path };
  }
  const binding = await repoStore.getBinding(toServiceId(launchServiceId));
  if (!binding) return null;
  return { launchServiceId, repositoryPath: binding.repositoryPath };
};

interface ResolvedServicePath {
  serviceId: string;
  repositoryPath: string;
}

/**
 * Collect every in-scope repo path for default-mode multi-service runs.
 * Mirrors `resolveLaunchBinding`'s fallback for legacy entries with empty
 * paths. Every selected service is load-bearing for worktree fan-out, so a
 * missing non-launch binding is a resolution failure too.
 */
const resolveAllServicePaths = async (
  session: AgenticSession,
  repoStore: RepoMappingStore,
): Promise<
  | { ok: true; servicePaths: ResolvedServicePath[] }
  | { ok: false; missingServiceId: string; message: string }
> => {
  const servicePaths: ResolvedServicePath[] = [];
  for (const entry of session.services ?? []) {
    if (entry.path.length > 0) {
      servicePaths.push({ serviceId: entry.id, repositoryPath: entry.path });
      continue;
    }
    const binding = await repoStore.getBinding(toServiceId(entry.id));
    if (!binding) {
      return {
        ok: false,
        missingServiceId: entry.id,
        message: `Session has no resolved repository mapping for selected service ${entry.id}.`,
      };
    }
    servicePaths.push({ serviceId: entry.id, repositoryPath: binding.repositoryPath });
  }
  return { ok: true, servicePaths };
};

/**
 * Resolve an approved Service scope from the durable Service-keyed mappings.
 * The result is assembled locally and is never returned as a partial set: the
 * caller can persist it only after every Service has a readable, traversable
 * workspace.
 */
export const resolveServiceBindingsForIds = async (input: {
  serviceIds: readonly string[];
  repoStore: RepoMappingStore;
  logger?: ServerLogger;
}): Promise<ServiceBindingResolution> => {
  const serviceIds = dedupePreservingOrder(input.serviceIds);
  const services: ResolvedServiceBinding[] = [];

  for (const serviceId of serviceIds) {
    const binding = await input.repoStore.getBinding(toServiceId(serviceId));
    if (!binding) {
      logWarn(input.logger, 'local.run_scope.approved_service_binding_missing', {
        serviceId,
      });
      return {
        ok: false,
        code: 'REPO_BINDING_MISSING',
        serviceId,
        message: `Approved Coding Plan scope has no repository mapping for Service ${serviceId}.`,
      };
    }

    const repositoryPath = toCanonicalPath(binding.repositoryPath);
    try {
      // R_OK | X_OK: the provider must be able to read and traverse the
      // workspace before the approved scope becomes executable.
      await fs.access(repositoryPath, 5);
    } catch {
      logWarn(input.logger, 'local.run_scope.approved_service_workspace_inaccessible', {
        serviceId,
        repositoryPath,
      });
      return {
        ok: false,
        code: 'REPO_BINDING_MISSING',
        serviceId,
        message: `Approved Coding Plan scope cannot access the workspace for Service ${serviceId}.`,
      };
    }

    services.push({ id: serviceId, path: repositoryPath });
  }

  return { ok: true, services };
};

export const resolveRunWorkspace = async (input: {
  session: AgenticSession;
  repoStore: RepoMappingStore;
  logger?: ServerLogger;
}): Promise<RunWorkspaceResolution> => {
  const { logger } = input;
  logDebug(logger, 'local.run_scope.workspace.resolve.started', getSessionLogFields(input.session));

  const launch = await resolveLaunchBinding(input.session, input.repoStore);
  if (!launch) {
    logWarn(logger, 'local.run_scope.workspace.resolve.launch_binding_missing', {
      ...getSessionLogFields(input.session),
    });
    return {
      ok: false,
      code: 'REPO_BINDING_MISSING',
      message: 'Session has no resolved launch service; cannot resolve repository mapping.',
    };
  }

  const bindingRepositoryPath = toCanonicalPath(launch.repositoryPath);
  const checkoutConflict = await findLaunchCheckoutConflict(
    bindingRepositoryPath,
    input.session.worktree?.enabled === true,
    logger,
  );
  if (checkoutConflict) {
    return { ok: false, code: 'RUN_SCOPE_INVALID', message: checkoutConflict };
  }
  const allServicePaths = await resolveAllServicePaths(input.session, input.repoStore);
  if (!allServicePaths.ok) {
    logWarn(logger, 'local.run_scope.workspace.resolve.service_binding_missing', {
      ...getSessionLogFields(input.session),
      missingServiceId: allServicePaths.missingServiceId,
    });
    return {
      ok: false,
      code: 'REPO_BINDING_MISSING',
      message: allServicePaths.message,
    };
  }
  const servicePaths = allServicePaths.servicePaths.map((entry) => ({
    serviceId: entry.serviceId,
    repositoryPath: toCanonicalPath(entry.repositoryPath),
  }));
  const serviceRepositoryPaths = servicePaths.map((entry) => entry.repositoryPath);

  if (!input.session.scope) {
    const worktreeState = await resolveWorktreesForSession(input.session, servicePaths, logger);
    const launchWorktree = worktreeState
      ? selectLaunchWorktreeState(input.session, worktreeState)
      : null;
    const cwd = launchWorktree?.worktreePath ?? bindingRepositoryPath;
    const baseRoots = worktreeState
      ? Object.values(worktreeState).map((entry) => entry.worktreePath)
      : [bindingRepositoryPath, ...serviceRepositoryPaths];
    const allowedRoots = dedupePreservingOrder(baseRoots);

    logDebug(logger, 'local.run_scope.workspace.resolve.succeeded', {
      ...getSessionLogFields(input.session),
      runMode: 'default',
      cwd,
      repositoryPathForRunStarted: cwd,
      bindingRepositoryPath,
      allowedRepositoryRoots: allowedRoots,
      worktreeServiceIds: worktreeState ? Object.keys(worktreeState) : [],
    });

    return {
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: cwd,
      cwd,
      allowedRepositoryRoots: allowedRoots,
      bindingRepositoryPath,
      workspaceRoot: null,
      ...(worktreeState ? { worktree: worktreeState } : {}),
    };
  }

  const scopeAllowedRoots = input.session.scope.allowedRepositoryRoots.map((rootPath) =>
    toCanonicalPath(rootPath),
  );
  const allowedRepositoryRoots = dedupePreservingOrder(scopeAllowedRoots);
  if (allowedRepositoryRoots.length === 0) {
    logWarn(logger, 'local.run_scope.workspace.resolve.scope_allowed_roots_empty', {
      ...getSessionLogFields(input.session),
    });
    return {
      ok: false,
      code: 'RUN_SCOPE_INVALID',
      message: `Run ${input.session.agentic_session_id} has no valid allowedRepositoryRoots.`,
    };
  }
  const includesBindingRoot = allowedRepositoryRoots.some((rootPath) =>
    isWithinRoot(bindingRepositoryPath, rootPath),
  );
  if (!includesBindingRoot) {
    logWarn(logger, 'local.run_scope.workspace.resolve.scope_excludes_binding_root', {
      ...getSessionLogFields(input.session),
      bindingRepositoryPath,
      allowedRepositoryRoots,
    });
    return {
      ok: false,
      code: 'RUN_SCOPE_INVALID',
      message: `Run ${input.session.agentic_session_id} scope excludes its service repository root.`,
    };
  }

  if (input.session.scope.mode === LOCAL_RUN_MODE.default) {
    const worktreeState = await resolveWorktreesForSession(input.session, servicePaths, logger);
    const launchWorktree = worktreeState
      ? selectLaunchWorktreeState(input.session, worktreeState)
      : null;
    const cwd = launchWorktree?.worktreePath ?? bindingRepositoryPath;
    const baseRoots = worktreeState
      ? replaceServiceRootsWithWorktrees(allowedRepositoryRoots, servicePaths, worktreeState)
      : [...allowedRepositoryRoots, ...serviceRepositoryPaths];
    const rootsWithWorktree = dedupePreservingOrder(baseRoots);

    logDebug(logger, 'local.run_scope.workspace.resolve.succeeded', {
      ...getSessionLogFields(input.session),
      runMode: 'default',
      cwd,
      repositoryPathForRunStarted: cwd,
      bindingRepositoryPath,
      allowedRepositoryRoots: rootsWithWorktree,
      worktreeServiceIds: worktreeState ? Object.keys(worktreeState) : [],
    });

    return {
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: cwd,
      cwd,
      allowedRepositoryRoots: rootsWithWorktree,
      bindingRepositoryPath,
      workspaceRoot: null,
      ...(worktreeState ? { worktree: worktreeState } : {}),
    };
  }

  if (
    input.session.scope.workspaceLayout !== undefined &&
    input.session.scope.workspaceLayout !== LOCAL_RUN_WORKSPACE_LAYOUT.symlinkTree
  ) {
    logWarn(logger, 'local.run_scope.workspace.resolve.incompatible_workspace_layout', {
      ...getSessionLogFields(input.session),
      workspaceLayout: input.session.scope.workspaceLayout,
    });
    return {
      ok: false,
      code: 'RUN_SCOPE_INVALID',
      message: `Run ${input.session.agentic_session_id} scope has incompatible workspaceLayout for cross-service review.`,
    };
  }

  const workspaceRootInput = readNonEmpty(input.session.scope.workspaceRoot);
  if (!workspaceRootInput) {
    logWarn(logger, 'local.run_scope.workspace.resolve.workspace_root_missing', {
      ...getSessionLogFields(input.session),
    });
    return {
      ok: false,
      code: 'RUN_SCOPE_INVALID',
      message: `Run ${input.session.agentic_session_id} scope is missing workspaceRoot for cross-service review.`,
    };
  }
  const workspaceRoot = toCanonicalPath(workspaceRootInput);

  logDebug(logger, 'local.run_scope.workspace.resolve.succeeded', {
    ...getSessionLogFields(input.session),
    runMode: 'cross_service_review',
    cwd: workspaceRoot,
    repositoryPathForRunStarted: workspaceRoot,
    bindingRepositoryPath,
    workspaceRoot,
    allowedRepositoryRoots,
    worktreeServiceIds: [],
  });

  return {
    ok: true,
    runMode: 'cross_service_review',
    repositoryPathForRunStarted: workspaceRoot,
    cwd: workspaceRoot,
    allowedRepositoryRoots,
    bindingRepositoryPath,
    workspaceRoot,
  };
};
