import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkflowId } from 'src/types';
import {
  addToServiceChain,
  enrichEventContext,
  trackProcessingTime,
} from '../../core/events/context-utils';
import { WithEventContext } from '../../core/events/observable-event.context';

/**
 * Actual DistilBERT API Response Types (from the real service)
 */
export interface ActualDistilBERTResponse {
  label: string;
  confidence: number;
  all_probabilities: Record<string, number>;
}

/**
 * Internal DistilBERT classification format (for compatibility)
 */
export interface DistilBERTClassification {
  label: string;
  score: number;
}

export interface DistilBERTResponse {
  labels: DistilBERTClassification[];
  text: string;
  model: string;
  processing_time_ms: number;
}

/**
 * Classification request and response types
 */
export interface ClassificationRequest {
  text: string;
  candidateLabels?: string[];
  threshold?: number;
  multiLabel?: boolean;
}

export interface ClassificationResult {
  detectedIntent: string;
  intentConfidence: number;
  reasoning?: string;
  allPredictions?: DistilBERTClassification[];
}

/**
 * Structured error class for Classification API failures
 */
export class ClassificationApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly originalError?: string,
  ) {
    super(message);
    this.name = 'ClassificationApiError';
  }
}

/**
 * Classification Client Service for DistilBERT model
 *
 * This service provides fast, specialized classification using a locally-hosted
 * DistilBERT model, optimized for intent classification tasks.
 */
@Injectable()
export class ClassificationClientService {
  private readonly logger = new Logger(ClassificationClientService.name);
  private readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeout: number;
  private readonly confidenceThreshold: number;

  constructor(private configService: ConfigService) {
    // Classification service configuration
    const enabledValue = this.configService.get<string>(
      'LOCAL_CLASSIFIER_ENABLED',
      'false',
    );
    this.enabled = enabledValue === 'true';
    this.baseUrl = this.configService.get<string>(
      'LLM_CLASSIFIER_URL',
      'http://192.168.50.212:11217',
    );
    this.model = this.configService.get<string>(
      'LLM_CLASSIFIER_MODEL',
      'distilbert-base-uncased-finetuned-sst-2-english',
    );
    this.timeout = this.configService.get<number>(
      'LLM_CLASSIFIER_TIMEOUT',
      10000, // 10 seconds - much faster than LLMs
    );
    this.confidenceThreshold = this.configService.get<number>(
      'LLM_CLASSIFIER_CONFIDENCE_THRESHOLD',
      0.5,
    );

    this.logger.log('ClassificationClientService initialized', {
      enabled: this.enabled,
      baseUrl: this.baseUrl,
      model: this.model,
      timeout: this.timeout,
      confidenceThreshold: this.confidenceThreshold,
    });

    // Validation
    if (this.enabled) {
      this.validateConfiguration();
    }
  }

  /**
   * Validate classification service configuration
   */
  private validateConfiguration(): void {
    if (!this.baseUrl) {
      throw new Error(
        'LLM_CLASSIFIER_URL is required when classifier is enabled',
      );
    }

    try {
      new URL(this.baseUrl);
    } catch {
      throw new Error(
        `Invalid LLM_CLASSIFIER_URL: ${this.baseUrl}. Must be a valid URL`,
      );
    }

    if (this.timeout < 1000 || this.timeout > 60000) {
      throw new Error(
        'LLM_CLASSIFIER_TIMEOUT must be between 1000ms and 60000ms',
      );
    }

    if (this.confidenceThreshold < 0 || this.confidenceThreshold > 1) {
      throw new Error(
        'LLM_CLASSIFIER_CONFIDENCE_THRESHOLD must be between 0 and 1',
      );
    }
  }

