import { useEffect } from "react";

const FALLBACK_FAVICON_HREF = "/heyhey-favicon.svg";
const BRAND_COLOR = "rgb(8, 126, 139)";
const BRAND_FONT = '"Monoton", sans-serif';
const BRAND_FONT_SPEC = `400 52px ${BRAND_FONT}`;

const getOrCreateFaviconLink = (): HTMLLinkElement => {
  const existingFavicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (existingFavicon) {
    return existingFavicon;
  }

  const faviconLink = document.createElement("link");
  faviconLink.rel = "icon";
  document.head.appendChild(faviconLink);
  return faviconLink;
};

const setFavicon = (href: string, type: string): void => {
  const faviconLink = getOrCreateFaviconLink();
  faviconLink.type = type;
  faviconLink.href = href;
};

const buildMonotonFavicon = (): string | null => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = BRAND_COLOR;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = BRAND_FONT_SPEC;
  context.fillText("H", canvas.width / 2, canvas.height / 2 + 1);
  return canvas.toDataURL("image/png");
};

const applyBrandedFavicon = async (): Promise<void> => {
  if ("fonts" in document) {
    await document.fonts.load(BRAND_FONT_SPEC);
  }

  const faviconDataUrl = buildMonotonFavicon();
  if (faviconDataUrl) {
    setFavicon(faviconDataUrl, "image/png");
    return;
  }

  setFavicon(FALLBACK_FAVICON_HREF, "image/svg+xml");
};

export const usePageMetadata = (): void => {
  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        await applyBrandedFavicon();
      } catch {
        if (!cancelled) {
          setFavicon(FALLBACK_FAVICON_HREF, "image/svg+xml");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);
};
