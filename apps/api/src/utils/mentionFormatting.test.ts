import {
  formatMention,
  parseMention,
  extractMentions,
  stripMentions,
  renderMentionText,
  renderMentionsAsText,
  MENTION_TOKEN_REGEX,
  MENTION_TOKEN_SINGLE_REGEX,
  type EntityMention,
} from './mentionFormatting';

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
};

describe('mentionFormatting', () => {
  describe('formatMention', () => {
    it('should format an EntityMention object into a mention token', () => {
      const mention: EntityMention = {
        entityType: 'task',
        entityId: 'abc-123',
        entityName: 'Task A',
      };

      const result = formatMention(mention);

      expect(result).toBe('@[task:abc-123|Task A]');
    });

    it('should handle entity names with spaces', () => {
      const mention: EntityMention = {
        entityType: 'initiative',
        entityId: 'uuid-xyz',
        entityName: 'Project Alpha Phase 2',
      };

      const result = formatMention(mention);

      expect(result).toBe('@[initiative:uuid-xyz|Project Alpha Phase 2]');
    });

    it('should handle design_doc entity type with underscores', () => {
      const mention: EntityMention = {
        entityType: 'design_doc',
        entityId: 'doc-456',
        entityName: 'API Specification',
      };

      const result = formatMention(mention);

      expect(result).toBe('@[design_doc:doc-456|API Specification]');
    });

    it('should handle agent_session entity type', () => {
      const mention: EntityMention = {
        entityType: 'agent_session',
        entityId: 'session-789',
        entityName: 'Feature Implementation',
      };

      const result = formatMention(mention);

      expect(result).toBe(
        '@[agent_session:session-789|Feature Implementation]',
      );
    });
  });

  describe('parseMention', () => {
    it('should parse a valid mention token into an EntityMention object', () => {
      const token = '@[task:abc-123|Task A]';

      const result = parseMention(token);

      expect(result).toEqual({
        entityType: 'task',
        entityId: 'abc-123',
        entityName: 'Task A',
      });
    });

    it('should parse mention with spaces in name', () => {
      const token = '@[initiative:uuid-xyz|Project Alpha Phase 2]';

      const result = parseMention(token);

      expect(result).toEqual({
        entityType: 'initiative',
        entityId: 'uuid-xyz',
        entityName: 'Project Alpha Phase 2',
      });
    });

    it('should parse design_doc type with underscores', () => {
      const token = '@[design_doc:doc-456|API Specification]';

      const result = parseMention(token);

      expect(result).toEqual({
        entityType: 'design_doc',
        entityId: 'doc-456',
        entityName: 'API Specification',
      });
    });

    it('should return null for invalid token format', () => {
      const token = '@[invalid]';

      const result = parseMention(token);

      expect(result).toBeNull();
    });

    it('should return null for plain text', () => {
      const token = 'just plain text';

      const result = parseMention(token);

      expect(result).toBeNull();
    });

    it('should return null for incomplete token', () => {
      const token = '@[task:abc|';

      const result = parseMention(token);

      expect(result).toBeNull();
    });
  });

  describe('extractMentions', () => {
    it('should extract single mention from content', () => {
      const content = 'Check @[task:123|Task A] out';

      const result = extractMentions(content);

      expect(result).toEqual([
        {
          entityType: 'task',
          entityId: '123',
          entityName: 'Task A',
        },
      ]);
    });

    it('should extract multiple mentions from content', () => {
      const content =
        'Review @[design_doc:doc-1|API Doc] and @[task:task-2|Task B]';

      const result = extractMentions(content);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        entityType: 'design_doc',
        entityId: 'doc-1',
        entityName: 'API Doc',
      });
      expect(result[1]).toEqual({
        entityType: 'task',
        entityId: 'task-2',
        entityName: 'Task B',
      });
    });

    it('should return empty array if no mentions found', () => {
      const content = 'This is plain text with no mentions';

      const result = extractMentions(content);

      expect(result).toEqual([]);
    });

    it('should handle mentions with complex entity names', () => {
      const content =
        'See @[initiative:init-1|Project: Phase 1 - Design] for details';

      const result = extractMentions(content);

      expect(result).toHaveLength(1);
      const firstMention = assertDefined(result[0], 'first mention');
      expect(firstMention.entityName).toBe('Project: Phase 1 - Design');
    });

    it('should extract mentions with different entity types', () => {
      const content =
        '@[task:1|T1] @[initiative:2|I2] @[design_doc:3|D3] @[agent_session:4|C4]';

      const result = extractMentions(content);

      expect(result).toHaveLength(4);
      expect(result.map((m) => m.entityType)).toEqual([
        'task',
        'initiative',
        'design_doc',
        'agent_session',
      ]);
    });
  });

  describe('stripMentions', () => {
    it('should remove single mention from content', () => {
      const content = 'Check @[task:123|Task A] out';

      const result = stripMentions(content);

      expect(result).toBe('Check  out');
    });

    it('should remove multiple mentions from content', () => {
      const content = 'Review @[design_doc:doc-1|API] and @[task:task-2|Task]';

      const result = stripMentions(content);

      expect(result).toBe('Review  and ');
    });

    it('should return unchanged content if no mentions', () => {
      const content = 'Plain text with no mentions';

      const result = stripMentions(content);

      expect(result).toBe('Plain text with no mentions');
    });

    it('should preserve surrounding text', () => {
      const content = 'Start @[task:1|Task] middle @[task:2|Task] end';

      const result = stripMentions(content);

      expect(result).toBe('Start  middle  end');
    });
  });

  describe('renderMentionText', () => {
    it('should render mention as display text', () => {
      const mention: EntityMention = {
        entityType: 'task',
        entityId: '123',
        entityName: 'Task A',
      };

      const result = renderMentionText(mention);

      expect(result).toBe('@Task A');
    });

    it('should handle complex names', () => {
      const mention: EntityMention = {
        entityType: 'initiative',
        entityId: 'uuid',
        entityName: 'Project: Phase 1 - Design',
      };

      const result = renderMentionText(mention);

      expect(result).toBe('@Project: Phase 1 - Design');
    });
  });

  describe('renderMentionsAsText', () => {
    it('should replace single mention token with display text', () => {
      const content = 'Check @[task:123|Task A] out';

      const result = renderMentionsAsText(content);

      expect(result).toBe('Check @Task A out');
    });

    it('should replace multiple mention tokens with display text', () => {
      const content = 'Review @[design_doc:1|API] and @[task:2|Task]';

      const result = renderMentionsAsText(content);

      expect(result).toBe('Review @API and @Task');
    });

    it('should preserve content with no mentions', () => {
      const content = 'Plain text with no mentions';

      const result = renderMentionsAsText(content);

      expect(result).toBe('Plain text with no mentions');
    });

    it('should handle mixed content with mentions', () => {
      const content =
        'Implement @[task:1|Backend API] then review @[design_doc:2|Schema Docs]';

      const result = renderMentionsAsText(content);

      expect(result).toBe('Implement @Backend API then review @Schema Docs');
    });
  });

  describe('Regex patterns', () => {
    describe('MENTION_TOKEN_REGEX', () => {
      it('should match mention tokens globally', () => {
        const content = '@[task:1|A] and @[task:2|B]';

        const matches = content.match(MENTION_TOKEN_REGEX);

        expect(matches).toHaveLength(2);
        expect(matches?.[0]).toBe('@[task:1|A]');
        expect(matches?.[1]).toBe('@[task:2|B]');
      });

      it('should not match invalid tokens', () => {
        const content = '@invalid or @[incomplete';

        const matches = content.match(MENTION_TOKEN_REGEX);

        expect(matches).toBeNull();
      });
    });

    describe('MENTION_TOKEN_SINGLE_REGEX', () => {
      it('should match a single mention token', () => {
        const token = '@[task:123|Task]';

        const match = token.match(MENTION_TOKEN_SINGLE_REGEX);

        expect(match).not.toBeNull();
        expect(match?.[0]).toBe('@[task:123|Task]');
        expect(match?.[1]).toBe('task');
        expect(match?.[2]).toBe('123');
        expect(match?.[3]).toBe('Task');
      });

      it('should extract capture groups correctly', () => {
        const token = '@[design_doc:uuid-abc|API Spec]';

        const match = token.match(MENTION_TOKEN_SINGLE_REGEX);

        expect(match?.[1]).toBe('design_doc');
        expect(match?.[2]).toBe('uuid-abc');
        expect(match?.[3]).toBe('API Spec');
      });

      it('should not match invalid token', () => {
        const token = '@[invalid]';

        const match = token.match(MENTION_TOKEN_SINGLE_REGEX);

        expect(match).toBeNull();
      });
    });
  });

  describe('Round-trip conversions', () => {
    it('should round-trip format and parse correctly', () => {
      const original: EntityMention = {
        entityType: 'task',
        entityId: 'abc-123',
        entityName: 'Important Task',
      };

      const formatted = formatMention(original);
      const parsed = parseMention(formatted);

      expect(parsed).toEqual(original);
    });

    it('should round-trip multiple mentions', () => {
      const mentions: EntityMention[] = [
        { entityType: 'task', entityId: '1', entityName: 'Task 1' },
        { entityType: 'initiative', entityId: '2', entityName: 'Initiative 2' },
        { entityType: 'design_doc', entityId: '3', entityName: 'Doc 3' },
      ];

      const content = mentions.map(formatMention).join(' ');
      const extracted = extractMentions(content);

      expect(extracted).toEqual(mentions);
    });

    it('should handle format -> extract -> parse consistently', () => {
      const original: EntityMention = {
        entityType: 'agent_session',
        entityId: 'session-xyz',
        entityName: 'Feature Development',
      };

      const content = `See @[${formatMention(original).slice(2)}`;
      const extracted = extractMentions(content);

      expect(extracted).toHaveLength(1);
      const firstExtracted = assertDefined(extracted[0], 'first extracted');
      expect(firstExtracted).toEqual(original);
    });
  });

  describe('Escaped bracket variant', () => {
    const unescaped = '@[task:abc-123|Task A]';
    const escaped = '@\\[task:abc-123|Task A]';

    it('parseMention treats escaped token equivalently to unescaped', () => {
      const expected: EntityMention = {
        entityType: 'task',
        entityId: 'abc-123',
        entityName: 'Task A',
      };

      expect(parseMention(escaped)).toEqual(expected);
      expect(parseMention(escaped)).toEqual(parseMention(unescaped));
    });

    it('extractMentions treats escaped token equivalently to unescaped', () => {
      const escapedContent = `Check ${escaped} out`;
      const unescapedContent = `Check ${unescaped} out`;

      expect(extractMentions(escapedContent)).toEqual(
        extractMentions(unescapedContent),
      );
      expect(extractMentions(escapedContent)).toEqual([
        { entityType: 'task', entityId: 'abc-123', entityName: 'Task A' },
      ]);
    });

    it('extractMentions handles a mix of escaped and unescaped tokens', () => {
      const content = `${escaped} and ${unescaped}`;

      const result = extractMentions(content);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        entityType: 'task',
        entityId: 'abc-123',
        entityName: 'Task A',
      });
      expect(result[1]).toEqual({
        entityType: 'task',
        entityId: 'abc-123',
        entityName: 'Task A',
      });
    });

    it('stripMentions removes escaped and unescaped tokens identically', () => {
      expect(stripMentions(`Check ${escaped} out`)).toBe('Check  out');
      expect(stripMentions(`Check ${escaped} out`)).toBe(
        stripMentions(`Check ${unescaped} out`),
      );
    });

    it('renderMentionsAsText replaces escaped tokens with display text', () => {
      expect(renderMentionsAsText(`Check ${escaped} out`)).toBe(
        'Check @Task A out',
      );
      expect(renderMentionsAsText(`Check ${escaped} out`)).toBe(
        renderMentionsAsText(`Check ${unescaped} out`),
      );
    });

    it('formatMention always emits the unescaped canonical form', () => {
      const mention: EntityMention = {
        entityType: 'task',
        entityId: 'abc-123',
        entityName: 'Task A',
      };

      expect(formatMention(mention)).toBe(unescaped);
      expect(formatMention(mention)).not.toContain('\\');
    });

    it('round-trip: parse escaped variant then format yields the unescaped canonical token', () => {
      const parsed = parseMention(escaped);

      expect(parsed).not.toBeNull();
      expect(formatMention(parsed as EntityMention)).toBe(unescaped);
    });

    it('parses a double-backslash variant (mention surviving an in-code-span pre-escape)', () => {
      const doubleEscaped = '@\\\\[task:abc-123|Task A]';

      expect(parseMention(doubleEscaped)).toEqual({
        entityType: 'task',
        entityId: 'abc-123',
        entityName: 'Task A',
      });
      expect(extractMentions(`Check ${doubleEscaped} out`)).toEqual([
        { entityType: 'task', entityId: 'abc-123', entityName: 'Task A' },
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content', () => {
      expect(extractMentions('')).toEqual([]);
      expect(stripMentions('')).toBe('');
      expect(renderMentionsAsText('')).toBe('');
    });

    it('should handle mentions at start and end of content', () => {
      const content = '@[task:1|Start] middle @[task:2|End]';

      const extracted = extractMentions(content);

      expect(extracted).toHaveLength(2);
      const firstExtracted = assertDefined(extracted[0], 'first extracted');
      const secondExtracted = assertDefined(extracted[1], 'second extracted');
      expect(firstExtracted.entityName).toBe('Start');
      expect(secondExtracted.entityName).toBe('End');
    });

    it('should handle mentions with special characters in name', () => {
      const mention: EntityMention = {
        entityType: 'task',
        entityId: '123',
        entityName: 'Task (v2) - Important!',
      };

      const formatted = formatMention(mention);
      const parsed = parseMention(formatted);

      expect(parsed).toEqual(mention);
    });

    it('should handle very long entity names', () => {
      const longName = 'A'.repeat(200);
      const mention: EntityMention = {
        entityType: 'initiative',
        entityId: 'long-id',
        entityName: longName,
      };

      const formatted = formatMention(mention);
      const parsed = parseMention(formatted);

      expect(parsed?.entityName).toBe(longName);
    });

    it('should handle consecutive mentions', () => {
      const content = '@[task:1|A]@[task:2|B]@[task:3|C]';

      const extracted = extractMentions(content);

      expect(extracted).toHaveLength(3);
    });
  });
});
