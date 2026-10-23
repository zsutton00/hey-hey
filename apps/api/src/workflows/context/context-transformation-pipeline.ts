import { log } from '@temporalio/workflow';
import { FlowContext } from '../../types/flow-internal.types';

/**
 * Phase 3: Context Transformation Pipeline System
 *
 * Provides powerful context transformation capabilities including
 * filtering, mapping, aggregation, and enrichment for advanced
 * workflow data processing scenarios.
 */

export interface ContextTransform {
  id: string;
  name: string;
  description: string;

  // Transform configuration
  transformType: TransformType;
  inputSchema?: ContextSchema;
  outputSchema?: ContextSchema;

  // Transform logic
  transformConfig: TransformConfig;

  // Validation
  validateInput: boolean;
  validateOutput: boolean;

  // Error handling
  errorStrategy: TransformErrorStrategy;
  retryConfig?: RetryConfig;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

export interface TransformConfig {
  // Filter configuration
  filters?: FilterConfig[];

  // Mapping configuration
  fieldMappings?: FieldMapping[];

  // Aggregation configuration
  aggregations?: AggregationConfig[];

  // Enrichment configuration
  enrichments?: EnrichmentConfig[];

  // Custom transformation
  customTransform?: CustomTransformConfig;
}

export interface FilterConfig {
  field: string;
  operator: FilterOperator;
  value: unknown;
  condition?: FilterCondition;
}

export interface FieldMapping {
  sourcePath: string;
  targetPath: string;
  transformFunction?: string;
  defaultValue?: unknown;
  required: boolean;
}

export interface AggregationConfig {
  sourceFields: string[];
  targetField: string;
  aggregationType: AggregationType;
  groupBy?: string[];
}

export interface EnrichmentConfig {
  targetField: string;
  enrichmentType: EnrichmentType;
  enrichmentSource: EnrichmentSource;
  enrichmentConfig: Record<string, unknown>;
}

export interface CustomTransformConfig {
  transformFunction: string;
  parameters: Record<string, unknown>;
  timeout?: number;
}

export interface ContextSchema {
  fields: SchemaField[];
  required: string[];
  additionalProperties: boolean;
}

export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  description?: string;
  format?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  items?: SchemaField; // For arrays
  properties?: SchemaField[]; // For objects
}

export interface RetryConfig {
  maxAttempts: number;
  backoffStrategy: BackoffStrategy;
  initialDelay: number;
  maxDelay: number;
  multiplier: number;
}

export enum TransformType {
  FILTER = 'FILTER',
  MAP = 'MAP',
  AGGREGATE = 'AGGREGATE',
  ENRICH = 'ENRICH',
  VALIDATE = 'VALIDATE',
  COMPOSITE = 'COMPOSITE', // Multiple transforms
}

export enum FilterOperator {
  EQUALS = 'EQUALS',
  NOT_EQUALS = 'NOT_EQUALS',
  GREATER_THAN = 'GREATER_THAN',
  LESS_THAN = 'LESS_THAN',
  GREATER_EQUAL = 'GREATER_EQUAL',
  LESS_EQUAL = 'LESS_EQUAL',
  CONTAINS = 'CONTAINS',
  NOT_CONTAINS = 'NOT_CONTAINS',
  STARTS_WITH = 'STARTS_WITH',
  ENDS_WITH = 'ENDS_WITH',
  IN = 'IN',
  NOT_IN = 'NOT_IN',
  EXISTS = 'EXISTS',
  NOT_EXISTS = 'NOT_EXISTS',
  REGEX = 'REGEX',
}

export enum FilterCondition {
  AND = 'AND',
  OR = 'OR',
}

export enum AggregationType {
  COUNT = 'COUNT',
  SUM = 'SUM',
  AVERAGE = 'AVERAGE',
  MIN = 'MIN',
  MAX = 'MAX',
  CONCAT = 'CONCAT',
  COLLECT = 'COLLECT', // Collect into array
  FIRST = 'FIRST',
  LAST = 'LAST',
}

export enum EnrichmentType {
  LOOKUP = 'LOOKUP', // Lookup from data source
  COMPUTE = 'COMPUTE', // Computed field
  EXTERNAL_API = 'EXTERNAL_API', // External API call
  REFERENCE = 'REFERENCE', // Reference to other context
}

