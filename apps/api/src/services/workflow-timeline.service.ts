import { Injectable } from '@nestjs/common';
import { ElasticsearchService } from './elasticsearch.service';

interface RawEntry {
  lines: string[];
  firstLineNumber: number;
  lastLineNumber: number;
}

interface LogEntry {
  raw: string;
  lineNumber: number;
  timestamp?: string;
  level?: string;
  logger?: string;
  message: string;
  metadata: Record<string, string> & {
    workflowId?: string;
    workflowRunId?: string;
    runId?: string;
    nodeId?: string;
    currentNodeId?: string;
    step?: string;
    stepName?: string;
    iteration?: string;
    status?: string;
    from?: string;
    to?: string;
    reason?: string;
    correlationId?: string;
    causationId?: string;
    conversationId?: string;
    requestId?: string;
    messageId?: string;
    jobId?: string;
    activityType?: string;
    activityId?: string;
    eventType?: string;
    flowId?: string;
    duration?: string;
    workflowType?: string;
    taskQueue?: string;
    sdkComponent?: string;
    namespace?: string;
    loggerContext?: string;
    structuredDetails?: string;
  };
}

interface EventRecord {
  at?: string;
  logger?: string;
  level?: string;
  severityRank: number;
  message: string;
  raw: string;
  metadata: Record<string, string>;
  type?: string;
  confidence: 'high' | 'medium' | 'low';
  line?: number;
  stepKey?: string;
}

interface StepRecord {
  key: string;
  name: string;
  iteration?: number;
  occurrence: number;
  status: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  metadata: Record<string, string>;
  events: EventRecord[];
}

interface NodeRecord {
  name: string;
  steps: StepRecord[];
  events: EventRecord[];
}

type InternalNodeRecord = NodeRecord & {
  stepIndex: Map<string, StepRecord>;
  occurrenceByStep: Map<string, number>;
  lastActiveStepKey?: string;
  pendingStepName?: string;
};

interface StepRef {
  nodeName: string;
  stepKey: string;
}

export interface TimelineResult {
  workflowId: string;
  runIds: string[];
  nodes: NodeRecord[];
  orphans: EventRecord[];
  stats: {
    totalEntries: number;
    assignedEntries: number;
    orphanedEntries: number;
  };
}

const FIELD_ALIASES: Record<string, string[]> = {
  workflowId: ['workflowId', 'workflow_id', 'workflow-id', 'workflowIds'],
  workflowRunId: ['workflowRunId', 'runId', 'workflowRunID', 'workflow_run_id'],
  runId: ['runId'],
  nodeId: ['nodeId', 'currentNodeId', 'node_id', 'currentNodeID'],
  currentNodeId: ['currentNodeId'],
  step: ['step'],
  stepName: ['stepName', 'step'],
  iteration: ['iteration'],
  status: ['status'],
  from: ['from'],
  to: ['to'],
  reason: ['reason'],
  correlationId: ['correlationId', 'corrId'],
  causationId: ['causationId'],
  conversationId: ['conversationId'],
  requestId: ['requestId'],
  messageId: ['messageId'],
  jobId: ['jobId'],
  activityType: ['activityType'],
  activityId: ['activityId'],
  eventType: ['eventType'],
  flowId: ['flowId'],
  duration: ['duration'],
  workflowType: ['workflowType'],
  taskQueue: ['taskQueue'],
  sdkComponent: ['sdkComponent'],
  namespace: ['namespace'],
};

@Injectable()
export class WorkflowTimelineService {
  constructor(private readonly elasticsearchService: ElasticsearchService) {}

  /**
   * Build a workflow timeline by fetching logs from Elasticsearch.
   */
  async buildTimelineForWorkflow(
    workflowId: string,
    options?: {
      index?: string;
      from?: Date;
      to?: Date;
      maxResults?: number;
      saveToFile?: boolean;
    },
  ): Promise<TimelineResult> {
    const logLines = await this.elasticsearchService.getLogsForWorkflow(
      workflowId,
      options,
    );

    // Always save logs to file for debugging
    // const fs = await import('fs/promises');
    // const path = await import('path');
    // const logDir = path.join(process.cwd(), 'logs');
    // await fs.mkdir(logDir, { recursive: true });
    // const logFile = path.join(
    //   logDir,
    //   `workflow_${workflowId}_${Date.now()}.log`,
    // );
    // await fs.writeFile(logFile, logLines.join('\n'), 'utf-8');
    // console.log(`Saved ${logLines.length} log lines to ${logFile}`);

    return this.buildTimelineFromLogs(logLines, workflowId);
  }

