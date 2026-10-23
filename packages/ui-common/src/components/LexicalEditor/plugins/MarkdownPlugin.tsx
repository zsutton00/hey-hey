/**
 * Markdown Plugin for LexicalSuggestionEditor
 * Enables markdown shortcuts and import/export functionality
 */

import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import {
  TRANSFORMERS,
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type Transformer,
} from "@lexical/markdown";

interface MarkdownPluginProps {
  enableShortcuts?: boolean;
  transformers?: Transformer[];
}

/**
 * Plugin that enables markdown shortcuts and provides markdown conversion utilities
 */
export const MarkdownPlugin: React.FC<MarkdownPluginProps> = ({
  enableShortcuts = true,
  transformers = TRANSFORMERS,
}) => {
  if (!enableShortcuts) {
    return null;
  }

  return <MarkdownShortcutPlugin transformers={transformers} />;
};

/**
 * Hook to provide markdown conversion utilities
 */
export const useMarkdownUtils = () => {
  const [editor] = useLexicalComposerContext();

  const convertFromMarkdown = React.useCallback(
    (markdown: string, transformers: Transformer[] = TRANSFORMERS) => {
      editor.update(() => {
        $convertFromMarkdownString(markdown, transformers);
      });
    },
    [editor]
  );

  const convertToMarkdown = React.useCallback(
    (transformers: Transformer[] = TRANSFORMERS): Promise<string> => {
      return new Promise((resolve) => {
        editor.update(() => {
          const markdown = $convertToMarkdownString(transformers);
          resolve(markdown);
        });
      });
    },
    [editor]
  );

  return {
    convertFromMarkdown,
    convertToMarkdown,
  };
};

/**
 * Enhanced MarkdownPlugin with custom transformers and callbacks
 */
export const EnhancedMarkdownPlugin: React.FC<
  MarkdownPluginProps & {
    onMarkdownImport?: (markdown: string) => void;
    onMarkdownExport?: (markdown: string) => void;
  }
> = ({
  enableShortcuts = true,
  transformers = TRANSFORMERS,
  onMarkdownImport,
  onMarkdownExport,
}) => {
  const { convertFromMarkdown, convertToMarkdown } = useMarkdownUtils();

  // Set up import/export callbacks
  React.useEffect(() => {
    if (onMarkdownImport) {
      // This would be triggered by external events
      // Implementation depends on your specific use case
    }

    if (onMarkdownExport) {
      // This would be triggered by external events
      // Implementation depends on your specific use case
    }
  }, [
    onMarkdownImport,
    onMarkdownExport,
    convertFromMarkdown,
    convertToMarkdown,
  ]);

  return (
    <MarkdownPlugin
      enableShortcuts={enableShortcuts}
      transformers={transformers}
    />
  );
};

export default MarkdownPlugin;
