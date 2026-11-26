import { z } from 'zod';

import {
  AgentSessionServicePlaceKind,
  AgentSessionServicePlaceOutcome,
  type AttachAgentSessionServicePlaceDto,
  type ReportAgentSessionServicePlacesDto,
  type ReportedAgentSessionServicePlace,
} from '@hey-hey/contracts/api/models';
import type { ResolvedRunWorkspace } from '../agents/run-scope';
import type { SubmissionToolAuth } from '../agents/submission-tools/submission-tool-auth';
import type { KeyPairStore } from '../credentials/keypair';
import { readCheckedOutBranch } from '../git/worktree';
import type { RunStore } from '../run-store/run-store';
import type { ServerLogger } from '../server/logger';
import type { AgenticSession } from '../session/types';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

// The envelope is validated once; each result and recorded place is validated
// on its own so one malformed entry cannot hide its valid siblings.
const responseEnvelopeSchema = z.object({
  data: z.object({
    results: z.array(z.unknown()),
    session: z.object({ servicePlaces: z.array(z.unknown()).optional() }).optional(),
  }),
});
const placeResultSchema = z.object({
  serviceId: z.string().min(1),
  outcome: z.nativeEnum(AgentSessionServicePlaceOutcome),
});
const recordedPlaceSchema = z.object({
  serviceId: z.string().min(1),
  kind: z.nativeEnum(AgentSessionServicePlaceKind),
  branch: z.string().nullable(),
  worktreePath: z.string().optional(),
});
const serviceIdOnlySchema = z.object({ serviceId: z.string().min(1) });
const changedSessionSchema = z.object({
  data: z.object({ servicePlaces: z.array(z.unknown()).optional() }),
});

type RecordedPlace = z.infer<typeof recordedPlaceSchema>;

/** The worktree an approved attach request moves one Service into. */
export interface ApprovedPlaceChange {
  requestId: string;
  serviceId: string;
  branch: string;
  worktreePath: string;
}

/**
 * - moved: the platform now records the Service in the approved worktree.
 * - not_moved: the platform answered success but the Service works elsewhere, such as after a
 *   repeated delivery or a later attach; `recordedPlace` is where it works, if the answer said.
 */
export type PlaceChangeResult =
  | { status: 'moved' }
  | { status: 'not_moved'; recordedPlace: RecordedPlace | null };

interface ParsedResponse {
  outcomes: Map<string, AgentSessionServicePlaceOutcome>;
  recordedPlaces: Map<string, RecordedPlace>;
}

interface ServicePlaceReporterOptions {
  runId: string;
  organizationId: string;
  projectId: string;
  apiBaseUrl: string;
  auth: SubmissionToolAuth;
  fetchImpl: typeof fetch;
  keyPairStore: KeyPairStore;
  runStore: RunStore;
  logger: ServerLogger;
  session: () => AgenticSession;
  patchSession: (patch: Partial<AgenticSession>) => void;
  /** Upper bound for one delivery, covering authentication, the request and its body. */
  requestTimeoutMs?: number;
}

const issueSummaries = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

const rejectOnAbort = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error(String(signal.reason)));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });

/**
 * Tells the server where each of a Run's Services works, right after the CLI
 * resolved their folders. Places are captured at resolution time (reading the
 * main folder's branch, never changing it); delivery then runs on its own with
 * a deadline, so a slow server never holds up a turn or an approval. Each
 * observation is kept on the Run until delivery settles; a Service that fails
 * stays unreported and its original observation is resent on the next
 * resolution, including after a resume.
 */
export class ServicePlaceReporter {
  private readonly inFlightServiceIds = new Set<string>();
  private readonly deliveries = new Set<Promise<void>>();

  public constructor(private readonly options: ServicePlaceReporterOptions) {}

  /**
   * Captures places for Services not yet reported and starts delivery. Never
   * throws or waits on the network. A Service is reserved before the first
   * await, so overlapping calls cannot capture or send it twice.
   */
  public async report(workspace: ResolvedRunWorkspace): Promise<void> {
    const reserved = this.reserveUnreportedServices();
    await this.readMainFolderBranches(workspace);
    const places = await this.capturePlaces(reserved, workspace);
    if (places.length === 0) {
      return;
    }

    const delivery = this.deliver(places).finally(() => {
      for (const place of places) {
        this.inFlightServiceIds.delete(place.serviceId);
      }
      this.deliveries.delete(delivery);
    });
    this.deliveries.add(delivery);
  }

