import { log } from '@temporalio/workflow';
import { FlowContext } from '../../types/flow-internal.types';
import { ContextVersion } from './context-version-manager';

/**
 * Phase 3: Context Sharing System
 *
 * Enables secure cross-workflow context sharing and collaboration
 * for enterprise-grade workflow orchestration scenarios.
 */

export interface SharedContext {
  id: string;
  sourceWorkflowId: string;
  organizationId: string;
  projectId: string;

  // Context data
  context: FlowContext;
  contextVersion?: string;

  // Sharing configuration
  shareConfig: ContextShareConfig;

  // Access control
  permissions: ContextPermissions;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;

  // Usage tracking
  accessCount: number;
  lastAccessedAt?: Date;
  lastAccessedBy?: string;
}

export interface ContextShareConfig {
  shareType: ContextShareType;
  shareScope: ContextShareScope;
  shareMode: ContextShareMode;

  // Selective sharing
  includedPaths?: string[]; // JSON paths to include
  excludedPaths?: string[]; // JSON paths to exclude

  // Auto-sync settings
  autoSync: boolean;
  syncInterval?: number; // milliseconds

  // Lifecycle settings
  maxAccessCount?: number;
  timeToLive?: number; // milliseconds
}

export interface ContextPermissions {
  // Who can access
  allowedWorkflowIds?: string[];
  allowedOrganizations?: string[];
  allowedProjects?: string[];
  allowedUsers?: string[];

  // What they can do
  canRead: boolean;
  canWrite: boolean;
  canShare: boolean;
  canDelete: boolean;

  // Access restrictions
  requiresApproval: boolean;
  approvedBy?: string[];
}

export enum ContextShareType {
  SNAPSHOT = 'SNAPSHOT', // One-time share of current state
  LIVE = 'LIVE', // Real-time synchronized sharing
  VERSIONED = 'VERSIONED', // Share specific version
}

export enum ContextShareScope {
  FULL = 'FULL', // Share entire context
  SELECTIVE = 'SELECTIVE', // Share specific paths
  FILTERED = 'FILTERED', // Share with filters applied
}

export enum ContextShareMode {
  READ_ONLY = 'READ_ONLY',
  READ_WRITE = 'READ_WRITE',
  COLLABORATIVE = 'COLLABORATIVE', // Multiple workflows can modify
}

export interface ContextAccessRequest {
  requestId: string;
  requesterWorkflowId: string;
  sharedContextId: string;
  requestedPermissions: Partial<ContextPermissions>;
  reason: string;
  timestamp: Date;
}

export interface ContextAccessResult {
  success: boolean;
  sharedContextId: string;
  accessedContext?: FlowContext;
  permissions: ContextPermissions;
  error?: string;
  requiresApproval?: boolean;
}

export interface ContextSyncEvent {
  eventId: string;
  sharedContextId: string;
  sourceWorkflowId: string;
  eventType: ContextSyncEventType;
  changes: ContextChange[];
  timestamp: Date;
}

export enum ContextSyncEventType {
  CONTEXT_UPDATED = 'CONTEXT_UPDATED',
  CONTEXT_SHARED = 'CONTEXT_SHARED',
  ACCESS_GRANTED = 'ACCESS_GRANTED',
  ACCESS_REVOKED = 'ACCESS_REVOKED',
  CONTEXT_EXPIRED = 'CONTEXT_EXPIRED',
}

export interface ContextChange {
  path: string;
  operation: 'set' | 'delete' | 'merge';
  oldValue?: unknown;
  newValue?: unknown;
  timestamp: Date;
}

export class ContextSharingManager {
  private sharedContexts: Map<string, SharedContext> = new Map();
  private accessRequests: Map<string, ContextAccessRequest> = new Map();
  private syncSubscriptions: Map<string, string[]> = new Map(); // sharedContextId -> subscriberWorkflowIds
  private accessHistory: Map<string, ContextAccessResult[]> = new Map();

