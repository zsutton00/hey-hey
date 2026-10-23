import { log } from '@temporalio/workflow';
import { FlowContext } from '../../types/flow-internal.types';

/**
 * Phase 3: Context Version Management System
 *
 * Provides versioning, rollback, and sharing capabilities for workflow contexts
 * to enable advanced workflow orchestration and recovery scenarios.
 */

export interface ContextVersion {
  id: string;
  workflowId: string;
  version: number;
  timestamp: Date;
  context: FlowContext;
  metadata: ContextVersionMetadata;
  checksum: string;
}

export interface ContextVersionMetadata {
  createdBy: string; // step name or system component
  reason: string; // why this version was created
  tags: string[]; // semantic tags for the version
  parentVersionId?: string; // for branching scenarios
  isSnapshot: boolean; // true for manual snapshots, false for auto-versions
  retentionPolicy: ContextRetentionPolicy;
}

export interface ContextRetentionPolicy {
  maxVersions: number;
  maxAgeHours: number;
  keepSnapshots: boolean;
  autoCleanup: boolean;
}

export interface ContextDiff {
  versionFrom: string;
  versionTo: string;
  changes: ContextChange[];
  summary: string;
}

export interface ContextChange {
  path: string; // JSON path to the changed field
  operation: 'added' | 'removed' | 'modified';
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ContextRollbackRequest {
  workflowId: string;
  targetVersionId: string;
  reason: string;
  rollbackBy: string;
  preserveCurrentAsSnapshot: boolean;
}

export interface ContextRollbackResult {
  success: boolean;
  rolledBackToVersion: string;
  snapshotVersionId?: string;
  rollbackDuration: number;
  warnings: string[];
}

export class ContextVersionManager {
  private versions: Map<string, ContextVersion[]> = new Map();
  private defaultRetentionPolicy: ContextRetentionPolicy = {
    maxVersions: 50,
    maxAgeHours: 24,
    keepSnapshots: true,
    autoCleanup: true,
  };

  /**
   * Creates a new context version
   */
  createVersion(
    workflowId: string,
    context: FlowContext,
    metadata: Partial<ContextVersionMetadata>,
  ): ContextVersion {
    const workflowVersions = this.versions.get(workflowId) || [];
    const versionNumber = workflowVersions.length + 1;

    const version: ContextVersion = {
      id: `${workflowId}_v${versionNumber}_${Date.now()}`,
      workflowId,
      version: versionNumber,
      timestamp: new Date(),
      context: this.deepClone(context),
      metadata: {
        createdBy: 'system',
        reason: 'automatic_version',
        tags: [],
        isSnapshot: false,
        retentionPolicy: this.defaultRetentionPolicy,
        ...metadata,
      },
      checksum: this.calculateChecksum(context),
    };

    workflowVersions.push(version);
    this.versions.set(workflowId, workflowVersions);

    // Apply retention policy
    if (version.metadata.retentionPolicy.autoCleanup) {
      this.applyRetentionPolicy(workflowId);
    }

    log.debug('[ContextVersionManager] Created context version', {
      workflowId,
      versionId: version.id,
      version: version.version,
      createdBy: version.metadata.createdBy,
      reason: version.metadata.reason,
    });

    return version;
  }

  /**
   * Creates a manual snapshot of the current context
   */
  createSnapshot(
    workflowId: string,
    context: FlowContext,
    reason: string,
    createdBy: string,
    tags: string[] = [],
  ): ContextVersion {
    return this.createVersion(workflowId, context, {
      createdBy,
      reason,
      tags,
      isSnapshot: true,
    });
  }

  /**
   * Gets a specific context version
   */
  getVersion(
    workflowId: string,
    versionId: string,
  ): ContextVersion | undefined {
    const workflowVersions = this.versions.get(workflowId) || [];
    return workflowVersions.find((v) => v.id === versionId);
  }

