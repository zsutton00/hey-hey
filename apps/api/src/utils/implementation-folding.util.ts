/**
 * Fold the optional `implementation` field into a task's description as a
 * trailing `## Implementation` markdown block. Task sections are a fixed
 * key set (`description`, `acceptanceCriteria`) with no `implementation`
 * key, so file-level context is realized as a labeled block at the end of
 * the description rather than as its own section row.
 *
 * Shared between the MCP create_work_item / edit_work_item handlers and the
 * plan-step→backing-task materialization path so the trailing block
 * format stays in lockstep.
 *
 * `sections` is the section array supplied to the caller (may be
 * undefined). `fallbackDescription` is the task's current description
 * content — the edit/materialization paths pass it so an
 * implementation-only fold still appends onto the existing body. This
 * applies whether the supplied `sections` omit a description section
 * entirely or include one whose content is empty (the edit form leaves
 * the description field blank).
 * Returns the section array to store, or the original `sections` value
 * untouched when there is no implementation text to fold.
 */
export interface ImplementationFoldingSection {
  key: string;
  content: unknown;
  order?: number;
}

const CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|`[^`\n]+`)/;

function unescapeNewlinesOutsideCode(text: string): string {
  return text
    .split(CODE_SEGMENT)
    .map((segment, index) =>
      // Odd indices are the captured code fences and inline spans.
      index % 2 === 1 ? segment : segment.replace(/\\n/g, '\n'),
    )
    .join('');
}

export function foldImplementationIntoSections<
  T extends ImplementationFoldingSection,
>(
  sections: T[] | undefined,
  implementation: string | undefined,
  fallbackDescription?: string,
): T[] | undefined {
  const trimmed = implementation
    ? unescapeNewlinesOutsideCode(implementation).trim()
    : undefined;
  if (!trimmed) return sections;

  const block = `## Implementation\n\n${trimmed}`;
  const list: T[] = sections ? sections.map((section) => ({ ...section })) : [];
  const descSection = list.find((section) => section.key === 'description');

  if (descSection) {
    // When the supplied description section is empty (the edit form leaves
    // the description field blank), fall back to the work item's current
    // description so an implementation-only edit appends rather than erases.
    const description =
      typeof descSection.content === 'string' ? descSection.content : '';
    const base = description.trim()
      ? description
      : (fallbackDescription?.trim() ?? '');
    descSection.content = base ? `${base}\n\n${block}` : block;
    return list;
  }

  const base = fallbackDescription?.trim() ?? '';
  list.push({
    key: 'description',
    content: base ? `${base}\n\n${block}` : block,
  } as T);
  return list;
}