  /**
   * Shares a context with other workflows
   */
  shareContext(
    sourceWorkflowId: string,
    organizationId: string,
    projectId: string,
    context: FlowContext,
    shareConfig: ContextShareConfig,
    permissions: ContextPermissions,
    contextVersion?: ContextVersion,
  ): SharedContext {
    const sharedContextId = this.generateSharedContextId(sourceWorkflowId);

    const sharedContext: SharedContext = {
      id: sharedContextId,
      sourceWorkflowId,
      organizationId,
      projectId,
      context: this.prepareSharedContext(context, shareConfig),
      contextVersion: contextVersion?.id,
      shareConfig,
      permissions,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: shareConfig.timeToLive
        ? new Date(Date.now() + shareConfig.timeToLive)
        : undefined,
      accessCount: 0,
      lastAccessedAt: undefined,
      lastAccessedBy: undefined,
    };

    this.sharedContexts.set(sharedContextId, sharedContext);

    log.info('[ContextSharingManager] Context shared', {
      sharedContextId,
      sourceWorkflowId,
      shareType: shareConfig.shareType,
      shareScope: shareConfig.shareScope,
      shareMode: shareConfig.shareMode,
    });

    // Set up auto-sync if enabled
    if (
      shareConfig.autoSync &&
      shareConfig.shareType === ContextShareType.LIVE
    ) {
      this.setupAutoSync(sharedContextId, shareConfig.syncInterval || 5000);
    }

    return sharedContext;
  }

  /**
   * Requests access to a shared context
   */
  requestContextAccess(
    requesterWorkflowId: string,
    sharedContextId: string,
    requestedPermissions: Partial<ContextPermissions>,
    reason: string,
  ): ContextAccessResult {
    const sharedContext = this.sharedContexts.get(sharedContextId);
    if (!sharedContext) {
      return {
        success: false,
        sharedContextId,
        permissions: {
          canRead: false,
          canWrite: false,
          canShare: false,
          canDelete: false,
          requiresApproval: false,
        },
        error: 'Shared context not found',
      };
    }

    // Check if context has expired
    if (sharedContext.expiresAt && sharedContext.expiresAt < new Date()) {
      return {
        success: false,
        sharedContextId,
        permissions: {
          canRead: false,
          canWrite: false,
          canShare: false,
          canDelete: false,
          requiresApproval: false,
        },
        error: 'Shared context has expired',
      };
    }

    // Check access limits
    if (
      sharedContext.shareConfig.maxAccessCount &&
      sharedContext.accessCount >= sharedContext.shareConfig.maxAccessCount
    ) {
      return {
        success: false,
        sharedContextId,
        permissions: {
          canRead: false,
          canWrite: false,
          canShare: false,
          canDelete: false,
          requiresApproval: false,
        },
        error: 'Maximum access count exceeded',
      };
    }

    // Validate access permissions
    const hasAccess = this.validateAccess(requesterWorkflowId, sharedContext);
    if (!hasAccess.allowed) {
      if (sharedContext.permissions.requiresApproval) {
        // Create access request for approval
        const requestId = this.generateRequestId();
        const accessRequest: ContextAccessRequest = {
          requestId,
          requesterWorkflowId,
          sharedContextId,
          requestedPermissions,
          reason,
          timestamp: new Date(),
        };

        this.accessRequests.set(requestId, accessRequest);

        return {
          success: false,
          sharedContextId,
          permissions: {
            canRead: false,
            canWrite: false,
            canShare: false,
            canDelete: false,
            requiresApproval: false,
          },
          requiresApproval: true,
          error: 'Access requires approval',
        };
      }

      return {
        success: false,
        sharedContextId,
        permissions: {
          canRead: false,
          canWrite: false,
          canShare: false,
          canDelete: false,
          requiresApproval: false,
        },
        error: hasAccess.reason,
      };
    }

    // Grant access
    const grantedPermissions = this.calculateGrantedPermissions(
      requestedPermissions,
      sharedContext.permissions,
    );

    // Update access tracking
    sharedContext.accessCount++;
    sharedContext.lastAccessedAt = new Date();
    sharedContext.lastAccessedBy = requesterWorkflowId;

    const result: ContextAccessResult = {
      success: true,
      sharedContextId,
      accessedContext: this.deepClone(sharedContext.context),
      permissions: grantedPermissions,
    };

    // Record access in history
    const history = this.accessHistory.get(sharedContextId) || [];
    history.push(result);
    this.accessHistory.set(sharedContextId, history);

    log.info('[ContextSharingManager] Context access granted', {
      sharedContextId,
      requesterWorkflowId,
      permissions: grantedPermissions,
      accessCount: sharedContext.accessCount,
    });

    return result;
  }