  /**
   * Parse raw log lines into a structured timeline for a specific workflow.
   */
  buildTimelineFromLogs(
    logLines: string[],
    workflowId: string,
  ): TimelineResult {
    const rawEntries = this.parseRawEntries(logLines);
    return this.buildTimeline(rawEntries, workflowId);
  }

  private parseRawEntries(logLines: string[]): RawEntry[] {
    const rawEntries: RawEntry[] = [];
    let current: RawEntry | null = null;
    let currentLineNumber = 0;

    for (const line of logLines) {
      currentLineNumber += 1;
      const isNew = this.looksLikeNewLogLine(line);

      if (isNew) {
        if (current && current.lines.length > 0) {
          rawEntries.push(current);
        }
        current = {
          lines: [line],
          firstLineNumber: currentLineNumber,
          lastLineNumber: currentLineNumber,
        };
      } else if (current) {
        current.lines.push(line);
        current.lastLineNumber = currentLineNumber;
      } else {
        current = {
          lines: [line],
          firstLineNumber: currentLineNumber,
          lastLineNumber: currentLineNumber,
        };
      }
    }

    if (current && current.lines.length > 0) {
      rawEntries.push(current);
    }

    return rawEntries;
  }

  private looksLikeNewLogLine(line: string): boolean {
    if (!line) {
      return false;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
      return true;
    }
    if (/^\[Nest\]/.test(line)) {
      return true;
    }
    if (/^\{\s*"timestamp"/.test(line)) {
      return true;
    }
    if (/^\[PID:/.test(line)) {
      return true;
    }
    if (/^\s*$/.test(line)) {
      return false;
    }
    return false;
  }

  private buildTimeline(
    entries: RawEntry[],
    workflowId: string,
  ): TimelineResult {
    const builder = new TimelineBuilder(workflowId);
    for (const raw of entries) {
      try {
        const parsed = this.parseLogEntry(raw);
        builder.addEntry(parsed);
      } catch (err) {
        console.error(
          `Failed to parse entry starting at line ${raw.firstLineNumber}:`,
          (err as Error).message,
        );
      }
    }
    return builder.getTimeline();
  }

  private parseLogEntry(raw: RawEntry): LogEntry {
    const combined = raw.lines.join('\n');
    let timestamp: string | undefined;
    let level: string | undefined;
    let logger: string | undefined;
    let message = combined.trim();
    let structuredContextFromLog: Record<string, unknown> | undefined;
    let loggerContextFromLog: string | undefined;
    let structuredDetailsFromLog: string[] | undefined;
    let parsedObject: Record<string, unknown> | undefined;

    const isoMatch = combined.match(
      /^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/,
    );
    if (isoMatch) {
      const [
        ,
        capturedTimestamp,
        capturedLevel,
        capturedLogger,
        capturedMessage,
      ] = isoMatch;
      if (
        capturedTimestamp &&
        capturedLevel &&
        capturedLogger &&
        capturedMessage !== undefined
      ) {
        timestamp = capturedTimestamp;
        level = capturedLevel;
        logger = capturedLogger;
        message = capturedMessage.trim();
      }
    } else {
      const nestMatch = combined.match(
        /^\[Nest\]\s+(\d+)\s+-\s+([^\[]+)\s+([A-Z]+)\s+\[([^\]]+)\]\s+(.*)$/s,
      );
      if (nestMatch) {
        const [
          ,
          ,
          capturedTimestamp,
          capturedLevel,
          capturedLogger,
          capturedMessage,
        ] = nestMatch;
        if (
          capturedTimestamp &&
          capturedLevel &&
          capturedLogger &&
          capturedMessage !== undefined
        ) {
          const rawTs = capturedTimestamp.trim();
          const parsedTs = this.parseDate(rawTs);
          timestamp = parsedTs ?? undefined;
          level = capturedLevel;
          logger = capturedLogger;
          message = capturedMessage.trim();
        }
      } else {
        const jsonMatch = combined.trim();
        if (jsonMatch.startsWith('{')) {
          try {
            const parsed = JSON.parse(jsonMatch);
            if (parsed.timestamp) {
              timestamp = parsed.timestamp;
            }
            level = parsed.level ?? parsed.severity;

            // For Temporal logs, use sdkComponent or detect from message
            if (
              parsed.sdkComponent === 'workflow' ||
              parsed.message?.includes('[Temporal]')
            ) {
              logger = 'Temporal';
            } else {
              logger = parsed.logger ?? parsed.service ?? parsed.context;
            }

            message = parsed.message ?? combined.trim();
            if (
              parsed.structuredContext &&
              typeof parsed.structuredContext === 'object'
            ) {
              structuredContextFromLog = parsed.structuredContext as Record<
                string,
                unknown
              >;
            }
            if (parsed.loggerContext) {
              loggerContextFromLog = String(parsed.loggerContext);
            }
            if (Array.isArray(parsed.structuredDetails)) {
              structuredDetailsFromLog = parsed.structuredDetails as string[];
            }
            parsedObject = parsed as Record<string, unknown>;
          } catch (err) {
            // Ignore JSON parse errors
          }
        }
      }
    }

    const metadata: LogEntry['metadata'] = {} as LogEntry['metadata'];

    if (parsedObject) {
      for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        const existing = metadata[field];
        if (existing !== undefined) {
          continue;
        }
        const fromObject = this.extractFieldFromObject(parsedObject, aliases);
        if (fromObject !== undefined) {
          metadata[field] = fromObject;
        }
      }
    }

    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (metadata[field] !== undefined) {
        continue;
      }
      const value = this.extractField(combined, aliases);
      if (value !== undefined) {
        metadata[field] = value;
      }
    }

    if (structuredContextFromLog) {
      for (const [key, value] of Object.entries(structuredContextFromLog)) {
        if (
          value !== undefined &&
          value !== null &&
          metadata[key] === undefined
        ) {
          metadata[key] = String(value);
        }
      }
    }

    if (loggerContextFromLog && metadata.loggerContext === undefined) {
      metadata.loggerContext = loggerContextFromLog;
    }

    if (structuredDetailsFromLog && structuredDetailsFromLog.length > 0) {
      metadata.structuredDetails = JSON.stringify(structuredDetailsFromLog);
    }

    // Normalize known numeric fields
    if (metadata.iteration) {
      const num = Number(metadata.iteration);
      if (!Number.isNaN(num)) {
        metadata.iteration = String(num);
      }
    }
    if (metadata.duration) {
      const num = Number(metadata.duration);
      if (!Number.isNaN(num)) {
        metadata.duration = String(num);
      }
    }

    return {
      raw: combined,
      lineNumber: raw.firstLineNumber,
      timestamp,
      level,
      logger,
      message,
      metadata,
    };
  }
  private extractField(text: string, keys: string[]): string | undefined {
    for (const key of keys) {
      let captured: string | undefined;
      this.extractByKeyFromText(text, key, (value) => {
        const normalized = String(value ?? '').trim();
        const sanitized = normalized.split(/[\s|]+/)[0];
        if (
          sanitized &&
          sanitized.toLowerCase() !== 'undefined' &&
          sanitized.toLowerCase() !== 'null' &&
          !sanitized.includes('...')
        ) {
          captured = sanitized;
        }
      });
      if (captured !== undefined) {
        return captured;
      }
    }
    return undefined;
  }

