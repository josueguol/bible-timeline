const PAN_THRESHOLD_PX = 4;
const LONG_PRESS_MS    = 500;
const DOUBLE_TAP_MS    = 300;
const DOUBLE_TAP_DIST  = 40;      // px
const VEL_WINDOW_MS    = 100;     // velocity averaging window

/**
 * Gesture handler — mirrors the behavior of the design prototype's
 * `useTimelineViewport` hook:
 *
 *   • Wheel over an element marked `data-scroll-host` (card bodies) is
 *     never hijacked — the browser scrolls the card and the timeline stays
 *     put. Users reading a verse card can scroll naturally.
 *   • Wheel with Ctrl / Cmd (macOS trackpad pinch), or vertical-dominant
 *     wheel (traditional mouse wheel), zooms cursor-anchored.
 *   • Horizontal-dominant wheel (trackpad two-finger swipe) pans the
 *     timeline. No inertia — the trackpad already encodes momentum.
 *   • Pointerdown over an element marked `data-no-drag` (buttons, form
 *     controls, cards, sidebar) does not start a drag. Same for non-primary
 *     mouse buttons.
 *   • Starting a drag clears any accidental text selection so the drag
 *     feels clean, and bumps cursor to `grabbing`.
 */

interface PointerState {
  x: number; y: number;
  startX: number; startY: number;
  moved: boolean;
}

interface VelSample { x: number; t: number; }

export interface GestureCallbacks {
  onPanStart(): void;
  /** dx: pixels moved this event (drag-pan — inertia applies). */
  onPan(dx: number): void;
  /** velocityX: px/ms at release (drag-pan only). */
  onPanEnd(velocityX: number): void;
  /** Horizontal wheel/trackpad pan — no inertia, direct delta. */
  onWheelPan(dx: number): void;
  /** scale > 1 = zoom in, < 1 = zoom out; centerX in screen px. */
  onZoom(scale: number, centerX: number): void;
  onTap(x: number, y: number): void;
  onDoubleTap(x: number, y: number): void;
  onLongPress(x: number, y: number): void;
}

