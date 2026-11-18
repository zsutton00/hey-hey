/** Local first-time setup runs as its own app at this address, never inside the main app. */
export const LOCAL_SETUP_PATH = "/local";

export const isLocalSetupEntry = (location: { pathname: string }): boolean =>
  location.pathname === LOCAL_SETUP_PATH ||
  location.pathname === `${LOCAL_SETUP_PATH}/`;