  private extractByKeyFromText(
    line: string,
    key: string,
    collect: (value: string) => void,
  ): void {
    const escaped = this.escapeRegExp(key);
    const boundary = `(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`;
    const patterns = [
      new RegExp(`['"]${escaped}['"]\s*:\s*['"]([^'"\s|]+)['"]`, 'gi'),
      new RegExp(`${boundary}\s*[:=]\s*['"]?([^'"\s,|]+)`, 'gi'),
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const value = match[1];
        if (value !== undefined) {
          collect(value);
        }
      }
    }
  }

  private extractFieldFromObject(
    obj: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = obj[key];
      if (value !== undefined && value !== null) {
        return String(value);
      }
    }
    return undefined;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private parseDate(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed.toISOString();
  }
}

class TimelineBuilder {
  private readonly workflowId: string;
  private readonly runIdSet = new Set<string>();
  private readonly nodes = new Map<string, InternalNodeRecord>();
  private readonly entrySignatures = new Set<string>();
  private readonly idIndex = new Map<string, StepRef>();
  private readonly conversationToWorkflow = new Map<string, string>();
  private readonly acceptedConversations = new Set<string>();
  private readonly orphans: EventRecord[] = [];
  private totalEntries = 0;
  private assignedEntries = 0;

  constructor(workflowId: string) {
    this.workflowId = workflowId;
  }

