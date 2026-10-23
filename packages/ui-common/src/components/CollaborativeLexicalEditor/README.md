# LexicalSuggestionEditor

A powerful, mode-aware text editor built on Lexical with AI suggestion capabilities, structured content support, and template-based editing.

## Overview

The LexicalSuggestionEditor is a React component that provides rich text editing capabilities with three distinct operational modes:

- **Legacy Mode**: Basic text editing with AI suggestion highlighting
- **Unified Mode**: Structured content editing with markdown serialization
- **Template Mode**: Template-driven content creation with skeleton support

## Architecture

This component has been refactored from a monolithic 957-line file into a modular, maintainable architecture:

```
LexicalSuggestionEditor/
├── index.ts                    # Main exports and type re-exports
├── LexicalSuggestionEditor.tsx # Core wrapper component
├── types/                      # TypeScript definitions
│   ├── EditorTypes.ts         # Core component interfaces
│   └── PluginTypes.ts         # Plugin system interfaces
├── plugins/                    # Plugin system
│   ├── OnChangeTextPlugin.tsx  # Debounced change handling
│   ├── InitialContentPlugin.tsx # Content initialization
│   └── SelectionDebugPlugin.tsx # Development debugging
├── modes/                      # Mode-specific handlers
│   ├── LegacyModeHandler.ts   # AI suggestions + plain text
│   ├── UnifiedModeHandler.ts  # Structured content processing
│   └── TemplateModeHandler.ts # Template-based editing
├── utils/                      # Core utilities
│   ├── SerializationEngine.ts  # Markdown serialization + caching
│   ├── ContentParsingEngine.ts # Content processing
│   └── EditorHelpers.ts       # Common utilities
├── styling/                    # Styling system
│   ├── EditorTheme.ts         # Lexical theme configuration
│   ├── EditorStyles.ts        # Memoized MUI styles
│   └── ThemeUtils.ts          # Theme calculation utilities
└── __tests__/                  # Comprehensive test suite
```

## Usage

### Basic Usage

```typescript
import { LexicalSuggestionEditor } from "./components/LexicalSuggestionEditor";

// Legacy mode with AI suggestions
<LexicalSuggestionEditor
  initialValue="Initial text content"
  originalText="Original text for diff comparison"
  onTextChange={(text) => console.log("Text changed:", text)}
  placeholder="Start typing..."
/>;
```

### Unified Mode

```typescript
import type { MultiLevelContent } from "./types/editorTemplate";

const initialContent: MultiLevelContent = {
  description: "Project description",
  details: "Detailed information",
  acceptanceCriteria: "Success criteria",
};

<LexicalSuggestionEditor
  unifiedMode={true}
  initialUnifiedContent={initialContent}
  onUnifiedChange={(content) => console.log("Unified content:", content)}
/>;
```

### Template Mode

```typescript
import type { EditorTemplate } from "./types/editorTemplate";

const template: EditorTemplate = {
  id: "initiative-template",
  name: "Initiative Template",
  sections: [
    {
      id: "description",
      header: { level: 2, text: "Description", editable: false },
      content: { initialText: "", showAsSkeleton: true },
    },
    // ... more sections
  ],
};

<LexicalSuggestionEditor
  template={template}
  onTemplateChange={(updatedTemplate) =>
    console.log("Template updated:", updatedTemplate)
  }
/>;
```

## Props Interface

```typescript
interface LexicalSuggestionEditorProps {
  // Basic props
  initialValue?: string;
  originalText?: string;
  onTextChange?: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;

  // Unified mode props
  unifiedMode?: boolean;
  onUnifiedChange?: (content: MultiLevelContent) => void;
  initialUnifiedContent?: MultiLevelContent;
  showSkeletons?: boolean; // DEPRECATED: use template instead

  // Template mode props (preferred approach)
  template?: EditorTemplate;
  onTemplateChange?: (template: EditorTemplate) => void;
}
```

## Features

### Performance Optimizations

- **Memoized styles**: Prevents style recalculation on every render
- **Instance-specific caching**: Eliminates race conditions in serialization
- **Debounced callbacks**: Reduces callback frequency (300ms default)
- **Conditional debug loading**: Debug plugins only in development

### AI Suggestion System

- **Word-level diffing**: Precise change detection and highlighting
- **Visual feedback**: Color-coded additions, deletions, and replacements
- **Interactive editing**: Edit suggestions in-place with real-time updates

### Template System

- **Section-based editing**: Structured content creation
- **Skeleton support**: Progressive disclosure with loading animations
- **Dynamic headers**: Configurable header levels and editability
- **Content validation**: Ensures template compliance

### Accessibility

- **Keyboard navigation**: Full keyboard support for all interactions
- **Screen reader support**: ARIA labels and proper semantic structure
- **Focus management**: Logical focus flow and visible indicators
- **High contrast**: Theme-aware styling for accessibility