export enum EnrichmentSource {
  DATABASE = 'DATABASE',
  EXTERNAL_API = 'EXTERNAL_API',
  SHARED_CONTEXT = 'SHARED_CONTEXT',
  WORKFLOW_STATE = 'WORKFLOW_STATE',
  COMPUTED = 'COMPUTED',
}

export enum SchemaFieldType {
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  ARRAY = 'ARRAY',
  OBJECT = 'OBJECT',
  DATE = 'DATE',
  NULL = 'NULL',
}

export enum TransformErrorStrategy {
  FAIL_FAST = 'FAIL_FAST',
  SKIP_INVALID = 'SKIP_INVALID',
  USE_DEFAULT = 'USE_DEFAULT',
  LOG_AND_CONTINUE = 'LOG_AND_CONTINUE',
  RETRY = 'RETRY',
}

export enum BackoffStrategy {
  FIXED = 'FIXED',
  LINEAR = 'LINEAR',
  EXPONENTIAL = 'EXPONENTIAL',
  RANDOM = 'RANDOM',
}

export interface TransformResult {
  success: boolean;
  transformedContext?: FlowContext;
  originalContext: FlowContext;
  transformsApplied: string[];
  errors: TransformError[];
  warnings: string[];
  executionTime: number;
  metadata: Record<string, unknown>;
}

export interface TransformError {
  transformId: string;
  errorType: string;
  errorMessage: string;
  field?: string;
  value?: unknown;
  timestamp: Date;
}

export interface PipelineExecutionContext {
  workflowId: string;
  executionId: string;
  pipelineId: string;
  startTime: Date;
  currentTransformIndex: number;
  transformResults: TransformResult[];
  context: Record<string, unknown>;
}

export class ContextTransformationPipeline {
  private transforms: Map<string, ContextTransform> = new Map();
  private pipelines: Map<string, ContextTransform[]> = new Map();
  private executionHistory: Map<string, PipelineExecutionContext[]> = new Map();

  /**
   * Registers a context transform
   */
  registerTransform(transform: ContextTransform): void {
    this.transforms.set(transform.id, transform);

    log.debug('[TransformationPipeline] Transform registered', {
      transformId: transform.id,
      name: transform.name,
      type: transform.transformType,
    });
  }

