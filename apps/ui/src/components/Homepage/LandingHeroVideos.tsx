import {
  Box,
  ButtonBase,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import {
  landingHeroViews,
  type LandingHeroView,
  type LandingProofVideo,
} from "./landingPageCopy";

const FADE_OUT_MS = 800;
const FADE_IN_MS = 400;
const FIRST_VIDEO_END_HOLD_MS = 750;

export const LandingHeroVideos = () => {
  const prefersReducedMotion = useMediaQuery(
    "(prefers-reduced-motion: reduce)",
  );
  const isMobileViewport = useMediaQuery("(max-width:599.95px)");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isTransitioningRef = useRef(false);
  const endHoldTimerRef = useRef<number | null>(null);
  const switchTimerRef = useRef<number | null>(null);
  const finishTimerRef = useRef<number | null>(null);
  const activeVideo: LandingHeroView =
    landingHeroViews[activeIndex] ?? landingHeroViews[0];
  const activeVisual: LandingProofVideo =
    isMobileViewport && activeVideo.visual.mobile
      ? activeVideo.visual.mobile
      : activeVideo.visual;
  const activeBody =
    isMobileViewport && activeVideo.mobileBody
      ? activeVideo.mobileBody
      : activeVideo.body;
  const isPaused = isHovered || isFocused;

  const transitionToVideo = useCallback(
    (index: number) => {
      if (index === activeIndex || isTransitioningRef.current) {
        return;
      }

      if (prefersReducedMotion) {
        setActiveIndex(index);
        return;
      }

      isTransitioningRef.current = true;
      setIsVisible(false);
      switchTimerRef.current = window.setTimeout(() => {
        setActiveIndex(index);
        setIsVisible(true);
        finishTimerRef.current = window.setTimeout(() => {
          isTransitioningRef.current = false;
        }, FADE_IN_MS);
      }, FADE_OUT_MS);
    },
    [activeIndex, prefersReducedMotion],
  );

  const selectVideo = useCallback(
    (index: number) => {
      if (endHoldTimerRef.current !== null) {
        window.clearTimeout(endHoldTimerRef.current);
        endHoldTimerRef.current = null;
      }
      transitionToVideo(index);
    },
    [transitionToVideo],
  );

  const advanceVideo = useCallback(() => {
    transitionToVideo((activeIndex + 1) % landingHeroViews.length);
  }, [activeIndex, transitionToVideo]);

  const handleVideoEnded = useCallback(() => {
    if (activeIndex !== 0) {
      advanceVideo();
      return;
    }

    endHoldTimerRef.current = window.setTimeout(() => {
      endHoldTimerRef.current = null;
      advanceVideo();
    }, FIRST_VIDEO_END_HOLD_MS);
  }, [activeIndex, advanceVideo]);

  useEffect(
    () => () => {
      if (endHoldTimerRef.current !== null) {
        window.clearTimeout(endHoldTimerRef.current);
      }
      if (switchTimerRef.current !== null) {
        window.clearTimeout(switchTimerRef.current);
      }
      if (finishTimerRef.current !== null) {
        window.clearTimeout(finishTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || prefersReducedMotion) {
      return;
    }

    if (isPaused) {
      video.pause();
      return;
    }

    if (video.readyState === 0) {
      return;
    }

    const playback = video.play();
    if (playback && typeof playback.catch === "function") {
      void playback.catch(() => {
        // Autoplay can be unavailable; the poster and video controls remain usable.
      });
    }
  }, [activeIndex, isPaused, prefersReducedMotion]);

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsFocused(false);
    }
  };

  return (
    <Box
      component="section"
      aria-label="Hey Hey product videos"
      data-testid="landing-hero-videos"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={handleBlur}
      sx={{ width: "100%", mt: { xs: 5, md: 7 } }}
    >
      <Box
        data-testid="landing-hero-phase"
        sx={{
          opacity: isVisible ? 1 : 0,
          transition: prefersReducedMotion
            ? "none"
            : `opacity ${isVisible ? FADE_IN_MS : FADE_OUT_MS}ms ease`,
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: "100%",
            maxWidth: 860,
            mx: "auto",
            aspectRatio: activeVisual.aspectRatio ?? "4 / 3",
            overflow: "hidden",
            border: "1px solid rgba(255, 255, 255, 0.24)",
            borderRadius: "4px",
            bgcolor: "#fff",
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.24)",
          }}
        >
          {prefersReducedMotion ? (
            <Box
              component="img"
              src={activeVisual.posterSrc}
              alt={activeVisual.alt}
              sx={{
                display: "block",
                width: "100%",
                height: "100%",
                objectFit: "cover",
                borderRadius: "4px",
              }}
            />
          ) : (
            <Box
              key={`${activeIndex}-${isMobileViewport ? "mobile" : "desktop"}`}
              ref={videoRef}
              component="video"
              autoPlay
              muted
              playsInline
              preload="metadata"
              poster={activeVisual.posterSrc}
              aria-label={activeVisual.alt}
              onEnded={handleVideoEnded}
              sx={{
                display: "block",
                width: "100%",
                height: "100%",
                objectFit: "cover",
                borderRadius: "4px",
              }}
            >
              {activeVisual.webmSrc && (
                <source src={activeVisual.webmSrc} type="video/webm" />
              )}
              <source src={activeVisual.mp4Src} type="video/mp4" />
            </Box>
          )}
        </Box>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={{ xs: 2, sm: 3 }}
          alignItems={{ xs: "stretch", sm: "center" }}
          justifyContent="space-between"
          sx={{ maxWidth: 860, mx: "auto", mt: 2.5 }}
        >
          <Box>
            <Typography
              component="h3"
              sx={{
                color: (theme) =>
                  [
                    theme.palette.common.white,
                    theme.palette.heyhey?.main ?? "rgb(8, 126, 139)",
                    theme.palette.primary.main,
                  ][activeIndex],
                fontSize: { xs: "1.05rem", sm: "1.2rem" },
                fontWeight: 700,
                transition: prefersReducedMotion
                  ? "none"
                  : `color ${FADE_IN_MS}ms ease`,
              }}
            >
              {activeVideo.title}
            </Typography>
            <Stack spacing={0.75} sx={{ mt: 0.5 }}>
              {activeBody.map((paragraph) => (
                <Typography
                  component="p"
                  key={paragraph}
                  sx={{
                    maxWidth: 620,
                    color: "rgba(255, 255, 255, 0.76)",
                    fontSize: { xs: "0.9rem", sm: "0.98rem" },
                    lineHeight: 1.55,
                  }}
                >
                  {paragraph}
                </Typography>
              ))}
            </Stack>
          </Box>

          <Stack
            component="div"
            role="tablist"
            aria-label="Choose product video"
            direction="row"
            spacing={1}
            sx={{ flexShrink: 0 }}
          >
            {landingHeroViews.map((video, index) => (
              <ButtonBase
                key={video.visual.alt}
                component="button"
                type="button"
                role="tab"
                aria-label={`Show product video ${index + 1}`}
                aria-selected={activeIndex === index}
                onClick={() => selectVideo(index)}
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  bgcolor:
                    activeIndex === index
                      ? "#fff"
                      : "rgba(255, 255, 255, 0.38)",
                  transition:
                    "background-color 160ms ease, transform 160ms ease",
                  "&:hover": { transform: "scale(1.2)" },
                  "&:focus-visible": {
                    outline: "3px solid rgba(255, 255, 255, 0.72)",
                    outlineOffset: 3,
                  },
                }}
              />
            ))}
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
};
