// Generated from specs/fixtures/entity-prompt-template-language-v1.json. Do not edit.
import { EntityPromptTemplateSyntaxVersion } from './api.js';

export interface EntityPromptTemplatePathFamily {
  readonly template: string;
  readonly pattern: string;
}

export interface EntityPromptTemplateLanguage {
  readonly syntaxVersion: EntityPromptTemplateSyntaxVersion;
  readonly supportedPaths: readonly string[];
  readonly pathFamilies: readonly EntityPromptTemplatePathFamily[];
  readonly missingPathBehavior: 'ERROR';
  readonly malformedSubstitutionBehavior: 'ERROR';
  readonly malformedSubstitutions: readonly string[];
  readonly conditionalBlocks: {
    readonly ifKeyword: string;
    readonly elseKeyword: string;
    readonly endIfKeyword: string;
    readonly absentValueBehavior: 'TREAT_AS_FALSE';
  };
}

export const ENTITY_PROMPT_TEMPLATE_LANGUAGES = {
  [EntityPromptTemplateSyntaxVersion.V1]: {
    syntaxVersion: 'V1',
    supportedPaths: [
      'entity.id',
      'entity.name',
      'entity.title',
      'entity.type',
      'entity.status',
      'entity.description',
      'entity.outcome',
      'entity.summary',
      'entity.acceptanceCriteria',
      'entity.sections',
      'context.entityId',
      'context.entityType',
      'context.taskType',
      'context.displayName',
      'context.createdAt',
      'context.content.status',
      'context.content.priority',
      'context.content.dueDate',
      'context.relatedEntities',
      'context.featureHierarchy',
      'context.proposals',
      'context.agentSessions',
    ],
    pathFamilies: [
      {
        template: 'entity.sections.<key>',
        pattern: '^entity\\.sections\\.[a-z][A-Za-z0-9_]*$',
      },
      {
        template: 'context.content.sections.<key>',
        pattern: '^context\\.content\\.sections\\.[a-z][A-Za-z0-9_]*$',
      },
      {
        template: 'reports.<TYPE>.latest',
        pattern: '^reports\\.[A-Z][A-Z0-9_]*\\.latest$',
      },
      {
        template: 'reports.<TYPE>.latest.summary',
        pattern: '^reports\\.[A-Z][A-Z0-9_]*\\.latest\\.summary$',
      },
    ],
    missingPathBehavior: 'ERROR',
    malformedSubstitutionBehavior: 'ERROR',
    malformedSubstitutions: ['{{entity.name', 'entity.name}}', '{{}}', '{{entity.{name}}}'],
    conditionalBlocks: {
      ifKeyword: '#if',
      elseKeyword: 'else',
      endIfKeyword: '/if',
      absentValueBehavior: 'TREAT_AS_FALSE',
    },
  },
} as const satisfies Readonly<
  Record<EntityPromptTemplateSyntaxVersion, EntityPromptTemplateLanguage>
>;

// Single source of the entity prompt-template grammar. Each language generator
// embeds this file verbatim into its generated entity-prompt-template-language.ts
// so API validation, CLI rendering and the editor apply identical rules.
// This file must stay self-contained: no imports.

export interface EntityPromptTemplateParserLanguage {
  readonly supportedPaths: readonly string[];
  readonly pathFamilies: readonly { readonly pattern: string }[];
  readonly conditionalBlocks: {
    readonly ifKeyword: string;
    readonly elseKeyword: string;
    readonly endIfKeyword: string;
  };
}

export type EntityPromptTemplateIssueCode =
  | 'UNMATCHED_CLOSING_DELIMITER'
  | 'UNMATCHED_OPENING_DELIMITER'
  | 'INVALID_INPUT_SYNTAX'
  | 'UNSUPPORTED_INPUT'
  | 'MISSING_CONDITION_PATH'
  | 'UNCLOSED_IF_BLOCK'
  | 'UNEXPECTED_ELSE'
  | 'DUPLICATE_ELSE'
  | 'UNEXPECTED_END_IF';

