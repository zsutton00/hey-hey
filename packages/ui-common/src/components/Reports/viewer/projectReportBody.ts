import type { ProjectReportBody } from "../../../api";

/**
 * Reads a project report's authored `{ html, css }` body: `html` must be a
 * non-blank string and `css` a string. Shared by the report viewer and the
 * Overview previews so both accept exactly the same bodies.
 */
export const readAuthoredBody = (body: unknown): ProjectReportBody | null => {
  if (typeof body !== "object" || body === null) return null;
  const { html, css } = body as Record<string, unknown>;
  if (typeof html !== "string" || html.trim().length === 0) return null;
  if (typeof css !== "string") return null;
  return { html, css };
};