export class GestureHandler {
  private pointers   = new Map<number, PointerState>();
  private isPanning  = false;
  private isZooming  = false;
  private lastPinchDist = 0;
  private velSamples: VelSample[] = [];
  private lastTapTime = 0;
  private lastTapX    = 0;
  private lastTapY    = 0;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly cb: GestureCallbacks,
  ) {
    // Pointers are attached to the canvas itself; drag-pan only starts when
    // the user presses down on canvas-visible space (cards and controls mark
    // themselves `data-no-drag` so their events don't bubble into drag start).
    el.addEventListener("pointerdown",   this.onDown,   { passive: false });
    el.addEventListener("pointermove",   this.onMove,   { passive: true  });
    el.addEventListener("pointerup",     this.onUp,     { passive: true  });
    el.addEventListener("pointercancel", this.onCancel, { passive: true  });

    // Wheel listens on the document so wheel events over DOM overlays (float
    // cards, era band) still reach the timeline. The handler bails when the
    // target is inside a scroll-host so native scrolling of card bodies wins.
    document.addEventListener("wheel", this.onWheel, { passive: false });

    el.style.userSelect = "none";
    el.style.cursor     = "grab";
  }

  // ── pointer handlers ──────────────────────────────────────────────────────

  private onDown = (e: PointerEvent): void => {
    // Only primary mouse button counts; ignore right-click / middle.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Let interactive overlays swallow the event before we start dragging.
    const target = e.target as Element | null;
    if (target?.closest?.("[data-no-drag]")) return;

    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    this.el.style.cursor = "grabbing";

    this.pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY,
      startX: e.clientX, startY: e.clientY,
      moved: false,
    });

    if (this.pointers.size === 1) {
      this.velSamples = [{ x: e.clientX, t: e.timeStamp }];
      this.longPressTimer = setTimeout(() => {
        const p = this.pointers.get(e.pointerId);
        if (p && !p.moved) this.cb.onLongPress(p.x, p.y);
      }, LONG_PRESS_MS);
    } else if (this.pointers.size === 2) {
      this.clearLongPress();
      this.lastPinchDist = this.pinchDist();
      this.isPanning  = false;
      this.isZooming  = true;
    }
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;

    const dx = e.clientX - p.x;
    p.x = e.clientX;
    p.y = e.clientY;

    if (!p.moved && Math.abs(e.clientX - p.startX) > PAN_THRESHOLD_PX) {
      p.moved = true;
      this.clearLongPress();
      // Selection artifacts from a half-started click would otherwise persist
      // through the drag — clearing them makes the pan feel clean.
      window.getSelection?.()?.removeAllRanges?.();
    }

    if (this.pointers.size === 2 && this.isZooming) {
      const dist = this.pinchDist();
      if (this.lastPinchDist > 0) {
        this.cb.onZoom(dist / this.lastPinchDist, this.pinchCenterX());
      }
      this.lastPinchDist = dist;
    } else if (this.pointers.size === 1 && p.moved) {
      if (!this.isPanning) {
        this.isPanning = true;
        this.cb.onPanStart();
      }
      this.cb.onPan(dx);

      const now = e.timeStamp;
      this.velSamples.push({ x: e.clientX, t: now });
      while (this.velSamples.length > 1 && now - this.velSamples[0]!.t > VEL_WINDOW_MS) {
        this.velSamples.shift();
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.clearLongPress();

    if (this.pointers.size === 0) {
      this.el.style.cursor = "grab";
      if (this.isPanning) {
        this.isPanning = false;
        this.cb.onPanEnd(this.computeVelocity());
      } else if (p && !p.moved) {
        this.handleTapRelease(e);
      }
      this.isZooming = false;
      this.velSamples = [];
    } else if (this.pointers.size === 1) {
      this.isZooming = false;
      this.lastPinchDist = 0;
    }
  };

  private onCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.clearLongPress();
    if (this.pointers.size === 0) {
      this.isPanning = this.isZooming = false;
      this.el.style.cursor = "grab";
    }
  };

  // ── wheel handler ─────────────────────────────────────────────────────────

  private onWheel = (e: WheelEvent): void => {
    const target = e.target as Element | null;
    // Cards with scrollable bodies mark themselves `data-scroll-host`. Wheel
    // events over them must go to the browser (native scroll) — never to the
    // timeline's zoom/pan logic.
    if (target?.closest?.("[data-scroll-host]")) return;

    const dx = e.deltaX;
    const dy = e.deltaY;
    const isPinch = e.ctrlKey;                 // macOS trackpad pinch sets ctrlKey
    const isExplicitZoom = isPinch || e.metaKey;
    const verticalDominant = Math.abs(dy) > Math.abs(dx) * 1.2;

    e.preventDefault();

    if (isExplicitZoom || verticalDominant) {
      // Soft exponential scale works across both traditional mice (dy ≈ 100 per
      // notch → ~0.67× per scroll) and trackpad pinch (dy ≈ 2-8 per frame →
      // smooth continuous zoom). Cursor-anchored in the canvas.
      const scale = Math.pow(0.996, dy);
      this.cb.onZoom(scale, e.clientX);
    } else {
      // Horizontal trackpad swipe → direct pan. No inertia because the
      // trackpad already encodes momentum; re-adding inertia here would
      // over-shoot on every swipe.
      this.cb.onWheelPan(-dx);
    }
  };

  // ── helpers ───────────────────────────────────────────────────────────────

  private pinchDist(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    const [a, b] = pts as [PointerState, PointerState];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private pinchCenterX(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    const [a, b] = pts as [PointerState, PointerState];
    return (a.x + b.x) / 2;
  }

  private computeVelocity(): number {
    if (this.velSamples.length < 2) return 0;
    const first = this.velSamples[0]!;
    const last  = this.velSamples[this.velSamples.length - 1]!;
    const dt = last.t - first.t;
    return dt > 0 ? (last.x - first.x) / dt : 0;
  }

  private handleTapRelease(e: PointerEvent): void {
    const now = e.timeStamp;
    const isDouble =
      now - this.lastTapTime < DOUBLE_TAP_MS &&
      Math.abs(e.clientX - this.lastTapX) < DOUBLE_TAP_DIST &&
      Math.abs(e.clientY - this.lastTapY) < DOUBLE_TAP_DIST;

    if (isDouble) {
      this.cb.onDoubleTap(e.clientX, e.clientY);
      this.lastTapTime = 0;
    } else {
      this.lastTapTime = now;
      this.lastTapX    = e.clientX;
      this.lastTapY    = e.clientY;
      this.cb.onTap(e.clientX, e.clientY);
    }
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  destroy(): void {
    this.el.removeEventListener("pointerdown",   this.onDown);
    this.el.removeEventListener("pointermove",   this.onMove);
    this.el.removeEventListener("pointerup",     this.onUp);
    this.el.removeEventListener("pointercancel", this.onCancel);
    document.removeEventListener("wheel", this.onWheel);
    this.clearLongPress();
  }
}
