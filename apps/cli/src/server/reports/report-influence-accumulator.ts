import type { ServerLogger } from '../logger';
import type { PlatformWebSocketEvent } from '../platform-ws';
import {
  ReportUpdateDispatcher,
  type ReportUpdateDispatcherOptions,
} from './dispatch-report-update';
import {
  entityKey,
  parseEntityKey,
  type EntityReportIndex,
  type EntityRef,
} from './entity-report-index';

/**
 * Rounded 50% threshold. Matches the examples in the spec:
 * 1 of 2, 2 of 3, 2 of 4, 3 of 5, 3 of 6.
 */
export const computeReportUpdateThreshold = (totalRefs: number): number => {
  if (totalRefs <= 0) return 0;
  return Math.ceil(totalRefs / 2);
};

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * Derive zero or more entity refs from a platform event. A single event can
 * reference multiple entities (e.g. an agent session event with both an
 * agentSessionId and a taskId); we emit one ref per identifier so the index
 * lookup catches all of them.
 *
 * TODO: this field-by-field extraction should live in the normalizer layer
 * once platform-ws events carry typed payloads. Tracked as a follow-up.
 */
export const extractEntityRefsFromEvent = (event: PlatformWebSocketEvent): EntityRef[] => {
  const refs: EntityRef[] = [];
  const taskId = readString(event['taskId']);
  if (taskId) refs.push({ entityType: 'TASK', entityId: taskId });
  const agentSessionId =
    readString(event['agentSessionId']) ?? readString(event['agent_session_id']);
  if (agentSessionId) {
    refs.push({ entityType: 'AGENT_SESSION', entityId: agentSessionId });
  }
  const featureId = readString(event['featureId']);
  if (featureId) refs.push({ entityType: 'FEATURE', entityId: featureId });
  const initiativeId = readString(event['initiativeId']);
  if (initiativeId) refs.push({ entityType: 'INITIATIVE', entityId: initiativeId });
  const designDocId = readString(event['designDocId']);
  if (designDocId) refs.push({ entityType: 'DESIGN_DOC', entityId: designDocId });
  const serviceId = readString(event['serviceId']);
  if (serviceId) refs.push({ entityType: 'SERVICE', entityId: serviceId });
  const planId = readString(event['planId']);
  if (planId) refs.push({ entityType: 'TASK', entityId: planId });
  return refs;
};

export interface ReportInfluenceDispatchInput {
  reportId: string;
  /** Entity refs that triggered the update. */
  changedEntities: EntityRef[];
  /** The raw platform events that triggered the update, in arrival order. */
  events: PlatformWebSocketEvent[];
  /** Total refs the report was registered with at dispatch time. */
  totalReferencedEntities: number;
}

export interface ReportInfluenceAccumulatorOptions extends ReportUpdateDispatcherOptions {
  index: EntityReportIndex;
}

interface ReportState {
  /** Entity keys (entityType:entityId) observed since the last dispatch. */
  changed: Set<string>;
  /** Raw events since the last dispatch, in arrival order. */
  events: PlatformWebSocketEvent[];
  /**
   * RunId of the in-flight update for this report, or null when idle.
   * Set by `bindRunId` after the dispatcher creates the run; cleared by
   * `onRunFinished` when the run completes or by `onUpdateFailed` on error.
   */
  inFlightRunId: string | null;
  /**
   * True between the threshold firing and either a runId being bound or
   * the dispatch failing. Blocks re-entry during the async gap so a burst
   * of events cannot queue two concurrent updates for the same report.
   */
  dispatching: boolean;
}

export class ReportInfluenceAccumulator {
  private readonly index: EntityReportIndex;
  private readonly dispatcher: ReportUpdateDispatcher;
  private readonly logger: ServerLogger;
  private readonly reportStates = new Map<string, ReportState>();
  private readonly runIdToReportId = new Map<string, string>();

  public constructor(options: ReportInfluenceAccumulatorOptions) {
    this.index = options.index;
    this.dispatcher = new ReportUpdateDispatcher({
      apiBaseUrl: options.apiBaseUrl,
      fetchImpl: options.fetchImpl,
      authContext: options.authContext,
      runStore: options.runStore,
      agentService: options.agentService,
      logger: options.logger,
    });
    this.logger = options.logger;
  }

  private getState(reportId: string): ReportState {
    let state = this.reportStates.get(reportId);
    if (!state) {
      state = {
        changed: new Set<string>(),
        events: [],
        inFlightRunId: null,
        dispatching: false,
      };
      this.reportStates.set(reportId, state);
    }
    return state;
  }

  private isInFlight(state: ReportState): boolean {
    return state.dispatching || state.inFlightRunId !== null;
  }

