import { Injectable, Logger } from '@nestjs/common';
import { Prisma, EntityType } from '@prisma/client';
import type {
  AttentionItemSummary,
  AttentionSummaryEntity,
  AttentionSummaryResponse,
  AttentionSwitchSummary,
  AttentionTimelineSpan,
} from '@hey-hey/contracts/api/models';
import { ProjectAccessService } from '../../auth/services/project-access.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ReadVisibilityService } from '../../read-restriction/read-visibility.service';
import { LEGACY_ENTITY_TYPE_MAP } from './attention-event.service';

const DAY_MS = 86_400_000;
const WINDOW_MS = 7 * DAY_MS;
const TIMELINE_MS = 2 * DAY_MS;
/** Views no further apart than this are adjacent: one timeline span, or a switch. */
const ADJACENT_MS = 10 * 60_000;
const MIN_SWITCHES = 2;
const MAX_SWITCH_PAIRS = 50;
const MAX_TIMELINE_SPANS = 100;

export interface AttentionSummaryQuery {
  projectId: string;
  entityTypes?: readonly string[];
}

interface SummaryScope extends AttentionSummaryQuery {
  organizationId: string;
  userId: string;
  since: Date;
  todayStartsAt: Date;
  recentSince: Date;
  asOf: Date;
}

interface ItemRow {
  entityType: AttentionSummaryEntity['entityType'];
  entityId: string;
  entityName: string;
  lastViewed: Date;
  viewsToday: number;
  viewsSevenDays: number;
  focusMsSevenDays: number;
}

interface UnreadableRow {
  problem: 'unsupported_entity_type' | 'invalid_focus_interval';
  storedType: string;
  records: number;
}

interface SwitchRow {
  firstKey: string;
  secondKey: string;
  occurrences: number;
}

interface SpanRow {
  key: string;
  start: Date;
  end: Date;
  focusMs: number;
  views: number;
}

/**
 * A window boundary comparable with the UTC `timestamp` columns. A bound Date arrives as
 * `timestamptz`, which PostgreSQL would shift into the database session's time zone.
 */
const utc = (instant: Date): Prisma.Sql =>
  Prisma.sql`${instant.toISOString()}::text::timestamp`;

const entityKey = (entity: Pick<ItemRow, 'entityType' | 'entityId'>): string =>
  `${entity.entityType}:${entity.entityId}`;

/**
 * Counts one user's attention in a project. PostgreSQL does the counting over the whole
 * window, so every record is counted exactly once and no raw record leaves the database.
 */
@Injectable()
export class AttentionSummaryService {
  private readonly logger = new Logger(AttentionSummaryService.name);

