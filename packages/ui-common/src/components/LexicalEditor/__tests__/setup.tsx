/**
 * Test setup configuration for LexicalSuggestionEditor
 * Configures mocks and test utilities for Lexical editor testing
 */

import React from "react";
import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock DOM methods that Lexical tries to use
Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
  value: vi.fn(() => ({
    top: 0,
    left: 0,
    bottom: 100,
    right: 200,
    width: 200,
    height: 100,
    x: 0,
    y: 0,
    toJSON: vi.fn(),
  })),
  writable: true,
});

Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  value: vi.fn(() => ({
    top: 0,
    left: 0,
    bottom: 100,
    right: 200,
    width: 200,
    height: 100,
    x: 0,
    y: 0,
    toJSON: vi.fn(),
  })),
  writable: true,
});

// Mock window.getSelection
Object.defineProperty(window, "getSelection", {
  value: vi.fn(() => ({
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
    getRangeAt: vi.fn(() => ({
      getBoundingClientRect: vi.fn(() => ({
        top: 0,
        left: 0,
        bottom: 100,
        right: 200,
        width: 200,
        height: 100,
        x: 0,
        y: 0,
        toJSON: vi.fn(),
      })),
    })),
    rangeCount: 0,
    setBaseAndExtent: vi.fn(),
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    isCollapsed: true,
    type: "None",
  })),
  writable: true,
});

// Mock document.createRange
Object.defineProperty(document, "createRange", {
  value: vi.fn(() => ({
    getBoundingClientRect: vi.fn(() => ({
      top: 0,
      left: 0,
      bottom: 100,
      right: 200,
      width: 200,
      height: 100,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    })),
    setStart: vi.fn(),
    setEnd: vi.fn(),
    collapse: vi.fn(),
    selectNode: vi.fn(),
    selectNodeContents: vi.fn(),
  })),
  writable: true,
});

// Mock Lexical editor components for testing
vi.mock("@lexical/react/LexicalComposer", () => ({
  LexicalComposer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="lexical-composer">{children}</div>
  ),
}));

vi.mock("@lexical/react/LexicalRichTextPlugin", () => ({
  RichTextPlugin: ({
    contentEditable,
    placeholder,
  }: {
    contentEditable: React.ReactNode;
    placeholder: React.ReactNode;
  }) => (
    <div data-testid="rich-text-plugin">
      {contentEditable}
      {placeholder}
    </div>
  ),
}));

vi.mock("@lexical/react/LexicalContentEditable", () => ({
  ContentEditable: (props: React.HTMLAttributes<HTMLDivElement>) => (
    <div
      data-testid="content-editable"
      data-lexical-editor="true"
      contentEditable
      {...props}
    />
  ),
}));

vi.mock("@lexical/react/LexicalHistoryPlugin", () => ({
  HistoryPlugin: () => <div data-testid="history-plugin" />,
}));

vi.mock("@lexical/react/LexicalAutoFocusPlugin", () => ({
  AutoFocusPlugin: () => <div data-testid="auto-focus-plugin" />,
}));

vi.mock("@lexical/react/LexicalOnChangePlugin", () => ({
  OnChangePlugin: ({ onChange }: { onChange: (state: unknown) => void }) => {
    // Simulate editor change for testing
    React.useEffect(() => {
      const mockEditorState = { read: vi.fn() };
      onChange(mockEditorState);
    }, [onChange]);

    return <div data-testid="on-change-plugin" />;
  },
}));

vi.mock("@lexical/react/LexicalErrorBoundary", () => ({
  LexicalErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="error-boundary">{children}</div>
  ),
}));

// Mock Lexical core components
vi.mock("@lexical/react/LexicalComposerContext", () => ({
  useLexicalComposerContext: () => [
    {
      // Mock editor instance
      update: vi.fn(),
      read: vi.fn(),
      getEditorState: vi.fn(),
      setEditorState: vi.fn(),
      registerCommand: vi.fn(),
      dispatchCommand: vi.fn(),
      hasNodes: vi.fn(() => true),
      getElementByKey: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
    },
  ],
}));

// Mock markdown support
vi.mock("@lexical/markdown", () => ({
  $convertFromMarkdownString: vi.fn(),
  $convertToMarkdownString: vi.fn(),
  TRANSFORMERS: [],
}));

// Mock Lexical core
vi.mock("lexical", () => ({
  $getRoot: vi.fn(() => ({
    getTextContent: vi.fn(() => "mock content"),
    clear: vi.fn(),
    append: vi.fn(),
  })),
  $getSelection: vi.fn(),
  $createParagraphNode: vi.fn(),
  $createTextNode: vi.fn(),
  $setSelection: vi.fn(),
}));

// Mock Lexical node types
vi.mock("@lexical/code", () => ({
  CodeNode: vi.fn(),
}));

vi.mock("@lexical/link", () => ({
  LinkNode: vi.fn(),
}));

vi.mock("@lexical/list", () => ({
  ListItemNode: vi.fn(),
  ListNode: vi.fn(),
}));

vi.mock("@lexical/rich-text", () => ({
  HeadingNode: vi.fn(),
  QuoteNode: vi.fn(),
}));

// Mock Registry components
vi.mock("../../LlmForms/Registry", () => ({
  AISuggestionTextNode: vi.fn(),
  $createAISuggestionTextNode: vi.fn(),
  HeaderNode: vi.fn(),
  $createHeaderNode: vi.fn(),
  $isHeaderNode: vi.fn(),
  SkeletonNode: vi.fn(),
  $createSkeletonNode: vi.fn(),
  $isSkeletonNode: vi.fn(),
  $createInitiativeSectionSkeleton: vi.fn(),
}));

// Mock utility functions
vi.mock("../../../utils/textDiff", () => ({
  calculateWordDiff: vi.fn(() => ({
    operations: [{ type: "equal", originalText: "test", newText: "test" }],
  })),
  calculateEditHistoryDiffs: vi.fn(() => ({
    hasChanges: false,
    hasMultipleSources: false,
    diffResult: {
      operations: [{ type: "equal", originalText: "test", newText: "test" }],
    },
  })),
}));

vi.mock("../../../utils/initiativeContent", () => ({
  parseUnifiedContent: vi.fn(),
  serializeToUnifiedContent: vi.fn(),
  isMainSectionHeader: vi.fn(),
}));

vi.mock("../../../utils/logger", () => ({
  log: {
    editorChange: vi.fn(),
    editorInit: vi.fn(),
    editorRender: vi.fn(),
    contentSerialize: vi.fn(),
    contentParse: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));