  getTimeline(): TimelineResult {
    const nodesArray: NodeRecord[] = [];
    for (const node of Array.from(this.nodes.values())) {
      const {
        stepIndex,
        occurrenceByStep,
        lastActiveStepKey,
        pendingStepName,
        ...rest
      } = node;
      for (const step of rest.steps) {
        step.events.sort(compareEvents);
        if (!step.status || step.status === 'IN_PROGRESS') {
          step.status = 'IN_PROGRESS';
        }
        if (step.startedAt && step.endedAt) {
          step.durationMs = computeDurationMs(step.startedAt, step.endedAt);
        } else if (step.metadata.duration) {
          const durationNum = Number(step.metadata.duration);
          if (!Number.isNaN(durationNum)) {
            step.durationMs = durationNum;
          }
        }
      }
      // Sort steps chronologically
      rest.steps.sort(compareSteps);
      rest.events.sort(compareEvents);
      nodesArray.push(rest);
    }

    nodesArray.sort((a, b) => a.name.localeCompare(b.name));

    const stats = {
      totalEntries: this.totalEntries,
      assignedEntries: this.assignedEntries,
      orphanedEntries: this.totalEntries - this.assignedEntries,
    };

    return {
      workflowId: this.workflowId,
      runIds: Array.from(this.runIdSet.values()),
      nodes: nodesArray,
      orphans: this.orphans.sort(compareEvents),
      stats,
    };
  }