  /**
   * Gets the latest context version
   */
  getLatestVersion(workflowId: string): ContextVersion | undefined {
    const workflowVersions = this.versions.get(workflowId) || [];
    return workflowVersions[workflowVersions.length - 1];
  }

  /**
   * Gets all versions for a workflow
   */
  getAllVersions(workflowId: string): ContextVersion[] {
    return this.versions.get(workflowId) || [];
  }

  /**
   * Gets versions by tag
   */
  getVersionsByTag(workflowId: string, tag: string): ContextVersion[] {
    const workflowVersions = this.versions.get(workflowId) || [];
    return workflowVersions.filter((v) => v.metadata.tags.includes(tag));
  }

  /**
   * Gets only snapshot versions
   */
  getSnapshots(workflowId: string): ContextVersion[] {
    const workflowVersions = this.versions.get(workflowId) || [];
    return workflowVersions.filter((v) => v.metadata.isSnapshot);
  }

  /**
   * Rolls back context to a specific version
   */
  rollback(request: ContextRollbackRequest): ContextRollbackResult {
    const startTime = Date.now();
    const result: ContextRollbackResult = {
      success: false,
      rolledBackToVersion: request.targetVersionId,
      rollbackDuration: 0,
      warnings: [],
    };

    try {
      const targetVersion = this.getVersion(
        request.workflowId,
        request.targetVersionId,
      );
      if (!targetVersion) {
        throw new Error(`Target version ${request.targetVersionId} not found`);
      }

      // Create snapshot of current state if requested
      if (request.preserveCurrentAsSnapshot) {
        const currentVersion = this.getLatestVersion(request.workflowId);
        if (currentVersion) {
          const snapshot = this.createSnapshot(
            request.workflowId,
            currentVersion.context,
            `Snapshot before rollback to ${request.targetVersionId}`,
            request.rollbackBy,
            ['pre_rollback', 'snapshot'],
          );
          result.snapshotVersionId = snapshot.id;
        }
      }

      // Validate rollback compatibility
      const compatibility = this.validateRollbackCompatibility(targetVersion);
      result.warnings.push(...compatibility.warnings);

      if (!compatibility.isCompatible) {
        throw new Error(`Rollback incompatible: ${compatibility.reason}`);
      }

      // Create new version with rolled back context
      const rollbackVersion = this.createVersion(
        request.workflowId,
        targetVersion.context,
        {
          createdBy: request.rollbackBy,
          reason: `Rollback to version ${targetVersion.version}: ${request.reason}`,
          tags: ['rollback'],
          parentVersionId: request.targetVersionId,
          isSnapshot: false,
        },
      );

      result.success = true;
      result.rollbackDuration = Date.now() - startTime;

      log.info('[ContextVersionManager] Context rollback completed', {
        workflowId: request.workflowId,
        targetVersionId: request.targetVersionId,
        rollbackVersion: rollbackVersion.id,
        duration: result.rollbackDuration,
        snapshotCreated: !!result.snapshotVersionId,
      });

      return result;
    } catch (error) {
      result.rollbackDuration = Date.now() - startTime;

      log.error('[ContextVersionManager] Context rollback failed', {
        workflowId: request.workflowId,
        targetVersionId: request.targetVersionId,
        error: (error as Error).message,
      });

      throw error;
    }
  }

  /**
   * Compares two context versions and returns differences
   */
  diff(
    workflowId: string,
    fromVersionId: string,
    toVersionId: string,
  ): ContextDiff {
    const fromVersion = this.getVersion(workflowId, fromVersionId);
    const toVersion = this.getVersion(workflowId, toVersionId);

    if (!fromVersion || !toVersion) {
      throw new Error('One or both versions not found');
    }

    const changes = this.calculateChanges(
      fromVersion.context,
      toVersion.context,
    );
    const summary = this.generateDiffSummary(changes);

    const diff: ContextDiff = {
      versionFrom: fromVersionId,
      versionTo: toVersionId,
      changes,
      summary,
    };

    log.debug('[ContextVersionManager] Generated context diff', {
      workflowId,
      fromVersionId,
      toVersionId,
      changeCount: changes.length,
    });

    return diff;
  }

