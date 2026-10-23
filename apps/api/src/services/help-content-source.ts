import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { validate as isUuid } from 'uuid';

export type HelpSourceDemo =
  | {
      id: string;
      kind: 'preset';
      ordering: number;
      caption: string;
      presetKey: string;
    }
  | {
      id: string;
      kind: 'dsl';
      ordering: number;
      caption: string;
      definition: Record<string, unknown>;
    };

export interface HelpSourceNode {
  id: string;
  slug: string;
  title: string;
  parentId: string | null;
  ordering: number;
  demos: HelpSourceDemo[];
  body: string;
}

const NODE_FIELDS = ['id', 'slug', 'title', 'parentId', 'ordering', 'demos'];
const PRESET_DEMO_FIELDS = ['id', 'kind', 'ordering', 'caption', 'presetKey'];
const DSL_DEMO_FIELDS = ['id', 'kind', 'ordering', 'caption', 'definition'];
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const HELP_ASSET_DIRECTORY_NAME = 'assets';

const HELP_ASSET_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export const DEFAULT_HELP_CONTENT_DIRECTORY = path.resolve(
  process.cwd(),
  'content/help',
);
export const DEFAULT_HELP_ASSET_DIRECTORY = path.join(
  DEFAULT_HELP_CONTENT_DIRECTORY,
  HELP_ASSET_DIRECTORY_NAME,
);

export async function loadHelpContentSource(
  directory = DEFAULT_HELP_CONTENT_DIRECTORY,
): Promise<HelpSourceNode[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const unexpected = entries.filter(
    (entry) =>
      !(
        (entry.isFile() && entry.name.endsWith('.md')) ||
        (entry.isDirectory() && entry.name === HELP_ASSET_DIRECTORY_NAME)
      ),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Help content directory contains unsupported entries: ${unexpected
        .map((entry) => entry.name)
        .sort()
        .join(', ')}`,
    );
  }

  const nodes = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
      .map(async (fileName) =>
        parseHelpContentFile(
          fileName,
          await fs.readFile(path.join(directory, fileName), 'utf8'),
        ),
      ),
  );
  validateHelpContentSource(nodes);
  await validateHelpImageReferences(
    nodes,
    path.join(directory, HELP_ASSET_DIRECTORY_NAME),
  );
  return nodes;
}

export function parseHelpContentFile(
  fileName: string,
  source: string,
): HelpSourceNode {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  if (!match) {
    throw new Error(`${fileName}: expected YAML frontmatter delimited by ---`);
  }

  let frontmatter: unknown;
  try {
    frontmatter = loadYaml(match[1] ?? '');
  } catch (error) {
    throw new Error(
      `${fileName}: malformed YAML frontmatter: ${errorMessage(error)}`,
    );
  }

  const record = requireRecord(frontmatter, `${fileName}: frontmatter`);
  requireExactFields(record, NODE_FIELDS, `${fileName}: frontmatter`);
  const id = requireUuid(record.id, `${fileName}: id`);
  const slug = requireString(record.slug, `${fileName}: slug`);
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`${fileName}: slug must be URL-safe kebab-case`);
  }
  const title = requireString(record.title, `${fileName}: title`);
  const parentId =
    record.parentId === null
      ? null
      : requireUuid(record.parentId, `${fileName}: parentId`);
  const ordering = requirePositiveInteger(
    record.ordering,
    `${fileName}: ordering`,
  );
  if (!Array.isArray(record.demos)) {
    throw new Error(`${fileName}: demos must be an array`);
  }
  const demos = record.demos.map((demo, index) =>
    parseDemo(demo, `${fileName}: demos[${index}]`),
  );
  assertContiguousOrdering(demos, `${fileName}: demo ordering`);

  const body = (match[2] ?? '').trim();
  if (body.length === 0) {
    throw new Error(`${fileName}: Markdown body must be non-empty`);
  }

  return {
    id,
    slug,
    title,
    parentId,
    ordering,
    demos,
    body,
  };
}

export function validateHelpContentSource(
  nodes: readonly HelpSourceNode[],
): void {
  const nodesById = new Map<string, HelpSourceNode>();
  const slugs = new Set<string>();
  const demoIds = new Set<string>();

  for (const node of nodes) {
    if (nodesById.has(node.id)) {
      throw new Error(`Duplicate Help node id: ${node.id}`);
    }
    if (slugs.has(node.slug)) {
      throw new Error(`Duplicate Help node slug: ${node.slug}`);
    }
    nodesById.set(node.id, node);
    slugs.add(node.slug);

    for (const demo of node.demos) {
      if (demoIds.has(demo.id)) {
        throw new Error(`Duplicate Help demo id: ${demo.id}`);
      }
      demoIds.add(demo.id);
    }
  }

  for (const node of nodes) {
    if (node.parentId !== null && !nodesById.has(node.parentId)) {
      throw new Error(
        `Help node ${node.id} references missing parent ${node.parentId}`,
      );
    }
    const visited = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) {
        throw new Error(`Help content contains a cycle involving ${node.id}`);
      }
      visited.add(parentId);
      parentId = nodesById.get(parentId)?.parentId ?? null;
    }
  }

  const siblings = new Map<string, HelpSourceNode[]>();
  for (const node of nodes) {
    const key = node.parentId ?? '<root>';
    const group = siblings.get(key) ?? [];
    group.push(node);
    siblings.set(key, group);
  }
  for (const [parentId, group] of siblings) {
    assertContiguousOrdering(group, `Help sibling ordering under ${parentId}`);
  }
}

/**
 * Extract image destinations without changing the Markdown persisted in the
 * Help node. The source convention intentionally keeps the `assets/` prefix
 * visible to authors and lets the API/UI resolve it at delivery time.
 */
export function extractHelpImageDestinations(markdown: string): string[] {
  const destinations: string[] = [];
  const imageStart = /!\[[^\]]*\]\(/g;
  let match: RegExpExecArray | null;

  while ((match = imageStart.exec(markdown)) !== null) {
    let cursor = match.index + match[0].length;
    while (/\s/.test(markdown[cursor] ?? '')) cursor += 1;

    if (markdown[cursor] === '<') {
      const end = markdown.indexOf('>', cursor + 1);
      destinations.push(
        end === -1
          ? markdown.slice(cursor + 1)
          : markdown.slice(cursor + 1, end),
      );
      continue;
    }

    const start = cursor;
    let nestedParentheses = 0;
    let escaped = false;
    while (cursor < markdown.length) {
      const character = markdown[cursor];
      if (character === undefined) break;
      if (escaped) {
        escaped = false;
        cursor += 1;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        cursor += 1;
        continue;
      }
      if (character === '(') {
        nestedParentheses += 1;
      } else if (character === ')') {
        if (nestedParentheses === 0) break;
        nestedParentheses -= 1;
      } else if (/\s/.test(character) && nestedParentheses === 0) {
        break;
      }
      cursor += 1;
    }
    destinations.push(markdown.slice(start, cursor));
  }

  return destinations;
}

/**
 * Normalize and validate the authored repository-relative reference. The
 * returned path retains the `assets/` prefix used in Markdown and is safe to
 * resolve below the packaged Help assets directory.
 */
export function normalizeHelpAssetReference(reference: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(reference.trim());
  } catch {
    throw new Error(`Invalid Help image reference: ${reference}`);
  }

  if (
    decoded.length === 0 ||
    decoded.includes('\\') ||
    decoded.includes('?') ||
    decoded.includes('#') ||
    decoded.split('').some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    }) ||
    !decoded.startsWith(`${HELP_ASSET_DIRECTORY_NAME}/`)
  ) {
    throw new Error(
      `Help image reference must be repository-relative below ${HELP_ASSET_DIRECTORY_NAME}/: ${reference}`,
    );
  }

  const normalized = path.posix.normalize(decoded);
  if (
    normalized !== decoded ||
    normalized === HELP_ASSET_DIRECTORY_NAME ||
    normalized.endsWith('/') ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(
      `Help image reference escapes ${HELP_ASSET_DIRECTORY_NAME}/: ${reference}`,
    );
  }

  return normalized;
}

export function getHelpAssetMediaType(assetPath: string): string | null {
  return (
    HELP_ASSET_MEDIA_TYPES[path.posix.extname(assetPath).toLowerCase()] ?? null
  );
}

async function validateHelpImageReferences(
  nodes: readonly HelpSourceNode[],
  assetDirectory: string,
): Promise<void> {
  const references = nodes.flatMap((node) =>
    extractHelpImageDestinations(node.body).map((reference) => ({
      fileName: node.slug,
      reference,
    })),
  );
  if (references.length === 0) return;

  let realAssetDirectory: string;
  try {
    realAssetDirectory = await fs.realpath(assetDirectory);
  } catch {
    throw new Error(`Help asset directory not found: ${assetDirectory}`);
  }

  for (const { fileName, reference } of references) {
    const normalized = normalizeHelpAssetReference(reference);
    const relativePath = normalized.slice(
      `${HELP_ASSET_DIRECTORY_NAME}/`.length,
    );
    const candidate = path.resolve(realAssetDirectory, relativePath);
    assertContainedPath(realAssetDirectory, candidate, reference);

    let realPath: string;
    try {
      realPath = await fs.realpath(candidate);
    } catch {
      throw new Error(`${fileName}: Help image asset not found: ${reference}`);
    }
    assertContainedPath(realAssetDirectory, realPath, reference);

    const stats = await fs.stat(realPath);
    if (!stats.isFile() || getHelpAssetMediaType(realPath) === null) {
      throw new Error(
        `${fileName}: Help image asset is not a supported image: ${reference}`,
      );
    }
  }
}

function assertContainedPath(
  root: string,
  candidate: string,
  reference: string,
): void {
  const relative = path.relative(root, candidate);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Help image reference escapes ${HELP_ASSET_DIRECTORY_NAME}/: ${reference}`,
    );
  }
}