  /**
   * Updates a shared context (for live sharing)
   */
  updateSharedContext(
    workflowId: string,
    sharedContextId: string,
    contextUpdates: Partial<FlowContext>,
    changeDescription?: string,
  ): boolean {
    const sharedContext = this.sharedContexts.get(sharedContextId);
    if (!sharedContext) {
      log.warn('[ContextSharingManager] Shared context not found for update', {
        sharedContextId,
        workflowId,
      });
      return false;
    }

    // Validate update permissions
    if (sharedContext.shareConfig.shareMode === ContextShareMode.READ_ONLY) {
      log.warn(
        '[ContextSharingManager] Cannot update read-only shared context',
        {
          sharedContextId,
          workflowId,
        },
      );
      return false;
    }

    // Only source workflow can update unless collaborative mode
    if (
      sharedContext.shareConfig.shareMode !== ContextShareMode.COLLABORATIVE &&
      workflowId !== sharedContext.sourceWorkflowId
    ) {
      log.warn('[ContextSharingManager] Unauthorized context update attempt', {
        sharedContextId,
        workflowId,
        sourceWorkflowId: sharedContext.sourceWorkflowId,
      });
      return false;
    }

    // Calculate changes
    const changes = this.calculateContextChanges(
      sharedContext.context,
      contextUpdates,
    );

    // Apply updates
    Object.assign(sharedContext.context, contextUpdates);
    sharedContext.updatedAt = new Date();

    // Notify subscribers if live sharing
    if (sharedContext.shareConfig.shareType === ContextShareType.LIVE) {
      this.notifySubscribers(sharedContextId, {
        eventId: this.generateEventId(),
        sharedContextId,
        sourceWorkflowId: workflowId,
        eventType: ContextSyncEventType.CONTEXT_UPDATED,
        changes,
        timestamp: new Date(),
      });
    }

    log.info('[ContextSharingManager] Shared context updated', {
      sharedContextId,
      workflowId,
      changeCount: changes.length,
      changeDescription,
    });

    return true;
  }

  /**
   * Subscribes to context updates for live sharing
   */
  subscribeToContextUpdates(
    sharedContextId: string,
    subscriberWorkflowId: string,
  ): boolean {
    const sharedContext = this.sharedContexts.get(sharedContextId);
    if (!sharedContext) {
      return false;
    }

    if (sharedContext.shareConfig.shareType !== ContextShareType.LIVE) {
      log.warn(
        '[ContextSharingManager] Cannot subscribe to non-live shared context',
        {
          sharedContextId,
          subscriberWorkflowId,
        },
      );
      return false;
    }

    const subscribers = this.syncSubscriptions.get(sharedContextId) || [];
    if (!subscribers.includes(subscriberWorkflowId)) {
      subscribers.push(subscriberWorkflowId);
      this.syncSubscriptions.set(sharedContextId, subscribers);
    }

    log.debug('[ContextSharingManager] Subscribed to context updates', {
      sharedContextId,
      subscriberWorkflowId,
      totalSubscribers: subscribers.length,
    });

    return true;
  }

  /**
   * Unsubscribes from context updates
   */
  unsubscribeFromContextUpdates(
    sharedContextId: string,
    subscriberWorkflowId: string,
  ): boolean {
    const subscribers = this.syncSubscriptions.get(sharedContextId) || [];
    const index = subscribers.indexOf(subscriberWorkflowId);

    if (index > -1) {
      subscribers.splice(index, 1);
      this.syncSubscriptions.set(sharedContextId, subscribers);

      log.debug('[ContextSharingManager] Unsubscribed from context updates', {
        sharedContextId,
        subscriberWorkflowId,
        remainingSubscribers: subscribers.length,
      });

      return true;
    }

    return false;
  }

  /**
   * Approves an access request
   */
  approveAccessRequest(
    requestId: string,
    approvedBy: string,
    grantedPermissions?: Partial<ContextPermissions>,
  ): ContextAccessResult {
    const accessRequest = this.accessRequests.get(requestId);
    if (!accessRequest) {
      return {
        success: false,
        sharedContextId: '',
        permissions: {
          canRead: false,
          canWrite: false,
          canShare: false,
          canDelete: false,
          requiresApproval: false,
        },
        error: 'Access request not found',
      };
    }

    // Grant access with approved permissions
    const result = this.requestContextAccess(
      accessRequest.requesterWorkflowId,
      accessRequest.sharedContextId,
      grantedPermissions || accessRequest.requestedPermissions,
      `Approved by ${approvedBy}`,
    );

    // Remove the request
    this.accessRequests.delete(requestId);

    log.info('[ContextSharingManager] Access request approved', {
      requestId,
      requesterWorkflowId: accessRequest.requesterWorkflowId,
      sharedContextId: accessRequest.sharedContextId,
      approvedBy,
    });

    return result;
  }

