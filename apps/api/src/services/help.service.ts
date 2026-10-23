import { InternalServerErrorException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validate as isUuid } from 'uuid';
import {
  HelpDemo,
  HelpDemoDsl,
  HelpDemoPreset,
  HelpNodeWithBody,
  HelpSearchResponse,
  HelpSearchResult,
  HelpTreeResponse,
} from 'src/generated';
import { PrismaService } from '../prisma/prisma.service';
import { buildHelpTreeItems } from './help-tree.util';

type HelpNodeWithDemosRow = Prisma.HelpNodeGetPayload<{
  include: { demos: true };
}>;

type HelpSearchRow = {
  id: string;
  slug: string;
  title: string;
  snippet: string | null;
  rank: number | string;
};

@Injectable()
export class HelpService {
  constructor(private readonly prisma: PrismaService) {}

  async getTree(): Promise<HelpTreeResponse> {
    const rows = await this.prisma.helpNode.findMany({
      select: {
        id: true,
        parentId: true,
        slug: true,
        title: true,
        ordering: true,
      },
    });

    return {
      items: buildHelpTreeItems(rows),
    } satisfies HelpTreeResponse;
  }

  async searchHelpNodes(
    query: string,
    maxResults = 10,
  ): Promise<HelpSearchResponse> {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length === 0) {
      return {
        results: [],
      } satisfies HelpSearchResponse;
    }

    const rows = await this.prisma.$queryRaw<HelpSearchRow[]>(Prisma.sql`
      WITH search_input AS (
        SELECT websearch_to_tsquery('english', ${trimmedQuery}) AS query
      ),
      ranked_help_nodes AS (
        SELECT
          hn.id,
          hn.slug,
          hn.title,
          hn.body,
          si.query,
          setweight(to_tsvector('english', hn.title), 'A') ||
            setweight(to_tsvector('english', hn.body), 'B') AS document
        FROM "help_node" hn
        CROSS JOIN search_input si
      )
      SELECT
        id::text AS id,
        slug,
        title,
        CASE
          WHEN to_tsvector('english', body) @@ query THEN
            ts_headline(
              'english',
              body,
              query,
              'MaxWords=24, MinWords=8, ShortWord=3, HighlightAll=false'
            )
          ELSE
            ts_headline(
              'english',
              title,
              query,
              'MaxWords=12, MinWords=1, ShortWord=3, HighlightAll=false'
            )
        END AS snippet,
        ts_rank(document, query)::double precision AS rank
      FROM ranked_help_nodes
      WHERE document @@ query
      ORDER BY rank DESC, title ASC, id ASC
      LIMIT ${maxResults}
    `);

    return {
      results: rows.map(toHelpSearchResult),
    } satisfies HelpSearchResponse;
  }

  async findByIdOrSlugPath(
    idOrSlugPath: string,
  ): Promise<HelpNodeWithBody | null> {
    const nodeId = isUuid(idOrSlugPath)
      ? idOrSlugPath
      : await this.resolveSlugPath(idOrSlugPath);

    if (!nodeId) {
      return null;
    }

    const row = await this.prisma.helpNode.findUnique({
      where: { id: nodeId },
      include: {
        demos: {
          orderBy: { ordering: 'asc' },
        },
      },
    });

    return row ? toHelpNodeWithBody(row) : null;
  }

  private async resolveSlugPath(slugPath: string): Promise<string | null> {
    const segments = slugPath.split('/');

    if (segments.some((segment) => segment.length === 0)) {
      return null;
    }

    let parentId: string | null = null;
    let resolvedId: string | null = null;

    for (const slug of segments) {
      const rows: Array<{ id: string }> = await this.prisma.helpNode.findMany({
        where: {
          parentId,
          slug,
        },
        select: {
          id: true,
        },
        take: 2,
      });

      if (rows.length === 0) {
        return null;
      }

      if (rows.length > 1) {
        throw new InternalServerErrorException(
          'help_node slug lookup must resolve to at most one sibling',
        );
      }

      const row = rows[0];
      if (!row) {
        return null;
      }

      resolvedId = row.id;
      parentId = resolvedId;
    }

    return resolvedId;
  }
}

function toHelpSearchResult(row: HelpSearchRow): HelpSearchResult {
  if (!row.snippet) {
    throw new InternalServerErrorException(
      'help search rows must include a snippet',
    );
  }

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    snippet: row.snippet,
    rank: Number(row.rank),
  } satisfies HelpSearchResult;
}

function toHelpNodeWithBody(row: HelpNodeWithDemosRow): HelpNodeWithBody {
  return {
    id: row.id,
    parentId: row.parentId,
    slug: row.slug,
    title: row.title,
    ordering: row.ordering,
    body: row.body,
    demos: row.demos.map(toHelpDemo),
  } satisfies HelpNodeWithBody;
}

function toHelpDemo(row: HelpNodeWithDemosRow['demos'][number]): HelpDemo {
  if (row.kind === 'preset') {
    return toPresetHelpDemo(row);
  }

  if (row.kind === 'dsl') {
    return toDslHelpDemo(row);
  }

  throw new InternalServerErrorException(
    `Unsupported help_demo kind: ${row.kind}`,
  );
}

function toPresetHelpDemo(
  row: HelpNodeWithDemosRow['demos'][number],
): HelpDemoPreset {
  if (!row.presetKey) {
    throw new InternalServerErrorException(
      'preset help_demo rows must have preset_key',
    );
  }

  return {
    id: row.id,
    ordering: row.ordering,
    caption: row.caption,
    kind: HelpDemoPreset.KindEnum.Preset,
    presetKey: row.presetKey,
  } satisfies HelpDemoPreset;
}

function toDslHelpDemo(
  row: HelpNodeWithDemosRow['demos'][number],
): HelpDemoDsl {
  if (!isJsonObject(row.definition)) {
    throw new InternalServerErrorException(
      'dsl help_demo rows must have an object definition',
    );
  }

  return {
    id: row.id,
    ordering: row.ordering,
    caption: row.caption,
    kind: HelpDemoDsl.KindEnum.Dsl,
    definition: row.definition,
  } satisfies HelpDemoDsl;
}

function isJsonObject(value: Prisma.JsonValue | null): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
