import { createHeyTheme } from "../../contexts/ThemeContext";

/**
 * Host theme for authored project report documents. Its typography, palette,
 * 8px spacing and radius come from the light `createHeyTheme` so a report
 * reads as part of Hey Hey. It is report-specific: work-item sections keep the
 * Modern and Sketch themes.
 *
 * The CLI report author is told to use these same class names
 * (`summary`, `interpretation`, `limitation`, `stats`, `stat`, `stat-value`,
 * `stat-label`, `timeline`, `bars`, `bar`, `bar-label`, `bar-value`, `num`,
 * `muted`), to leave citation styling to the host, and never to add left
 * accent borders, which the final rule strips. Keep both sides in step.
 */
const buildReportTheme = (): string => {
  const { palette, typography, shape, spacing } = createHeyTheme("light");
  const headingFont = typography.h1.fontFamily ?? typography.fontFamily;
  const radius = `${shape.borderRadius}px`;

  return `
:root { color-scheme: light; --hh-text: ${
    palette.text.primary
  }; --hh-text-muted: ${palette.text.secondary}; --hh-divider: ${
    palette.divider
  }; --hh-surface: ${palette.background.paper}; --hh-surface-muted: ${
    palette.interactive.light
  }; --hh-primary: ${palette.primary.main}; --hh-report: ${
    palette.report.main
  }; --hh-info-bg: ${palette.info.light}; --hh-warning-bg: ${
    palette.warning.light
  }; --hh-warning-text: ${
    palette.warning.dark
  }; --hh-radius: ${radius}; font-family: ${
    typography.fontFamily
  }; font-size: ${
    typography.fontSize
  }px; line-height: 1.6; color: var(--hh-text); background: var(--hh-surface); }
* { box-sizing: border-box; }
body { margin: 0; padding: ${spacing(3)} ${spacing(4)} ${spacing(
    4
  )}; max-width: 72rem; }
h1, h2, h3, h4 { font-family: ${headingFont}; font-weight: 600; color: var(--hh-text); line-height: 1.25; margin: ${spacing(
    4
  )} 0 ${spacing(1)}; }
h1 { font-size: 1.75rem; letter-spacing: .05em; }
h2 { font-size: 1.375rem; letter-spacing: .03em; padding-bottom: 4px; border-bottom: 1px solid var(--hh-divider); }
h3 { font-size: 1.125rem; }
h4 { font-size: 1rem; color: var(--hh-text-muted); }
body > :first-child, body > [data-host-duplicate-title] + * { margin-top: 0; }
p, ul, ol, table, figure, blockquote { margin: 0 0 ${spacing(2)}; }
ul, ol { padding-left: ${spacing(3)}; }
li + li { margin-top: 4px; }
strong { font-weight: 700; }
small, .muted, figcaption { color: var(--hh-text-muted); font-size: .875rem; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875em; background: var(--hh-surface-muted); border-radius: 4px; padding: 1px 4px; }
hr { border: 0; border-top: 1px solid var(--hh-divider); margin: ${spacing(
    3
  )} 0; }
section + section { margin-top: ${spacing(3)}; }
.summary { background: var(--hh-info-bg); border-radius: var(--hh-radius); padding: ${spacing(
    2
  )} 20px; margin: 0 0 ${spacing(3)}; font-size: 1.0625rem; }
.summary > :last-child, .interpretation > :last-child, .limitation > :last-child { margin-bottom: 0; }
.interpretation { background: var(--hh-surface-muted); border-radius: var(--hh-radius); padding: 12px ${spacing(
    2
  )}; margin: 0 0 ${spacing(2)}; }
.interpretation::before { content: "Interpretation"; display: block; margin-bottom: 4px; color: var(--hh-report); font-size: .75rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.limitation { background: var(--hh-warning-bg); color: var(--hh-text); border-radius: var(--hh-radius); padding: 12px ${spacing(
    2
  )}; margin: 0 0 ${spacing(2)}; }
.limitation::before { content: "Coverage"; display: block; margin-bottom: 4px; color: var(--hh-warning-text); font-size: .75rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
table { width: 100%; border-collapse: collapse; font-size: .9375rem; }
caption { caption-side: top; text-align: left; font-weight: 600; padding-bottom: ${spacing(
    1
  )}; }
th, td { text-align: left; vertical-align: top; padding: ${spacing(
    1
  )} 12px; border-bottom: 1px solid var(--hh-divider); }
thead th { background: var(--hh-surface-muted); font-weight: 600; color: var(--hh-text-muted); font-size: .8125rem; letter-spacing: .02em; }
th.num, td.num, .num { text-align: right; font-variant-numeric: tabular-nums; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 0 0 ${spacing(
    3
  )}; padding: 0; list-style: none; }
.stat { background: var(--hh-surface-muted); border-radius: var(--hh-radius); padding: 12px ${spacing(
    2
  )}; margin: 0; }
.stat-value { display: block; font-family: ${headingFont}; font-size: 1.75rem; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; }
.stat-label { display: block; color: var(--hh-text-muted); font-size: .875rem; }
.timeline { position: relative; list-style: none; margin: 0 0 ${spacing(
    3
  )}; padding: 0 0 0 22px; }
.timeline::before { content: ""; position: absolute; left: 4px; top: .5em; bottom: ${spacing(
    2
  )}; width: 2px; background: var(--hh-divider); }
.timeline > li { position: relative; margin: 0; padding: 0 0 ${spacing(2)}; }
.timeline > li::after { content: ""; position: absolute; left: -22px; top: .5em; width: 10px; height: 10px; border-radius: 50%; background: var(--hh-surface); box-shadow: 0 0 0 2px var(--hh-primary); }
.timeline time { display: block; color: var(--hh-text-muted); font-size: .8125rem; font-variant-numeric: tabular-nums; }
.bars { list-style: none; margin: 0 0 ${spacing(
    3
  )}; padding: 0; display: grid; grid-template-columns: minmax(8rem, max-content) 1fr max-content; gap: 6px 12px; align-items: center; }
.bars > li { display: contents; }
.bar-label { color: var(--hh-text); font-size: .9375rem; }
.bar { height: 12px; width: var(--value, 0%); background: var(--hh-primary); border-radius: 0 4px 4px 0; }
.bar-value { color: var(--hh-text-muted); font-size: .875rem; font-variant-numeric: tabular-nums; text-align: right; }
[data-evidence-key][role="button"] { color: var(--hh-primary); text-decoration: underline dotted; text-decoration-thickness: 1px; text-underline-offset: 3px; border-radius: 4px; }
[data-evidence-key][role="button"]:hover { text-decoration-style: solid; }
[data-evidence-key][role="button"]:focus-visible { outline: 2px solid var(--hh-primary); outline-offset: 2px; }
a.hh-mention[data-entity-type] { color: var(--hh-primary); background: color-mix(in srgb, var(--hh-primary) 10%, transparent); font-weight: 500; text-decoration: none; padding: 0 4px; border-radius: 4px; }
a.hh-mention[data-entity-type]::before { content: "@"; opacity: .7; }
a.hh-mention[data-entity-type]:hover { text-decoration: underline; }
a.hh-mention[data-entity-type]:focus-visible { outline: 2px solid var(--hh-primary); outline-offset: 2px; }
body *, body *::before, body *::after { border-left-width: 0 !important; border-inline-start-width: 0 !important; }
`;
};

export const HTML_CSS_REPORT_THEME = buildReportTheme();
