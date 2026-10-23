# SmarterTextAreaCard with Entity Mentions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Build a Lexical-based text area component that supports @mentioning other entities (tasks, initiatives, etc.) with immutable mention tokens that serialize to `@[type:id|name]` format.

**Architecture:**
- Custom `MentionNode` extends Lexical's `DecoratorNode` to render mentions as immutable badges
- `MentionPlugin` listens for "@" character and triggers mention search/selection
- `MentionPopup` component provides typeahead search with entity type filtering
- `SmarterTextAreaCard` wraps Lexical editor, maintains same props/styling as `SmartTextAreaCard`
- Serialization: Lexical JSON → plain text with `@[type:id|name]` tokens
- Deserialization: Plain text with `@[type:id|name]` → Lexical JSON with `MentionNode`s

**Tech Stack:**
- Lexical 0.38.2 (already in project)
- React 19
- TypeScript with strict types
- MUI for styling (maintain SmartTextAreaCard look/feel)

---

### Task 1: Create mention types and utilities

**Files:**
- Create: `src/components/SmarterTextAreaCard/types.ts`
- Create: `src/components/SmarterTextAreaCard/mentionUtils.ts`
- Create: `src/components/__tests__/mentionUtils.test.ts`

**Step 1: Write the failing test for mention parsing**

Create `src/components/__tests__/mentionUtils.test.ts`:

```typescript
import { parseMentionToken, serializeMentions, deserializeContent } from '../SmarterTextAreaCard/mentionUtils';

describe('Mention utilities', () => {
  describe('parseMentionToken', () => {
    it('should parse a valid mention token', () => {
      const token = '@[task:123|Build login page]';
      const result = parseMentionToken(token);
      expect(result).toEqual({
        entityType: 'task',
        entityId: '123',
        entityName: 'Build login page',
      });
    });

    it('should return null for invalid token', () => {
      const token = '@[invalid]';
      const result = parseMentionToken(token);
      expect(result).toBeNull();
    });

    it('should handle entity names with special characters', () => {
      const token = '@[initiative:456|Q4 Goals: Build & Deploy]';
      const result = parseMentionToken(token);
      expect(result).toEqual({
        entityType: 'initiative',
        entityId: '456',
        entityName: 'Q4 Goals: Build & Deploy',
      });
    });
  });

  describe('serializeMentions', () => {
    it('should serialize mention nodes to token strings', () => {
      const mentions = [
        { entityType: 'task', entityId: '123', entityName: 'Build login' },
        { entityType: 'initiative', entityId: '456', entityName: 'Q4 Goals' },
      ];
      const mentions_map = new Map(mentions.map((m, i) => [i.toString(), m]));
      const result = serializeMentions(mentions_map);
      expect(result).toContainEqual('@[task:123|Build login]');
      expect(result).toContainEqual('@[initiative:456|Q4 Goals]');
    });
  });

  describe('deserializeContent', () => {
    it('should extract mentions from content string', () => {
      const content = 'Check out @[task:123|Build login] and @[initiative:456|Q4 Goals]';
      const mentions = deserializeContent(content);
      expect(mentions).toHaveLength(2);
      expect(mentions[0]).toEqual({
        entityType: 'task',
        entityId: '123',
        entityName: 'Build login',
      });
    });

    it('should handle plain text without mentions', () => {
      const content = 'This is just plain text';
      const mentions = deserializeContent(content);
      expect(mentions).toHaveLength(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm run test src/components/__tests__/mentionUtils.test.ts
```

Expected: FAIL - module not found

**Step 3: Create types file**

Create `src/components/SmarterTextAreaCard/types.ts`:

```typescript
export interface EntityMention {
  entityType: string;
  entityId: string;
  entityName: string;
}

export interface SearchEntity {
  id: string;
  type: string;
  name: string;
  description?: string;
}

export interface MentionSearchRequest {
  query: string;
  entityType: string; // "all" for all types
}
```

**Step 4: Create mentionUtils.ts**

Create `src/components/SmarterTextAreaCard/mentionUtils.ts`:

```typescript
import type { EntityMention } from './types';

const MENTION_REGEX = /@\[([a-z-]+):([a-z0-9-]+)\|([^\]]+)\]/g;
const SINGLE_MENTION_REGEX = /@\[([a-z-]+):([a-z0-9-]+)\|([^\]]+)\]/;

/**
 * Parse a single mention token string into structured data
 * Format: @[type:id|name]
 */
export function parseMentionToken(token: string): EntityMention | null {
  const match = token.match(SINGLE_MENTION_REGEX);
  if (!match) return null;

  return {
    entityType: match[1],
    entityId: match[2],
    entityName: match[3],
  };
}

/**
 * Create a mention token string from structured data
 */
export function createMentionToken(mention: EntityMention): string {
  return `@[${mention.entityType}:${mention.entityId}|${mention.entityName}]`;
}

/**
 * Serialize a map of mentions to an array of token strings
 */
export function serializeMentions(mentionMap: Map<string, EntityMention>): string[] {
  return Array.from(mentionMap.values()).map(createMentionToken);
}

/**
 * Extract all mentions from content string
 */
export function deserializeContent(content: string): EntityMention[] {
  const mentions: EntityMention[] = [];
  const matches = content.matchAll(MENTION_REGEX);

  for (const match of matches) {
    mentions.push({
      entityType: match[1],
      entityId: match[2],
      entityName: match[3],
    });
  }

  return mentions;
}

/**
 * Remove all mention tokens from content, leaving plain text
 */
export function stripMentions(content: string): string {
  return content.replace(MENTION_REGEX, '');
}

/**
 * Replace mention token with display text only (for preview/display)
 */
export function renderMentionAsText(mention: EntityMention): string {
  return `@${mention.entityName}`;
}
```

**Step 5: Run test to verify it passes**

```bash
pnpm run test src/components/__tests__/mentionUtils.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
cd /Users/zac/Desktop/code/hey-hey/ui-common/.worktrees/mention-component
git add src/components/SmarterTextAreaCard/types.ts src/components/SmarterTextAreaCard/mentionUtils.ts src/components/__tests__/mentionUtils.test.ts
git commit -m "feat: add mention types and serialization utilities

- Add EntityMention, SearchEntity, and MentionSearchRequest types
- Implement parseMentionToken, createMentionToken for @[type:id|name] format
- Add serializeMentions, deserializeContent for lexical state conversion
- Add stripMentions and renderMentionAsText helpers
- Include comprehensive tests for all parsing scenarios"
```

---

### Task 2: Create MentionNode (custom Lexical decorator node)

**Files:**
- Create: `src/components/SmarterTextAreaCard/MentionNode.tsx`
- Modify: `src/components/SmarterTextAreaCard/types.ts` (add SerializedMentionNode)
- Create: `src/components/__tests__/MentionNode.test.ts`

**Step 1: Write the failing test for MentionNode**

Create `src/components/__tests__/MentionNode.test.ts`:

```typescript
import { $createMentionNode, $isMentionNode, MentionNode } from '../SmarterTextAreaCard/MentionNode';
import type { EntityMention } from '../SmarterTextAreaCard/types';

describe('MentionNode', () => {
  describe('$createMentionNode', () => {
    it('should create a mention node', () => {
      const mention: EntityMention = {
        entityType: 'task',
        entityId: '123',
        entityName: 'Build login',
      };
      const node = $createMentionNode(mention);
      expect($isMentionNode(node)).toBe(true);
    });

    it('should store mention data correctly', () => {
      const mention: EntityMention = {
        entityType: 'task',
        entityId: '123',
        entityName: 'Build login',
      };
      const node = $createMentionNode(mention) as MentionNode;
      expect(node.getMention()).toEqual(mention);
    });
  });

  describe('MentionNode.exportJSON', () => {
    it('should export mention data', () => {
      const mention: EntityMention = {
        entityType: 'task',
        entityId: '123',
        entityName: 'Build login',
      };
      const node = $createMentionNode(mention) as MentionNode;
      const json = node.exportJSON();
      expect(json.type).toBe('mention');
      expect(json.mention).toEqual(mention);
    });
  });

  describe('MentionNode.importJSON', () => {
    it('should import mention data', () => {
      const serialized = {
        type: 'mention',
        version: 1,
        mention: {
          entityType: 'task',
          entityId: '123',
          entityName: 'Build login',
        },
      };
      const node = MentionNode.importJSON(serialized as any);
      expect($isMentionNode(node)).toBe(true);
      expect((node as MentionNode).getMention()).toEqual(serialized.mention);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm run test src/components/__tests__/MentionNode.test.ts
```

Expected: FAIL - module not found

**Step 3: Update types.ts with SerializedMentionNode**

Add to `src/components/SmarterTextAreaCard/types.ts`:

```typescript
export interface SerializedMentionNode {
  type: 'mention';
  version: 1;
  mention: EntityMention;
}
```

**Step 4: Create MentionNode.tsx**

Create `src/components/SmarterTextAreaCard/MentionNode.tsx`:

```typescript
import type { EditorConfig, NodeKey, SerializedLexicalNode } from 'lexical';
import { $applyNodeReplacement, DecoratorNode } from 'lexical';
import { Box } from '@mui/material';
import React from 'react';
import type { EntityMention, SerializedMentionNode } from './types';

export class MentionNode extends DecoratorNode<React.ReactNode> {
  __mention: EntityMention;

  constructor(mention: EntityMention, key?: NodeKey) {
    super(key);
    this.__mention = mention;
  }

  static getType(): string {
    return 'mention';
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__mention, node.getKey());
  }

  getMention(): EntityMention {
    return this.__mention;
  }

  createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'mention-node';
    span.setAttribute('data-entity-type', this.__mention.entityType);
    span.setAttribute('data-entity-id', this.__mention.entityId);
    span.setAttribute('contenteditable', 'false');
    return span;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): React.ReactNode {
    return (
      <Box
        component="span"
        data-testid="mention-badge"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          backgroundColor: 'primary.main',
          color: 'primary.contrastText',
          borderRadius: '4px',
          padding: '2px 8px',
          fontSize: '0.875rem',
          fontWeight: 500,
          margin: '0 2px',
          cursor: 'default',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          '&:hover': {
            backgroundColor: 'primary.dark',
          },
        }}
      >
        @{this.__mention.entityName}
      </Box>
    );
  }

  static importJSON(serializedNode: SerializedLexicalNode): MentionNode {
    const node = serializedNode as SerializedMentionNode;
    return new MentionNode(node.mention);
  }

  exportJSON(): SerializedMentionNode {
    return {
      type: 'mention',
      version: 1,
      mention: this.__mention,
    };
  }
}

export function $createMentionNode(mention: EntityMention): MentionNode {
  return $applyNodeReplacement(new MentionNode(mention));
}

export function $isMentionNode(node: unknown): node is MentionNode {
  return node instanceof MentionNode;
}
```

**Step 5: Run test to verify it passes**

```bash
pnpm run test src/components/__tests__/MentionNode.test.ts
```

Expected: PASS

**Step 6: Type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 7: Commit**

```bash
git add src/components/SmarterTextAreaCard/MentionNode.tsx src/components/__tests__/MentionNode.test.ts
git commit -m "feat: implement MentionNode as Lexical DecoratorNode

- Create MentionNode extending DecoratorNode for immutable mentions
- Render mentions as styled badges with entity name
- Support serialization/deserialization to mention data
- Mark nodes as non-editable with contenteditable=false
- Include tests for node creation, serialization, and import/export"
```

---

### Task 3: Create MentionPlugin for @ trigger detection

**Files:**
- Create: `src/components/SmarterTextAreaCard/MentionPlugin.tsx`
- Create: `src/components/__tests__/MentionPlugin.test.ts`

**Step 1: Write the failing test for MentionPlugin**

Create `src/components/__tests__/MentionPlugin.test.ts`:

```typescript
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { MentionPlugin } from '../SmarterTextAreaCard/MentionPlugin';
import { MentionNode } from '../SmarterTextAreaCard/MentionNode';
import type { SearchEntity } from '../SmarterTextAreaCard/types';

// Mock search function
const mockSearchEntities = jest.fn(
  async (query: string, type: string): Promise<SearchEntity[]> => {
    if (query === 'build') {
      return [
        { id: '123', type: 'task', name: 'Build login page' },
      ];
    }
    return [];
  }
);

describe('MentionPlugin', () => {
  it('should render popup when @ is typed', async () => {
    const user = userEvent.setup();

    render(
      <LexicalComposer
        initialConfig={{
          namespace: 'TestEditor',
          nodes: [MentionNode],
          theme: {},
          onError: jest.fn(),
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          placeholder={<div>Enter text...</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <MentionPlugin
          onSearchEntities={mockSearchEntities}
          currentEntityType="task"
          mentionableEntityTypes={['task', 'initiative']}
        />
      </LexicalComposer>
    );

    const editor = screen.getByRole('textbox');
    await user.click(editor);
    await user.type(editor, '@build');

    await waitFor(() => {
      expect(mockSearchEntities).toHaveBeenCalledWith('build', 'task');
    });
  });

  it('should close popup on Escape', async () => {
    const user = userEvent.setup();

    const { container } = render(
      <LexicalComposer
        initialConfig={{
          namespace: 'TestEditor',
          nodes: [MentionNode],
          theme: {},
          onError: jest.fn(),
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          placeholder={<div>Enter text...</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <MentionPlugin
          onSearchEntities={mockSearchEntities}
          currentEntityType="task"
          mentionableEntityTypes={['task']}
        />
      </LexicalComposer>
    );

    const editor = screen.getByRole('textbox');
    await user.click(editor);
    await user.type(editor, '@build');
    await user.keyboard('{Escape}');

    await waitFor(() => {
      const popup = container.querySelector('[data-testid="mention-popup"]');
      expect(popup).not.toBeInTheDocument();
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm run test src/components/__tests__/MentionPlugin.test.ts
```

Expected: FAIL - MentionPlugin not found

**Step 3: Create MentionPlugin.tsx**

Create `src/components/SmarterTextAreaCard/MentionPlugin.tsx`:

```typescript
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection, $getRoot, COMMAND_PRIORITY_LOW } from 'lexical';
import { mergeRegister } from '@lexical/utils';
import { KEY_MODIFIER } from 'lexical/dist/LexicalUtils.ts';
import type { SearchEntity, MentionSearchRequest } from './types';

interface MentionPluginProps {
  onSearchEntities: (query: string, entityType: string) => Promise<SearchEntity[]>;
  currentEntityType?: string;
  mentionableEntityTypes?: string[];
}

export const MentionPlugin: React.FC<MentionPluginProps> = ({
  onSearchEntities,
  currentEntityType = 'all',
  mentionableEntityTypes = ['all'],
}) => {
  const [editor] = useLexicalComposerContext();
  const [showPopup, setShowPopup] = useState(false);
  const [query, setQuery] = useState('');
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [searchResults, setSearchResults] = useState<SearchEntity[]>([]);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState(currentEntityType);
  const [isSearching, setIsSearching] = useState(false);

  // Detect @ character and start mention mode
  const handleTextInput = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;

      const anchor = selection.anchor;
      const anchorNode = anchor.getNode();

      // Get text content up to cursor
      if (anchorNode.getType() === 'text') {
        const text = anchorNode.getTextContent();
        const offset = anchor.offset;
        const textBefore = text.substring(0, offset);

        // Check if @ was just typed
        const lastAtIndex = textBefore.lastIndexOf('@');
        if (lastAtIndex >= 0) {
          const queryText = textBefore.substring(lastAtIndex + 1);
          // Only start mention if no space or special chars after @
          if (!/[\s\[\]|]/.test(queryText)) {
            setMentionStart(lastAtIndex);
            setQuery(queryText);
            setShowPopup(true);
          }
        } else {
          setShowPopup(false);
          setMentionStart(null);
        }
      }
    });
  }, [editor]);

  // Search entities when query changes
  useEffect(() => {
    if (!showPopup || !query) {
      setSearchResults([]);
      return;
    }

    const search = async () => {
      setIsSearching(true);
      try {
        const results = await onSearchEntities(query, selectedTypeFilter);
        setSearchResults(results);
      } catch (error) {
        console.error('Mention search error:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    const timer = setTimeout(search, 150); // debounce
    return () => clearTimeout(timer);
  }, [query, selectedTypeFilter, showPopup, onSearchEntities]);

  // Register input listener
  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(() => {
        handleTextInput();
      })
    );
  }, [editor, handleTextInput]);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showPopup) {
        setShowPopup(false);
        e.preventDefault();
      }
    };

    if (showPopup) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [showPopup]);

  if (!showPopup) return null;

  return (
    <div
      data-testid="mention-popup"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 1000,
      }}
    >
      {/* Popup content will be rendered by MentionPopup component */}
      {/* This is a placeholder - actual popup positioning handled in SmarterTextAreaCard */}
    </div>
  );
};
```

**Step 4: Run test to verify it passes**

```bash
pnpm run test src/components/__tests__/MentionPlugin.test.ts
```

Expected: PASS (tests may need adjustment for specific implementation details)

**Step 5: Type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 6: Commit**

```bash
git add src/components/SmarterTextAreaCard/MentionPlugin.tsx src/components/__tests__/MentionPlugin.test.ts
git commit -m "feat: implement MentionPlugin for @ trigger detection

- Detect @ character in text input and enter mention mode
- Track query text after @ for search
- Search entities with debouncing on query change
- Support entity type filtering with type selector
- Close popup on Escape key
- Track mention position for later node insertion"
```

---

### Task 4: Create MentionPopup component for search UI

**Files:**
- Create: `src/components/SmarterTextAreaCard/MentionPopup.tsx`
- Create: `src/components/__tests__/MentionPopup.test.tsx`

**Step 1: Write failing test for MentionPopup**

Create `src/components/__tests__/MentionPopup.test.tsx`:

```typescript
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MentionPopup } from '../SmarterTextAreaCard/MentionPopup';
import type { SearchEntity } from '../SmarterTextAreaCard/types';

describe('MentionPopup', () => {
  const mockResults: SearchEntity[] = [
    { id: '1', type: 'task', name: 'Build login page' },
    { id: '2', type: 'task', name: 'Build profile page' },
  ];

  it('should render search input and type selector', () => {
    render(
      <MentionPopup
        query=""
        results={mockResults}
        selectedTypeFilter="all"
        onTypeFilterChange={jest.fn()}
        onSelectEntity={jest.fn()}
        onClose={jest.fn()}
        isLoading={false}
        entityTypes={['task', 'initiative']}
      />
    );

    expect(screen.getByPlaceholderText(/search for/i)).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('should display search results', () => {
    render(
      <MentionPopup
        query="build"
        results={mockResults}
        selectedTypeFilter="all"
        onTypeFilterChange={jest.fn()}
        onSelectEntity={jest.fn()}
        onClose={jest.fn()}
        isLoading={false}
        entityTypes={['task', 'initiative']}
      />
    );

    expect(screen.getByText('Build login page')).toBeInTheDocument();
    expect(screen.getByText('Build profile page')).toBeInTheDocument();
  });

  it('should call onSelectEntity when result is clicked', async () => {
    const user = userEvent.setup();
    const onSelectEntity = jest.fn();

    render(
      <MentionPopup
        query="build"
        results={mockResults}
        selectedTypeFilter="all"
        onTypeFilterChange={jest.fn()}
        onSelectEntity={onSelectEntity}
        onClose={jest.fn()}
        isLoading={false}
        entityTypes={['task', 'initiative']}
      />
    );

    await user.click(screen.getByText('Build login page'));
    expect(onSelectEntity).toHaveBeenCalledWith(mockResults[0]);
  });

  it('should show loading state', () => {
    render(
      <MentionPopup
        query="build"
        results={[]}
        selectedTypeFilter="all"
        onTypeFilterChange={jest.fn()}
        onSelectEntity={jest.fn()}
        onClose={jest.fn()}
        isLoading={true}
        entityTypes={['task', 'initiative']}
      />
    );

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('should show no results message', () => {
    render(
      <MentionPopup
        query="nonexistent"
        results={[]}
        selectedTypeFilter="all"
        onTypeFilterChange={jest.fn()}
        onSelectEntity={jest.fn()}
        onClose={jest.fn()}
        isLoading={false}
        entityTypes={['task', 'initiative']}
      />
    );

    expect(screen.getByText(/no matches found/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm run test src/components/__tests__/MentionPopup.test.tsx
```

Expected: FAIL - MentionPopup not found

**Step 3: Create MentionPopup.tsx**

Create `src/components/SmarterTextAreaCard/MentionPopup.tsx`:

```typescript
import React from 'react';
import {
  Box,
  TextField,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  CircularProgress,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { SearchEntity } from './types';

interface MentionPopupProps {
  query: string;
  results: SearchEntity[];
  selectedTypeFilter: string;
  onTypeFilterChange: (type: string) => void;
  onSelectEntity: (entity: SearchEntity) => void;
  onClose: () => void;
  isLoading?: boolean;
  entityTypes?: string[];
}

export const MentionPopup: React.FC<MentionPopupProps> = ({
  query,
  results,
  selectedTypeFilter,
  onTypeFilterChange,
  onSelectEntity,
  onClose,
  isLoading = false,
  entityTypes = ['task', 'initiative'],
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const handleTypeChange = (
    _event: React.MouseEvent<HTMLElement>,
    newType: string | null
  ) => {
    if (newType !== null) {
      onTypeFilterChange(newType);
    }
  };

  return (
    <Paper
      data-testid="mention-popup"
      sx={{
        width: 360,
        maxHeight: 400,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 3,
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      {/* Search Header */}
      <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
        <TextField
          fullWidth
          size="small"
          placeholder={t('common.search', { defaultValue: 'Search for ...' })}
          value={query}
          disabled
          variant="outlined"
          sx={{ mb: 2 }}
        />

        {/* Type Selector */}
        <ToggleButtonGroup
          value={selectedTypeFilter}
          exclusive
          onChange={handleTypeChange}
          size="small"
          fullWidth
        >
          <ToggleButton value="all">{t('common.all', { defaultValue: 'All' })}</ToggleButton>
          {entityTypes.map((type) => (
            <ToggleButton key={type} value={type}>
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {/* Results Section */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {isLoading ? (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              flex: 1,
              p: 2,
            }}
          >
            <CircularProgress size={32} />
          </Box>
        ) : results.length > 0 ? (
          <List disablePadding>
            {results.map((entity) => (
              <ListItem key={entity.id} disablePadding>
                <ListItemButton
                  onClick={() => onSelectEntity(entity)}
                  data-testid={`mention-result-${entity.id}`}
                >
                  <ListItemText
                    primary={entity.name}
                    secondary={
                      entity.description ? (
                        <Typography
                          component="span"
                          variant="body2"
                          color="textSecondary"
                          noWrap
                        >
                          {entity.description}
                        </Typography>
                      ) : null
                    }
                  />
                  <Typography variant="caption" sx={{ ml: 1 }}>
                    {entity.type}
                  </Typography>
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        ) : (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="textSecondary" align="center">
              {t('common.noMatches', { defaultValue: 'No matches found' })}
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};
```