  /**
   * Merges changes from one context version into another
   */
  merge(
    workflowId: string,
    baseVersionId: string,
    sourceVersionId: string,
    mergedBy: string,
    conflictResolution: 'base' | 'source' | 'manual' = 'source',
  ): ContextVersion {
    const baseVersion = this.getVersion(workflowId, baseVersionId);
    const sourceVersion = this.getVersion(workflowId, sourceVersionId);

    if (!baseVersion || !sourceVersion) {
      throw new Error('Base or source version not found');
    }

    // Calculate differences
    const diff = this.diff(workflowId, baseVersionId, sourceVersionId);

    // Apply changes to base context
    const mergedContext = this.deepClone(baseVersion.context);
    const conflicts: ContextChange[] = [];

    for (const change of diff.changes) {
      try {
        this.applyChange(mergedContext, change);
      } catch (error) {
        conflicts.push(change);

        // Apply conflict resolution strategy
        if (conflictResolution === 'source') {
          this.forceApplyChange(mergedContext, change);
        }
        // For 'base', we skip the change (keep base value)
        // For 'manual', would need external resolution
      }
    }

    // Create merged version
    const mergedVersion = this.createVersion(workflowId, mergedContext, {
      createdBy: mergedBy,
      reason: `Merged ${sourceVersionId} into ${baseVersionId}`,
      tags: ['merge', ...(conflicts.length > 0 ? ['conflicts'] : [])],
      isSnapshot: false,
    });

    log.info('[ContextVersionManager] Context merge completed', {
      workflowId,
      baseVersionId,
      sourceVersionId,
      mergedVersionId: mergedVersion.id,
      conflictCount: conflicts.length,
      conflictResolution,
    });

    return mergedVersion;
  }

  /**
   * Validates if a rollback to a specific version is compatible
   */
  private validateRollbackCompatibility(targetVersion: ContextVersion): {
    isCompatible: boolean;
    reason?: string;
    warnings: string[];
  } {
    const warnings: string[] = [];

    // Check version age
    const ageHours =
      (Date.now() - targetVersion.timestamp.getTime()) / (1000 * 60 * 60);
    if (ageHours > 24) {
      warnings.push(`Target version is ${Math.round(ageHours)} hours old`);
    }

    // Check for major structural changes
    // This would involve schema validation in a real implementation

    // Check for required fields
    const requiredFields = ['core', 'flowId', 'gatheredData'];
    for (const field of requiredFields) {
      if (!(field in targetVersion.context)) {
        return {
          isCompatible: false,
          reason: `Required field '${field}' missing in target version`,
          warnings,
        };
      }
    }

    return {
      isCompatible: true,
      warnings,
    };
  }

  /**
   * Calculates changes between two contexts
   */
  private calculateChanges(
    from: FlowContext,
    to: FlowContext,
  ): ContextChange[] {
    const changes: ContextChange[] = [];

    // Simple implementation - would use a proper diff library in production
    const fromFlat = this.flattenObject(from);
    const toFlat = this.flattenObject(to);

    // Find added and modified
    for (const [path, value] of Object.entries(toFlat)) {
      if (!(path in fromFlat)) {
        changes.push({
          path,
          operation: 'added',
          newValue: value,
        });
      } else if (JSON.stringify(fromFlat[path]) !== JSON.stringify(value)) {
        changes.push({
          path,
          operation: 'modified',
          oldValue: fromFlat[path],
          newValue: value,
        });
      }
    }

    // Find removed
    for (const [path, value] of Object.entries(fromFlat)) {
      if (!(path in toFlat)) {
        changes.push({
          path,
          operation: 'removed',
          oldValue: value,
        });
      }
    }

    return changes;
  }

