import type { Location } from "react-router-dom";

export const DEFAULT_POST_LOGIN_PATH = "/home";

const LOCAL_ORIGIN = "https://app.local";
const LOGIN_PATH = "/login";
const URI_SCHEME = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

type RouterLocationLike = Partial<
  Pick<Location, "pathname" | "search" | "hash">
>;

const isRouterLocationLike = (
  value: unknown,
): value is RouterLocationLike =>
  typeof value === "object" && value !== null && "pathname" in value;

const hasUnsafeCharacters = (value: string): boolean =>
  Array.from(value).some((char) => {
    const codePoint = char.codePointAt(0);

    return char === "\\" || codePoint === undefined || codePoint < 32 || codePoint === 127;
  });

const isLoginPath = (pathname: string): boolean =>
  pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);

const normalizePathParts = (location: RouterLocationLike): string | null => {
  const { pathname, search = "", hash = "" } = location;

  if (
    typeof pathname !== "string" ||
    typeof search !== "string" ||
    typeof hash !== "string"
  ) {
    return null;
  }

  if (
    hasUnsafeCharacters(pathname) ||
    hasUnsafeCharacters(search) ||
    hasUnsafeCharacters(hash)
  ) {
    return null;
  }

  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    return null;
  }

  if ((search && !search.startsWith("?")) || (hash && !hash.startsWith("#"))) {
    return null;
  }

  if (isLoginPath(pathname)) {
    return null;
  }

  return `${pathname}${search}${hash}`;
};

export const normalizeInternalReturnTarget = (
  target: unknown,
): string | null => {
  if (isRouterLocationLike(target)) {
    return normalizePathParts(target);
  }

  if (typeof target !== "string" || target !== target.trim()) {
    return null;
  }

  if (
    !target.startsWith("/") ||
    target.startsWith("//") ||
    URI_SCHEME.test(target) ||
    hasUnsafeCharacters(target)
  ) {
    return null;
  }

  try {
    const url = new URL(target, LOCAL_ORIGIN);

    if (url.origin !== LOCAL_ORIGIN || isLoginPath(url.pathname)) {
      return null;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};

export const getAuthReturnTarget = (location: Location): RouterLocationLike => ({
  pathname: location.pathname,
  search: location.search,
  hash: location.hash,
});

export const resolveAuthReturnTarget = (
  location: Location,
  fallback = DEFAULT_POST_LOGIN_PATH,
): string => {
  const state = location.state as { from?: unknown } | null;
  const stateTarget = normalizeInternalReturnTarget(state?.from);

  if (stateTarget) {
    return stateTarget;
  }

  const queryTarget = new URLSearchParams(location.search).get("returnTo");
  const queryReturnTarget = normalizeInternalReturnTarget(queryTarget);

  return queryReturnTarget ?? fallback;
};