  addEntry(entry: LogEntry): void {
    const signature = createEntrySignature(entry);
    if (this.entrySignatures.has(signature)) {
      return;
    }
    this.entrySignatures.add(signature);
    this.totalEntries += 1;
    const workflowId = normalizeId(entry.metadata.workflowId);
    const workflowRunId = normalizeId(
      entry.metadata.workflowRunId || entry.metadata.runId,
    );
    const conversationId = normalizeId(entry.metadata.conversationId);

    const shouldSkipDueToConversation =
      conversationId !== undefined &&
      this.acceptedConversations.size > 0 &&
      !this.acceptedConversations.has(conversationId);

    if (shouldSkipDueToConversation) {
      this.orphans.push(this.createEventRecord(entry, 'low'));
      return;
    }

    if (conversationId) {
      this.acceptedConversations.add(conversationId);
    }

    // Establish conversationId mapping early if this entry has matching workflowId
    if (workflowId === this.workflowId && conversationId) {
      this.conversationToWorkflow.set(conversationId, this.workflowId);
    }

    if (workflowRunId) {
      this.runIdSet.add(workflowRunId);
    }

    const stepRefFromIndex = this.lookupFromIndices(entry);
    if (!workflowId && (!stepRefFromIndex || !stepRefFromIndex.nodeName)) {
      if (conversationId) {
        const mappedWorkflow = this.conversationToWorkflow.get(conversationId);
        if (mappedWorkflow && mappedWorkflow !== this.workflowId) {
          this.orphans.push(this.createEventRecord(entry, 'low'));
          return;
        }
      } else {
        this.orphans.push(this.createEventRecord(entry, 'low'));
        return;
      }
    }

    const nodeId = normalizeId(
      entry.metadata.nodeId ||
        entry.metadata.currentNodeId ||
        stepRefFromIndex?.nodeName,
    );

    const node = nodeId ? this.ensureNode(nodeId) : undefined;

    if (workflowRunId) {
      this.runIdSet.add(workflowRunId);
    }

    const workflowMatches = workflowId === this.workflowId;

    const confidence: EventRecord['confidence'] = workflowId
      ? workflowMatches
        ? 'high'
        : 'medium'
      : stepRefFromIndex
        ? 'medium'
        : node
          ? 'medium'
          : 'low';

    if (isProcessingStep(entry)) {
      if (!node) {
        this.orphans.push(this.createEventRecord(entry, 'low'));
        return;
      }
      const stepName =
        entry.metadata.step ||
        entry.metadata.stepName ||
        extractStepNameFromMessage(entry.message);
      const event = this.createEventRecord(entry, confidence);
      if (!stepName) {
        event.stepKey = undefined;
        node.events.push(event);
        return;
      }
      const hasExplicitStepMetadata = Boolean(
        entry.metadata.step || entry.metadata.stepName,
      );
      if (!hasExplicitStepMetadata && node.pendingStepName !== stepName) {
        event.stepKey = undefined;
        node.events.push(event);
        return;
      }
      const iteration = parseIteration(entry);
      let step = this.resolveExistingStep(node, stepName);
      const allowCreation =
        hasExplicitStepMetadata || node.pendingStepName === stepName;
      if (!step && allowCreation && isTemporalLogEntry(entry)) {
        step = this.createStep(
          node,
          stepName,
          iteration,
          entry.timestamp,
          entry,
          confidence,
        );
      }
      if (!step) {
        event.stepKey = undefined;
        node.events.push(event);
        return;
      }
      if (node.pendingStepName === stepName) {
        node.pendingStepName = undefined;
      }
      if (iteration !== undefined && step.iteration === undefined) {
        step.iteration = iteration;
      }
      if (!step.startedAt && entry.timestamp) {
        step.startedAt = entry.timestamp;
      }
      node.lastActiveStepKey = step.key;
      event.stepKey = step.key;
      step.events.push(event);
      node.events.push(event);
      this.indexEntry(entry, node.name, step.key);
      this.assignedEntries += 1;
      return;
    }

    if (isCompletedStep(entry)) {
      if (!node) {
        this.orphans.push(this.createEventRecord(entry, 'low'));
        return;
      }
      const stepName =
        entry.metadata.stepName ||
        entry.metadata.step ||
        extractStepNameFromMessage(entry.message);
      const event = this.createEventRecord(entry, confidence);
      if (!stepName) {
        event.stepKey = undefined;
        node.events.push(event);
        return;
      }
      const step = this.resolveExistingStep(node, stepName);
      if (step) {
        if (!step.startedAt && entry.timestamp) {
          step.startedAt = entry.timestamp;
        }
        if (entry.metadata.status) {
          step.status = entry.metadata.status;
        } else {
          step.status = 'COMPLETED';
        }
        step.endedAt = entry.timestamp ?? step.endedAt;
        if (entry.metadata.duration && !step.metadata.duration) {
          step.metadata.duration = entry.metadata.duration;
        }
        node.lastActiveStepKey = step.key;
        event.stepKey = step.key;
        step.events.push(event);
        node.events.push(event);
        this.indexEntry(entry, node.name, step.key);
        this.assignedEntries += 1;
      } else {
        const placeholder = this.createStep(
          node,
          stepName,
          undefined,
          entry.timestamp,
          entry,
          confidence,
        );
        placeholder.status = entry.metadata.status ?? 'COMPLETED';
        placeholder.endedAt = entry.timestamp;
        if (entry.metadata.duration) {
          placeholder.metadata.duration = entry.metadata.duration;
        }
        node.lastActiveStepKey = placeholder.key;
        event.stepKey = placeholder.key;
        placeholder.events.push(event);
        node.events.push(event);
        this.indexEntry(entry, node.name, placeholder.key);
        this.assignedEntries += 1;
      }
      return;
    }

    if (isTransitionEntry(entry)) {
      if (!node) {
        this.orphans.push(this.createEventRecord(entry, 'low'));
        return;
      }
      const fromStepName = entry.metadata.from;
      const fromStep = fromStepName
        ? this.resolveExistingStep(node, fromStepName)
        : node.lastActiveStepKey
          ? node.stepIndex.get(node.lastActiveStepKey)
          : undefined;
      const event = this.createEventRecord(entry, confidence);
      if (fromStep) {
        event.stepKey = fromStep.key;
        fromStep.events.push(event);
        if (entry.metadata.to) {
          fromStep.metadata.transitionTo = entry.metadata.to;
        }
        if (entry.metadata.reason && !fromStep.metadata.reason) {
          fromStep.metadata.reason = entry.metadata.reason;
        }
        if (entry.timestamp) {
          fromStep.endedAt = entry.timestamp;
        }
        if (!fromStep.status || fromStep.status === 'IN_PROGRESS') {
          const reason = entry.metadata.reason?.toLowerCase() ?? '';
          if (
            reason.includes('fail') ||
            reason.includes('error') ||
            reason.includes('timeout')
          ) {
            fromStep.status = 'FAILED';
          } else if (reason.includes('cancel')) {
            fromStep.status = 'FAILED';
          } else {
            fromStep.status = 'COMPLETED';
          }
        }
        node.events.push(event);
        this.indexEntry(entry, node.name, fromStep.key);
        this.assignedEntries += 1;
      } else {
        event.stepKey = undefined;
        node.events.push(event);
      }

      const toStepName = entry.metadata.to;
      node.pendingStepName = toStepName;
      node.lastActiveStepKey = undefined;
      return;
    }

    const targetStep = this.resolveStepForEvent(node, stepRefFromIndex, entry);
    const event = this.createEventRecord(entry, confidence);

    if (targetStep) {
      event.stepKey = targetStep.step.key;
      targetStep.step.events.push(event);
      const owningNode = this.nodes.get(targetStep.nodeName);
      owningNode?.events.push(event);
      this.indexEntry(entry, targetStep.nodeName, targetStep.step.key);
      this.assignedEntries += 1;
    } else if (node) {
      event.stepKey = undefined;
      node.events.push(event);
    } else {
      this.orphans.push(event);
    }
  }