  /**
   * Revokes access to a shared context
   */
  revokeContextAccess(
    sharedContextId: string,
    workflowId: string,
    revokedBy: string,
  ): boolean {
    const sharedContext = this.sharedContexts.get(sharedContextId);
    if (!sharedContext) {
      return false;
    }

    // Update permissions to revoke access
    if (sharedContext.permissions.allowedWorkflowIds) {
      const index =
        sharedContext.permissions.allowedWorkflowIds.indexOf(workflowId);
      if (index > -1) {
        sharedContext.permissions.allowedWorkflowIds.splice(index, 1);
      }
    }

    // Unsubscribe from updates
    this.unsubscribeFromContextUpdates(sharedContextId, workflowId);

    log.info('[ContextSharingManager] Context access revoked', {
      sharedContextId,
      workflowId,
      revokedBy,
    });

    return true;
  }

  /**
   * Gets shared contexts for a workflow
   */
  getSharedContexts(
    workflowId: string,
    organizationId?: string,
  ): SharedContext[] {
    const contexts: SharedContext[] = [];

    for (const sharedContext of Array.from(this.sharedContexts.values())) {
      // Check if workflow has access
      const hasAccess = this.validateAccess(workflowId, sharedContext);

      if (
        hasAccess.allowed &&
        (!organizationId || sharedContext.organizationId === organizationId)
      ) {
        contexts.push(sharedContext);
      }
    }

    return contexts.filter(
      (ctx) => !ctx.expiresAt || ctx.expiresAt > new Date(),
    );
  }

  /**
   * Gets access history for a shared context
   */
  getAccessHistory(sharedContextId: string): ContextAccessResult[] {
    return this.accessHistory.get(sharedContextId) || [];
  }

  /**
   * Cleans up expired shared contexts
   */
  cleanupExpiredContexts(): number {
    let removedCount = 0;
    const now = new Date();

    for (const [contextId, sharedContext] of Array.from(
      this.sharedContexts.entries(),
    )) {
      if (sharedContext.expiresAt && sharedContext.expiresAt < now) {
        this.sharedContexts.delete(contextId);
        this.syncSubscriptions.delete(contextId);
        this.accessHistory.delete(contextId);
        removedCount++;

        log.debug('[ContextSharingManager] Removed expired shared context', {
          sharedContextId: contextId,
          expiredAt: sharedContext.expiresAt,
        });
      }
    }

    if (removedCount > 0) {
      log.info('[ContextSharingManager] Cleaned up expired contexts', {
        removedCount,
      });
    }

    return removedCount;
  }

  /**
   * Prepares context for sharing based on share configuration
   */
  private prepareSharedContext(
    context: FlowContext,
    shareConfig: ContextShareConfig,
  ): FlowContext {
    let sharedContext = this.deepClone(context);

    if (
      shareConfig.shareScope === ContextShareScope.SELECTIVE &&
      shareConfig.includedPaths
    ) {
      sharedContext = this.extractPaths(
        sharedContext,
        shareConfig.includedPaths,
      );
    }

    if (shareConfig.excludedPaths) {
      sharedContext = this.removePaths(
        sharedContext,
        shareConfig.excludedPaths,
      );
    }

    return sharedContext;
  }

  /**
   * Validates if a workflow can access a shared context
   */
  private validateAccess(
    workflowId: string,
    sharedContext: SharedContext,
  ): {
    allowed: boolean;
    reason?: string;
  } {
    const permissions = sharedContext.permissions;

    // Check workflow-specific permissions
    if (
      permissions.allowedWorkflowIds &&
      !permissions.allowedWorkflowIds.includes(workflowId)
    ) {
      return { allowed: false, reason: 'Workflow not in allowed list' };
    }

    // Source workflow always has access
    if (workflowId === sharedContext.sourceWorkflowId) {
      return { allowed: true };
    }

    return { allowed: true };
  }

  /**
   * Calculates granted permissions based on request and context permissions
   */
  private calculateGrantedPermissions(
    requested: Partial<ContextPermissions>,
    contextPermissions: ContextPermissions,
  ): ContextPermissions {
    return {
      canRead: (requested.canRead ?? true) && contextPermissions.canRead,
      canWrite: (requested.canWrite ?? false) && contextPermissions.canWrite,
      canShare: (requested.canShare ?? false) && contextPermissions.canShare,
      canDelete: (requested.canDelete ?? false) && contextPermissions.canDelete,
      requiresApproval: contextPermissions.requiresApproval,
    };
  }

  /**
   * Calculates changes between contexts
   */
  private calculateContextChanges(
    oldContext: FlowContext,
    updates: Partial<FlowContext>,
  ): ContextChange[] {
    const changes: ContextChange[] = [];
    const now = new Date();

    for (const [key, newValue] of Object.entries(updates)) {
      const oldValue = (oldContext as any)[key];

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({
          path: key,
          operation:
            newValue === undefined
              ? 'delete'
              : oldValue === undefined
                ? 'set'
                : 'merge',
          oldValue,
          newValue,
          timestamp: now,
        });
      }
    }

