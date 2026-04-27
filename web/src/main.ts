import { registerSW } from "virtual:pwa-register";
import { TimelineCanvas } from "@canvas/timeline-canvas.ts";
import { store } from "@store/app-store.ts";
import { applyThemeToRoot } from "./theme.ts";
import { Sidebar } from "@ui/sidebar.ts";
import { EraBand } from "@ui/era-band.ts";
import { EventCards } from "@ui/event-cards.ts";
import { FloatCards } from "@ui/float-cards.ts";
import { Minimap } from "@ui/minimap.ts";
import { ZoomFab } from "@ui/zoom-fab.ts";
import { Topbar } from "@ui/topbar.ts";
import { SearchPalette } from "@ui/search-palette.ts";
import { EventCard } from "@ui/event-card.ts";
import { Ads } from "@ui/ads.ts";
import "./styles/tokens.css";

// ── Service worker ────────────────────────────────────────────────────────────

registerSW({
  onNeedRefresh() {},
  onOfflineReady() { console.info("PWA: offline-ready"); },
});

// ── Apply the initial theme to :root as early as possible ────────────────────
//
// Every DOM overlay reads CSS variables (--color-*) during its first render, so
// the tokens have to be on the root before any component mounts. The store also
// emits on theme changes; we re-apply in the subscriber below.
applyThemeToRoot(store.getState().theme);

let appliedTheme = store.getState().theme;
store.subscribe((s) => {
  if (s.theme !== appliedTheme) {
    appliedTheme = s.theme;
    applyThemeToRoot(s.theme);
  }
});

// ── Offline badge ─────────────────────────────────────────────────────────────

const offlineBadge = document.createElement("div");
offlineBadge.textContent = "Sin conexión";
offlineBadge.style.cssText =
  "display:none;position:fixed;top:12px;left:50%;transform:translateX(-50%);" +
  "z-index:100;background:oklch(0.45 0.18 25);color:#fff;font-size:11px;font-weight:600;" +
  "padding:4px 12px;border-radius:999px;pointer-events:none;" +
  "font-family:var(--font-mono);letter-spacing:0.06em;";
document.body.appendChild(offlineBadge);

store.subscribe((s) => {
  offlineBadge.style.display = s.online ? "none" : "block";
});

// ── App bootstrap ─────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) throw new Error("#app not found");

  // Order matters for z-stacking (see tokens.css --z-* scale):
  //   canvas (0) < float cards (9) < event cards (10) < era band (5)
  //   < minimap (22) < topbar (25) < search (30) < sidebar (35) < sheet (40)
  //
  // The timeline reads verses directly in the top cards once zoom reaches the
  // verse level — no separate bottom sheet is needed, matching the design.
  const canvas        = new TimelineCanvas();
  const ads           = new Ads();
  const sidebar       = new Sidebar();
  const eraBand       = new EraBand();
  const floatCards    = new FloatCards();
  const eventCards    = new EventCards();
  const minimap       = new Minimap();
  const topbar        = new Topbar();
  const zoomFab       = new ZoomFab();
  const searchPalette = new SearchPalette();
  const eventCard     = new EventCard();

  // mount
  canvas.mount(app);
  floatCards.mount(app);
  ads.mount(app);                           // bottom strip (z-8, below cards)
  app.appendChild(ads.makeFloatAdCard());   // float-zone card (z-9, right side)
  eventCards.mount(app);
  eraBand.mount(app);
  sidebar.setAds(ads);
  sidebar.mount(app);
  minimap.mount(app);
  ads.setMinimapEl(minimap.el);
  topbar.mount(app);
  zoomFab.mount(app);
  searchPalette.mount(app);
  eventCard.mount(app);

  // wire
  // Open event card + zoom in so the user lands at the event's children level.
  const openEventById = (id: string): void => {
    const vp = store.getState().viewport;
    const ev = vp?.visibleEvents?.find((e) => e.id === id);
    if (ev) {
      const midSeq = Math.round((ev.startSequence + ev.endSequence) / 2);
      const targetZoom =
        ev.zoomLevel === 0 ? 0.15 :
        ev.zoomLevel === 1 ? 0.30 :
        ev.zoomLevel === 2 ? 0.55 :
        0.80;
      canvas.jumpToSequenceAndZoom(midSeq, targetZoom);
    }
    eventCard.open(id);
  };
  canvas.setOpenEventCard(openEventById);
  eventCards.setOpenEventCard(openEventById);
  // "Leer versículos" button in the popup jumps to verse-level zoom at event midpoint.
  eventCard.setJumpTo((seq) => canvas.jumpToSequenceAndZoom(seq, 0.80));
  // The canvas asks for the current packing overflow whenever it clamps the
  // pan offset — letting us reserve more right-side room when a cluster of
  // cards extends past the natural timeline end.
  canvas.setRightOverflowProvider(() => eventCards.rightOverflowPx);
  zoomFab.connect(canvas);
  searchPalette.connect(canvas);

  minimap.setJumpTo((seq) => {
    store.update({ focusRef: null, focusEventId: null });
    canvas.jumpToSequence(seq);
  });

  // Sidebar uses a custom event rather than an imperative handle so any
  // component (current or future) can emit it.
  window.addEventListener("sidebar-jump-sequence", ((e: Event) => {
    const detail = (e as CustomEvent<{ sequence: number }>).detail;
    if (detail?.sequence) canvas.jumpToSequence(detail.sequence);
  }) as EventListener);

  try {
    const res = await fetch("/health");
    if (!res.ok) console.warn("API health check failed:", res.status);
  } catch {
    console.warn("API unreachable — offline mode");
    store.update({ online: false });
  }

  await canvas.loadInitialViewport();

  const loader = document.getElementById("bt-loader");
  if (loader) {
    loader.classList.add("bt-out");
    setTimeout(() => loader.remove(), 400);
  }
}

bootstrap().catch(console.error);
