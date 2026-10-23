import {
  landingPageCopy,
  landingHeroViews,
  type LandingHeroView,
} from "../../components/Homepage/landingPageCopy";
import {
  fetchDemoSandboxAvailable,
  landingCtaByState,
} from "../../components/Homepage/landingPageCta";
import "./landing.css";
import { startLandingAnalytics } from "./landingAnalytics";

// Copy is shared with the in-app home page; no application runtime is imported.
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );

export function mountLanding(root: HTMLElement) {
  const { hero, capabilities, beta } = landingPageCopy;
  const cta = landingCtaByState["signed-out"];
  root.innerHTML = `
    <main class="landing" data-testid="landing-page">
      <section class="landing-hero" data-testid="landing-hero">
        <div class="landing-container">
          <h1 class="landing-brand"><span>H</span>ey <span>H</span>ey</h1>
          <h2>${escapeHtml(hero.title)}</h2>
          <p class="landing-description">${escapeHtml(hero.description)}</p>
          <div class="landing-actions">
            <a class="landing-button" href="${cta.primary.path}">${cta.primary.label}</a>
            <span data-demo-entry hidden></span>
            <a class="landing-button landing-button-outline" href="${cta.secondary.path}">${cta.secondary.label}</a>
          </div>
          <section class="landing-videos" aria-label="Hey Hey product videos">
            <div class="landing-video-phase">
              <div class="landing-media"></div>
              <div class="landing-video-caption">
                <div><h3></h3><div class="landing-video-body"></div></div>
                <div class="landing-video-buttons" role="group" aria-label="Choose product video">
                  ${landingHeroViews.map((_, index) => `<button type="button" aria-label="Show product video ${index + 1}" aria-pressed="${index === 0}"></button>`).join("")}
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>
      <section class="landing-capabilities" aria-labelledby="landing-why-title">
        <div class="landing-container">
          <h2 id="landing-why-title">Why Hey Hey</h2>
          <ul>${capabilities.map((capability) => `<li><span aria-hidden="true">☷</span><div><h3>${escapeHtml(capability.title)}</h3><p>${escapeHtml(capability.description)}</p></div></li>`).join("")}</ul>
        </div>
      </section>
      <section class="landing-beta" data-testid="landing-beta-cta">
        <h2>${escapeHtml(beta.title)}</h2>
        <p>${escapeHtml(beta.description)}</p>
        <a class="landing-button" href="${cta.primary.path}">${escapeHtml(beta.action)}</a>
      </section>
    </main>
    <footer class="landing-footer" aria-label="Legal disclosures">
      <span>Hey Hey beta</span>
      <nav aria-label="Legal disclosures"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/security">Security</a></nav>
    </footer>`;

  const stopAnalytics = startLandingAnalytics(root);

  let unmounted = false;
  void fetchDemoSandboxAvailable().then((available) => {
    if (!available || unmounted) return;
    const link = Object.assign(document.createElement("a"), {
      className: "landing-button landing-button-outline",
      href: cta.demo.path,
      textContent: cta.demo.label,
    });
    link.dataset.testid = "landing-view-demo";
    root.querySelector("[data-demo-entry]")?.replaceWith(link);
  });

  const container = root.querySelector<HTMLElement>(".landing-videos")!;
  const phase = container.querySelector<HTMLElement>(".landing-video-phase")!;
  const media = container.querySelector<HTMLElement>(".landing-media")!;
  const title = container.querySelector("h3")!;
  const body = container.querySelector(".landing-video-body")!;
  const buttons = [...container.querySelectorAll("button")];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobile = window.matchMedia("(max-width: 599.95px)");
  let activeIndex = 0;
  let hovered = false;
  let focused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let transitioning = false;

  const updatePlayback = () => {
    const video = media.querySelector("video");
    if (!video) return;
    if (hovered || focused || document.hidden) video.pause();
    else
      void video.play()?.catch(() => {
        // Provide native controls if the browser blocks autoplay.
        video.controls = true;
      });
  };

  const renderVideo = () => {
    const view: LandingHeroView = landingHeroViews[activeIndex];
    const visual =
      mobile.matches && view.visual.mobile ? view.visual.mobile : view.visual;
    const paragraphs =
      mobile.matches && view.mobileBody ? view.mobileBody : view.body;
    media.style.aspectRatio = visual.aspectRatio ?? "4 / 3";
    title.textContent = view.title;
    title.style.color = ["#fff", "rgb(8, 126, 139)", "#90caf9"][activeIndex];
    body.innerHTML = paragraphs
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      .join("");
    buttons.forEach((button, index) =>
      button.setAttribute("aria-pressed", String(index === activeIndex)),
    );
    if (reducedMotion.matches) {
      const poster = document.createElement("img");
      poster.src = visual.posterSrc;
      poster.alt = visual.alt;
      media.replaceChildren(poster);
      return;
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.poster = visual.posterSrc;
    video.setAttribute("aria-label", visual.alt);
    for (const [src, type] of [
      [visual.webmSrc, "video/webm"],
      [visual.mp4Src, "video/mp4"],
    ]) {
      if (!src) continue;
      const source = document.createElement("source");
      source.src = src;
      source.type = type!;
      video.append(source);
    }
    video.addEventListener("ended", () => {
      timer = setTimeout(
        () => selectVideo((activeIndex + 1) % landingHeroViews.length),
        activeIndex === 0 ? 750 : 0,
      );
    });
    media.replaceChildren(video);
    updatePlayback();
  };

  const selectVideo = (index: number) => {
    if (transitioning || activeIndex === index) return;
    clearTimeout(timer);
    if (reducedMotion.matches) {
      activeIndex = index;
      renderVideo();
      return;
    }
    transitioning = true;
    phase.classList.add("is-fading");
    timer = setTimeout(() => {
      activeIndex = index;
      renderVideo();
      phase.classList.remove("is-fading");
      timer = setTimeout(() => {
        transitioning = false;
      }, 400);
    }, 800);
  };
  buttons.forEach((button, index) =>
    button.addEventListener("click", () => selectVideo(index)),
  );
  container.addEventListener("mouseenter", () => {
    hovered = true;
    updatePlayback();
  });
  container.addEventListener("mouseleave", () => {
    hovered = false;
    updatePlayback();
  });
  container.addEventListener("focusin", () => {
    focused = true;
    updatePlayback();
  });
  container.addEventListener("focusout", (event) => {
    focused = container.contains(event.relatedTarget as Node | null);
    updatePlayback();
  });
  const resetVideo = () => {
    clearTimeout(timer);
    transitioning = false;
    phase.classList.remove("is-fading");
    renderVideo();
  };
  mobile.addEventListener("change", resetVideo);
  reducedMotion.addEventListener("change", resetVideo);
  document.addEventListener("visibilitychange", updatePlayback);
  renderVideo();

  return () => {
    unmounted = true;
    stopAnalytics();
    clearTimeout(timer);
    mobile.removeEventListener("change", resetVideo);
    reducedMotion.removeEventListener("change", resetVideo);
    document.removeEventListener("visibilitychange", updatePlayback);
    media.querySelector("video")?.pause();
    root.replaceChildren();
  };
}