  private readonly visibility: ReadVisibilityService;

  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly prisma: PrismaService,
  ) {
    this.visibility = new ReadVisibilityService(prisma);
  }

  async summarize(
    user: AuthenticatedUser,
    query: AttentionSummaryQuery,
  ): Promise<AttentionSummaryResponse> {
    await this.projectAccess.assertProject(
      user.userId,
      user.currentOrgId,
      query.projectId,
    );
    const scope = this.scopeFor(user, query, new Date());

    try {
      const unreadableRecords = await this.countUnreadable(scope);
      const items = await this.visibility.filterVisible(
        await this.countItems(scope),
        (item) => item,
      );
      // Switches and spans are built only from the counted, visible items, so a hidden
      // or late-arriving record can never appear in them.
      const keys = items.map(entityKey);
      const [switches, spans] =
        keys.length > 0
          ? await Promise.all([
              this.findSwitches(scope, keys),
              this.buildTimeline(scope, keys),
            ])
          : [[], []];

      const entities = new Map<string, AttentionSummaryEntity>(
        items.map(({ entityType, entityId, entityName }) => [
          entityKey({ entityType, entityId }),
          { entityType, entityId, entityName },
        ]),
      );

      this.logger.debug(
        `Summarized attention for user ${user.userId} in project ${query.projectId}: ` +
          `${items.length} items, ${switches.length} switch pairs, ${spans.length} spans, ${unreadableRecords} unreadable records`,
      );

      return {
        since: scope.since.toISOString(),
        todayStartsAt: scope.todayStartsAt.toISOString(),
        asOf: scope.asOf.toISOString(),
        items: items.map((item) => this.toItem(item, entities)),
        switches: switches
          .slice(0, MAX_SWITCH_PAIRS)
          .map((row) => this.toSwitch(row, entities)),
        // Rows arrive newest first so the limit keeps the latest spans.
        timeline: spans
          .slice(0, MAX_TIMELINE_SPANS)
          .reverse()
          .map((row) => this.toSpan(row, entities)),
        truncated: {
          switches: switches.length > MAX_SWITCH_PAIRS,
          timeline: spans.length > MAX_TIMELINE_SPANS,
        },
        unreadableRecords,
      };
    } catch (error) {
      this.logger.error(
        `Failed to summarize attention for user ${user.userId} in project ${query.projectId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  private scopeFor(
    user: AuthenticatedUser,
    query: AttentionSummaryQuery,
    asOf: Date,
  ): SummaryScope {
    return {
      ...query,
      organizationId: user.currentOrgId,
      userId: user.userId,
      since: new Date(asOf.getTime() - WINDOW_MS),
      todayStartsAt: new Date(Math.floor(asOf.getTime() / DAY_MS) * DAY_MS),
      recentSince: new Date(asOf.getTime() - TIMELINE_MS),
      asOf,
    };
  }

  /**
   * The window's records as `checked`, each marked with why it cannot be counted, and the
   * countable ones for the requested types as `readable`.
   */
  private records(scope: SummaryScope): Prisma.Sql {
    const legacyTypes = Prisma.join(
      Object.entries(LEGACY_ENTITY_TYPE_MAP).map(
        ([legacy, current]) =>
          Prisma.sql`WHEN ${legacy} THEN ${current as string}`,
      ),
      ' ',
    );

    return Prisma.sql`
      WITH stored AS (
        SELECT id, entity_id, focus_start, focus_end, duration_ms,
          upper(replace(btrim(entity_type), '-', '_')) AS stored_type
        FROM attention_events
        WHERE organization_id = ${scope.organizationId}
          AND user_id = ${scope.userId}
          -- A UUID column, unlike what the Prisma model says.
          AND project_id = ${scope.projectId}::uuid
          AND focus_end >= ${utc(scope.since)}
          AND focus_start <= ${utc(scope.asOf)}
      ),
      typed AS (
        SELECT *, CASE stored_type ${legacyTypes} ELSE stored_type END AS entity_type
        FROM stored
      ),
      checked AS (
        SELECT *, CASE
          WHEN entity_type NOT IN (${Prisma.join(Object.values(EntityType))})
            THEN 'unsupported_entity_type'
          WHEN duration_ms < 0
            OR duration_ms > EXTRACT(EPOCH FROM (focus_end - focus_start)) * 1000
            THEN 'invalid_focus_interval'
        END AS problem
        FROM typed
      ),
      readable AS (
        SELECT id, entity_type, entity_id, focus_start, focus_end, duration_ms,
          (entity_type || ':' || entity_id) COLLATE "C" AS key,
          LEAST(focus_end, ${utc(scope.asOf)}) AS counted_end
        FROM checked
        WHERE problem IS NULL AND ${this.requestedType(scope)}
      )`;
  }

  private requestedType(scope: SummaryScope): Prisma.Sql {
    return scope.entityTypes?.length
      ? Prisma.sql`entity_type IN (${Prisma.join([...scope.entityTypes])})`
      : Prisma.sql`TRUE`;
  }

  /** Focus time of a `readable` record that falls between `from` and the end of the window. */
  private focusMsFrom(from: Date): Prisma.Sql {
    return Prisma.sql`LEAST(
      duration_ms,
      GREATEST(0, EXTRACT(EPOCH FROM (counted_end - GREATEST(focus_start, ${utc(from)}))) * 1000)
    )`;
  }

  private async countUnreadable(scope: SummaryScope): Promise<number> {
    const rows = await this.prisma.db.$queryRaw<UnreadableRow[]>`
      ${this.records(scope)}
      SELECT problem, stored_type AS "storedType", COUNT(*)::int AS records
      FROM checked
      WHERE problem = 'unsupported_entity_type'
        OR (problem IS NOT NULL AND ${this.requestedType(scope)})
      GROUP BY problem, stored_type`;

    if (rows.length > 0) {
      const reasons = rows
        .map((row) => `${row.problem} (${row.storedType}): ${row.records}`)
        .join(', ');
      this.logger.warn(
        `Left unreadable attention records out of the summary for user ${scope.userId} in project ${scope.projectId}: ${reasons}`,
      );
    }

    return rows.reduce((total, row) => total + row.records, 0);
  }

  private countItems(scope: SummaryScope): Promise<ItemRow[]> {
    return this.prisma.db.$queryRaw<ItemRow[]>`
      ${this.records(scope)},
      counted AS (
        SELECT entity_type, entity_id, key,
          MAX(focus_start) AS last_viewed,
          COUNT(*) FILTER (WHERE focus_start >= ${utc(scope.todayStartsAt)})::int AS views_today,
          COUNT(*) FILTER (WHERE focus_start >= ${utc(scope.since)})::int AS views_seven_days,
          FLOOR(SUM(${this.focusMsFrom(scope.since)}))::float8 AS focus_ms
        FROM readable
        GROUP BY entity_type, entity_id, key
      )
      SELECT counted.entity_type AS "entityType",
        counted.entity_id AS "entityId",
        COALESCE(NULLIF(registry.entity_name, ''), 'Unknown') AS "entityName",
        counted.last_viewed AS "lastViewed",
        counted.views_today AS "viewsToday",
        counted.views_seven_days AS "viewsSevenDays",
        counted.focus_ms AS "focusMsSevenDays"
      FROM counted
      LEFT JOIN entity_registry registry
        ON registry.organization_id = ${scope.organizationId}
        AND registry.entity_id = counted.entity_id
        AND registry.entity_type::text = counted.entity_type
      ORDER BY counted.last_viewed DESC, counted.key`;
  }

  /** Pairs of items the user moved between: each record against the one before it. */
  private findSwitches(
    scope: SummaryScope,
    keys: string[],
  ): Promise<SwitchRow[]> {
    return this.prisma.db.$queryRaw<SwitchRow[]>`
      ${this.records(scope)},
      ordered AS (
        SELECT key, focus_start,
          LAG(key) OVER chronological AS previous_key,
          LAG(focus_end) OVER chronological AS previous_end
        FROM readable
        WHERE key = ANY(${keys})
        WINDOW chronological AS (ORDER BY focus_start, id)
      )
      SELECT LEAST(key, previous_key) AS "firstKey",
        GREATEST(key, previous_key) AS "secondKey",
        COUNT(*)::int AS occurrences
      FROM ordered
      WHERE previous_key <> key
        AND EXTRACT(EPOCH FROM (focus_start - previous_end)) * 1000 <= ${ADJACENT_MS}
      GROUP BY 1, 2
      HAVING COUNT(*) >= ${MIN_SWITCHES}
      ORDER BY occurrences DESC, "firstKey", "secondKey"
      LIMIT ${MAX_SWITCH_PAIRS + 1}`;
  }

  /**
   * Recent focus as spans. A run is consecutive records of one item; a run splits into
   * spans wherever a record starts more than the adjacency gap after the span so far.
   */
  private buildTimeline(
    scope: SummaryScope,
    keys: string[],
  ): Promise<SpanRow[]> {
    return this.prisma.db.$queryRaw<SpanRow[]>`
      ${this.records(scope)},
      recent AS (
        SELECT id, key, focus_start,
          GREATEST(focus_start, ${utc(scope.recentSince)}) AS span_start,
          counted_end AS span_end,
          ${this.focusMsFrom(scope.recentSince)} AS focus_ms
        FROM readable
        WHERE key = ANY(${keys}) AND counted_end >= ${utc(scope.recentSince)}
      ),
      marked AS (
        SELECT *, CASE WHEN key = LAG(key) OVER chronological THEN 0 ELSE 1 END AS starts_run
        FROM recent
        WINDOW chronological AS (ORDER BY focus_start, id)
      ),
      runs AS (
        SELECT *, SUM(starts_run) OVER (ORDER BY focus_start, id) AS run
        FROM marked
      ),
      gaps AS (
        SELECT *, CASE WHEN EXTRACT(EPOCH FROM (
            span_start - MAX(span_end) OVER (
              PARTITION BY run ORDER BY focus_start, id
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            )
          )) * 1000 <= ${ADJACENT_MS} THEN 0 ELSE 1 END AS starts_span
        FROM runs
      ),
      spans AS (
        SELECT *, SUM(starts_span) OVER (ORDER BY focus_start, id) AS span
        FROM gaps
      )
      SELECT key,
        MIN(span_start) AS start,
        MAX(span_end) AS "end",
        FLOOR(SUM(focus_ms))::float8 AS "focusMs",
        COUNT(*)::int AS views
      FROM spans
      GROUP BY span, key
      ORDER BY span DESC
      LIMIT ${MAX_TIMELINE_SPANS + 1}`;
  }

  private toItem(
    row: ItemRow,
    entities: ReadonlyMap<string, AttentionSummaryEntity>,
  ): AttentionItemSummary {
    return {
      entity: entities.get(entityKey(row))!,
      lastViewed: row.lastViewed.toISOString(),
      viewsToday: row.viewsToday,
      viewsSevenDays: row.viewsSevenDays,
      focusMsSevenDays: row.focusMsSevenDays,
    };
  }

  private toSwitch(
    row: SwitchRow,
    entities: ReadonlyMap<string, AttentionSummaryEntity>,
  ): AttentionSwitchSummary {
    return {
      entities: [entities.get(row.firstKey)!, entities.get(row.secondKey)!],
      occurrences: row.occurrences,
    };
  }

  private toSpan(
    row: SpanRow,
    entities: ReadonlyMap<string, AttentionSummaryEntity>,
  ): AttentionTimelineSpan {
    return {
      entity: entities.get(row.key)!,
      start: row.start.toISOString(),
      end: row.end.toISOString(),
      focusMs: row.focusMs,
      views: row.views,
    };
  }
}
