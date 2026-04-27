import { store } from "@store/app-store.ts";
import type { ViewportResponse } from "@api/types.ts";
import { GestureHandler }   from "./gesture-handler.ts";
import { InertiaEngine }    from "./inertia.ts";
import { ViewportFetcher }  from "./viewport-fetcher.ts";
import { computePxPerVerse } from "./zoom-math.ts";
import { dispatchCameraUpdate } from "../camera.ts";
import { getTheme } from "../theme.ts";
import { ERAS } from "../era-data.ts";

const TOTAL_SEQUENCES = 31102;
const SIDEBAR_RAIL_W  = 52;   // always-visible rail; full sidebar = 288
const VERSES_PER_CHAPTER_APPROX = 26;
const ERA_BAND_H = 32;         // matches the DOM EraBand overlay height
const AXIS_OFFSET_FROM_CENTER = 0; // axis sits at canvas vertical center

/**
 * How far past each end of the timeline the pan is allowed to drift.
 *
 * Cards above the axis are centered on their verse sequence and are between
 * 220 (compact) and 300 (comfy) pixels wide, so without overscan the first
 * and last cards would hang half off-screen. We pad asymmetrically:
 *
 *   • Left: 160 px is plenty — the sidebar already reserves 52–288 px of
 *     chrome and the horizontal packing algorithm only pushes cards to the
 *     RIGHT when they collide, so the leftmost card never drifts further
 *     left than its natural center.
 *   • Right: the packing algorithm can push the tail of a cluster farther
 *     right than the card's natural axis position, so we give the right
 *     side more slack (260 px — half of a comfy card plus breathing room
 *     for the bottom-right zoom FAB and a small rightmost shadow/fade).
 */
const EDGE_PAD_LEFT_PX  = 160;
const EDGE_PAD_RIGHT_PX = 160;

/**
 * Axis tick density per level. Mirrors timeline.jsx::Axis — roughly 12 era
 * ticks, 30 book ticks, 80 chapter ticks, 200 verse ticks across the visible
 * world. Ticks are spaced uniformly in sequence space so they re-densify
 * automatically as the user zooms in.
 */
const TICK_COUNTS: Record<string, number> = {
  panorama: 12,
  era: 12,
  book: 30,
  chapter: 80,
  verse: 200,
};

export class TimelineCanvas {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // camera
  private focusSeq   = 1;
  private panOffset  = 0;
  private zoomFactor = 0.05;
  private sidebarW   = SIDEBAR_RAIL_W;
  private mouseX     = 0;

  // render state
  private viewport: ViewportResponse | null = null;
  private dirty    = true;

  // RAF loop
  private rafId: number | null = null;
  private lastTs  = 0;

  // engines
  private readonly inertia:   InertiaEngine;
  private readonly gestures:  GestureHandler;
  private readonly fetcher:   ViewportFetcher;
  private readonly resizer:   ResizeObserver;

  private openEventCard?: (eventId: string) => void;
  /**
   * Callback that returns the current card-layout overflow in pixels —
   * how far past sequence TOTAL's natural screen position the right-most
   * packed card extends. Injected from `main.ts` so the canvas can
   * stretch its right-side clamp dynamically as the card cluster changes.
   */
  private rightOverflowProvider: () => number = () => 0;
  /** First viewport after boot: auto-center. Subsequent responses compensate. */
  private firstViewport = true;