  /**
   * Check if classification service is enabled and available
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Classify text using DistilBERT model
   */
  @WithEventContext('ClassificationClientService')
  async classify(
    text: string,
    candidateLabels?: string[],
    source: { workflowId?: WorkflowId; nodeId?: string } = {},
  ): Promise<ClassificationResult> {
    if (!this.enabled) {
      throw new Error(
        'Classification service is not enabled - caller should check isEnabled() first',
      );
    }

    const classificationStartTime = Date.now();
    addToServiceChain('ClassificationClientService');

    enrichEventContext({
      nodeId: source.nodeId,
    });

    this.logger.debug('Starting text classification', {
      textLength: text.length,
      candidateLabels,
      nodeId: source.nodeId,
    });

    try {
      const request: ClassificationRequest = {
        text,
        candidateLabels,
        threshold: this.confidenceThreshold,
        multiLabel: false, // Single-label classification for now
      };

      const response = await this.callDistilBERTAPI(request, source);
      const result = this.transformToClassificationResult(response, text);

      trackProcessingTime('classificationCall', classificationStartTime);

      this.logger.debug('Classification completed successfully', {
        detectedIntent: result.detectedIntent,
        confidence: result.intentConfidence,
        processingTime: Date.now() - classificationStartTime,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - classificationStartTime;
      this.logger.error(`Classification failed after ${duration}ms:`, error);

      throw error;
    }
  }

  /**
   * Call DistilBERT classification API
   */
  private async callDistilBERTAPI(
    request: ClassificationRequest,
    source: { workflowId?: WorkflowId; nodeId?: string } = {},
  ): Promise<DistilBERTResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      this.logger.debug('Calling DistilBERT API', {
        url: `${this.baseUrl}/classify`,
        model: this.model,
        textLength: request.text.length,
      });

      const response = await fetch(`${this.baseUrl}/classify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: request.text,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ClassificationApiError(
          `DistilBERT API error: ${response.status} ${response.statusText} - ${errorText}`,
          response.status,
          errorText,
        );
      }

      const actualData = (await response.json()) as ActualDistilBERTResponse;

      // Validate response structure
      if (!actualData.label || typeof actualData.confidence !== 'number') {
        throw new Error(
          'Invalid response from DistilBERT API: missing label or confidence',
        );
      }

      // Transform to internal format
      const transformedData: DistilBERTResponse = {
        labels: [
          {
            label: actualData.label,
            score: actualData.confidence,
          },
          // Add other probabilities as additional predictions
          ...Object.entries(actualData.all_probabilities || {})
            .filter(([label]) => label !== actualData.label)
            .sort(([, a], [, b]) => b - a)
            .map(([label, score]) => ({ label, score })),
        ],
        text: request.text,
        model: this.model,
        processing_time_ms: Date.now(), // Placeholder since real service doesn't provide this
      };

      this.logger.debug('DistilBERT API response received', {
        labelCount: transformedData.labels.length,
        topLabel: transformedData.labels[0]?.label,
        topScore: transformedData.labels[0]?.score,
        allProbabilities: actualData.all_probabilities,
      });

      return transformedData;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('DistilBERT classification request timeout');
      }
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new Error(
          'DistilBERT classification server connection refused - server may be down',
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Transform DistilBERT response to expected classification result format
   */
  private transformToClassificationResult(
    response: DistilBERTResponse,
    originalText: string,
  ): ClassificationResult {
    const topPrediction = response.labels[0];

    if (!topPrediction) {
      throw new Error('No predictions returned from DistilBERT model');
    }

    // Generate reasoning based on confidence and alternatives
    let reasoning = `Classification confidence: ${(topPrediction.score * 100).toFixed(1)}%`;

    if (response.labels.length > 1) {
      const secondBest = response.labels[1];
      if (secondBest) {
        reasoning += `, next best: ${secondBest.label} (${(secondBest.score * 100).toFixed(1)}%)`;
      }
    }

    if (topPrediction.score < this.confidenceThreshold) {
      reasoning += ` - WARNING: Below confidence threshold of ${this.confidenceThreshold}`;
    }

    return {
      detectedIntent: topPrediction.label,
      intentConfidence: topPrediction.score,
      reasoning,
      allPredictions: response.labels,
    };
  }

  /**
   * Health check for the classification service
   */
  async healthCheck(): Promise<{
    available: boolean;
    model: string;
    responseTime?: number;
    error?: string;
  }> {
    if (!this.enabled) {
      return {
        available: false,
        model: this.model,
        error: 'Classification service not enabled',
      };
    }

    try {
      const startTime = Date.now();

      // Simple health check with minimal text
      await this.callDistilBERTAPI({
        text: 'health check',
      });

      const responseTime = Date.now() - startTime;

      return {
        available: true,
        model: this.model,
        responseTime,
      };
    } catch (error) {
      return {
        available: false,
        model: this.model,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