  /**
   * Creates a transformation pipeline
   */
  createPipeline(pipelineId: string, transformIds: string[]): boolean {
    const transforms: ContextTransform[] = [];

    for (const transformId of transformIds) {
      const transform = this.transforms.get(transformId);
      if (!transform) {
        log.error('[TransformationPipeline] Transform not found for pipeline', {
          pipelineId,
          transformId,
        });
        return false;
      }
      transforms.push(transform);
    }

    this.pipelines.set(pipelineId, transforms);

    log.info('[TransformationPipeline] Pipeline created', {
      pipelineId,
      transformCount: transforms.length,
      transforms: transforms.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.transformType,
      })),
    });

    return true;
  }

  /**
   * Executes a transformation pipeline
   */
  async executePipeline(
    workflowId: string,
    pipelineId: string,
    context: FlowContext,
    executionContext?: Record<string, unknown>,
  ): Promise<TransformResult> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      return {
        success: false,
        originalContext: context,
        transformsApplied: [],
        errors: [
          {
            transformId: pipelineId,
            errorType: 'PIPELINE_NOT_FOUND',
            errorMessage: `Pipeline ${pipelineId} not found`,
            timestamp: new Date(),
          },
        ],
        warnings: [],
        executionTime: 0,
        metadata: {},
      };
    }

    const startTime = Date.now();
    const executionId = this.generateExecutionId();

    const pipelineContext: PipelineExecutionContext = {
      workflowId,
      executionId,
      pipelineId,
      startTime: new Date(),
      currentTransformIndex: 0,
      transformResults: [],
      context: executionContext || {},
    };

    let currentContext = this.deepClone(context);
    const transformsApplied: string[] = [];
    const allErrors: TransformError[] = [];
    const allWarnings: string[] = [];

    log.info('[TransformationPipeline] Executing pipeline', {
      workflowId,
      pipelineId,
      executionId,
      transformCount: pipeline.length,
    });

    // Execute transforms in sequence
    for (let i = 0; i < pipeline.length; i++) {
      const transform = pipeline[i];
      if (!transform) {
        allErrors.push({
          transformId: pipelineId,
          errorType: 'PIPELINE_INVALID',
          errorMessage: `Pipeline ${pipelineId} contains an empty transform at index ${i}`,
          timestamp: new Date(),
        });
        break;
      }
      pipelineContext.currentTransformIndex = i;

      try {
        const transformResult = await this.executeTransform(
          transform,
          currentContext,
          pipelineContext,
        );

        pipelineContext.transformResults.push(transformResult);

        if (transformResult.success && transformResult.transformedContext) {
          currentContext = transformResult.transformedContext;
          transformsApplied.push(transform.id);
        } else {
          allErrors.push(...transformResult.errors);
          allWarnings.push(...transformResult.warnings);

          // Handle error based on strategy
          if (transform.errorStrategy === TransformErrorStrategy.FAIL_FAST) {
            break;
          }
        }
      } catch (error) {
        const transformError: TransformError = {
          transformId: transform.id,
          errorType: 'EXECUTION_ERROR',
          errorMessage: (error as Error).message,
          timestamp: new Date(),
        };

        allErrors.push(transformError);

        if (transform.errorStrategy === TransformErrorStrategy.FAIL_FAST) {
          break;
        }
      }
    }

    const executionTime = Date.now() - startTime;
    const success = allErrors.length === 0;

    // Store execution history
    const workflowHistory = this.executionHistory.get(workflowId) || [];
    workflowHistory.push(pipelineContext);
    this.executionHistory.set(workflowId, workflowHistory);

    const result: TransformResult = {
      success,
      transformedContext: success ? currentContext : undefined,
      originalContext: context,
      transformsApplied,
      errors: allErrors,
      warnings: allWarnings,
      executionTime,
      metadata: {
        pipelineId,
        executionId,
        transformCount: pipeline.length,
        completedTransforms: transformsApplied.length,
      },
    };

    log.info('[TransformationPipeline] Pipeline execution completed', {
      workflowId,
      pipelineId,
      executionId,
      success,
      executionTime,
      transformsApplied: transformsApplied.length,
      errorCount: allErrors.length,
      warningCount: allWarnings.length,
    });

    return result;
  }

  /**
   * Executes a single transform
   */
  private async executeTransform(
    transform: ContextTransform,
    context: FlowContext,
    pipelineContext: PipelineExecutionContext,
  ): Promise<TransformResult> {
    const startTime = Date.now();
    const errors: TransformError[] = [];
    const warnings: string[] = [];

    log.debug('[TransformationPipeline] Executing transform', {
      transformId: transform.id,
      name: transform.name,
      type: transform.transformType,
    });

    try {
      // Validate input if required
      if (transform.validateInput && transform.inputSchema) {
        const validationErrors = this.validateContext(
          context,
          transform.inputSchema,
        );
        if (validationErrors.length > 0) {
          errors.push(
            ...validationErrors.map((error) => ({
              transformId: transform.id,
              errorType: 'INPUT_VALIDATION_ERROR',
              errorMessage: error,
              timestamp: new Date(),
            })),
          );

          if (transform.errorStrategy === TransformErrorStrategy.FAIL_FAST) {
            return {
              success: false,
              originalContext: context,
              transformsApplied: [],
              errors,
              warnings,
              executionTime: Date.now() - startTime,
              metadata: { transformId: transform.id },
            };
          }
        }
      }

      // Apply transformation based on type
      let transformedContext: FlowContext;

      switch (transform.transformType) {
        case TransformType.FILTER:
          transformedContext = this.applyFilters(
            context,
            transform.transformConfig.filters || [],
          );
          break;
        case TransformType.MAP:
          transformedContext = this.applyMappings(
            context,
            transform.transformConfig.fieldMappings || [],
          );
          break;
        case TransformType.AGGREGATE:
          transformedContext = this.applyAggregations(
            context,
            transform.transformConfig.aggregations || [],
          );
          break;
        case TransformType.ENRICH:
          transformedContext = await this.applyEnrichments(
            context,
            transform.transformConfig.enrichments || [],
            pipelineContext,
          );
          break;
        case TransformType.VALIDATE:
          transformedContext = context; // Validation doesn't change context
          break;
        case TransformType.COMPOSITE:
          transformedContext = await this.applyCompositeTransform(
            context,
            transform.transformConfig,
            pipelineContext,
          );
          break;
        default:
          throw new Error(
            `Unsupported transform type: ${transform.transformType}`,
          );
      }

      // Validate output if required
      if (transform.validateOutput && transform.outputSchema) {
        const validationErrors = this.validateContext(
          transformedContext,
          transform.outputSchema,
        );
        if (validationErrors.length > 0) {
          errors.push(
            ...validationErrors.map((error) => ({
              transformId: transform.id,
              errorType: 'OUTPUT_VALIDATION_ERROR',
              errorMessage: error,
              timestamp: new Date(),
            })),
          );

          if (transform.errorStrategy === TransformErrorStrategy.FAIL_FAST) {
            return {
              success: false,
              originalContext: context,
              transformsApplied: [],
              errors,
              warnings,
              executionTime: Date.now() - startTime,
              metadata: { transformId: transform.id },
            };
          }
        }
      }

      return {
        success: errors.length === 0,
        transformedContext,
        originalContext: context,
        transformsApplied: [transform.id],
        errors,
        warnings,
        executionTime: Date.now() - startTime,
        metadata: { transformId: transform.id },
      };
    } catch (error) {
      errors.push({
        transformId: transform.id,
        errorType: 'EXECUTION_ERROR',
        errorMessage: (error as Error).message,
        timestamp: new Date(),
      });

      return {
        success: false,
        originalContext: context,
        transformsApplied: [],
        errors,
        warnings,
        executionTime: Date.now() - startTime,
        metadata: { transformId: transform.id },
      };
    }
  }

  /**
   * Applies filter transformations
   */
  private applyFilters(
    context: FlowContext,
    filters: FilterConfig[],
  ): FlowContext {
    const result = this.deepClone(context);

    for (const filter of filters) {
      const value = this.getValueByPath(result, filter.field);
      const passes = this.evaluateFilter(value, filter);

      if (!passes) {
        this.deleteValueByPath(result, filter.field);
      }
    }

    return result;
  }

  /**
   * Applies field mapping transformations
   */
  private applyMappings(
    context: FlowContext,
    mappings: FieldMapping[],
  ): FlowContext {
    const result: any = {};

    for (const mapping of mappings) {
      let value = this.getValueByPath(context, mapping.sourcePath);

      if (value === undefined && mapping.defaultValue !== undefined) {
        value = mapping.defaultValue;
      }

      if (value !== undefined || mapping.required) {
        if (mapping.transformFunction) {
          value = this.applyTransformFunction(value, mapping.transformFunction);
        }

        this.setValueByPath(result, mapping.targetPath, value);
      }
    }

    return result;
  }

  /**
   * Applies aggregation transformations
   */
  private applyAggregations(
    context: FlowContext,
    aggregations: AggregationConfig[],
  ): FlowContext {
    const result = this.deepClone(context);

    for (const aggregation of aggregations) {
      const values = aggregation.sourceFields.map((field) =>
        this.getValueByPath(context, field),
      );
      const aggregatedValue = this.performAggregation(
        values,
        aggregation.aggregationType,
      );

      this.setValueByPath(result, aggregation.targetField, aggregatedValue);
    }

    return result;
  }

  /**
   * Applies enrichment transformations
   */
  private async applyEnrichments(
    context: FlowContext,
    enrichments: EnrichmentConfig[],
    pipelineContext: PipelineExecutionContext,
  ): Promise<FlowContext> {
    const result = this.deepClone(context);

    for (const enrichment of enrichments) {
      try {
        const enrichedValue = await this.performEnrichment(
          enrichment,
          context,
          pipelineContext,
        );
        this.setValueByPath(result, enrichment.targetField, enrichedValue);
      } catch (error) {
        log.warn('[TransformationPipeline] Enrichment failed', {
          targetField: enrichment.targetField,
          enrichmentType: enrichment.enrichmentType,
          error: (error as Error).message,
        });
      }
    }

    return result;
  }

  /**
   * Applies composite transformation
   */
  private async applyCompositeTransform(
    context: FlowContext,
    transformConfig: TransformConfig,
    pipelineContext: PipelineExecutionContext,
  ): Promise<FlowContext> {
    let result = this.deepClone(context);

    // Apply filters first
    if (transformConfig.filters) {
      result = this.applyFilters(result, transformConfig.filters);
    }

    // Apply mappings
    if (transformConfig.fieldMappings) {
      result = this.applyMappings(result, transformConfig.fieldMappings);
    }

    // Apply aggregations
    if (transformConfig.aggregations) {
      result = this.applyAggregations(result, transformConfig.aggregations);
    }

    // Apply enrichments
    if (transformConfig.enrichments) {
      result = await this.applyEnrichments(
        result,
        transformConfig.enrichments,
        pipelineContext,
      );
    }

    return result;
  }

  /**
   * Evaluates a filter condition
   */
  private evaluateFilter(value: unknown, filter: FilterConfig): boolean {
    switch (filter.operator) {
      case FilterOperator.EQUALS:
        return value === filter.value;
      case FilterOperator.NOT_EQUALS:
        return value !== filter.value;
      case FilterOperator.GREATER_THAN:
        return (
          typeof value === 'number' &&
          typeof filter.value === 'number' &&
          value > filter.value
        );
      case FilterOperator.LESS_THAN:
        return (
          typeof value === 'number' &&
          typeof filter.value === 'number' &&
          value < filter.value
        );
      case FilterOperator.CONTAINS:
        return (
          typeof value === 'string' &&
          typeof filter.value === 'string' &&
          value.includes(filter.value)
        );
      case FilterOperator.EXISTS:
        return value !== undefined && value !== null;
      case FilterOperator.NOT_EXISTS:
        return value === undefined || value === null;
      default:
        return true;
    }
  }

  /**
   * Performs aggregation
   */
  private performAggregation(
    values: unknown[],
    aggregationType: AggregationType,
  ): unknown {
    switch (aggregationType) {
      case AggregationType.COUNT:
        return values.filter((v) => v !== undefined && v !== null).length;
      case AggregationType.SUM:
        return values
          .filter((v) => typeof v === 'number')
          .reduce((sum, v) => sum + v, 0);
      case AggregationType.AVERAGE:
        const numbers = values.filter((v) => typeof v === 'number');
        return numbers.length > 0
          ? numbers.reduce((sum, v) => sum + v, 0) / numbers.length
          : 0;
      case AggregationType.MIN:
        const minNumbers = values.filter((v) => typeof v === 'number');
        return minNumbers.length > 0 ? Math.min(...minNumbers) : undefined;
      case AggregationType.MAX:
        const maxNumbers = values.filter((v) => typeof v === 'number');
        return maxNumbers.length > 0 ? Math.max(...maxNumbers) : undefined;
      case AggregationType.CONCAT:
        return values
          .filter((v) => v !== undefined && v !== null)
          .map((v) => String(v))
          .join('');
      case AggregationType.COLLECT:
        return values.filter((v) => v !== undefined && v !== null);
      case AggregationType.FIRST:
        return values.find((v) => v !== undefined && v !== null);
      case AggregationType.LAST:
        return values
          .slice()
          .reverse()
          .find((v) => v !== undefined && v !== null);
      default:
        return undefined;
    }
  }

  /**
   * Performs enrichment
   */
  private async performEnrichment(
    enrichment: EnrichmentConfig,
    context: FlowContext,
    pipelineContext: PipelineExecutionContext,
  ): Promise<unknown> {
    switch (enrichment.enrichmentType) {
      case EnrichmentType.COMPUTE:
        return this.performComputedEnrichment(enrichment, context);
      case EnrichmentType.LOOKUP:
        return this.performLookupEnrichment(enrichment, context);
      case EnrichmentType.REFERENCE:
        return this.performReferenceEnrichment(
          enrichment,
          context,
          pipelineContext,
        );
      default:
        throw new Error(
          `Unsupported enrichment type: ${enrichment.enrichmentType}`,
        );
    }
  }

  /**
   * Performs computed enrichment
   */
  private performComputedEnrichment(
    enrichment: EnrichmentConfig,
    context: FlowContext,
  ): unknown {
    // This would implement various computed field logic
    // For now, return a placeholder
    return `computed_${Date.now()}`;
  }

  /**
   * Performs lookup enrichment
   */
  private performLookupEnrichment(
    enrichment: EnrichmentConfig,
    context: FlowContext,
  ): unknown {
    // This would implement lookup from various data sources
    // For now, return a placeholder
    return `lookup_${Date.now()}`;
  }

  /**
   * Performs reference enrichment
   */
  private performReferenceEnrichment(
    enrichment: EnrichmentConfig,
    context: FlowContext,
    pipelineContext: PipelineExecutionContext,
  ): unknown {
    // This would implement references to other contexts or workflow state
    // For now, return a placeholder
    return `reference_${Date.now()}`;
  }

  /**
   * Applies transform function to a value
   */
  private applyTransformFunction(
    value: unknown,
    functionName: string,
  ): unknown {
    switch (functionName) {
      case 'uppercase':
        return typeof value === 'string' ? value.toUpperCase() : value;
      case 'lowercase':
        return typeof value === 'string' ? value.toLowerCase() : value;
      case 'trim':
        return typeof value === 'string' ? value.trim() : value;
      case 'toString':
        return String(value);
      case 'toNumber':
        return typeof value === 'string' ? parseFloat(value) : value;
      default:
        return value;
    }
  }

  /**
   * Validates context against schema
   */
  private validateContext(
    context: FlowContext,
    schema: ContextSchema,
  ): string[] {
    const errors: string[] = [];

    // Check required fields
    for (const requiredField of schema.required) {
      const value = this.getValueByPath(context, requiredField);
      if (value === undefined || value === null) {
        errors.push(`Required field '${requiredField}' is missing`);
      }
    }

    // Validate field types
    for (const field of schema.fields) {
      const value = this.getValueByPath(context, field.name);
      if (value !== undefined && value !== null) {
        const typeError = this.validateFieldType(value, field);
        if (typeError) {
          errors.push(`Field '${field.name}': ${typeError}`);
        }
      }
    }

    return errors;
  }

  /**
   * Validates field type
   */
  private validateFieldType(value: unknown, field: SchemaField): string | null {
    switch (field.type) {
      case SchemaFieldType.STRING:
        return typeof value !== 'string'
          ? `Expected string, got ${typeof value}`
          : null;
      case SchemaFieldType.NUMBER:
        return typeof value !== 'number'
          ? `Expected number, got ${typeof value}`
          : null;
      case SchemaFieldType.BOOLEAN:
        return typeof value !== 'boolean'
          ? `Expected boolean, got ${typeof value}`
          : null;
      case SchemaFieldType.ARRAY:
        return !Array.isArray(value)
          ? `Expected array, got ${typeof value}`
          : null;
      case SchemaFieldType.OBJECT:
        return typeof value !== 'object' ||
          Array.isArray(value) ||
          value === null
          ? `Expected object, got ${typeof value}`
          : null;
      default:
        return null;
    }
  }

  /**
   * Gets execution history for a workflow
   */
  getExecutionHistory(workflowId: string): PipelineExecutionContext[] {
    return this.executionHistory.get(workflowId) || [];
  }

  /**
   * Gets registered transforms
   */
  getTransforms(): ContextTransform[] {
    return Array.from(this.transforms.values());
  }

  /**
   * Gets registered pipelines
   */
  getPipelines(): { id: string; transforms: ContextTransform[] }[] {
    const result: { id: string; transforms: ContextTransform[] }[] = [];

    for (const [id, transforms] of Array.from(this.pipelines.entries())) {
      result.push({ id, transforms });
    }

    return result;
  }

  // Utility methods
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

  private setValueByPath(obj: any, path: string, value: unknown): void {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (key === undefined) {
        return;
      }
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }

    const lastKey = keys[keys.length - 1];
    if (lastKey === undefined) {
      return;
    }
    current[lastKey] = value;
  }

  private deleteValueByPath(obj: any, path: string): void {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (key === undefined) {
        return;
      }
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return;
      }
    }

    if (current && typeof current === 'object') {
      const lastKey = keys[keys.length - 1];
      if (lastKey === undefined) {
        return;
      }
      delete current[lastKey];
    }
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleans up execution history for a workflow
   */
  cleanup(workflowId: string): void {
    this.executionHistory.delete(workflowId);

    log.debug('[TransformationPipeline] Cleaned up execution history', {
      workflowId,
    });
  }
}
