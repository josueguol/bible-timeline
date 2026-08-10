import { store } from "@store/app-store.ts";
import { ERAS } from "../era-data.ts";
import { subscribeCameraUpdate, type CameraSnapshot } from "../camera.ts";
import type { FloatCard } from "../data/floats.ts";

/**
 * Bottom-centered minimap with era bands, float-card dots, and a draggable
 * viewport indicator. Styled to match the design: glass background, hairline
 * border, rounded corners.
 *
 * Public API (unchanged): `setJumpTo(fn)` receives a sequence number to jump
 * to when the user clicks or drags inside the minimap.
 */

const MINIMAP_H = 36;
const TOTAL     = 31102;

export class Minimap {
  readonly el: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private viewport!: HTMLElement;
  private unsub?: () => void;
  private lastSnap?: CameraSnapshot;
  private dragging = false;

  private jumpTo?: (seq: number) => void;
  private floatDots: readonly FloatCard[] = [];

  constructor() {
    this.el = document.createElement("div");
    this.el.setAttribute("role", "navigation");
    this.el.setAttribute("aria-label", "Minimap de la Biblia");
    this.el.dataset.noDrag = "1";
    this.el.style.cssText =
      "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);" +
      `width:min(640px, 60%);height:${MINIMAP_H}px;z-index:var(--z-minimap);` +
      "background:color-mix(in oklch, var(--color-surface) 85%, transparent);" +
      "border:1px solid var(--color-border);border-radius:var(--radius-md);" +
      "backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);" +
      "overflow:hidden;cursor:grab;touch-action:none;";

    this.buildCanvas();
    this.buildViewport();
    this.buildInteractions();
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
    this.unsub = subscribeCameraUpdate((snap) => this.onCamera(snap));
    store.subscribe(() => this.redraw());
  }

  setJumpTo(fn: (seq: number) => void): void {
    this.jumpTo = fn;
  }

  setFloatCards(cards: readonly FloatCard[]): void {
    this.floatDots = cards;
    this.redraw();
  }

  destroy(): void {
    this.unsub?.();
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  private buildCanvas(): void {
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("minimap canvas 2d unavailable");
    this.ctx = ctx;
    this.el.appendChild(this.canvas);
  }

  private buildViewport(): void {
    this.viewport = document.createElement("div");
    this.viewport.style.cssText =
      "position:absolute;top:0;bottom:0;pointer-events:none;" +
      "background:color-mix(in oklch, var(--color-accent) 18%, transparent);" +
      "border:1px solid var(--color-accent);border-radius:var(--radius-xs);";
    this.el.appendChild(this.viewport);
  }

  private buildInteractions(): void {
    const seqFromEvent = (e: PointerEvent | MouseEvent): number => {
      const rect = this.el.getBoundingClientRect();
      const r = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      return Math.round(r * (TOTAL - 1)) + 1;
    };

    this.el.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.el.setPointerCapture(e.pointerId);
      this.el.style.cursor = "grabbing";
      this.jumpTo?.(seqFromEvent(e));
    });
    this.el.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.jumpTo?.(seqFromEvent(e));
    });
    const end = (e: PointerEvent) => {
      this.dragging = false;
      this.el.style.cursor = "grab";
      this.el.releasePointerCapture?.(e.pointerId);
    };
    this.el.addEventListener("pointerup", end);
    this.el.addEventListener("pointercancel", end);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  private onCamera(snap: CameraSnapshot): void {
    this.lastSnap = snap;
    this.redraw();
  }

  private redraw(): void {
    const snap = this.lastSnap;
    const w = this.el.offsetWidth;
    const h = MINIMAP_H;

    const dpr = window.devicePixelRatio ?? 1;
    this.canvas.width  = Math.max(1, w * dpr);
    this.canvas.height = Math.max(1, h * dpr);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Era bands
    for (const era of ERAS) {
      const x  = era.start * w;
      const ew = (era.end - era.start) * w;
      ctx.fillStyle = era.color;
      ctx.globalAlpha = 0.30;
      ctx.fillRect(x, 0, ew, h);
      ctx.globalAlpha = 1;
      // Right divider
      ctx.fillStyle = era.color;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(x + ew - 1, 0, 1, h);
      ctx.globalAlpha = 1;
    }

    // Float-card dots (small markers)
    for (const f of this.floatDots) {
      const x = ((f.sequence - 1) / TOTAL) * w;
      ctx.fillStyle = "oklch(1 0 0 / 0.55)";
      ctx.beginPath();
      ctx.arc(x, h / 2, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Visible-events dots (from server response)
    const vp = store.getState().viewport;
    if (vp) {
      for (const ev of vp.visibleEvents) {
        const mid = (ev.startSequence + ev.endSequence) / 2;
        const x = ((mid - 1) / TOTAL) * w;
        ctx.fillStyle = ev.isFocused
          ? "var(--color-accent)"  // note: canvas can't resolve vars; fall back below
          : "oklch(0.82 0.15 95)";
        if (ev.isFocused) {
          ctx.fillStyle = "oklch(0.82 0.15 95)";
        }
        ctx.beginPath();
        ctx.arc(x, h / 2, ev.isFocused ? 3 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Viewport indicator — represents the sequence range currently visible
    // in the canvas area. Clip to the minimap extents on each edge so the
    // indicator accurately reflects what's on screen (and nothing more) even
    // when the user has overscanned past sequence 1 or TOTAL.
    //
    // Constraints enforced:
    //   1) Both edges of the indicator stay inside [0, w] — the right edge
    //      especially must not drift past the minimap when the timeline is
    //      panned to its extreme right. When the natural width is below the
    //      minimum we enforce, we push the *left* edge in (instead of letting
    //      left+width punch through the right edge like the previous code).
    //   2) Minimum width ≥ 12 px so the indicator stays grabbable at the
    //      deepest zoom levels.
    if (snap) {
      const MIN_INDICATOR_W = 12;
      const leftSeq  = snap.focusSeq - (snap.viewportW / 2 - snap.sidebarW / 2 + snap.panOffset) / snap.pxPerVerse;
      const rightSeq = leftSeq + (snap.viewportW - snap.sidebarW) / snap.pxPerVerse;
      const vxRaw  = ((leftSeq  - 1) / (TOTAL - 1)) * w;
      const vx2Raw = ((rightSeq - 1) / (TOTAL - 1)) * w;
      const leftClipped  = Math.max(0, Math.min(w, vxRaw));
      const rightClipped = Math.max(0, Math.min(w, vx2Raw));

      const naturalW = Math.max(0, rightClipped - leftClipped);
      const vw       = Math.min(w, Math.max(MIN_INDICATOR_W, naturalW));
      // When enforcing the minimum width, keep the indicator centered on the
      // natural range midpoint, then clamp so left + vw never exceeds w.
      const center       = (leftClipped + rightClipped) / 2;
      const unclampedLeft = naturalW >= vw ? leftClipped : center - vw / 2;
      const finalLeft     = Math.max(0, Math.min(w - vw, unclampedLeft));

      this.viewport.style.left  = `${finalLeft}px`;
      this.viewport.style.width = `${vw}px`;
    }
  }
}
