/** A Markdown heading: its level and its title. */
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/u;
/** The heading the readers put above each of an entity's sections (`### description`). */
const SECTION_HEADING = /^### [a-z][A-Za-z]*$/u;
const FENCE = /^\s*(?:```|~~~)/u;

/**
 * An entity's text as Jev reads it: without its Implementation section, which says how the work
 * is built and does not change whether the entity applies. The section runs to the next heading
 * no deeper than its own or to the entity's next section. Readers, mention scanning and the
 * entities returned to callers keep the full text.
 */
export const textForJev = (text: string): string => {
  const kept: string[] = [];
  let skippingFrom: number | null = null;
  let fenced = false;
  for (const line of text.split('\n')) {
    const heading = fenced ? null : HEADING.exec(line);
    if (FENCE.test(line)) fenced = !fenced;
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      const level = heading[1].length;
      if (skippingFrom !== null && (level <= skippingFrom || SECTION_HEADING.test(line))) {
        skippingFrom = null;
      }
      if (skippingFrom === null && /^implementation$/iu.test(heading[2])) skippingFrom = level;
    }
    if (skippingFrom === null) kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd();
};