  private ensureNode(nodeId: string): InternalNodeRecord {
    let node = this.nodes.get(nodeId);
    if (!node) {
      node = {
        name: nodeId,
        steps: [],
        events: [],
        stepIndex: new Map(),
        occurrenceByStep: new Map(),
        pendingStepName: undefined,
      };
      this.nodes.set(nodeId, node);
    }
    return node;
  }

  private createStep(
    node: ReturnType<TimelineBuilder['ensureNode']>,
    name: string,
    iteration: number | undefined,
    timestamp: string | undefined,
    entry: LogEntry,
    confidence: EventRecord['confidence'],
  ): StepRecord {
    const occurrence = (node.occurrenceByStep.get(name) ?? 0) + 1;
    node.occurrenceByStep.set(name, occurrence);
    const iterationSuffix =
      iteration !== undefined ? `#iter-${iteration}` : 'iter-?';
    const key = `${name}::${iterationSuffix}::${occurrence}`;
    const step: StepRecord = {
      key,
      name,
      iteration,
      occurrence,
      status: 'IN_PROGRESS',
      startedAt: timestamp,
      metadata: {},
      events: [],
    };
    node.steps.push(step);
    node.stepIndex.set(key, step);
    node.lastActiveStepKey = key;

    if (entry.metadata.duration) {
      step.metadata.duration = entry.metadata.duration;
    }

    return step;
  }

  private resolveExistingStep(
    node: ReturnType<TimelineBuilder['ensureNode']>,
    name: string,
  ): StepRecord | undefined {
    for (let i = node.steps.length - 1; i >= 0; i -= 1) {
      const step = node.steps[i];
      if (!step) {
        continue;
      }
      if (step.name === name) {
        node.lastActiveStepKey = step.key;
        return step;
      }
    }
    return undefined;
  }

  private resolveStepForEvent(
    node: ReturnType<TimelineBuilder['ensureNode']> | undefined,
    stepRef: StepRef | null,
    entry: LogEntry,
  ): { nodeName: string; step: StepRecord } | null {
    if (stepRef) {
      const mappedNode = this.nodes.get(stepRef.nodeName);
      const step = mappedNode?.stepIndex.get(stepRef.stepKey);
      if (mappedNode && step) {
        mappedNode.lastActiveStepKey = step.key;
        return { nodeName: mappedNode.name, step };
      }
    }

    if (node) {
      let stepName =
        entry.metadata.step ||
        entry.metadata.stepName ||
        extractStepNameFromMessage(entry.message);
      if (!stepName && node.pendingStepName) {
        stepName = node.pendingStepName;
      }
      const hasExplicit = Boolean(
        entry.metadata.step || entry.metadata.stepName,
      );
      if (stepName) {
        const existing = this.resolveExistingStep(node, stepName);
        if (existing) {
          if (node.pendingStepName === stepName) {
            node.pendingStepName = undefined;
          }
          return { nodeName: node.name, step: existing };
        }
        const allowCreation = hasExplicit || node.pendingStepName === stepName;
        if (allowCreation && isTemporalLogEntry(entry)) {
          const iteration = parseIteration(entry);
          const newStep = this.createStep(
            node,
            stepName,
            iteration,
            entry.timestamp,
            entry,
            'medium',
          );
          if (node.pendingStepName === stepName) {
            node.pendingStepName = undefined;
          }
          return { nodeName: node.name, step: newStep };
        }
      }

      if (node.lastActiveStepKey) {
        const step = node.stepIndex.get(node.lastActiveStepKey);
        if (step) {
          return { nodeName: node.name, step };
        }
      }

      const fallbackName = deriveFallbackStepName(entry);
      if (fallbackName) {
        const existing = this.resolveExistingStep(node, fallbackName);
        if (existing) {
          return { nodeName: node.name, step: existing };
        }
        if (
          node.pendingStepName === fallbackName &&
          isTemporalLogEntry(entry)
        ) {
          const iteration = parseIteration(entry);
          const newStep = this.createStep(
            node,
            fallbackName,
            iteration,
            entry.timestamp,
            entry,
            'low',
          );
          node.pendingStepName = undefined;
          return { nodeName: node.name, step: newStep };
        }
      }

      return null;
    }

    return null;
  }