export interface EntityPromptTemplateParseIssue {
  readonly code: EntityPromptTemplateIssueCode;
  /** Offset in the source where the offending tag or delimiter starts. */
  readonly offset: number;
  readonly message: string;
}

export type EntityPromptTemplateNode =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'substitution'; readonly path: string }
  | {
      readonly type: 'if';
      readonly path: string;
      readonly then: EntityPromptTemplateNode[];
      else: EntityPromptTemplateNode[] | null;
    };

export type EntityPromptTemplateTokenKind = 'substitution' | 'if' | 'else' | 'endIf';

/** One well-formed tag in source order, for editors that need token spans. */
export interface EntityPromptTemplateToken {
  readonly kind: EntityPromptTemplateTokenKind;
  readonly start: number;
  readonly end: number;
}

export interface EntityPromptTemplateParseResult {
  readonly nodes: EntityPromptTemplateNode[];
  readonly tokens: EntityPromptTemplateToken[];
  readonly issues: EntityPromptTemplateParseIssue[];
}

const ENTITY_PROMPT_TEMPLATE_INPUT_PATH_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/u;

export function isSupportedEntityPromptTemplatePath(
  path: string,
  language: EntityPromptTemplateParserLanguage,
): boolean {
  return (
    ENTITY_PROMPT_TEMPLATE_INPUT_PATH_PATTERN.test(path) &&
    (language.supportedPaths.includes(path) ||
      language.pathFamilies.some((family) => new RegExp(family.pattern, 'u').test(path)))
  );
}

type ParsedTag =
  | { readonly kind: 'if'; readonly path: string }
  | { readonly kind: 'else' }
  | { readonly kind: 'endIf' }
  | { readonly kind: 'substitution'; readonly path: string };

function classifyEntityPromptTemplateTag(
  expression: string,
  language: EntityPromptTemplateParserLanguage,
): ParsedTag {
  const { ifKeyword, elseKeyword, endIfKeyword } = language.conditionalBlocks;
  if (expression === elseKeyword) {
    return { kind: 'else' };
  }
  if (expression === endIfKeyword) {
    return { kind: 'endIf' };
  }
  if (expression === ifKeyword) {
    return { kind: 'if', path: '' };
  }
  if (expression.startsWith(ifKeyword) && /\s/u.test(expression.charAt(ifKeyword.length))) {
    return { kind: 'if', path: expression.slice(ifKeyword.length).trim() };
  }
  return { kind: 'substitution', path: expression };
}

interface OpenBlock {
  readonly node: Extract<EntityPromptTemplateNode, { type: 'if' }>;
  readonly offset: number;
  inElse: boolean;
}

/**
 * Parse a template into text, substitution and `if` nodes. A preceding
 * backslash escapes a literal `{{...}}`. Tags are never trimmed or collapsed:
 * surrounding text, including newlines, is kept as written.
 */