  /**
   * Applies a change to a context
   */
  private applyChange(context: FlowContext, change: ContextChange): void {
    // Simple implementation - would use a proper path library in production
    if (!change.path) {
      throw new Error('[ContextVersionManager] Path is required');
    }
    const pathParts = change.path.split('.').filter(Boolean);
    if (pathParts.length === 0) {
      throw new Error('[ContextVersionManager] Path is required');
    }
    let current: any = context;

    for (let i = 0; i < pathParts.length - 1; i++) {
      const key = pathParts[i];
      if (!key) {
        throw new Error('[ContextVersionManager] Path is required');
      }
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }

    const lastKey = pathParts[pathParts.length - 1];
    if (!lastKey) {
      throw new Error('[ContextVersionManager] Path is required');
    }

    switch (change.operation) {
      case 'added':
      case 'modified':
        current[lastKey] = change.newValue;
        break;
      case 'removed':
        delete current[lastKey];
        break;
    }
  }

  /**
   * Force applies a change, ignoring conflicts
   */
  private forceApplyChange(context: FlowContext, change: ContextChange): void {
    try {
      this.applyChange(context, change);
    } catch (error) {
      log.warn('[ContextVersionManager] Force applied conflicted change', {
        path: change.path,
        operation: change.operation,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Generates a summary of changes
   */
  private generateDiffSummary(changes: ContextChange[]): string {
    const added = changes.filter((c) => c.operation === 'added').length;
    const modified = changes.filter((c) => c.operation === 'modified').length;
    const removed = changes.filter((c) => c.operation === 'removed').length;

    return `${added} added, ${modified} modified, ${removed} removed`;
  }

  /**
   * Applies retention policy to clean up old versions
   */
  private applyRetentionPolicy(workflowId: string): void {
    const versions = this.versions.get(workflowId) || [];
    const policy = this.defaultRetentionPolicy;

    // Keep snapshots if policy requires
    let versionsToKeep = versions.filter(
      (v) => policy.keepSnapshots && v.metadata.isSnapshot,
    );

    // Add recent non-snapshot versions
    const nonSnapshots = versions.filter((v) => !v.metadata.isSnapshot);
    const recentVersions = nonSnapshots.slice(-policy.maxVersions);

    // Filter by age
    const cutoffTime = Date.now() - policy.maxAgeHours * 60 * 60 * 1000;
    const recentByAge = recentVersions.filter(
      (v) => v.timestamp.getTime() > cutoffTime,
    );

    versionsToKeep.push(...recentByAge);

    // Remove duplicates and sort
    versionsToKeep = Array.from(new Set(versionsToKeep)).sort(
      (a, b) => a.version - b.version,
    );

    const removedCount = versions.length - versionsToKeep.length;

    if (removedCount > 0) {
      this.versions.set(workflowId, versionsToKeep);

      log.debug('[ContextVersionManager] Applied retention policy', {
        workflowId,
        totalVersions: versions.length,
        keptVersions: versionsToKeep.length,
        removedVersions: removedCount,
      });
    }
  }

  /**
   * Calculates checksum for context integrity
   */
  private calculateChecksum(context: FlowContext): string {
    const contextString = JSON.stringify(context, Object.keys(context).sort());
    return this.simpleHash(contextString);
  }

  /**
   * Simple hash function for checksums
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Deep clones an object
   */
  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Flattens nested object for easier comparison
   */
  private flattenObject(
    obj: any,
    prefix: string = '',
  ): Record<string, unknown> {
    const flattened: Record<string, unknown> = {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const newKey = prefix ? `${prefix}.${key}` : key;

        if (
          obj[key] &&
          typeof obj[key] === 'object' &&
          !Array.isArray(obj[key])
        ) {
          Object.assign(flattened, this.flattenObject(obj[key], newKey));
        } else {
          flattened[newKey] = obj[key];
        }
      }
    }

    return flattened;
  }

  /**
   * Cleans up all versions for a workflow
   */
  cleanup(workflowId: string): void {
    this.versions.delete(workflowId);

    log.debug('[ContextVersionManager] Cleaned up context versions', {
      workflowId,
    });
  }
}