  /**
   * Records an approved attach through the place-change operation, never the launch report. The
   * place sent is the request's approved worktree, never a fresh observation of a folder. The
   * Service counts as reported only once the platform shows it in that worktree, which also drops
   * any launch observation still waiting, so the old place is never sent after the move. Throws
   * when the change cannot be delivered.
   */
  public async changePlace(change: ApprovedPlaceChange): Promise<PlaceChangeResult> {
    const { logger, runId } = this.options;
    const { serviceId } = change;

    // A launch report for this Service that is already on its way finishes first.
    await this.whenIdle();
    this.inFlightServiceIds.add(serviceId);
    try {
      const machineId = await this.options.keyPairStore.loadCurrentMachineId();
      if (!machineId) {
        throw new Error('Changing where a Service works requires a verified machine binding.');
      }

      logger.debug('local.run.service_places.change_sending', { runId, change });
      const recordedPlace = await this.sendChange(machineId, change);
      const moved =
        recordedPlace?.kind === AgentSessionServicePlaceKind.Worktree &&
        recordedPlace.branch === change.branch &&
        recordedPlace.worktreePath === change.worktreePath;
      if (!moved) {
        logger.warn('local.run.service_places.change_not_applied', {
          runId,
          change,
          recordedPlace,
        });
        return { status: 'not_moved', recordedPlace };
      }

      logger.info('local.run.service_places.changed', { runId, change });
      await this.markChangedServiceReported(serviceId);
      return { status: 'moved' };
    } finally {
      this.inFlightServiceIds.delete(serviceId);
    }
  }

  /**
   * Stops the launch report from ever sending this Service's old place. The platform has already
   * moved, so a failed Run store write is logged and never turns the move into a failure; this
   * process still stops resending, because its in-memory session is updated either way.
   */
  private async markChangedServiceReported(serviceId: string): Promise<void> {
    const { logger, runId } = this.options;
    try {
      const updated = await this.options.runStore.markServicePlacesReported(runId, [serviceId]);
      this.options.patchSession({
        reportedServicePlaceServiceIds: updated.reportedServicePlaceServiceIds ?? [serviceId],
        capturedServicePlaces: updated.capturedServicePlaces ?? [],
      });
    } catch (error) {
      logger.warn('local.run.service_places.change_mark_reported_failed', {
        runId,
        serviceId,
        error,
      });
      const session = this.options.session();
      this.options.patchSession({
        reportedServicePlaceServiceIds: Array.from(
          new Set([...(session.reportedServicePlaceServiceIds ?? []), serviceId]),
        ),
        capturedServicePlaces: (session.capturedServicePlaces ?? []).filter(
          (place) => place.serviceId !== serviceId,
        ),
      });
    }
  }

  private async sendChange(
    machineId: string,
    change: ApprovedPlaceChange,
  ): Promise<RecordedPlace | null> {
    const { apiBaseUrl, organizationId, projectId, runId } = this.options;
    const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(new Error(`Service place change timed out after ${String(timeoutMs)}ms`)),
      timeoutMs,
    );

    try {
      const exchange = (async (): Promise<unknown> => {
        const accessToken = await this.options.auth.getAccessToken();
        const baseUrl = apiBaseUrl.replace(/\/$/u, '');
        const url = `${baseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/agent-sessions/${encodeURIComponent(runId)}/service-places/attach`;
        const body = {
          machineId,
          serviceId: change.serviceId,
          branch: change.branch,
          worktreePath: change.worktreePath,
          requestId: change.requestId,
        } satisfies AttachAgentSessionServicePlaceDto;
        const response = await this.options.fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = (await response.text()).trim().replace(/\s+/gu, ' ').slice(0, 500);
          throw new Error(
            `Recording the new place failed with status ${String(response.status)}${detail ? `: ${detail}` : '.'}`,
          );
        }
        return response.json();
      })();
      const payload = await rejectOnAbort(exchange, controller.signal);

