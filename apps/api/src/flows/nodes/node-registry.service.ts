import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FlowContext, NodeType, INode } from '../../types/flow-internal.types';

/**
 * Central registry for all Injectable flow nodes
 *
 * Nodes register themselves with this service during module initialization.
 * FlowEngineService retrieves nodes from this registry during execution.
 *
 * This replaces the pattern of passing nodes around as plain objects.
 */
@Injectable()
export class NodeRegistry implements OnModuleInit {
  private readonly logger = new Logger(NodeRegistry.name);
  private readonly nodes = new Map<string, INode<FlowContext>>();

  onModuleInit() {
    this.logger.log(`NodeRegistry initialized with ${this.nodes.size} nodes`);
  }

  /**
   * Register a node in the registry
   *
   * @param node - The Injectable node instance to register
   * @throws Error if node with same ID already exists
   */
  register<T extends FlowContext = FlowContext>(node: INode<T>): void {
    if (this.nodes.has(node.id)) {
      throw new Error(
        `Node with ID "${node.id}" is already registered. ` +
          `Ensure each node has a unique ID.`,
      );
    }

    this.nodes.set(node.id, node as unknown as INode<FlowContext>);
    this.logger.debug(`Registered node: ${node.id} (type: ${node.type})`);
  }

  /**
   * Register multiple nodes at once
   *
   * @param nodes - Array of Injectable node instances
   */
  registerMany(nodes: INode[]): void {
    for (const node of nodes) {
      this.register(node);
    }
  }

  /**
   * Get a node by its ID
   *
   * @param nodeId - The unique node identifier
   * @returns The node instance
   * @throws Error if node not found
   */
  get<T extends FlowContext = FlowContext>(nodeId: string): INode<T> {
    const node = this.nodes.get(nodeId);

    if (!node) {
      throw new Error(
        `Node "${nodeId}" not found in registry. ` +
          `Available nodes: ${Array.from(this.nodes.keys()).join(', ')}`,
      );
    }

    return node as INode<T>;
  }

  /**
   * Check if a node exists in the registry
   *
   * @param nodeId - The unique node identifier
   * @returns true if node exists, false otherwise
   */
  has(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  /**
   * Get all registered nodes
   *
   * @returns Array of all node instances
   */
  getAll(): INode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all node IDs
   *
   * @returns Array of all registered node IDs
   */
  getAllIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  /**
   * Get nodes by type
   *
   * @param type - The NodeType to filter by
   * @returns Array of nodes matching the type
   */
  getByType(type: NodeType): INode[] {
    return Array.from(this.nodes.values()).filter((node) => node.type === type);
  }

  /**
   * Clear all registered nodes (primarily for testing)
   */
  clear(): void {
    this.nodes.clear();
    this.logger.debug('Node registry cleared');
  }

  /**
   * Get registry statistics (useful for debugging)
   */
  getStats(): {
    totalNodes: number;
    nodesByType: Record<string, number>;
    nodeIds: string[];
  } {
    const nodesByType: Record<string, number> = {};

    for (const node of this.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    }

    return {
      totalNodes: this.nodes.size,
      nodesByType,
      nodeIds: this.getAllIds(),
    };
  }
}