**Step 4: Run test to verify it passes**

```bash
pnpm run test src/components/__tests__/MentionPopup.test.tsx
```

Expected: PASS

**Step 5: Type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 6: Commit**

```bash
git add src/components/SmarterTextAreaCard/MentionPopup.tsx src/components/__tests__/MentionPopup.test.tsx
git commit -m "feat: create MentionPopup component for entity search UI

- Build search input and entity type toggle selector
- Display search results as clickable list items
- Show loading spinner during search
- Display 'no matches' message when results are empty
- Support entity type filtering with toggle buttons
- Maintain consistent styling with SmartTextAreaCard"
```

---

### Task 5: Create SmarterTextAreaCard with Lexical integration

**Files:**
- Create: `src/components/SmarterTextAreaCard/SmarterTextAreaCard.tsx`
- Create: `src/components/SmarterTextAreaCard/index.ts`
- Create: `src/components/__tests__/SmarterTextAreaCard.test.tsx`

**Step 1: Write failing test for SmarterTextAreaCard**

Create `src/components/__tests__/SmarterTextAreaCard.test.tsx`:

```typescript
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmarterTextAreaCard } from '../SmarterTextAreaCard';
import type { SearchEntity } from '../SmarterTextAreaCard/types';

const mockSearchEntities = async (query: string, type: string): Promise<SearchEntity[]> => {
  return [
    { id: '123', type: 'task', name: 'Build login page' },
  ];
};

describe('SmarterTextAreaCard', () => {
  it('should render with basic props', () => {
    render(
      <SmarterTextAreaCard
        value=""
        onChange={jest.fn()}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        onSearchEntities={mockSearchEntities}
      />
    );

    expect(screen.getByTestId('smarter-textarea-card')).toBeInTheDocument();
  });

  it('should call onChange when text is typed', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(
      <SmarterTextAreaCard
        value=""
        onChange={onChange}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        onSearchEntities={mockSearchEntities}
      />
    );

    const contentEditable = screen.getByRole('textbox');
    await user.type(contentEditable, 'Hello world');

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
  });

  it('should support mentions with @', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(
      <SmarterTextAreaCard
        value=""
        onChange={onChange}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        onSearchEntities={mockSearchEntities}
        mentionableEntityTypes={['task']}
      />
    );

    const contentEditable = screen.getByRole('textbox');
    await user.type(contentEditable, '@');

    await waitFor(() => {
      expect(screen.getByTestId('mention-popup')).toBeInTheDocument();
    });
  });

  it('should deserialize content with mentions on mount', () => {
    const valueWithMention = 'Check out @[task:123|Build login]';

    render(
      <SmarterTextAreaCard
        value={valueWithMention}
        onChange={jest.fn()}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        onSearchEntities={mockSearchEntities}
      />
    );

    expect(screen.getByTestId('mention-badge')).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm run test src/components/__tests__/SmarterTextAreaCard.test.tsx
```

Expected: FAIL - SmarterTextAreaCard not found

**Step 3: Create SmarterTextAreaCard.tsx**

Create `src/components/SmarterTextAreaCard/SmarterTextAreaCard.tsx`:

