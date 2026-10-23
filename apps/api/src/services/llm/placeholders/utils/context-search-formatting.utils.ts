import { Logger } from '@nestjs/common';

import { ArtifactWithMetadata } from '../../../../context/interfaces';
import { errorToLoggable } from '../../../../utils/logging.util';

export const contextSearchLogger = new Logger('ContextSearchPlaceholder');

export function formatContextSearchResults(
  artifacts: ArtifactWithMetadata[],
): string {
  return artifacts
    .map((artifact, index) => {
      const lines: string[] = [];
      lines.push(
        `${index + 1}. ${artifact.title || artifact.type || 'Search Result'}`,
      );

      if (
        typeof artifact.relevanceScore === 'number' &&
        Number.isFinite(artifact.relevanceScore)
      ) {
        lines.push(`Similarity: ${artifact.relevanceScore.toFixed(3)}`);
      }

      const content = extractSearchResultContent(artifact.data);
      const truncated = truncateSearchContent(content);

      if (truncated) {
        lines.push(`Content: ${truncated}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

function truncateSearchContent(content: string): string {
  if (!content) {
    return '';
  }

  const trimmed = content.trim();
  if (trimmed.length <= 600) {
    return trimmed;
  }

  return `${trimmed.slice(0, 600)}...`;
}

function extractSearchResultContent(data: unknown): string {
  if (!data) {
    return '';
  }

  if (typeof data === 'string') {
    return data;
  }

  if (typeof data === 'object') {
    if ('content' in (data as Record<string, unknown>)) {
      const value = (data as Record<string, unknown>).content;
      if (typeof value === 'string') {
        return value;
      }
    }

    try {
      return JSON.stringify(data);
    } catch (error) {
      contextSearchLogger.warn(
        'Failed to stringify context search result data',
        errorToLoggable(error),
      );
      return '';
    }
  }

  return '';
}
