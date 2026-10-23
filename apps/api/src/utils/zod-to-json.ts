/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';

function innerToScalar(schema: z.ZodType<any>) {
  if (schema instanceof z.ZodString) {
    return 'string';
  }

  // Handle number
  if (schema instanceof z.ZodNumber) {
    return 0;
  }

  // Handle boolean
  if (schema instanceof z.ZodBoolean) {
    return true;
  }

  return;
}

export function zodSchemaToJson(schema: z.ZodType<any>): any {
  // Handle nullable wrapper
  if (schema instanceof z.ZodNullable) {
    // Check if the nullable wrapper itself has a description
    const description = (schema as any)._def.description;
    if (description) {
      // Try to parse as JSON if it looks like an array
      try {
        const parsed = JSON.parse(description);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Not JSON, return as is
      }
      return description;
    }
    // Otherwise recurse into the inner type
    return zodSchemaToJson(schema._def.innerType);
  }

  // Handle optional wrapper
  if (schema instanceof z.ZodOptional) {
    // Check if the optional wrapper itself has a description
    const description = (schema as any)._def.description;
    if (description) {
      // Try to parse as JSON if it looks like an array
      try {
        const parsed = JSON.parse(description);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Not JSON, return as is
      }
      return description;
    }
    // Otherwise recurse into the inner type
    return zodSchemaToJson(schema._def.innerType);
  }

  // Handle default wrapper
  if (schema instanceof z.ZodDefault) {
    return zodSchemaToJson(schema._def.innerType);
  }

  // Handle literal - return the actual literal value
  if (schema instanceof z.ZodLiteral) {
    return schema._def.value;
  }

  // Handle string
  if (schema instanceof z.ZodString) {
    const description = (schema as any)._def.description;
    return description || 'string';
  }

  // Handle number
  if (schema instanceof z.ZodNumber) {
    const description = (schema as any)._def.description;
    // If description looks like a number, parse it
    if (description) {
      const parsed = Number(description);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
    const checks = (schema as any)._def.checks || [];
    let min = 0;
    let max = 100;

    for (const check of checks) {
      if (check.kind === 'min') min = check.value;
      if (check.kind === 'max') max = check.value;
    }

    // Return a sensible example within the range
    if (min === 0 && max === 1) {
      return 0.85; // Common confidence/probability value
    } else if (min === 0 && max === 100) {
      return 75;
    } else if (min === 1 && max === 5) {
      return 4; // Common rating value
    } else {
      return min; // Safe default
    }
  }

  // Handle boolean
  if (schema instanceof z.ZodBoolean) {
    const description = (schema as any)._def.description;
    if (description === 'true') return true;
    if (description === 'false') return false;
    return description ? `${description} (true|false)` : 'true|false';
  }

  if (schema instanceof z.ZodEnum) {
    const description = (schema as any)._def.description;
    const values = schema._def.values;

    // If description matches one of the enum values, use it
    if (description && values.includes(description)) {
      return description;
    }

    // Otherwise return the first enum value as example
    return Array.isArray(values)
      ? `[SELECT ONE: ${values.map((v) => `${v}`).join(', ')}]`
      : `${values}`;
  }

  // Handle array
  if (schema instanceof z.ZodArray) {
    const description = (schema as any)._def.description;

    // If array has a description that looks like JSON, parse and return it
    if (description) {
      try {
        const parsed = JSON.parse(description);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Not valid JSON, continue
      }
    }

    // For arrays without JSON descriptions, create example from inner type
    const innerType = schema._def.type as z.ZodType<any>;
    if (innerType instanceof z.ZodObject || innerType instanceof z.ZodArray) {
      // For object arrays, create one example object
      const innerExample = zodSchemaToJson(innerType);
      return [innerExample];
    }

    // For primitive arrays without descriptions, return empty array
    // (they should have descriptions if they need values)
    try {
      return description ? [description] : [innerToScalar(innerType)];
    } catch (_err) {
      return [];
    }
  }

  // Handle object
  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape();
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(shape)) {
      const fieldValue = zodSchemaToJson(value as z.ZodType<any>);

      // Only include if value is defined (handles optional fields)
      if (fieldValue !== undefined) {
        result[key] = fieldValue;
      }
    }

    return result;
  }

  // Handle any
  if (schema instanceof z.ZodAny) {
    const description = (schema as any)._def.description;
    return description || {};
  }

  // Default: try to use description
  const description = (schema as any)._def.description;
  return description || null;
}