    return changes;
  }

  /**
   * Notifies subscribers of context changes
   */
  private notifySubscribers(
    sharedContextId: string,
    syncEvent: ContextSyncEvent,
  ): void {
    const subscribers = this.syncSubscriptions.get(sharedContextId) || [];

    for (const subscriberWorkflowId of subscribers) {
      // In a real implementation, this would send signals to subscriber workflows
      log.debug(
        '[ContextSharingManager] Notifying subscriber of context update',
        {
          sharedContextId,
          subscriberWorkflowId,
          eventType: syncEvent.eventType,
          changeCount: syncEvent.changes.length,
        },
      );
    }
  }

  /**
   * Sets up auto-sync for live shared context
   */
  private setupAutoSync(sharedContextId: string, syncInterval: number): void {
    // In a real implementation, this would set up periodic sync
    log.debug('[ContextSharingManager] Auto-sync configured', {
      sharedContextId,
      syncInterval,
    });
  }

  /**
   * Extracts specific paths from context
   */
  private extractPaths(context: FlowContext, paths: string[]): FlowContext {
    const result: any = {};

    for (const path of paths) {
      const value = this.getValueByPath(context, path);
      if (value !== undefined) {
        this.setValueByPath(result, path, value);
      }
    }

    return result;
  }

  /**
   * Removes specific paths from context
   */
  private removePaths(context: FlowContext, paths: string[]): FlowContext {
    const result = this.deepClone(context);

    for (const path of paths) {
      this.deleteValueByPath(result, path);
    }

    return result;
  }

  /**
   * Gets value by JSON path
   */
  private getValueByPath(obj: any, path: string): unknown {
    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Sets value by JSON path
   */
  private setValueByPath(obj: any, path: string, value: unknown): void {
    if (!path) {
      throw new Error('[ContextSharingManager] Path is required');
    }
    const keys = path.split('.').filter(Boolean);
    if (keys.length === 0) {
      throw new Error('[ContextSharingManager] Path is required');
    }
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!key) {
        throw new Error('[ContextSharingManager] Path is required');
      }
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }

    const lastKey = keys[keys.length - 1];
    if (!lastKey) {
      throw new Error('[ContextSharingManager] Path is required');
    }
    current[lastKey] = value;
  }

  /**
   * Deletes value by JSON path
   */
  private deleteValueByPath(obj: any, path: string): void {
    if (!path) {
      throw new Error('[ContextSharingManager] Path is required');
    }
    const keys = path.split('.').filter(Boolean);
    if (keys.length === 0) {
      throw new Error('[ContextSharingManager] Path is required');
    }
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!key) {
        throw new Error('[ContextSharingManager] Path is required');
      }
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return;
      }
    }

    if (current && typeof current === 'object') {
      const lastKey = keys[keys.length - 1];
      if (!lastKey) {
        throw new Error('[ContextSharingManager] Path is required');
      }
      delete current[lastKey];
    }
  }

  /**
   * Deep clones an object
   */
  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Generates a unique shared context ID
   */
  private generateSharedContextId(sourceWorkflowId: string): string {
    return `shared_${sourceWorkflowId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates a unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates a unique event ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleans up all data for a workflow
   */
  cleanup(workflowId: string): void {
    // Remove shared contexts created by this workflow
    for (const [contextId, sharedContext] of Array.from(
      this.sharedContexts.entries(),
    )) {
      if (sharedContext.sourceWorkflowId === workflowId) {
        this.sharedContexts.delete(contextId);
        this.syncSubscriptions.delete(contextId);
        this.accessHistory.delete(contextId);
      }
    }

    // Remove access requests from this workflow
    for (const [requestId, accessRequest] of Array.from(
      this.accessRequests.entries(),
    )) {
      if (accessRequest.requesterWorkflowId === workflowId) {
        this.accessRequests.delete(requestId);
      }
    }

    // Remove subscriptions for this workflow
    for (const [contextId, subscribers] of Array.from(
      this.syncSubscriptions.entries(),
    )) {
      const index = subscribers.indexOf(workflowId);
      if (index > -1) {
        subscribers.splice(index, 1);
        if (subscribers.length === 0) {
          this.syncSubscriptions.delete(contextId);
        }
      }
    }

    log.debug('[ContextSharingManager] Cleaned up workflow data', {
      workflowId,
    });
  }
}