  private indexEntry(
    entry: LogEntry,
    nodeName?: string,
    stepKey?: string,
  ): void {
    const stepRef = stepKey && nodeName ? { nodeName, stepKey } : undefined;

    const workflowId = normalizeId(entry.metadata.workflowId);
    if (entry.metadata.conversationId) {
      const normalizedConversationId = normalizeId(
        entry.metadata.conversationId,
      );
      if (normalizedConversationId) {
        this.conversationToWorkflow.set(
          normalizedConversationId,
          this.workflowId,
        );
      }
    }

    const register = (prefix: string, value?: string) => {
      const normalized = normalizeId(value);
      if (!normalized || !stepRef) {
        return;
      }
      this.idIndex.set(`${prefix}:${normalized}`, stepRef);
    };

    register('correlation', entry.metadata.correlationId);
    register('correlation', entry.metadata.causationId);
    register('job', entry.metadata.jobId);
    register('message', entry.metadata.messageId);
    register('request', entry.metadata.requestId);
  }

  private lookupFromIndices(entry: LogEntry): StepRef | null {
    const candidates = [
      ['correlation', entry.metadata.correlationId],
      ['correlation', entry.metadata.causationId],
      ['job', entry.metadata.jobId],
      ['message', entry.metadata.messageId],
      ['request', entry.metadata.requestId],
    ] as const;

    for (const [prefix, value] of candidates) {
      const normalized = normalizeId(value);
      if (!normalized) {
        continue;
      }
      const ref = this.idIndex.get(`${prefix}:${normalized}`);
      if (ref) {
        return ref;
      }
    }

    return null;
  }

  private createEventRecord(
    entry: LogEntry,
    confidence: EventRecord['confidence'],
  ): EventRecord {
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry.metadata)) {
      if (value !== undefined) {
        metadata[key] = value;
      }
    }
    const type = classifyEvent(entry);
    const severity = resolveSeverity(entry.level);
    return {
      at: entry.timestamp,
      logger: entry.logger,
      level: severity.level ?? entry.level,
      severityRank: severity.rank,
      message: entry.message,
      raw: entry.raw,
      metadata,
      type,
      confidence,
      line: entry.lineNumber,
    };
  }
}

function normalizeId(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function computeDurationMs(start: string, end: string): number | undefined {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return undefined;
  }
  return endDate.getTime() - startDate.getTime();
}

function classifyEvent(entry: LogEntry): string | undefined {
  const lower = entry.message.toLowerCase();

  // Temporal-specific event types
  if (lower.includes('[temporal]')) {
    if (
      lower.includes('[transitiontostep]') ||
      lower.includes('step transition')
    ) {
      return 'temporal.step.transition';
    }
    if (lower.includes('workflow')) {
      return 'temporal.workflow.event';
    }
    return 'temporal.event';
  }

  // NestJS/Application event types
  if (lower.includes('starting node execution')) {
    return 'node.execution.start';
  }
  if (lower.includes('completed step execution')) {
    return 'workflow.step.completed';
  }
  if (lower.includes('processing step')) {
    return 'workflow.step.processing';
  }
  if (lower.includes('transition')) {
    return 'workflow.step.transition';
  }
  if (lower.includes('artifact')) {
    return 'artifact.event';
  }
  if (lower.includes('message')) {
    return 'message.event';
  }
  if (lower.includes('signal')) {
    return 'signal.event';
  }
  return undefined;
}

function compareSteps(a: StepRecord, b: StepRecord): number {
  // First, sort by startedAt timestamp
  if (a.startedAt && b.startedAt) {
    const timeDiff =
      new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
    if (!Number.isNaN(timeDiff) && timeDiff !== 0) {
      return timeDiff;
    }
  }

  // If timestamps are the same, sort by lifecycle (IN_PROGRESS before COMPLETED)
  // This ensures proper ordering when multiple events occur at the same millisecond
  const statusOrder: Record<string, number> = {
    IN_PROGRESS: 0,
    COMPLETED: 1,
    FAILED: 2,
  };
  const aOrder = statusOrder[a.status] ?? 99;
  const bOrder = statusOrder[b.status] ?? 99;
  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  // If both status and timestamp are equal, sort by occurrence
  return a.occurrence - b.occurrence;
}