      return this.parseChangedPlace(payload, change.serviceId);
    } finally {
      clearTimeout(timer);
    }
  }

  private parseChangedPlace(payload: unknown, serviceId: string): RecordedPlace | null {
    const envelope = changedSessionSchema.safeParse(payload);
    if (!envelope.success) {
      throw new Error(
        `Recording the new place returned an invalid response: ${issueSummaries(envelope.error).join('; ')}`,
      );
    }

    for (const item of envelope.data.data.servicePlaces ?? []) {
      const recorded = recordedPlaceSchema.safeParse(item);
      if (recorded.success && recorded.data.serviceId === serviceId) {
        return recorded.data;
      }
    }
    this.options.logger.warn('local.run.service_places.change_place_missing', {
      runId: this.options.runId,
      serviceId,
    });
    return null;
  }

  /** Resolves once every started delivery has finished. */
  public async whenIdle(): Promise<void> {
    await Promise.all([...this.deliveries]);
  }

  /**
   * Keeps the branch of each Service working in its main folder on the Run, read
   * once, so prompts and worktree-attach requests name it without asking git
   * again. A failed read is logged and retried at the next resolution.
   */
  private async readMainFolderBranches(workspace: ResolvedRunWorkspace): Promise<void> {
    const { logger, runId } = this.options;

    for (const { id: serviceId } of this.options.session().services) {
      const repositoryPath = workspace.servicePaths?.[serviceId];
      const alreadyRead = this.options.session().mainFolderBranches?.[serviceId] !== undefined;
      if (workspace.worktree?.[serviceId] || !repositoryPath || alreadyRead) {
        continue;
      }

      try {
        const branch = await readCheckedOutBranch(repositoryPath);
        this.options.patchSession({
          mainFolderBranches: {
            ...this.options.session().mainFolderBranches,
            [serviceId]: branch,
          },
        });
        logger.debug('local.run.active_places.main_folder_branch_read', {
          runId,
          serviceId,
          branch,
        });
      } catch (error) {
        logger.warn('local.run.active_places.branch_read_failed', { runId, serviceId, error });
      }
    }
  }

  private reserveUnreportedServices(): AgenticSession['services'] {
    const { logger, runId } = this.options;
    const session = this.options.session();
    const alreadyReported = new Set(session.reportedServicePlaceServiceIds ?? []);
    const reserved: AgenticSession['services'] = [];

    for (const service of session.services) {
      if (alreadyReported.has(service.id)) {
        logger.debug('local.run.service_places.skipped_already_reported', {
          runId,
          serviceId: service.id,
        });
        continue;
      }
      if (this.inFlightServiceIds.has(service.id)) {
        logger.debug('local.run.service_places.skipped_in_flight', {
          runId,
          serviceId: service.id,
        });
        continue;
      }

      this.inFlightServiceIds.add(service.id);
      reserved.push(service);
    }

    return reserved;
  }

  /**
   * The place to send for each reserved Service: the one captured when it was
   * first resolved if delivery has not settled yet, otherwise a fresh
   * observation, which is retained before it is sent.
   */
  private async capturePlaces(
    reserved: AgenticSession['services'],
    workspace: ResolvedRunWorkspace,
  ): Promise<ReportedAgentSessionServicePlace[]> {
    const { logger, runId } = this.options;
    const retained = new Map(
      (this.options.session().capturedServicePlaces ?? []).map((place) => [place.serviceId, place]),
    );
    const places: ReportedAgentSessionServicePlace[] = [];
    const observed: ReportedAgentSessionServicePlace[] = [];

    try {
      for (const service of reserved) {
        const kept = retained.get(service.id);
        if (kept) {
          logger.debug('local.run.service_places.reusing_captured', { runId, place: kept });
          places.push(kept);
          continue;
        }

        const place = await this.buildPlace(service.id, workspace);
        if (place) {
          places.push(place);
          observed.push(place);
        } else {
          this.inFlightServiceIds.delete(service.id);
        }
      }
    } catch (error) {
      logger.warn('local.run.service_places.build_failed', { runId, error });
      const captured = new Set(places.map((place) => place.serviceId));
      for (const service of reserved) {
        if (!captured.has(service.id)) {
          this.inFlightServiceIds.delete(service.id);
        }
      }
    }

    if (observed.length > 0) {
      await this.retain(observed);
    }

    return places;
  }

  private async retain(observed: ReportedAgentSessionServicePlace[]): Promise<void> {
    const { logger, runId } = this.options;
    const current = this.options.session().capturedServicePlaces ?? [];
    // Kept in memory first, so a retry in this process resends the observation
    // even when the Run store cannot be written.
    this.options.patchSession({ capturedServicePlaces: [...current, ...observed] });

    try {
      await this.options.runStore.recordCapturedServicePlaces(runId, observed);
    } catch (error) {
      logger.warn('local.run.service_places.capture_persist_failed', {
        runId,
        serviceIds: observed.map((place) => place.serviceId),
        error,
      });
    }
  }

  private async buildPlace(
    serviceId: string,
    workspace: ResolvedRunWorkspace,
  ): Promise<ReportedAgentSessionServicePlace | null> {
    const { logger, runId } = this.options;
    const worktree = workspace.worktree?.[serviceId];
    if (worktree) {
      const place = {
        serviceId,
        kind: AgentSessionServicePlaceKind.Worktree,
        branch: worktree.branch,
        worktreePath: worktree.worktreePath,
      } satisfies ReportedAgentSessionServicePlace;
      logger.debug('local.run.service_places.built', { runId, place });

      return place;
    }

    try {
      const repositoryPath = workspace.servicePaths?.[serviceId];
      if (!repositoryPath) {
        logger.warn('local.run.service_places.folder_unresolved', { runId, serviceId });

        return null;
      }

      const known = this.options.session().mainFolderBranches?.[serviceId];
      const branch = known !== undefined ? known : await readCheckedOutBranch(repositoryPath);
      const place = {
        serviceId,
        kind: AgentSessionServicePlaceKind.MainFolder,
        branch,
      } satisfies ReportedAgentSessionServicePlace;
      logger.debug('local.run.service_places.built', { runId, place });

      return place;
    } catch (error) {
      logger.warn('local.run.service_places.branch_read_failed', { runId, serviceId, error });

      return null;
    }
  }

  private async deliver(places: ReportedAgentSessionServicePlace[]): Promise<void> {
    const { logger, runId } = this.options;
    const serviceIds = places.map((place) => place.serviceId);
    const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(new Error(`Service place report timed out after ${String(timeoutMs)}ms`)),
      timeoutMs,
    );

    try {
      const machineId = await this.options.keyPairStore.loadCurrentMachineId();
      if (!machineId) {
        logger.warn('local.run.service_places.machine_binding_missing', { runId, serviceIds });

        return;
      }

      logger.debug('local.run.service_places.sending', { runId, places });
      const exchange = this.send(machineId, places, controller.signal);
      const response = await rejectOnAbort(exchange, controller.signal);
      await this.settle(places, response);
    } catch (error) {
      logger.warn('local.run.service_places.report_failed', { runId, serviceIds, error });
    } finally {
      clearTimeout(timer);
    }
  }

  private async send(
    machineId: string,
    places: ReportedAgentSessionServicePlace[],
    signal: AbortSignal,
  ): Promise<ParsedResponse> {
    const { apiBaseUrl, organizationId, projectId, runId } = this.options;
    const accessToken = await this.options.auth.getAccessToken();
    const baseUrl = apiBaseUrl.replace(/\/$/u, '');
    const url = `${baseUrl}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/agent-sessions/${encodeURIComponent(runId)}/service-places`;
    const body = { machineId, places } satisfies ReportAgentSessionServicePlacesDto;

    const response = await this.options.fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).trim().replace(/\s+/gu, ' ').slice(0, 500);
      throw new Error(
        `Service place report failed with status ${String(response.status)}: ${detail}`,
      );
    }

    return this.parseResponse(await response.json());
  }

  private parseResponse(payload: unknown): ParsedResponse {
    const { logger, runId } = this.options;
    const envelope = responseEnvelopeSchema.safeParse(payload);
    if (!envelope.success) {
      throw new Error(
        `Service place report returned an invalid response: ${issueSummaries(envelope.error).join('; ')}`,
      );
    }

    const outcomes = new Map<string, AgentSessionServicePlaceOutcome>();
    for (const item of envelope.data.data.results) {
      const result = placeResultSchema.safeParse(item);
      if (result.success) {
        outcomes.set(result.data.serviceId, result.data.outcome);
        continue;
      }
      logger.warn('local.run.service_places.result_invalid', {
        runId,
        serviceId: serviceIdOnlySchema.safeParse(item).data?.serviceId ?? null,
        issues: issueSummaries(result.error),
      });
    }

    const recordedPlaces = new Map<string, RecordedPlace>();
    for (const item of envelope.data.data.session?.servicePlaces ?? []) {
      const recorded = recordedPlaceSchema.safeParse(item);
      if (recorded.success) {
        recordedPlaces.set(recorded.data.serviceId, recorded.data);
      }
    }

    return { outcomes, recordedPlaces };
  }

  private async settle(
    places: ReportedAgentSessionServicePlace[],
    response: ParsedResponse,
  ): Promise<void> {
    const { logger, runId } = this.options;
    const reported: string[] = [];

    for (const place of places) {
      const serviceId = place.serviceId;
      const outcome = response.outcomes.get(serviceId);
      if (outcome === undefined) {
        logger.warn('local.run.service_places.result_missing', { runId, serviceId });
        continue;
      }

      if (outcome === AgentSessionServicePlaceOutcome.NotMember) {
        logger.warn('local.run.service_places.not_member', { runId, serviceId });
        continue;
      }

      if (outcome === AgentSessionServicePlaceOutcome.Conflict) {
        logger.warn('local.run.service_places.conflict', {
          runId,
          serviceId,
          reportedPlace: place,
          existingPlace: response.recordedPlaces.get(serviceId) ?? null,
        });
      } else {
        logger.debug(
          outcome === AgentSessionServicePlaceOutcome.Recorded
            ? 'local.run.service_places.recorded'
            : 'local.run.service_places.already_recorded',
          { runId, serviceId },
        );
      }
      reported.push(serviceId);
    }
    if (reported.length === 0) {
      return;
    }

    const updated = await this.options.runStore.markServicePlacesReported(runId, reported);
    const settled = new Set(reported);
    const stillCaptured = (this.options.session().capturedServicePlaces ?? []).filter(
      (place) => !settled.has(place.serviceId),
    );
    this.options.patchSession({
      reportedServicePlaceServiceIds: updated.reportedServicePlaceServiceIds ?? reported,
      capturedServicePlaces: stillCaptured,
    });
  }
}