  constructor() {
    this.el = document.createElement("canvas");
    this.el.style.cssText = "position:fixed;inset:0;width:100%;height:100%;touch-action:none;z-index:0;";
    this.el.setAttribute("role", "application");
    this.el.setAttribute("aria-label", "Bible Timeline");
    this.el.setAttribute("aria-live", "polite");

    const ctx = this.el.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;

    this.inertia = new InertiaEngine();

    this.gestures = new GestureHandler(this.el, {
      onPanStart: () => {
        this.inertia.stop();
        store.update({ status: "panning" });
      },
      onPan: (dx) => {
        this.panOffset = this.clampPan(this.panOffset + dx);
        this.markDirty();
      },
      onPanEnd: (vx) => {
        store.update({ status: "idle" });
        this.inertia.start(vx);
        if (!this.inertia.isActive) this.settle();
      },
      // Horizontal wheel / trackpad swipe: direct pan, no inertia because the
      // trackpad already carries momentum. We debounce the follow-up viewport
      // request inside ViewportFetcher, so streaming wheel events don't
      // hammer the backend.
      onWheelPan: (dx) => {
        this.inertia.stop();
        this.panOffset = this.clampPan(this.panOffset + dx);
        this.markDirty();
        const focusX = this.mouseX > 0 ? this.mouseX : this.canvasCenterX();
        this.fetcher.request(this.zoomFactor, Math.round(this.screenToSeq(focusX)));
      },
      onZoom: (scale, centerX) => {
        this.applyZoom(scale, centerX);
      },
      onTap: (_x, _y) => {
        // DOM cards handle their own clicks
      },
      onDoubleTap: (x, _y) => {
        this.applyZoom(1.5, x);
      },
      onLongPress: (_x, _y) => {
        // no-op — DOM cards handle long press
      },
    });

    const s = store.getState();
    this.zoomFactor = s.zoomFactor;
    this.focusSeq   = 1;

    this.fetcher = new ViewportFetcher(
      s.timelineId,
      (vp) => this.onViewportReceived(vp),
      (err) => {
        console.error("Viewport error:", err);
        store.update({ status: "idle" });
      },
    );

    this.resizer = new ResizeObserver(() => this.onResize());
    this.resizer.observe(document.documentElement);

    this.el.addEventListener("mousemove", (e) => { this.mouseX = e.clientX; });
    this.el.addEventListener("mouseleave", () => { this.mouseX = 0; });

    document.addEventListener("keydown", this.onKeyDown);

    store.subscribe((s) => {
      const nextSidebarW = s.sidebarOpen ? 320 : SIDEBAR_RAIL_W;
      if (nextSidebarW !== this.sidebarW) {
        this.sidebarW = nextSidebarW;
        // The visible area shrinks/grows → re-clamp so the timeline stays
        // within bounds (or re-centers if everything now fits).
        this.panOffset = this.clampPan(this.panOffset);
      }
      this.markDirty();
    });
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
    this.onResize();
    this.startLoop();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setOpenEventCard(fn: (eventId: string) => void): void {
    this.openEventCard = fn;
  }

  /** Inject the dynamic right-side overflow source (from EventCards). */
  setRightOverflowProvider(fn: () => number): void {
    this.rightOverflowProvider = fn;
  }

  zoomIn(): void  { this.applyZoom(1.3, this.canvasCenterX()); }
  zoomOut(): void { this.applyZoom(1 / 1.3, this.canvasCenterX()); }

  recenter(): void {
    this.panOffset = this.clampPan(0);
    this.markDirty();
    this.fetcher.request(this.zoomFactor, this.focusSeq);
  }

  /** Jump the focus point to an absolute verse sequence (clamped to [1..TOTAL]). */
  jumpToSequence(seq: number): void {
    this.focusSeq  = Math.max(1, Math.min(TOTAL_SEQUENCES, Math.round(seq)));
    this.panOffset = this.clampPan(0);
    this.markDirty();
    this.fetcher.request(this.zoomFactor, this.focusSeq);
  }

  /** Jump + zoom-in. Used by search palette when the user picks a hit. */
  jumpToSequenceAndZoom(seq: number, minZoomFactor = 0.55): void {
    const targetZoom = Math.max(this.zoomFactor, minZoomFactor);
    this.focusSeq   = Math.max(1, Math.min(TOTAL_SEQUENCES, Math.round(seq)));
    this.zoomFactor = targetZoom;
    // Clamp AFTER the new zoom is committed so clampPan uses the new pxPerVerse.
    this.panOffset  = this.clampPan(0);
    store.update({ zoomFactor: targetZoom, status: "focusing" });
    this.markDirty();
    this.fetcher.request(this.zoomFactor, this.focusSeq);
  }

  async loadInitialViewport(): Promise<void> {
    store.update({ status: "loading-viewport" });
    this.fetcher.request(this.zoomFactor, this.focusSeq);
  }

  // ── RAF loop ─────────────────────────────────────────────────────────────

  private startLoop(): void {
    const tick = (ts: number) => {
      const dt = this.lastTs > 0 ? Math.min(ts - this.lastTs, 50) : 16;
      this.lastTs = ts;

      if (this.inertia.isActive) {
        const next = this.panOffset + this.inertia.tick(dt);
        const clamped = this.clampPan(next);
        // If the inertia ran into the boundary, kill the glide so we don't
        // keep bouncing off the wall every frame.
        if (clamped !== next) this.inertia.stop();
        this.panOffset = clamped;
        this.markDirty();
        if (!this.inertia.isActive) this.settle();
      }

      if (this.dirty) {
        this.render();
        this.dirty = false;
        this.emitCamera();
      }

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  // ── Camera helpers ────────────────────────────────────────────────────────

  private canvasCenterX(): number {
    // Center of the viewable area to the right of the sidebar.
    return (window.innerWidth + this.sidebarW) / 2;
  }

  seqToScreen(seq: number): number {
    const pxPerVerse = computePxPerVerse(this.zoomFactor);
    return (seq - this.focusSeq) * pxPerVerse + this.canvasCenterX() + this.panOffset;
  }

  private screenToSeq(screenX: number): number {
    const pxPerVerse = computePxPerVerse(this.zoomFactor);
    return this.focusSeq + (screenX - this.canvasCenterX() - this.panOffset) / pxPerVerse;
  }

  /**
   * Constrain a proposed pan offset so the timeline can't scroll past its
   * own extremities.
   *
   * The visible range in sequence space must stay within [1, TOTAL]:
   *   • The leftmost visible x should show a sequence >= 1 (sequence 1 sits
   *     at or to the right of the canvas left edge).
   *   • The rightmost visible x should show a sequence <= TOTAL.
   *
   * When the entire content fits inside the viewport (very zoomed out),
   * the two bounds flip. In that case we center the content — the two
   * halves of the midpoint formula happen to be the average of the
   * (now invalid) min/max.
   */
  private clampPan(pan: number): number {
    const pxPerVerse = computePxPerVerse(this.zoomFactor);
    const cx         = this.canvasCenterX();
    const leftEdge   = this.sidebarW;
    const rightEdge  = window.innerWidth;

    // Allow asymmetric overscan on each side so cards centered on sequence 1
    // or TOTAL don't end up half-clipped by the viewport edges. The right pad
    // is larger because the horizontal card-packing algorithm can push the
    // tail of a cluster further right than its natural axis position — we
    // read the dynamic overflow (reported by EventCards after every layout)
    // and stretch the right bound so the last packed card stays on-screen
    // with the EDGE_PAD_RIGHT_PX breathing room beyond it.
    const dynamicRightPad = EDGE_PAD_RIGHT_PX + Math.max(0, this.rightOverflowProvider());
    const maxPan = (this.focusSeq - 1)               * pxPerVerse + leftEdge  - cx + EDGE_PAD_LEFT_PX;
    const minPan = (this.focusSeq - TOTAL_SEQUENCES) * pxPerVerse + rightEdge - cx - dynamicRightPad;

    if (minPan > maxPan) {
      // Content narrower than viewport (typical at the minimum zoom) —
      // center it. The average of the two invalid bounds resolves to the
      // pan value that puts the midpoint of the sequence space at cx.
      return (minPan + maxPan) / 2;
    }
    return Math.max(minPan, Math.min(maxPan, pan));
  }

  private emitCamera(): void {
    dispatchCameraUpdate({
      focusSeq:   this.focusSeq,
      panOffset:  this.panOffset,
      zoomFactor: this.zoomFactor,
      pxPerVerse: computePxPerVerse(this.zoomFactor),
      viewportW:  window.innerWidth,
      sidebarW:   this.sidebarW,
    });
  }

  private markDirty(): void { this.dirty = true; }

  private settle(): void {
    const pxPerVerse = computePxPerVerse(this.zoomFactor);
    const intDelta   = Math.round(-this.panOffset / pxPerVerse);
    this.focusSeq    = Math.max(1, Math.min(TOTAL_SEQUENCES, this.focusSeq + intDelta));
    // Keep the sub-verse fractional remainder so screen positions don't jump.
    // Setting panOffset=0 here would snap cards by up to pxPerVerse/2 px
    // (invisible at era zoom ~0.6px/verse; up to 125px at verse zoom 250px/verse).
    this.panOffset   = this.clampPan(this.panOffset + intDelta * pxPerVerse);
    this.markDirty();
    this.fetcher.request(this.zoomFactor, this.focusSeq);
  }

  private applyZoom(scale: number, centerX: number): void {
    const pxPerVerse    = computePxPerVerse(this.zoomFactor);
    const newZoom       = Math.max(0.001, Math.min(0.999, this.zoomFactor * scale));
    const newPxPerVerse = computePxPerVerse(newZoom);

    const cx = this.canvasCenterX();
    const seqOffset = (centerX - cx - this.panOffset) / pxPerVerse;
    const nextPan   = centerX - cx - seqOffset * newPxPerVerse;

    this.zoomFactor = newZoom;
    this.panOffset  = this.clampPan(nextPan);
    store.update({ zoomFactor: newZoom, status: "zooming" });
    this.markDirty();
    // Use the sequence at the zoom center (mouse/pinch position) as focus so
    // the server returns events centered around where the user is pointing.
    const focusAtCenter = Math.max(1, Math.min(TOTAL_SEQUENCES, Math.round(this.focusSeq + seqOffset)));
    this.fetcher.request(newZoom, focusAtCenter);
  }

  // ── Viewport callback ─────────────────────────────────────────────────────

  private onViewportReceived(vp: ViewportResponse): void {
    const pxPerVerse = computePxPerVerse(this.zoomFactor);
    const prevFocus  = this.focusSeq;
    const newFocus   = vp.focus.resolvedFocusSequence;

    this.viewport  = vp;
    this.focusSeq  = newFocus;

    if (this.firstViewport) {
      // Boot: let clampPan auto-center when the entire timeline fits in the
      // viewport (typical at zoom 0). From here on we never auto-center on
      // responses — the pan would snap away from wherever the user is.
      this.panOffset    = this.clampPan(0);
      this.firstViewport = false;
    } else {
      // Live refresh — typical during streaming trackpad/wheel pan, pinch
      // zoom, or arrow-key navigation. The visible position must not jump
      // just because the server re-resolved the focus sequence.
      //
      //   seqToScreen(s) = (s - focus) * pxPerVerse + cx + pan
      //
      // After a focus change Δ = newFocus - prevFocus we need the same on-
      // screen position, so pan must shift by +Δ·pxPerVerse. When the server
      // returned exactly what we asked for (the common case — our service
      // uses the explicit focusSequence we pass), Δ is 0 and pan is
      // untouched; the formula also handles focus snapping transparently.
      const focusShiftPx = (newFocus - prevFocus) * pxPerVerse;
      this.panOffset = this.clampPan(this.panOffset + focusShiftPx);
    }

    store.update({ viewport: vp, focusEventId: vp.focus.focusedEventId, status: "idle" });
    this.markDirty();
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  private onKeyDown = (e: KeyboardEvent): void => {
    const tag = (document.activeElement as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    const pxPerVerse = computePxPerVerse(this.zoomFactor);
    const step = e.shiftKey ? VERSES_PER_CHAPTER_APPROX : 1;

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        this.panOffset = this.clampPan(this.panOffset + step * pxPerVerse);
        this.markDirty();
        this.fetcher.request(this.zoomFactor, Math.round(this.screenToSeq(this.canvasCenterX())));
        break;
      case "ArrowRight":
        e.preventDefault();
        this.panOffset = this.clampPan(this.panOffset - step * pxPerVerse);
        this.markDirty();
        this.fetcher.request(this.zoomFactor, Math.round(this.screenToSeq(this.canvasCenterX())));
        break;
      case "+":
      case "=":
        e.preventDefault();
        this.applyZoom(1.3, this.canvasCenterX());
        break;
      case "-":
        e.preventDefault();
        this.applyZoom(1 / 1.3, this.canvasCenterX());
        break;
      case " ":
        e.preventDefault();
        this.panOffset = 0;
        this.markDirty();
        break;
      case "Home":
        e.preventDefault();
        this.focusSeq  = 1;
        this.panOffset = 0;
        this.markDirty();
        this.fetcher.request(this.zoomFactor, 1);
        break;
    }
  };

  // ── Resize ────────────────────────────────────────────────────────────────

  private onResize(): void {
    const dpr = window.devicePixelRatio ?? 1;
    this.el.width  = window.innerWidth  * dpr;
    this.el.height = window.innerHeight * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    // Re-clamp so resizing the window (or opening/closing the sidebar) keeps
    // the content properly centered / within bounds at the new viewport size.
    this.panOffset = this.clampPan(this.panOffset);
    this.markDirty();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  //
  // The canvas paints the always-visible atmosphere of the timeline: the
  // vignette, era band background, axis line, and ticks. All interactive
  // elements (event cards, float cards, era labels) live in DOM overlays.

  private render(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ctx = this.ctx;
    const theme = getTheme(store.getState().theme);

    // ── Background + vignette ───────────────────────────────────────────────
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);
    this.drawVignette(ctx, w, h, theme);

    if (!this.viewport) {
      this.drawPlaceholder(w, h, theme);
      return;
    }

    this.drawAxis(ctx, w, h, theme);
    this.drawDateRule(ctx, w, h, theme);

    if (store.getState().status === "loading-viewport") {
      // Subtle loading shade; DOM overlays remain visible on top.
      ctx.fillStyle = "oklch(0 0 0 / 0.18)";
      ctx.fillRect(0, 0, w, h);
    }
  }

  /** Soft two-layer radial vignette matching the design prototype. */
  private drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, _theme: ReturnType<typeof getTheme>): void {
    // Canvas 2D has no color-mix helper, so we render the vignette using
    // radial gradients against the themed background.
    const g1 = ctx.createRadialGradient(w / 2, h * 0.2, 0, w / 2, h * 0.2, Math.max(w, h) * 0.5);
    g1.addColorStop(0, "oklch(1 0 0 / 0.02)");
    g1.addColorStop(1, "oklch(0 0 0 / 0)");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);

    const g2 = ctx.createRadialGradient(w / 2, h * 1.1, 0, w / 2, h * 1.1, Math.max(w, h) * 0.55);
    g2.addColorStop(0, "oklch(1 0 0 / 0.03)");
    g2.addColorStop(1, "oklch(0 0 0 / 0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  }

  /** Horizontal axis + era-tinted ticks + era rail just above the axis. */
  private drawAxis(ctx: CanvasRenderingContext2D, w: number, h: number, theme: ReturnType<typeof getTheme>): void {
    const axisY = h / 2 + AXIS_OFFSET_FROM_CENTER;
    const pxPerVerse = computePxPerVerse(this.zoomFactor);

    // Era rail — thin color strip that sits directly above the axis, distinct
    // from the DOM-based era band at the top. Helps the eye connect cards
    // above the axis with the era underneath.
    const RAIL_H = 3;
    const railY  = axisY - RAIL_H - 10;
    for (const era of ERAS) {
      const startSeq = era.start * TOTAL_SEQUENCES + 1;
      const endSeq   = era.end   * TOTAL_SEQUENCES + 1;
      const x1 = this.seqToScreen(startSeq);
      const x2 = this.seqToScreen(endSeq);
      if (x2 < this.sidebarW || x1 > w) continue;
      ctx.fillStyle = era.color;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(Math.max(x1, this.sidebarW), railY, Math.min(x2, w) - Math.max(x1, this.sidebarW), RAIL_H);
    }
    ctx.globalAlpha = 1;

    // Main axis line
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(this.sidebarW, axisY);
    ctx.lineTo(w, axisY);
    ctx.stroke();

    // Ticks — evenly spaced in sequence space. Major tick every 5 minor ticks.
    const level = this.viewport?.zoomLevel?.label?.toLowerCase?.() ?? "era";
    const majorPerWorld = TICK_COUNTS[level] ?? TICK_COUNTS.era!;
    const step = Math.max(1, Math.round(TOTAL_SEQUENCES / (majorPerWorld * 5)));
    const firstSeq = Math.floor(this.screenToSeq(this.sidebarW) / step) * step;
    const lastSeq  = Math.ceil(this.screenToSeq(w) / step) * step;
    ctx.fillStyle = theme.axis;
    for (let seq = firstSeq; seq <= lastSeq; seq += step) {
      if (seq < 1 || seq > TOTAL_SEQUENCES) continue;
      const x = this.seqToScreen(seq);
      if (x < this.sidebarW - 4 || x > w + 4) continue;

      const isMajor = (seq % (step * 5)) === 0;
      const tickH = isMajor ? 14 : 8;
      ctx.globalAlpha = isMajor ? 0.9 : 0.45;
      ctx.fillRect(Math.round(x), axisY - tickH / 2, 1, tickH);
    }
    ctx.globalAlpha = 1;

    // Focus-ref label under the axis (monospace, subdued)
    const focusRef = this.viewport?.focus?.resolvedFocusRef;
    if (focusRef) {
      ctx.fillStyle    = theme.textMute;
      ctx.font         = "11px 'JetBrains Mono', monospace";
      ctx.textBaseline = "top";
      ctx.textAlign    = "center";
      ctx.fillText(focusRef, this.canvasCenterX(), axisY + 10);
      ctx.textAlign = "start";
    }

    // Pixels-per-verse ornament near the axis left edge, barely visible.
    if (this.viewport?.zoomLevel?.label) {
      ctx.fillStyle    = theme.textMute;
      ctx.globalAlpha  = 0.45;
      ctx.font         = "10px 'JetBrains Mono', monospace";
      ctx.textBaseline = "top";
      ctx.textAlign    = "start";
      ctx.fillText(
        `${pxPerVerse.toFixed(2)} px/verse`,
        this.sidebarW + 12,
        axisY + 10,
      );
      ctx.globalAlpha = 1;
    }
  }

  /** Fade-to-bg gradients on the left (above sidebar) and right edges. */
  private drawDateRule(ctx: CanvasRenderingContext2D, w: number, h: number, theme: ReturnType<typeof getTheme>): void {
    const FADE = 48;
    const leftFade = ctx.createLinearGradient(this.sidebarW, 0, this.sidebarW + FADE, 0);
    leftFade.addColorStop(0, theme.bg);
    leftFade.addColorStop(1, "oklch(0 0 0 / 0)");
    ctx.fillStyle = leftFade;
    ctx.fillRect(this.sidebarW, ERA_BAND_H, FADE, h - ERA_BAND_H);

    const rightFade = ctx.createLinearGradient(w - FADE, 0, w, 0);
    rightFade.addColorStop(0, "oklch(0 0 0 / 0)");
    rightFade.addColorStop(1, theme.bg);
    ctx.fillStyle = rightFade;
    ctx.fillRect(w - FADE, ERA_BAND_H, FADE, h - ERA_BAND_H);
  }

  private drawPlaceholder(w: number, h: number, theme: ReturnType<typeof getTheme>): void {
    this.ctx.fillStyle    = theme.textMute;
    this.ctx.font         = "14px Inter, system-ui, sans-serif";
    this.ctx.textAlign    = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText("Cargando timeline…", (w + this.sidebarW) / 2, h / 2);
    this.ctx.textAlign = "start";
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.gestures.destroy();
    this.fetcher.destroy();
    this.resizer.disconnect();
    document.removeEventListener("keydown", this.onKeyDown);
  }
}