```typescript
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import type { EditorState, LexicalEditor } from 'lexical';
import {
  Box,
  Paper,
  Typography,
  Button,
  CircularProgress,
  useTheme,
} from '@mui/material';
import { SlideLeft, SlideRight } from '../animations';
import {
  Save,
  Psychology,
  CheckCircle,
  Send as SendIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { KEYS } from '../i18n/keys';

import { MentionNode } from './MentionNode';
import { MentionPlugin } from './MentionPlugin';
import type { SearchEntity, SaveStatus as SmartTextSaveStatus } from './types';
import { deserializeContent, createMentionToken } from './mentionUtils';

export type SaveStatus =
  | 'draft'
  | 'saving'
  | 'saved'
  | 'submitting'
  | 'sent'
  | 'complete';

type SaveMode = 'silent' | 'feedback' | null;

export interface SmarterTextAreaCardProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  headerText?: string;
  saveStatus: SaveStatus;
  saveMode: SaveMode;
  hasUnsavedChanges: boolean;
  onSaveWithoutFeedback?: () => void;
  onSaveWithFeedback?: () => void;
  isSaving?: boolean;
  saveWithoutFeedbackText?: string;
  saveWithFeedbackText?: string;
  saveWithoutFeedbackIcon?: React.ReactNode;
  saveWithFeedbackIcon?: React.ReactNode;
  multiline?: boolean;
  error?: boolean;
  helperText?: string;
  minRows?: number;
  maxRows?: number;
  required?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onSearchEntities: (query: string, entityType: string) => Promise<SearchEntity[]>;
  currentEntityType?: string;
  mentionableEntityTypes?: string[];
}

const getStatusIcon = (status: SaveStatus): React.ReactNode => {
  switch (status) {
    case 'draft':
      return null;
    case 'saving':
      return <CircularProgress size={16} />;
    case 'saved':
      return <CheckCircle fontSize="small" />;
    case 'submitting':
      return <CircularProgress size={16} />;
    case 'sent':
      return <SendIcon fontSize="small" />;
    case 'complete':
      return <CheckCircle fontSize="small" />;
    default:
      return null;
  }
};

const getStatusColor = (status: SaveStatus): string => {
  switch (status) {
    case 'draft':
      return 'text.secondary';
    case 'saving':
    case 'submitting':
      return 'primary.main';
    case 'saved':
    case 'sent':
    case 'complete':
      return 'success.main';
    default:
      return 'text.secondary';
  }
};

const InternalEditor: React.FC<
  Pick<SmarterTextAreaCardProps, 'onChange' | 'value' | 'onSearchEntities' | 'currentEntityType' | 'mentionableEntityTypes'>
> = ({ onChange, value, onSearchEntities, currentEntityType, mentionableEntityTypes }) => {
  const [editor] = useLexicalComposerContext();
  const isInitializing = useRef(true);

  // Load initial value with mentions
  useEffect(() => {
    if (isInitializing.current && value) {
      editor.update(() => {
        // Parse mentions and load state
        // This is handled by loading the lexical state
        isInitializing.current = false;
      });
    }
  }, [editor, value]);

  return (
    <>
      <OnChangePlugin onChange={(state: EditorState) => {
        state.read(() => {
          // Serialize editor state to text with mentions
          const text = state.getRoot().getTextContent();
          onChange(text);
        });
      }} />
      <MentionPlugin
        onSearchEntities={onSearchEntities}
        currentEntityType={currentEntityType}
        mentionableEntityTypes={mentionableEntityTypes}
      />
      <HistoryPlugin />
      <AutoFocusPlugin />
    </>
  );
};

export const SmarterTextAreaCard: React.FC<SmarterTextAreaCardProps> = ({
  disabled = false,
  error = false,
  hasUnsavedChanges,
  headerText,
  helperText,
  isSaving = false,
  maxRows = 16,
  minRows = 3,
  multiline = true,
  onBlur,
  onChange,
  onFocus,
  onSaveWithFeedback,
  onSaveWithoutFeedback,
  placeholder,
  required = false,
  saveMode,
  saveStatus,
  saveWithFeedbackIcon,
  saveWithFeedbackText,
  saveWithoutFeedbackIcon,
  saveWithoutFeedbackText,
  value,
  onSearchEntities,
  currentEntityType,
  mentionableEntityTypes,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const showSaveWithoutFeedback = !!onSaveWithoutFeedback;
  const showSaveWithFeedback = !!onSaveWithFeedback;

  const defaultSaveWithoutFeedbackText =
    saveWithoutFeedbackText || t(KEYS.common.save);
  const defaultSaveWithFeedbackText =
    saveWithFeedbackText || t(KEYS.initiatives.editor.saveAndGetFeedback);
  const defaultSaveWithoutFeedbackIcon = saveWithoutFeedbackIcon || <Save />;
  const defaultSaveWithFeedbackIcon = saveWithFeedbackIcon || <Psychology />;

  const editorConfig = useMemo(() => {
    return {
      namespace: 'SmarterTextAreaCard',
      nodes: [MentionNode],
      theme: {},
      onError: (error: Error) => console.error('Editor error:', error),
    };
  }, []);

  return (
    <Paper
      data-testid="smarter-textarea-card"
      elevation={0}
      sx={{
        borderRadius: `${theme.shape.borderRadius}px`,
        overflow: 'hidden',
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      {/* Header Section */}
      <Box
        sx={{
          display: 'flex',
          minHeight: 48,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            px: 2,
            bgcolor: theme.palette.mode === 'dark' ? 'grey.800' : '#fcfcfc',
          }}
        >
          {headerText ? (
            <Typography
              variant="body2"
              color="text.primary"
              sx={{
                fontFamily: [
                  '"Tilt Neon"',
                  '"Fira Code"',
                  '"Source Code Pro"',
                  '"SF Mono"',
                  '"Cascadia Code"',
                  '"Consolas"',
                  'monospace',
                ].join(','),
                fontSize: '1rem',
                lineHeight: 1.5,
                padding: '10px 0',
              }}
            >
              {headerText}
            </Typography>
          ) : (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                fontFamily: [
                  '"Tilt Neon"',
                  '"Fira Code"',
                  '"Source Code Pro"',
                  '"SF Mono"',
                  '"Cascadia Code"',
                  '"Consolas"',
                  'monospace',
                ].join(','),
                fontSize: '0.875rem',
                lineHeight: 1.5,
              }}
            >
              {t(KEYS.common.edit)}
            </Typography>
          )}
        </Box>

        <Box
          sx={{
            width: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
            color: getStatusColor(saveStatus),
          }}
        >
          {getStatusIcon(saveStatus)}
        </Box>
      </Box>

      {/* Editor Section */}
      <Box
        sx={{
          bgcolor: 'background.paper',
        }}
      >
        <LexicalComposer initialConfig={editorConfig}>
          <div
            style={{
              position: 'relative',
              fontSize: '1.125rem',
              lineHeight: 1.5,
            }}
          >
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  style={{
                    outline: 'none',
                    padding: '16px',
                    minHeight: `${minRows * 24 + 8}px`,
                    maxHeight: `${maxRows * 24 + 8}px`,
                    overflow: 'auto',
                  }}
                  data-testid="smarter-textarea-input"
                />
              }
              placeholder={
                <div
                  style={{
                    position: 'absolute',
                    top: '16px',
                    left: '16px',
                    color: theme.palette.text.secondary,
                    pointerEvents: 'none',
                  }}
                >
                  {placeholder}
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <InternalEditor
              onChange={onChange}
              value={value}
              onSearchEntities={onSearchEntities}
              currentEntityType={currentEntityType}
              mentionableEntityTypes={mentionableEntityTypes}
            />
          </div>
        </LexicalComposer>
      </Box>

      {helperText && (
        <Typography
          variant="caption"
          color={error ? 'error.main' : 'text.secondary'}
          sx={{ px: 2, pb: 1, display: 'block' }}
        >
          {helperText}
        </Typography>
      )}

      {/* Action Buttons Section */}
      {(showSaveWithoutFeedback || showSaveWithFeedback) && (
        <Box
          sx={{
            display: 'flex',
            borderTop: `1px solid ${theme.palette.divider}`,
            bgcolor: theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
            opacity: hasUnsavedChanges ? 1 : 0.4,
            transition: 'opacity 0.3s ease-in-out',
          }}
        >
          {showSaveWithoutFeedback && (
            <SlideLeft
              delay={showSaveWithFeedback ? 0.15 : 0.1}
              duration="fast"
              style={{ flex: 1, display: 'flex' }}
            >
              <Button
                data-testid="smarter-textarea-save-without-feedback"
                variant="text"
                size="small"
                onClick={onSaveWithoutFeedback}
                disabled={disabled || isSaving || !hasUnsavedChanges}
                startIcon={
                  isSaving && saveMode === 'silent' ? (
                    <CircularProgress size={16} />
                  ) : (
                    defaultSaveWithoutFeedbackIcon
                  )
                }
                sx={{
                  width: '100%',
                  py: 1.5,
                  borderRadius: 0,
                  textTransform: 'none',
                }}
              >
                {isSaving && saveMode === 'silent'
                  ? t(KEYS.common.processing)
                  : defaultSaveWithoutFeedbackText}
              </Button>
            </SlideLeft>
          )}
          {showSaveWithFeedback && (
            <SlideRight
              delay={0.1}
              duration="fast"
              style={{ flex: 1, display: 'flex' }}
            >
              <Button
                data-testid="smarter-textarea-save-with-feedback"
                variant="text"
                size="small"
                onClick={onSaveWithFeedback}
                disabled={disabled || isSaving || !hasUnsavedChanges}
                startIcon={
                  isSaving && saveMode === 'feedback' ? (
                    <CircularProgress size={16} />
                  ) : (
                    defaultSaveWithFeedbackIcon
                  )
                }
                sx={{
                  width: '100%',
                  py: 1.5,
                  borderRadius: 0,
                  borderRight: showSaveWithoutFeedback
                    ? `1px solid ${theme.palette.divider}`
                    : 'none',
                  textTransform: 'none',
                  backgroundColor: theme.palette.actionable.main,
                  color: theme.palette.actionable.contrastText,
                  '&:hover': {
                    backgroundColor: theme.palette.actionable.dark,
                  },
                }}
              >
                {isSaving && saveMode === 'feedback'
                  ? t(KEYS.common.processing)
                  : defaultSaveWithFeedbackText}
              </Button>
            </SlideRight>
          )}
        </Box>
      )}
    </Paper>
  );
};
```

**Step 4: Create index.ts**

Create `src/components/SmarterTextAreaCard/index.ts`:

