import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';

export interface ElasticsearchLogHit {
  _source: {
    timestamp?: string;
    level?: string;
    logger?: string;
    message?: string;
    [key: string]: unknown;
  };
}

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchService.name);
  private client: Client | null = null;

  async onModuleInit() {
    const elasticsearchUrl =
      process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
    this.client = new Client({
      node: elasticsearchUrl,
    });

    try {
      const health = await this.client.cluster.health();
      this.logger.log(
        `Connected to Elasticsearch: ${health.cluster_name} (${health.status})`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to connect to Elasticsearch at ${elasticsearchUrl}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Query logs from Elasticsearch for a specific workflow ID.
   * Returns raw log lines that can be parsed by WorkflowTimelineService.
   */
  async getLogsForWorkflow(
    workflowId: string,
    options?: {
      index?: string;
      from?: Date;
      to?: Date;
      maxResults?: number;
    },
  ): Promise<string[]> {
    if (!this.client) {
      throw new Error('Elasticsearch client is not initialized');
    }
    const index = options?.index || 'logstash-*';
    const maxResults = options?.maxResults || 10000;

    try {
      // Query for workflowId in multiple locations:
      // - workflowId field (Temporal logs)
      // - structuredContext.workflowId field (NestJS logs with nested context)
      // - start.workflowExecution.workflowId field (Temporal activity task logs)
      const mustNotClauses = [
        // Exclude Temporal periodic bookkeeping logs
        {
          match_phrase: {
            message: '[Temporal] Completed activation',
          },
        },
      ];

      const query = {
        bool: {
          should: [
            {
              term: {
                'workflowId.keyword': workflowId,
              },
            },
            {
              term: {
                workflowId: workflowId,
              },
            },
            {
              term: {
                'structuredContext.workflowId.keyword': workflowId,
              },
            },
            {
              term: {
                'start.workflowExecution.workflowId.keyword': workflowId,
              },
            },
            {
              term: {
                'start.workflowExecution.workflowId': workflowId,
              },
            },
          ],
          minimum_should_match: 1,
          must_not: mustNotClauses,
          ...(options?.from || options?.to
            ? {
                filter: [
                  {
                    range: {
                      '@timestamp': {
                        ...(options.from
                          ? { gte: options.from.toISOString() }
                          : {}),
                        ...(options.to
                          ? { lte: options.to.toISOString() }
                          : {}),
                      },
                    },
                  },
                ],
              }
            : {}),
        },
      };

      this.logger.log(
        `Querying Elasticsearch for workflowId: ${workflowId}, index: ${index}`,
      );

      const response = await this.client.search({
        index,
        size: maxResults,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query: query as any, // Force type - ES client types are overly strict
        sort: [{ '@timestamp': 'asc' }, { timestamp: 'asc' }],
      });

      const totalHits =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : (response.hits.total?.value ?? 0);
      this.logger.log(
        `Elasticsearch returned ${totalHits} total hits for workflow ${workflowId}`,
      );

      const logLines: string[] = [];
      let skippedCount = 0;
      for (const hit of response.hits.hits as ElasticsearchLogHit[]) {
        const source = hit._source;
        const serialized = this.serializeLogSource(source);
        if (serialized) {
          logLines.push(serialized);
          if (logLines.length === 1) {
            this.logger.debug(
              `First serialized log (length ${serialized.length}): ${serialized.substring(0, 300)}`,
            );
          }
        } else {
          skippedCount++;
          if (skippedCount === 1) {
            this.logger.warn(
              `First skipped log source: ${JSON.stringify(source).substring(0, 200)}`,
            );
          }
        }
      }

      if (skippedCount > 0) {
        this.logger.warn(`Skipped ${skippedCount} logs during serialization`);
      }

      this.logger.log(
        `Retrieved ${logLines.length} log lines for workflow ${workflowId}`,
      );
      return logLines;
    } catch (error) {
      this.logger.error(
        `Failed to query Elasticsearch for workflow ${workflowId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Test connection to Elasticsearch
   */
  async ping(): Promise<boolean> {
    try {
      if (!this.client) {
        return false;
      }
      await this.client.ping();
      return true;
    } catch (_error) {
      return false;
    }
  }

  private serializeLogSource(
    source: ElasticsearchLogHit['_source'],
  ): string | null {
    if (!source) {
      return null;
    }

    // Build normalized object with timestamp FIRST (for looksLikeNewLogLine parser)
    const rawTimestamp =
      (source as Record<string, unknown>)['@timestamp'] ?? source.timestamp;
    const timestamp =
      typeof rawTimestamp === 'string'
        ? rawTimestamp
        : new Date().toISOString();

    const level = typeof source.level === 'string' ? source.level : 'INFO';

    const { logger, context } = source as Record<string, unknown>;
    const loggerName =
      (logger as string) ?? (context as string) ?? 'UnknownLogger';

    const message = source.message ?? '';

    // Construct with timestamp first, then other fields
    const normalized: Record<string, unknown> = {
      timestamp,
      level,
      logger: loggerName,
      message,
      ...source, // Include all other fields from source
    };

    // Remove duplicate @timestamp if it exists
    delete normalized['@timestamp'];

    try {
      return JSON.stringify(normalized);
    } catch (err) {
      this.logger.warn(
        `Failed to serialize log source for workflow timeline: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
