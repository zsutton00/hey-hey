/** Render a short diagnostic as an ASCII box for structured log fields. */
export const renderAsciiLogBox = (title: string, lines: readonly string[]): string => {
  const content = [title, ...lines];
  const contentWidth = Math.max(...content.map((line) => line.length));
  const border = `+${'-'.repeat(contentWidth + 2)}+`;
  return [border, ...content.map((line) => `| ${line.padEnd(contentWidth)} |`), border].join('\n');
};
