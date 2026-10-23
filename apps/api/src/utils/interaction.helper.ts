import { Injectable } from '@nestjs/common';
import {
  SystemMessageData,
  SystemMessageResponseType,
  UIElement,
} from '../generated';
import { PrismaService } from '../prisma/prisma.service';

// Type definitions for the enhanced schema
interface SchemaField {
  type: string;
  description?: string;
  'ui:prompt'?: string;
  default?: string;
  uiType?: 'textarea' | 'text' | 'number' | 'select' | 'currency' | 'priority';
  placeholder?: string;
  options?: string[];
  required?: boolean;
  isInitialField?: boolean;
  min?: number;
  max?: number;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
}

export interface EnhancedSchema {
  type: string;
  properties: Record<string, SchemaField>;
  required?: string[];
}

@Injectable()
export class InteractionHelper {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate initial system message data from enhanced userPromptSchema
   * Returns SystemMessageData with feedback and questions
   */
  generateOpenerFromSchema(
    userPromptSchema: EnhancedSchema,
  ): SystemMessageData {
    const uiElements = this.generateUIElementsFromSchema(userPromptSchema);

    // Try to get feedback from the schema's feedback field default value
    const feedbackField = userPromptSchema.properties.feedback;
    const response =
      feedbackField?.default || 'Please answer the following questions:';

    return {
      detectedIntent: '',
      intentConfidence: 0,
      type: 'QUESTIONS',
      response,
      uiElements,
    };
  }

  /**
   * Generate array of UI elements from enhanced userPromptSchema
   * Returns all fields that have a prompt defined, prioritizing required fields
   */
  private generateUIElementsFromSchema(
    userPromptSchema: EnhancedSchema,
  ): UIElement[] {
    if (!userPromptSchema || !userPromptSchema.properties) {
      return [];
    }

    const properties = userPromptSchema.properties;
    const required = userPromptSchema.required || [];
    const uiElements: UIElement[] = [];

    // First, add all required fields that have prompts
    for (const fieldName of required) {
      const field = properties[fieldName];
      if (field && field['ui:prompt']) {
        uiElements.push(this.createUIElementFromField(fieldName, field, true));
      }
    }

    // Then, add non-required fields that have prompts
    for (const [fieldName, field] of Object.entries(properties)) {
      if (!required.includes(fieldName) && field['ui:prompt']) {
        uiElements.push(this.createUIElementFromField(fieldName, field, false));
      }
    }

    // If no fields have prompts, return empty array
    if (uiElements.length === 0) {
      return [];
    }

    return uiElements;
  }

  private createUIElementFromField(
    fieldName: string,
    field: SchemaField,
    isRequired: boolean,
  ): UIElement {
    const prompt = field['ui:prompt'];
    if (!prompt) {
      throw new Error(`Missing UI prompt for field "${fieldName}"`);
    }
    const uiElement: UIElement = {
      id: fieldName,
      label: prompt,
      type: (field.uiType || 'textarea') as UIElement['type'],
      required: isRequired,
      placeholder:
        field.placeholder || `Enter ${fieldName.replace('_', ' ')}...`,
      influences: [],
    };

    // Add optional properties if they exist
    if (field.options) {
      uiElement.options = field.options.map((opt) => ({
        value: opt,
        label: opt,
      }));
    }

    return uiElement;
  }

  // TODO: Add new helper methods here as needed for the new workflow system
}
