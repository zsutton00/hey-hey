import { randomUUID } from 'crypto';
import { MENTION_TOKEN_REGEX } from '../../utils/mentionFormatting';

function isStructuredText(value: string): boolean {
  const first = value.trimStart()[0];
  return first === '{' || first === '[';
}

/**
 * One identity namespace, including IDs embedded in structured sections.
 *
 * `ids` holds every record the clone copies, so translation is an exact lookup:
 * a value that is a copied record's ID becomes the copy's ID, and any other
 * value (a dispatch ID, a deleted record, a shared user) is left untouched.
 * A template record deliberately left out of the copy is `withheld`:
 * references to it are dropped so nothing points back at the template.
 */
export class TemplateCloneRemapper {
  readonly ids = new Map<string, string>();
  readonly withheld = new Set<unknown>();

  allocate(id: string): string {
    if (!this.ids.has(id)) this.ids.set(id, randomUUID());
    return this.require(id);
  }

  /** The copied identity of a record the clone itself created. */
  require(id: string): string {
    const copy = this.ids.get(id);
    if (!copy) throw new Error('Template clone record has no copied identity');
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

  rewrite<T>(value: T): T {
    if (value instanceof Date || value instanceof Uint8Array) return value as T;
    if (Array.isArray(value))
      return value.map((child: unknown) => this.rewrite(child)) as T;
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([field, child]) => [
          // Structured configurations sometimes use entity IDs as object keys.
          this.ids.get(field) ?? field,
          this.rewrite(child),
        ]),
      ) as T;
    }
    if (typeof value !== 'string') return value;
    const copy = this.ids.get(value);
    if (copy) return copy as T;
    if (this.withheld.has(value)) return null as T;
    if (isStructuredText(value)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = undefined;
      }
      if (parsed !== undefined)
        return JSON.stringify(this.rewrite(parsed)) as T;
    }
    let content = value.replace(
      new RegExp(MENTION_TOKEN_REGEX),
      (token, type: string, id: string, title: string) => {
        const target = this.ids.get(id);
        if (target) return `@[${type}:${target}|${title}]`;
        return this.withheld.has(id) ? title : token;
      },
    );
    // Covers serialized snapshots, prose links and historical identifiers too.
    for (const [source, target] of this.ids)
      content = content.split(source).join(target);
    return content as T;
  }
}
