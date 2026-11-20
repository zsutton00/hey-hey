/**
 * Leaves the current app with a full page load, so whichever app owns the
 * destination starts from scratch: setup never hands live state to the main
 * app, and the main app never runs setup inside itself.
 */
export const loadDocument = (path: string): void => {
  window.location.replace(path);
};
