/**
 * Utility for extracting JSON content from LLM responses that may be wrapped
 * in markdown code blocks or mixed with explanatory text
 */
export class JsonExtractionUtil {
  /**
   * Extracts JSON content from LLM responses that may be wrapped in markdown code blocks
   * Handles both ```json and ``` code block formats, as well as plain text responses
   */
  static extractJSONFromResponse(
    content: string,
    options?: {
      strippedJsonCodeBlocks?: boolean;
      strippedCodeBlocks?: boolean;
      strippedExplanatoryText?: boolean;
    },
  ): string {
    let cleanedContent = content.trim();

    // First, try to parse as-is - handles properly formatted JSON
    try {
      JSON.parse(cleanedContent);
      return cleanedContent;
    } catch {
      // Continue to other extraction methods
    }

    // Check if response is wrapped in ```json code blocks
    if (!options?.strippedJsonCodeBlocks) {
      const jsonCodeBlockRegex = /^```json\s*\n([\s\S]*?)\n```$/;
      const jsonMatch = cleanedContent.match(jsonCodeBlockRegex);

      if (jsonMatch) {
        const captured = jsonMatch[1];
        if (captured === undefined) {
          return cleanedContent;
        }
        // Extract the JSON content from the code block
        cleanedContent = captured.trim();
        return JsonExtractionUtil.extractJSONFromResponse(cleanedContent, {
          strippedJsonCodeBlocks: true,
        });
      }
    }

    if (!options?.strippedCodeBlocks) {
      // Check for generic ``` code blocks that might contain JSON
      const genericCodeBlockRegex = /^```\s*\n([\s\S]*?)\n```$/;
      const genericMatch = cleanedContent.match(genericCodeBlockRegex);

      if (genericMatch) {
        const captured = genericMatch[1];
        if (captured === undefined) {
          return cleanedContent;
        }
        const potentialJson = captured.trim();
        // Validate if it's actually JSON by trying to parse it
        try {
          JSON.parse(potentialJson);
          cleanedContent = potentialJson;
          return JsonExtractionUtil.extractJSONFromResponse(cleanedContent, {
            strippedJsonCodeBlocks: true,
            strippedCodeBlocks: true,
          });
        } catch {
          // If it's not valid JSON, keep looking for other patterns
        }
      }
    }

    // Look for JSON content that starts after explanatory text
    if (!options?.strippedExplanatoryText) {
      // Pattern 1: Look for JSON in ```json code blocks after text
      const jsonStartRegex = /```json\s*\n([\s\S]*?)(?:\n```|$)/;
      const jsonStartMatch = cleanedContent.match(jsonStartRegex);

      if (jsonStartMatch) {
        const captured = jsonStartMatch[1];
        if (captured === undefined) {
          return cleanedContent;
        }
        cleanedContent = captured.trim();
        return JsonExtractionUtil.extractJSONFromResponse(cleanedContent, {
          strippedJsonCodeBlocks: true,
          strippedCodeBlocks: true,
          strippedExplanatoryText: true,
        });
      }

      // Pattern 2: Look for JSON objects that start with { after text preamble
      // Try to find the first complete JSON object in the content
      let braceCount = 0;
      let jsonStart = -1;
      let jsonEnd = -1;

      for (let i = 0; i < cleanedContent.length; i++) {
        const char = cleanedContent[i];
        if (char === '{') {
          if (braceCount === 0) {
            jsonStart = i;
          }
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0 && jsonStart !== -1) {
            jsonEnd = i;
            break;
          }
        }
      }

      if (jsonStart !== -1 && jsonEnd !== -1) {
        const potentialJson = cleanedContent.slice(jsonStart, jsonEnd + 1);
        try {
          JSON.parse(potentialJson);
          return JsonExtractionUtil.extractJSONFromResponse(potentialJson, {
            strippedJsonCodeBlocks: true,
            strippedCodeBlocks: true,
            strippedExplanatoryText: true,
          });
        } catch {
          // Not valid JSON, continue to other patterns
        }
      }
    }

    // Handle escaped JSON strings (e.g., "{\n  \"type\": \"QUESTIONS\",...}")
    try {
      // Try to unescape the string and parse it
      const fixed = cleanedContent.replace(
        /"([^"]*)"/g,
        (_match, content: string) => {
          const escapedContent = content
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
          return `"${escapedContent}"`;
        },
      );
      return fixed;
    } catch {
      // If all parsing attempts fail, return original content
    }

    // If no code blocks found, return original content
    return cleanedContent;
  }
}