function compareEvents(a: EventRecord, b: EventRecord): number {
  if (a.at && b.at) {
    const timeDiff = new Date(a.at).getTime() - new Date(b.at).getTime();
    if (!Number.isNaN(timeDiff) && timeDiff !== 0) {
      return timeDiff;
    }
  }
  if (a.line !== undefined && b.line !== undefined) {
    return a.line - b.line;
  }
  return 0;
}

function isTemporalLogEntry(entry: LogEntry): boolean {
  if (entry.logger && entry.logger.toLowerCase() === 'temporal') {
    return true;
  }
  const component = entry.metadata.sdkComponent?.toLowerCase();
  if (component === 'workflow') {
    return true;
  }
  if (entry.metadata.workflowType) {
    return true;
  }
  if (entry.raw && /\[temporal\]/i.test(entry.raw)) {
    return true;
  }
  return false;
}

function resolveSeverity(level?: string): { level?: string; rank: number } {
  if (!level) {
    return { level: undefined, rank: 4 };
  }

  const normalized = level.toLowerCase();
  const severityOrder: Record<string, number> = {
    fatal: 0,
    error: 1,
    err: 1,
    warn: 2,
    warning: 2,
    info: 3,
    notice: 3,
    debug: 4,
    verbose: 4,
    trace: 5,
  };

  const rank = severityOrder[normalized] ?? 4;
  const normalizedLabel = normalized.toUpperCase();
  return { level: normalizedLabel, rank };
}

function isProcessingStep(entry: LogEntry): boolean {
  return isTemporalLogEntry(entry) && /processing step/i.test(entry.raw);
}

function isCompletedStep(entry: LogEntry): boolean {
  return (
    isTemporalLogEntry(entry) && /completed step execution/i.test(entry.raw)
  );
}

function isTransitionEntry(entry: LogEntry): boolean {
  return isTemporalLogEntry(entry) && /step transition/i.test(entry.raw);
}

function extractStepNameFromMessage(message: string): string | undefined {
  const match = message.match(/step\s+([\w.-]+)/i);
  if (match) {
    return match[1];
  }
  const bracketMatch = extractBracketTag(message);
  if (bracketMatch) {
    return bracketMatch;
  }
  return undefined;
}

function parseIteration(entry: LogEntry): number | undefined {
  const raw = entry.metadata.iteration;
  if (raw) {
    const num = Number(raw);
    if (!Number.isNaN(num)) {
      return num;
    }
  }
  const match = entry.message.match(/iteration\s*[:=]\s*(\d+)/i);
  if (match) {
    const num = Number(match[1]);
    if (!Number.isNaN(num)) {
      return num;
    }
  }
  return undefined;
}

function deriveFallbackStepName(entry: LogEntry): string | undefined {
  if (!isTemporalLogEntry(entry)) {
    return undefined;
  }
  if (entry.logger && entry.logger.toLowerCase() === 'temporal') {
    return undefined;
  }
  if (entry.metadata.activityType) {
    return `activity:${entry.metadata.activityType}`;
  }

  const tag = extractBracketTag(entry.message);
  if (tag && tag.toUpperCase() !== 'CTX') {
    return entry.logger ? `${entry.logger}.${tag}` : tag;
  }

  if (entry.logger) {
    return entry.logger;
  }

  return undefined;
}

function createEntrySignature(entry: LogEntry): string {
  const parts = [
    entry.timestamp ?? '',
    entry.level ? entry.level.toLowerCase() : '',
    entry.logger ? entry.logger.toLowerCase() : '',
    entry.message,
    entry.metadata.workflowId ?? '',
    entry.metadata.workflowRunId ?? entry.metadata.runId ?? '',
    entry.metadata.correlationId ?? '',
    entry.metadata.messageId ?? '',
    entry.metadata.eventType ?? '',
    entry.metadata.nodeId ?? entry.metadata.currentNodeId ?? '',
  ];
  return parts.join('|');
}

function extractBracketTag(message: string): string | undefined {
  const regex = /\[(?!CTX)([A-Za-z0-9_.-]{3,})\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(message)) !== null) {
    const tag = match[1];
    if (!tag) {
      continue;
    }
    if (tag.toUpperCase() === 'TEMPORAL') {
      continue;
    }
    return tag;
  }
  return undefined;
}
