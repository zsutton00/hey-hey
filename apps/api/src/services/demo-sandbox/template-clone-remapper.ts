import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MENTION_TOKEN_REGEX } from '../../utils/mentionFormatting';

function isStructuredText(value: string): boolean {
  const first = value.trimStart()[0];
  return first === '{' || first === '[';
}

// These are transport correlation keys or logical workflow node names, not
// references to project records. Known copied identities still take precedence.
const NON_RECORD_IDENTIFIERS = new Set([
  'requestId',
  'correlationId',
  'causationId',
  'nodeId',
]);

/** One identity namespace, including IDs embedded in structured sections. */
export class TemplateCloneRemapper {
  readonly ids = new Map<string, string>();
  private readonly logger = new Logger(TemplateCloneRemapper.name);
  diagnosticContext: {
    sourceProjectId?: string;
    targetProjectId?: string;
    stage?: string;
    sourceTable?: string;
    sourceRecordId?: string;
  } = {};

  allocate(id: string): string {
    if (!this.ids.has(id)) this.ids.set(id, randomUUID());
    return this.require(id);
  }

  require(id: string, fieldPath = '$', referenceKind = 'record'): string {
    const copy = this.ids.get(id);
    if (!copy) {
      this.logger.error('Template clone contains an unmapped reference', {
        ...this.diagnosticContext,
        fieldPath,
        referenceKind,
        // Field-name heuristics can mistake arbitrary strings for identifiers.
        // Never emit those strings: they may contain payloads or credentials.
        unmappedReferenceId:
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          )
            ? id
            : '[redacted non-UUID identifier]',
        mappedIdentityCount: this.ids.size,
      });
      throw new Error('Template clone contains an unmapped reference');
    }
    return copy;
  }

  collect(value: unknown): void {
    if (Array.isArray(value)) value.forEach((child) => this.collect(child));
    else if (value && typeof value === 'object' && !(value instanceof Date)) {
      for (const [key, child] of Object.entries(value)) {
        if (key === 'id' && typeof child === 'string') this.allocate(child);
        else this.collect(child);
      }
    } else if (typeof value === 'string' && isStructuredText(value)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return;
      }
      this.collect(parsed);
    }
  }

  rewrite<T>(value: T, key = '', fieldPath = '$'): T {
    if (value instanceof Date || value instanceof Uint8Array) return value as T;
    if (Array.isArray(value)) {
      return value.map((child: unknown, index) =>
        this.rewrite(child, key, `${fieldPath}[${index}]`),
      ) as T;
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([field, child]) => [
          // Structured configurations sometimes use entity IDs as object keys.
          this.ids.get(field) ?? field,
          this.rewrite(
            child,
            field,
            `${fieldPath}.${/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(field) ? field : '[key]'}`,
          ),
        ]),
      ) as T;
    }
    if (typeof value !== 'string') return value;
    if (this.ids.has(value))
      return this.require(value, fieldPath, 'identifier-field') as T;
    if (
      value &&
      !NON_RECORD_IDENTIFIERS.has(key) &&
      /(?:^id$|Id$|Ids$|_id$)/.test(key)
    ) {
      return this.require(value, fieldPath, 'identifier-field') as T;
    }
    if (isStructuredText(value)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = undefined;
      }
      if (parsed !== undefined)
        return JSON.stringify(
          this.rewrite(parsed, '', `${fieldPath}[json]`),
        ) as T;
    }
    let content = value.replace(
      new RegExp(MENTION_TOKEN_REGEX),
      (_token, type: string, id: string, title: string) =>
        `@[${type}:${this.require(id, fieldPath, 'mention')}|${title}]`,
    );
    // Covers serialized snapshots, prose links and historical identifiers too.
    for (const [source, target] of this.ids)
      content = content.split(source).join(target);
    return content as T;
  }
}