export function parseEntityPromptTemplate(
  content: string,
  language: EntityPromptTemplateParserLanguage,
): EntityPromptTemplateParseResult {
  const root: EntityPromptTemplateNode[] = [];
  const tokens: EntityPromptTemplateToken[] = [];
  const issues: EntityPromptTemplateParseIssue[] = [];
  const open: OpenBlock[] = [];
  const currentBranch = (): EntityPromptTemplateNode[] => {
    const block = open[open.length - 1];
    if (!block) {
      return root;
    }
    if (block.inElse && block.node.else) {
      return block.node.else;
    }
    return block.node.then;
  };
  const addIssue = (code: EntityPromptTemplateIssueCode, offset: number, message: string): void => {
    issues.push({ code, offset, message });
  };
  const checkPath = (path: string, offset: number): boolean => {
    if (!ENTITY_PROMPT_TEMPLATE_INPUT_PATH_PATTERN.test(path)) {
      addIssue(
        'INVALID_INPUT_SYNTAX',
        offset,
        'Template inputs must be dotted paths containing letters, numbers, underscores, hyphens, or periods.',
      );
      return false;
    }
    if (!isSupportedEntityPromptTemplatePath(path, language)) {
      addIssue(
        'UNSUPPORTED_INPUT',
        offset,
        `Template input ${path} is not supported for entity prompt templates.`,
      );
      return false;
    }
    return true;
  };

  let cursor = 0;
  while (cursor < content.length) {
    const openingIndex = content.indexOf('{{', cursor);
    const closingIndex = content.indexOf('}}', cursor);

    if (closingIndex !== -1 && (openingIndex === -1 || closingIndex < openingIndex)) {
      addIssue(
        'UNMATCHED_CLOSING_DELIMITER',
        closingIndex,
        'Template input expressions must start with {{.',
      );
      cursor = closingIndex + 2;
      continue;
    }

    if (openingIndex === -1) {
      currentBranch().push({ type: 'text', value: content.slice(cursor) });
      break;
    }

    const escaped = openingIndex > 0 && content[openingIndex - 1] === '\\';
    const literalEnd = escaped ? openingIndex - 1 : openingIndex;
    if (literalEnd > cursor) {
      currentBranch().push({
        type: 'text',
        value: content.slice(cursor, literalEnd),
      });
    }

    const expressionEnd = content.indexOf('}}', openingIndex + 2);
    if (expressionEnd === -1) {
      addIssue(
        'UNMATCHED_OPENING_DELIMITER',
        openingIndex,
        'Template input expressions must end with }}.',
      );
      break;
    }

    const expression = content.slice(openingIndex + 2, expressionEnd).trim();
    const tagEnd = expressionEnd + 2;
    cursor = tagEnd;
    const tag = classifyEntityPromptTemplateTag(expression, language);

    if (escaped) {
      if (tag.kind === 'substitution' && !checkPath(tag.path, openingIndex)) {
        continue;
      }
      if (tag.kind === 'if' && tag.path !== '' && !checkPath(tag.path, openingIndex)) {
        continue;
      }
      currentBranch().push({
        type: 'text',
        value: `{{${expression}}}`,
      });
      continue;
    }

    if (tag.kind === 'substitution') {
      if (checkPath(tag.path, openingIndex)) {
        tokens.push({ kind: 'substitution', start: openingIndex, end: tagEnd });
        currentBranch().push({ type: 'substitution', path: tag.path });
      }
      continue;
    }

    if (tag.kind === 'if') {
      if (tag.path === '') {
        addIssue(
          'MISSING_CONDITION_PATH',
          openingIndex,
          'A conditional block must name the value it tests, for example {{#if entity.summary}}.',
        );
        continue;
      }
      const valid = checkPath(tag.path, openingIndex);
      const node: Extract<EntityPromptTemplateNode, { type: 'if' }> = {
        type: 'if',
        path: tag.path,
        then: [],
        else: null,
      };
      currentBranch().push(node);
      open.push({ node, offset: openingIndex, inElse: false });
      if (valid) {
        tokens.push({ kind: 'if', start: openingIndex, end: tagEnd });
      }
      continue;
    }

    if (tag.kind === 'else') {
      const block = open[open.length - 1];
      if (!block) {
        addIssue('UNEXPECTED_ELSE', openingIndex, 'An else tag must appear inside an if block.');
      } else if (block.inElse) {
        addIssue('DUPLICATE_ELSE', openingIndex, 'An if block can have only one else tag.');
      } else {
        block.inElse = true;
        block.node.else = [];
      }
      tokens.push({ kind: 'else', start: openingIndex, end: tagEnd });
      continue;
    }

    if (open.length === 0) {
      addIssue('UNEXPECTED_END_IF', openingIndex, 'An end-if tag must close an open if block.');
    } else {
      open.pop();
    }
    tokens.push({ kind: 'endIf', start: openingIndex, end: tagEnd });
  }

  for (const block of open) {
    addIssue(
      'UNCLOSED_IF_BLOCK',
      block.offset,
      `The if block testing ${block.node.path} is never closed.`,
    );
  }

  return { nodes: root, tokens, issues };
}