```typescript
export { SmarterTextAreaCard } from './SmarterTextAreaCard';
export type { SmarterTextAreaCardProps, SaveStatus } from './SmarterTextAreaCard';
export { MentionNode, $createMentionNode, $isMentionNode } from './MentionNode';
export type { EntityMention, SearchEntity } from './types';
export { parseMentionToken, createMentionToken, deserializeContent } from './mentionUtils';
```

**Step 5: Run test to verify it passes**

```bash
pnpm run test src/components/__tests__/SmarterTextAreaCard.test.tsx
```

Expected: PASS

**Step 6: Type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 7: Commit**

```bash
git add src/components/SmarterTextAreaCard/SmarterTextAreaCard.tsx src/components/SmarterTextAreaCard/index.ts src/components/__tests__/SmarterTextAreaCard.test.tsx
git commit -m "feat: implement SmarterTextAreaCard with Lexical editor

- Replace TextField with LexicalComposer for mention support
- Maintain same props interface and styling as SmartTextAreaCard
- Integrate MentionPlugin and MentionNode for @ mention handling
- Support deserialization of @[type:id|name] format on mount
- Preserve header, status indicator, and action buttons
- Include comprehensive tests for editor initialization and mention support"
```

---

### Task 6: Add mention serialization/deserialization to editor

**Files:**
- Modify: `src/components/SmarterTextAreaCard/SmarterTextAreaCard.tsx`
- Create: `src/components/SmarterTextAreaCard/serializationUtils.ts`
- Modify: `src/components/__tests__/SmarterTextAreaCard.test.tsx`

**Step 1: Write test for serialization**

Add to `src/components/__tests__/SmarterTextAreaCard.test.tsx`:

```typescript
describe('SmarterTextAreaCard serialization', () => {
  it('should serialize mentions to @[type:id|name] format', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(
      <SmarterTextAreaCard
        value=""
        onChange={onChange}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        onSearchEntities={mockSearchEntities}
        mentionableEntityTypes={['task']}
      />
    );

    const contentEditable = screen.getByRole('textbox');
    await user.type(contentEditable, '@build');

    await waitFor(() => {
      expect(screen.getByTestId('mention-result-123')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('mention-result-123'));

    await waitFor(() => {
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
      expect(lastCall[0]).toContain('@[task:123|Build login page]');
    });
  });

  it('should deserialize @[type:id|name] to mention nodes on load', () => {
    const valueWithMention = 'Check this out @[task:456|Deploy app] asap';

    const { container } = render(
      <SmarterTextAreaCard
        value={valueWithMention}
        onChange={jest.fn()}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        onSearchEntities={mockSearchEntities}
      />
    );

    const mentionBadge = screen.getByTestId('mention-badge');
    expect(mentionBadge).toBeInTheDocument();
    expect(mentionBadge).toHaveTextContent('@Deploy app');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm run test src/components/__tests__/SmarterTextAreaCard.test.tsx
```

Expected: FAIL - serialization not working

**Step 3: Create serializationUtils.ts**

Create `src/components/SmarterTextAreaCard/serializationUtils.ts`:

```typescript
import { $getRoot, $createTextNode, LexicalNode } from 'lexical';
import type { EntityMention } from './types';
import { $createMentionNode } from './MentionNode';
import { parseMentionToken, deserializeContent } from './mentionUtils';

/**
 * Load content with mentions from plain text into Lexical editor
 * Parses @[type:id|name] tokens and creates MentionNodes
 */
export function loadContentWithMentions(content: string): void {
  const root = $getRoot();
  root.clear();

  if (!content) return;

  // Find all mention tokens
  const mentions = deserializeContent(content);
  const mentionMap = new Map(mentions.map((m) => [m.entityId, m]));

  // Split content by mention tokens
  const parts: Array<{ type: 'text' | 'mention'; content: string | EntityMention }> = [];
  let lastIndex = 0;

  const tokenRegex = /@\[([a-z-]+):([a-z0-9-]+)\|([^\]]+)\]/g;
  let match;

  while ((match = tokenRegex.exec(content))) {
    // Add text before mention
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: content.substring(lastIndex, match.index),
      });
    }

    // Add mention
    const mention = parseMentionToken(match[0]);
    if (mention) {
      parts.push({
        type: 'mention',
        content: mention,
      });
    }

    lastIndex = tokenRegex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push({
      type: 'text',
      content: content.substring(lastIndex),
    });
  }

  // Create paragraph with mixed text and mention nodes
  const paragraph = $createParagraphNode();

  for (const part of parts) {
    if (part.type === 'text') {
      paragraph.append($createTextNode(part.content));
    } else {
      paragraph.append($createMentionNode(part.content));
    }
  }

  root.append(paragraph);
}

/**
 * Serialize Lexical editor state to plain text with mention tokens
 * MentionNodes are serialized to @[type:id|name] format
 */
export function serializeEditorState(): string {
  const root = $getRoot();
  const parts: string[] = [];

  root.getChildren().forEach((child) => {
    if (child.getType() === 'paragraph') {
      child.getChildren().forEach((node) => {
        parts.push(serializeNode(node));
      });
    }
  });

  return parts.join('');
}

function serializeNode(node: LexicalNode): string {
  if (node.getType() === 'mention') {
    const mentionNode = node as any; // MentionNode
    const mention = mentionNode.getMention();
    return `@[${mention.entityType}:${mention.entityId}|${mention.entityName}]`;
  }

  const text = node.getTextContent();
  return text;
}

import { $createParagraphNode } from 'lexical';
```

**Step 4: Update InternalEditor to use serialization**

Modify the `InternalEditor` component in `SmarterTextAreaCard.tsx`:

```typescript
const InternalEditor: React.FC<
  Pick<SmarterTextAreaCardProps, 'onChange' | 'value' | 'onSearchEntities' | 'currentEntityType' | 'mentionableEntityTypes'>
> = ({ onChange, value, onSearchEntities, currentEntityType, mentionableEntityTypes }) => {
  const [editor] = useLexicalComposerContext();
  const isInitializing = useRef(true);
  const previousValueRef = useRef(value);

  // Load initial value with mentions on mount
  useEffect(() => {
    if (isInitializing.current && value) {
      editor.update(() => {
        loadContentWithMentions(value);
        isInitializing.current = false;
      });
    }
  }, [editor]);

  // Reload content when value changes externally
  useEffect(() => {
    if (value !== previousValueRef.current && !isInitializing.current) {
      editor.update(() => {
        loadContentWithMentions(value);
      });
    }
    previousValueRef.current = value;
  }, [value, editor]);

  return (
    <>
      <OnChangePlugin
        onChange={(state: EditorState) => {
          state.read(() => {
            const serialized = serializeEditorState();
            onChange(serialized);
          });
        }}
      />
      <MentionPlugin
        onSearchEntities={onSearchEntities}
        currentEntityType={currentEntityType}
        mentionableEntityTypes={mentionableEntityTypes}
      />
      <HistoryPlugin />
      <AutoFocusPlugin />
    </>
  );
};
```

**Step 5: Import serialization in SmarterTextAreaCard.tsx**

Add to imports:

```typescript
import { loadContentWithMentions, serializeEditorState } from './serializationUtils';
```

**Step 6: Run test to verify it passes**

```bash
pnpm run test src/components/__tests__/SmarterTextAreaCard.test.tsx
```

Expected: PASS

**Step 7: Type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 8: Commit**