  /** Feed a platform event in. Returns the list of reportIds dispatched. */
  public handleEvent(event: PlatformWebSocketEvent): string[] {
    const refs = extractEntityRefsFromEvent(event);
    if (refs.length === 0) return [];

    // Find every report impacted by any ref in this event, de-duplicated.
    const impactedReports = new Set<string>();
    const refsPerReport = new Map<string, EntityRef[]>();
    for (const ref of refs) {
      const reportIds = this.index.lookupReports(ref.entityType, ref.entityId);
      for (const reportId of reportIds) {
        impactedReports.add(reportId);
        let list = refsPerReport.get(reportId);
        if (!list) {
          list = [];
          refsPerReport.set(reportId, list);
        }
        list.push(ref);
      }
    }

    if (impactedReports.size === 0) return [];

    const dispatchedReportIds: string[] = [];
    for (const reportId of impactedReports) {
      const state = this.getState(reportId);
      if (this.isInFlight(state)) {
        this.logger.debug('report-update.accumulator.skip-in-flight', {
          reportId,
          eventType: event.type,
          inFlightRunId: state.inFlightRunId,
          dispatching: state.dispatching,
        });
        continue;
      }

      let newChanged = false;
      const matchingRefs = refsPerReport.get(reportId) ?? [];
      for (const ref of matchingRefs) {
        const key = entityKey(ref.entityType, ref.entityId);
        if (!state.changed.has(key)) {
          state.changed.add(key);
          newChanged = true;
        }
      }

      if (!newChanged) {
        this.logger.debug('report-update.accumulator.duplicate', {
          reportId,
          eventType: event.type,
        });
        continue;
      }

      state.events.push(event);
      const totalRefs = this.index.getReferencedEntityCount(reportId);
      const threshold = computeReportUpdateThreshold(totalRefs);
      this.logger.debug('report-update.accumulator.accumulated', {
        reportId,
        eventType: event.type,
        changedCount: state.changed.size,
        totalRefs,
        threshold,
      });

      if (totalRefs > 0 && state.changed.size >= threshold) {
        const changedEntities: EntityRef[] = [];
        for (const key of state.changed) {
          changedEntities.push(parseEntityKey(key));
        }
        const events = state.events.slice();

        state.changed.clear();
        state.events = [];
        state.dispatching = true;

        this.logger.debug('report-update.accumulator.threshold-reached', {
          reportId,
          changedCount: changedEntities.length,
          totalRefs,
          threshold,
        });

        dispatchedReportIds.push(reportId);
        // The concrete dispatcher returns the created run id. The accumulator
        // owns the in-flight transition instead of asking the dispatcher to
        // call back into it through renamed dependency fields.
        void Promise.resolve()
          .then(() =>
            this.dispatcher.dispatch({
              reportId,
              changedEntities,
              events,
              totalReferencedEntities: totalRefs,
            }),
          )
          .then((runId) => {
            if (runId) {
              this.bindRunId(reportId, runId);
              return;
            }
            this.onUpdateFailed(reportId);
          })
          .catch((error: unknown) => {
            this.logger.error('report-update.accumulator.dispatch-failed', {
              reportId,
              error: error instanceof Error ? error.message : String(error),
            });
            this.onUpdateFailed(reportId);
          });
      }
    }

    return dispatchedReportIds;
  }

  public bindRunId(reportId: string, runId: string): void {
    const state = this.reportStates.get(reportId);
    if (!state) return;
    state.dispatching = false;
    state.inFlightRunId = runId;
    this.runIdToReportId.set(runId, reportId);
    this.logger.debug('report-update.accumulator.run-bound', { reportId, runId });
  }

  private releaseReport(reportId: string): void {
    const state = this.reportStates.get(reportId);
    if (!state) return;
    if (state.inFlightRunId) this.runIdToReportId.delete(state.inFlightRunId);
    state.inFlightRunId = null;
    state.dispatching = false;
  }

  public onRunFinished(runId: string): void {
    const reportId = this.runIdToReportId.get(runId);
    if (!reportId) return;
    this.releaseReport(reportId);
    this.logger.debug('report-update.accumulator.run-finished', { runId, reportId });
  }

  public onUpdateFailed(reportId: string): void {
    this.releaseReport(reportId);
    this.logger.debug('report-update.accumulator.update-failed', { reportId });
  }

  public peekAccumulated(): Record<string, EntityRef[]> {
    const out: Record<string, EntityRef[]> = {};
    for (const [reportId, state] of this.reportStates) {
      const refs: EntityRef[] = [];
      for (const key of state.changed) {
        refs.push(parseEntityKey(key));
      }
      out[reportId] = refs;
    }
    return out;
  }
}
