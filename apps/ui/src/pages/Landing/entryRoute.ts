export function isStandaloneLanding(location: { pathname: string; search: string }) {
  return location.pathname === "/" &&
    !new URLSearchParams(location.search).get("welcome");
}