```bash
git add src/components/SmarterTextAreaCard/serializationUtils.ts src/components/SmarterTextAreaCard/SmarterTextAreaCard.tsx src/components/__tests__/SmarterTextAreaCard.test.tsx
git commit -m "feat: add mention serialization and deserialization

- Implement loadContentWithMentions to parse @[type:id|name] tokens
- Create MentionNodes from tokens on editor initialization
- Implement serializeEditorState to convert editor state to plain text
- Serialize MentionNodes back to @[type:id|name] format
- Support external value changes by reloading content
- Update OnChangePlugin to use serialization for onChange callbacks"
```

---

### Task 7: Complete MentionPlugin with node insertion and typing

**Files:**
- Modify: `src/components/SmarterTextAreaCard/MentionPlugin.tsx`
- Modify: `src/components/__tests__/MentionPlugin.test.ts`

**Step 1: Update MentionPlugin test for selection behavior**

Modify `src/components/__tests__/MentionPlugin.test.ts`:

```typescript
it('should insert mention node when result is selected', async () => {
  const user = userEvent.setup();

  const { container } = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'TestEditor',
        nodes: [MentionNode],
        theme: {},
        onError: jest.fn(),
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable />}
        placeholder={<div>Enter text...</div>}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <MentionPlugin
        onSearchEntities={mockSearchEntities}
        currentEntityType="task"
        mentionableEntityTypes={['task', 'initiative']}
      />
    </LexicalComposer>
  );

  const editor = screen.getByRole('textbox');
  await user.click(editor);
  await user.type(editor, 'Check @build');

  await waitFor(() => {
    expect(mockSearchEntities).toHaveBeenCalled();
  });

  // Verify mention node is inserted
  await waitFor(() => {
    expect(screen.getByTestId('mention-badge')).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm run test src/components/__tests__/MentionPlugin.test.ts
```

Expected: FAIL - mention selection not working

**Step 3: Complete MentionPlugin implementation**

Replace `src/components/SmarterTextAreaCard/MentionPlugin.tsx` with:

```typescript
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { mergeRegister } from '@lexical/utils';
import type { SearchEntity, EntityMention } from './types';
import { $createMentionNode } from './MentionNode';
import { MentionPopup } from './MentionPopup';
import { Box } from '@mui/material';

interface MentionPluginProps {
  onSearchEntities: (query: string, entityType: string) => Promise<SearchEntity[]>;
  currentEntityType?: string;
  mentionableEntityTypes?: string[];
}

export const MentionPlugin: React.FC<MentionPluginProps> = ({
  onSearchEntities,
  currentEntityType = 'all',
  mentionableEntityTypes = ['all'],
}) => {
  const [editor] = useLexicalComposerContext();
  const [showPopup, setShowPopup] = useState(false);
  const [query, setQuery] = useState('');
  const [mentionStartNode, setMentionStartNode] = useState<any>(null);
  const [searchResults, setSearchResults] = useState<SearchEntity[]>([]);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState(currentEntityType);
  const [isSearching, setIsSearching] = useState(false);
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  // Handle text input and detect @
  const handleTextInput = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        setShowPopup(false);
        return;
      }

      const anchor = selection.anchor;
      const anchorNode = anchor.getNode();

      if (anchorNode.getType() === 'text') {
        const text = anchorNode.getTextContent();
        const offset = anchor.offset;
        const textBefore = text.substring(0, offset);

        const lastAtIndex = textBefore.lastIndexOf('@');
        if (lastAtIndex >= 0) {
          const queryText = textBefore.substring(lastAtIndex + 1);
          // Only show popup if no space or special chars after @
          if (!/[\s\[\]|]/.test(queryText)) {
            setMentionStartNode(anchorNode);
            setQuery(queryText);
            setShowPopup(true);

            // Position popup near cursor
            const editorElement = editor.getRootElement();
            if (editorElement) {
              const rect = editorElement.getBoundingClientRect();
              setPopupPosition({
                top: rect.bottom,
                left: rect.left,
              });
            }
          }
        } else {
          setShowPopup(false);
          setMentionStartNode(null);
        }
      }
    });
  }, [editor]);

  // Search entities
  useEffect(() => {
    if (!showPopup || !query) {
      setSearchResults([]);
      return;
    }

    const search = async () => {
      setIsSearching(true);
      try {
        const results = await onSearchEntities(query, selectedTypeFilter);
        setSearchResults(results);
      } catch (error) {
        console.error('Mention search error:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    const timer = setTimeout(search, 150);
    return () => clearTimeout(timer);
  }, [query, selectedTypeFilter, showPopup, onSearchEntities]);

  // Handle entity selection
  const handleSelectEntity = useCallback(
    (entity: SearchEntity) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();

        if (anchorNode.getType() === 'text' && anchorNode === mentionStartNode) {
          const text = anchorNode.getTextContent();
          const offset = anchor.offset;
          const textBefore = text.substring(0, offset);

          const lastAtIndex = textBefore.lastIndexOf('@');
          if (lastAtIndex >= 0) {
            // Split text at @ position
            const beforeMention = text.substring(0, lastAtIndex);
            const afterMention = text.substring(offset);

            // Create mention data
            const mention: EntityMention = {
              entityType: entity.type,
              entityId: entity.id,
              entityName: entity.name,
            };

            // Replace the text node with: [before] + [mention] + [after]
            anchorNode.setTextContent(beforeMention);

            // Insert mention node
            const mentionNode = $createMentionNode(mention);
            anchorNode.insertAfter(mentionNode);

            // Insert after text
            if (afterMention) {
              mentionNode.insertAfter($createTextNode(afterMention));
            }

            // Move cursor after mention
            const nextNode = mentionNode.getNextSibling();
            if (nextNode) {
              selection.setTextNodeRange(nextNode, 0, nextNode, 0);
            }
          }
        }

        setShowPopup(false);
        setMentionStartNode(null);
        setQuery('');
      });
    },
    [editor, mentionStartNode]
  );

  // Close popup
  const handleClosePopup = useCallback(() => {
    setShowPopup(false);
  }, []);

  // Register input listener
  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(() => {
        handleTextInput();
      }),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        () => {
          if (showPopup && searchResults.length > 0) {
            handleSelectEntity(searchResults[0]);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW
      )
    );
  }, [editor, handleTextInput, showPopup, searchResults, handleSelectEntity]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showPopup) {
        setShowPopup(false);
        e.preventDefault();
      }
    };

    if (showPopup) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [showPopup]);

  if (!showPopup) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: `${popupPosition.top}px`,
        left: `${popupPosition.left}px`,
        zIndex: 1000,
      }}
    >
      <MentionPopup
        query={query}
        results={searchResults}
        selectedTypeFilter={selectedTypeFilter}
        onTypeFilterChange={setSelectedTypeFilter}
        onSelectEntity={handleSelectEntity}
        onClose={handleClosePopup}
        isLoading={isSearching}
        entityTypes={
          mentionableEntityTypes && mentionableEntityTypes[0] !== 'all'
            ? mentionableEntityTypes
            : ['task', 'initiative']
        }
      />
    </Box>
  );
};
```

**Step 4: Run test to verify it passes**

```bash
pnpm run test src/components/__tests__/MentionPlugin.test.ts
```

Expected: PASS

**Step 5: Type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 6: Commit**

```bash
git add src/components/SmarterTextAreaCard/MentionPlugin.tsx
git commit -m "feat: complete MentionPlugin with entity selection and insertion

- Implement mention node insertion on entity selection
- Handle text splitting at @ position
- Position popup near cursor for better UX
- Support Enter key to select first result
- Move cursor after inserted mention node
- Clear mention state after selection
- Support configurable entity type filtering"
```