## Mode Details

### Legacy Mode

Best for simple text editing with AI assistance:

- Plain text content with rich formatting
- AI suggestion highlighting with diff visualization
- Simple change callbacks
- Backward compatibility with existing implementations

### Unified Mode

Ideal for structured content editing:

- Markdown-based serialization
- Section headers with custom syntax `[[ SectionName ]]`
- Multi-level content structure (description, details, acceptance criteria)
- Skeleton support for empty sections

### Template Mode

Perfect for consistent content creation:

- Predefined section structure
- Configurable headers and content areas
- Progressive disclosure with skeletons
- Template-driven validation and formatting

## Performance Considerations

### Memory Management

- Cache size limits prevent memory leaks
- Instance-specific caches avoid global state issues
- Automatic cleanup on component unmount
- Debounced operations reduce computational overhead

### Bundle Size Impact

- Modular architecture enables tree-shaking
- Conditional debug plugin loading
- Lazy loading potential for mode handlers
- Minimal external dependencies

### Runtime Performance

- Memoized expensive operations (styling, configuration)
- Change detection prevents unnecessary updates
- Optimized serialization with caching
- Efficient diff algorithms for AI suggestions

## Migration Guide

### From Monolithic Component

The component maintains 100% backward compatibility. Existing usage patterns continue to work without changes:

```typescript
// This still works exactly the same
import { LexicalSuggestionEditor } from "./components/LexicalSuggestionEditor";
```

### Registry Integration

The component maintains its dependencies on Registry components:

- `AISuggestionTextNode` - AI suggestion rendering
- `HeaderNode` - Section headers with custom styling
- `SkeletonNode` - Loading placeholders and progressive disclosure

## Testing

### Test Coverage

- **Utilities**: 95%+ coverage (pure functions)
- **Mode Handlers**: 90%+ coverage (business logic)
- **Plugins**: 80%+ coverage (React integration)
- **Main Component**: 85%+ coverage (integration scenarios)

### Running Tests

```bash
# Run all LexicalSuggestionEditor tests
npm test src/components/LexicalSuggestionEditor

# Run with coverage
npm test src/components/LexicalSuggestionEditor -- --coverage

# Run specific test files
npm test SerializationEngine.test.ts
```

### Test Structure

```
__tests__/
├── LexicalSuggestionEditor.test.tsx  # Integration tests
├── plugins/                          # Plugin-specific tests
├── modes/                           # Mode handler tests
├── utils/                           # Utility function tests
├── styling/                         # Style and theme tests
├── setup.ts                         # Test configuration
└── testUtils.tsx                    # Test helpers and mocks
```

## Development

### Setup

```bash
# Install dependencies
pnpm install

# Run type checking
pnpm run type-check

# Run linting
pnpm run lint

# Run tests
pnpm run test
```

### Adding New Modes

1. Create mode handler in `modes/`
2. Add mode configuration to types
3. Update main component to include new mode
4. Add comprehensive tests
5. Update documentation

### Adding New Plugins

1. Create plugin component in `plugins/`
2. Add plugin props interface to types
3. Register plugin in main component
4. Add unit tests
5. Update plugin index exports

## Troubleshooting

### Common Issues

**Template mode not updating**: Ensure `onTemplateChange` callback is provided and template has proper section structure.

**Cache race conditions**: This has been fixed with instance-specific caches. If issues persist, check for global state sharing.

**Performance problems**: Verify styles are memoized and debug plugins are disabled in production.

**Type errors**: Ensure all imports use proper type imports (`import type`) and no `any` types are used.

### Debug Mode

Enable debug logging in development:

```typescript
// Debug plugins are automatically loaded in development
// Check browser console for detailed logging
```

### Performance Monitoring

```typescript
// Monitor performance in development
React.useEffect(() => {
  if (process.env.NODE_ENV === "development") {
    console.time("LexicalSuggestionEditor-render");
    return () => console.timeEnd("LexicalSuggestionEditor-render");
  }
}, []);
```

## Contributing

### Code Style

- Follow TypeScript strict mode (no `any` types)
- Use functional components with hooks
- Prefer `const` assertions for immutable data
- Use descriptive variable names
- Add JSDoc comments for public APIs

### Pull Request Guidelines

1. Ensure all tests pass (`pnpm run test`)
2. Maintain 100% TypeScript compliance (`pnpm run type-check`)
3. Follow linting rules (`pnpm run lint`)
4. Add tests for new functionality
5. Update documentation for API changes

### Architecture Decisions

- **Modular design**: Each concern separated into focused modules
- **Type safety**: Strict TypeScript throughout
- **Performance first**: Memoization and caching by default
- **Backward compatibility**: Maintain existing API contracts
- **Testing priority**: High test coverage for reliability

---

_This component represents a significant architectural improvement from the original monolithic implementation, providing better maintainability, performance, and developer experience while maintaining complete backward compatibility._
