import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { z } from "zod";

interface StackLocation {
  source: string;
  line: number;
  column: number;
}

const sourceMapSchema = z.object({
  version: z.literal(3),
  sources: z.array(z.string().nullable()),
  names: z.array(z.string()),
  mappings: z.string(),
  sourceRoot: z.string().optional(),
});

const maps = new Map<string, Promise<TraceMap | null>>();
const MAX_CACHED_MAPS = 16;
const MAP_TIMEOUT_MS = 1500;

export function parseInitiatorStack(stack: string): StackLocation[] {
  return stack.split("\n").flatMap((line) => {
    // Chrome/V8: at fn (url:line:column); Firefox/Safari: fn@url:line:column.
    const match = line
      .trim()
      .match(
        /(?:\(|@|\s|^)((?:https?:\/\/|file:\/\/\/|\/)[^\s()]+):(\d+):(\d+)\)?$/
      );
    if (!match) return [];
    return [
      { source: match[1], line: Number(match[2]), column: Number(match[3]) },
    ];
  });
}

function isApplicationSource(source: string): boolean {
  if (!/\.[cm]?[jt]sx?(?:\?|$)/.test(source)) return false;
  const normalized = source.replace(/\\/g, "/");
  if (
    normalized.includes("/node_modules/") &&
    !normalized.includes("/@hey-hey/ui-common/")
  )
    return false;
  return ![
    "/data/core/",
    "/data/hooks/",
    "/data/collections/",
    "/clients/",
    "/api/",
    "initiatorContext.",
    "requestInitiator.",
    "resolveInitiator.",
  ].some((part) => normalized.includes(part));
}

function formatLocation(location: StackLocation): string {
  // Keep a repo-relative path when present, never deployment host/query values.
  const source = location.source.split("?")[0];
  const start = source.lastIndexOf("/src/");
  const path = start >= 0 ? source.slice(start + 1) : source.split("/").pop();
  return `${path}:${location.line}:${location.column}`;
}

async function loadSourceMap(url: string): Promise<TraceMap | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: "omit",
    });
    if (!response.ok) return null;
    const parsed = sourceMapSchema.safeParse(await response.json());
    return parsed.success ? new TraceMap(parsed.data, url) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function getSourceMap(source: string): Promise<TraceMap | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  let url: URL;
  try {
    url = new URL(source, window.location.href);
  } catch {
    return Promise.resolve(null);
  }
  if (url.origin !== window.location.origin || !/\.[cm]?js$/.test(url.pathname))
    return Promise.resolve(null);
  // Vite emits each map beside its content-hashed bundle. Do not fetch arbitrary
  // cross-origin stack URLs or source contents, or send authentication headers.
  url.pathname += ".map";
  url.search = "";
  url.hash = "";
  const key = url.href;
  let pending = maps.get(key);
  if (!pending) {
    if (maps.size >= MAX_CACHED_MAPS) {
      const oldest = maps.keys().next().value;
      if (oldest) maps.delete(oldest);
    }
    pending = loadSourceMap(key);
    maps.set(key, pending);
  }
  return pending;
}

async function originalLocation(
  location: StackLocation
): Promise<StackLocation | null> {
  if (
    /\.[jt]sx?(?:\?|$)/.test(location.source) &&
    !/\.[cm]?js(?:\?|$)/.test(location.source)
  )
    return location;
  const map = await getSourceMap(location.source);
  if (!map) return null;
  try {
    const original = originalPositionFor(map, {
      line: location.line,
      column: location.column - 1,
    });
    return original.source !== null &&
      original.line !== null &&
      original.column !== null
      ? {
          source: original.source,
          line: original.line,
          column: original.column + 1,
        }
      : null;
  } catch {
    return null;
  }
}

export async function resolveInitiator(
  stack: string
): Promise<string | undefined> {
  const locations = parseInitiatorStack(stack);
  // Explicit diagnostic labels (e.g. older-message reads) remain valid.
  if (!locations.length)
    return stack.includes("\n") || stack === "Error" ? undefined : stack;
  const originals = await Promise.all(locations.map(originalLocation));
  const applicationLocations = originals.filter(
    (location): location is StackLocation =>
      location !== null && isApplicationSource(location.source)
  );
  const component = applicationLocations.find((location) =>
    /\.[jt]sx(?:\?|$)/.test(location.source)
  );
  const chosen = component ?? applicationLocations[0];
  if (chosen) return formatLocation(chosen);
  // Keep an honest, searchable generated position if maps are unavailable.
  const generated = locations.find(
    (location) => !location.source.includes("vendor")
  );
  return generated ? `unmapped:${formatLocation(generated)}` : undefined;
}