---

### Task 8: Update component exports and add to index

**Files:**
- Modify: `src/components/index.ts`
- Verify: All files compile and type-check

**Step 1: Add SmarterTextAreaCard to component exports**

Modify `src/components/index.ts`:

```typescript
export { SmarterTextAreaCard } from './SmarterTextAreaCard';
export type { SmarterTextAreaCardProps } from './SmarterTextAreaCard';
```

**Step 2: Run type check to verify everything compiles**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 3: Run full test suite**

```bash
pnpm run test
```

Expected: All tests pass

**Step 4: Commit**

```bash
git add src/components/index.ts
git commit -m "chore: export SmarterTextAreaCard from components index"
```

---

### Task 9: Integration test and example usage

**Files:**
- Create: `src/components/__tests__/SmarterTextAreaCard.integration.test.tsx`

**Step 1: Write integration test**

Create `src/components/__tests__/SmarterTextAreaCard.integration.test.tsx`:

```typescript
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmarterTextAreaCard } from '../SmarterTextAreaCard';
import type { SearchEntity } from '../SmarterTextAreaCard/types';

const mockSearchEntities = async (query: string, type: string): Promise<SearchEntity[]> => {
  // Mock database search
  const allEntities: Record<string, SearchEntity[]> = {
    task: [
      { id: 'task-1', type: 'task', name: 'Build login page', description: 'Authentication UI' },
      { id: 'task-2', type: 'task', name: 'Build profile page', description: 'User profile UI' },
      { id: 'task-3', type: 'task', name: 'Build settings page', description: 'App settings UI' },
    ],
    initiative: [
      { id: 'init-1', type: 'initiative', name: 'Q4 Goals', description: 'Quarterly objectives' },
      { id: 'init-2', type: 'initiative', name: 'Q4 Security', description: 'Security improvements' },
    ],
  };

  let results: SearchEntity[] = [];
  if (type === 'all') {
    results = Object.values(allEntities).flat();
  } else if (allEntities[type]) {
    results = allEntities[type];
  }

  // Filter by query
  return results.filter((e) =>
    e.name.toLowerCase().includes(query.toLowerCase())
  );
};

describe('SmarterTextAreaCard Integration', () => {
  it('should complete full mention workflow', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(
      <SmarterTextAreaCard
        value=""
        onChange={onChange}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={true}
        onSearchEntities={mockSearchEntities}
        mentionableEntityTypes={['task', 'initiative']}
        headerText="Add your notes here"
        placeholder="Type to add notes..."
        onSaveWithoutFeedback={() => console.log('Saved')}
      />
    );

    const editor = screen.getByRole('textbox');

    // Type initial text
    await user.type(editor, 'Need to work on ');

    // Start mention
    await user.type(editor, '@build');

    // Wait for search results
    await waitFor(() => {
      expect(screen.getByTestId('mention-popup')).toBeInTheDocument();
    });

    // Select first result
    const firstResult = screen.getByText('Build login page');
    await user.click(firstResult);

    // Verify mention was inserted
    await waitFor(() => {
      expect(screen.getByTestId('mention-badge')).toBeInTheDocument();
      expect(screen.getByText('@Build login page')).toBeInTheDocument();
    });

    // Verify popup is closed
    await waitFor(() => {
      const popup = screen.queryByTestId('mention-popup');
      expect(popup).not.toBeInTheDocument();
    });

    // Continue typing
    await user.type(editor, ' and then ');
    await user.type(editor, '@q4');

    // Select initiative
    await waitFor(() => {
      expect(screen.getByText('Q4 Goals')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Q4 Goals'));

    // Verify both mentions are present
    await waitFor(() => {
      const badges = screen.getAllByTestId('mention-badge');
      expect(badges).toHaveLength(2);
    });
  });

  it('should handle mention in serialized content on load', () => {
    const onChange = jest.fn();
    const contentWithMentions = 'Review @[task:task-1|Build login page] for @[init-init-1|Q4 Goals]';

    render(
      <SmarterTextAreaCard
        value={contentWithMentions}
        onChange={onChange}
        saveStatus="draft"
        saveMode={null}
        hasUnsavedChanges={false}
        onSearchEntities={mockSearchEntities}
      />
    );

    const badges = screen.getAllByTestId('mention-badge');
    expect(badges).toHaveLength(2);
    expect(screen.getByText('@Build login page')).toBeInTheDocument();
    expect(screen.getByText('@Q4 Goals')).toBeInTheDocument();
  });
});
```

**Step 2: Run integration test**

```bash
pnpm run test src/components/__tests__/SmarterTextAreaCard.integration.test.tsx
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/components/__tests__/SmarterTextAreaCard.integration.test.tsx
git commit -m "test: add integration tests for SmarterTextAreaCard mentions

- Test complete mention workflow from @ to selection
- Test multiple mentions in single content
- Test loading pre-existing mentions from content
- Verify popup behavior and mention badge rendering"
```

---

### Task 10: Update component exports and final verification

**Files:**
- Verify: All tests pass, type checking passes, linting passes

**Step 1: Run full test suite**

```bash
pnpm run test
```

Expected: All tests pass

**Step 2: Run type check**

```bash
pnpm run type-check
```

Expected: Found 0 errors

**Step 3: Run linting**

```bash
pnpm run lint
```

Expected: No errors

**Step 4: Final verification and commit**

```bash
git log --oneline -10
```

Verify all commits are present. Then create final summary commit:

```bash
git commit --allow-empty -m "feat: complete SmarterTextAreaCard with entity mentions

This implementation adds support for @mentioning other entities (tasks, initiatives, etc.) in a Lexical-based text area component.

Features:
- Custom MentionNode extends Lexical's DecoratorNode for immutable mentions
- MentionPlugin detects @ character and triggers entity search
- MentionPopup provides typeahead search with entity type filtering
- Serialization to @[type:id|name] format for persistence
- Deserialization on mount to reconstruct MentionNodes
- Maintains SmartTextAreaCard props interface and visual styling
- Comprehensive test coverage for all components
- Integration tests for complete mention workflow

All tests pass, type checking passes, no linting errors."
```

---

## Usage Example

Once implemented, use `SmarterTextAreaCard` like this:

```typescript
import { SmarterTextAreaCard } from 'src/components/SmarterTextAreaCard';
import type { SearchEntity } from 'src/components/SmarterTextAreaCard/types';

const MyComponent = () => {
  const [value, setValue] = useState('');

  const searchEntities = async (
    query: string,
    entityType: string
  ): Promise<SearchEntity[]> => {
    // Call your backend API to search entities
    const response = await fetch(
      `/api/search?q=${query}&type=${entityType}`
    );
    return response.json();
  };

  return (
    <SmarterTextAreaCard
      value={value}
      onChange={setValue}
      saveStatus="draft"
      saveMode={null}
      hasUnsavedChanges={value !== ''}
      onSearchEntities={searchEntities}
      mentionableEntityTypes={['task', 'initiative']}
      currentEntityType="task"
      headerText="Add your notes"
      placeholder="Type @ to mention entities..."
      onSaveWithoutFeedback={() => console.log('Saved:', value)}
    />
  );
};
```

The `value` prop will contain serialized mentions:
```
"Check out @[task:123|Build login page] for @[initiative:456|Q4 Goals]"
```

Parse on the backend using the regex pattern: `@\[([a-z-]+):([a-z0-9-]+)\|([^\]]+)\]`