function parseDemo(value: unknown, label: string): HelpSourceDemo {
  const demo = requireRecord(value, label);
  const kind = requireString(demo.kind, `${label}.kind`);
  if (kind === 'preset') {
    requireExactFields(demo, PRESET_DEMO_FIELDS, label);
    return {
      id: requireUuid(demo.id, `${label}.id`),
      kind,
      ordering: requirePositiveInteger(demo.ordering, `${label}.ordering`),
      caption: requireString(demo.caption, `${label}.caption`),
      presetKey: requireString(demo.presetKey, `${label}.presetKey`),
    };
  }
  if (kind === 'dsl') {
    requireExactFields(demo, DSL_DEMO_FIELDS, label);
    return {
      id: requireUuid(demo.id, `${label}.id`),
      kind,
      ordering: requirePositiveInteger(demo.ordering, `${label}.ordering`),
      caption: requireString(demo.caption, `${label}.caption`),
      definition: requireRecord(demo.definition, `${label}.definition`),
    };
  }
  throw new Error(`${label}.kind must be preset or dsl`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\0') !== wanted.join('\0')) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireUuid(value: unknown, label: string): string {
  const result = requireString(value, label);
  if (!isUuid(result)) {
    throw new Error(`${label} must be a full UUID`);
  }
  return result;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function assertContiguousOrdering(
  values: readonly { ordering: number }[],
  label: string,
): void {
  const actual = values.map((value) => value.ordering).sort((a, b) => a - b);
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== index + 1) {
      throw new Error(`${label} must be unique and contiguous from 1`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
