import type { TimelineCanvas } from "@canvas/timeline-canvas.ts";
import { store } from "@store/app-store.ts";

/**
 * Bottom-right zoom controls — a level badge (LVL · N.N×) plus stacked
 * ＋ / ⌖ / − buttons. Matches the design's ZoomControls component but stays
 * vanilla TS and reads CSS tokens for theming.
 *
 * Public API (unchanged): `connect(canvas)` wires the buttons to the
 * TimelineCanvas's zoom/recenter methods.
 */

export class ZoomFab {
  readonly el: HTMLElement;
  private badge!: HTMLElement;
  private btnIn!: HTMLButtonElement;
  private btnOut!: HTMLButtonElement;
  private btnReset!: HTMLButtonElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.setAttribute("role", "group");
    this.el.setAttribute("aria-label", "Controles de zoom");
    this.el.dataset.noDrag = "1";
    this.el.style.cssText =
      "position:fixed;right:16px;bottom:72px;display:flex;flex-direction:column;" +
      "align-items:flex-end;gap:8px;z-index:var(--z-topbar);";

    this.buildBadge();
    this.buildStack();

    store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
  }

  connect(canvas: TimelineCanvas): void {
    this.btnIn.addEventListener("click",    () => canvas.zoomIn());
    this.btnOut.addEventListener("click",   () => canvas.zoomOut());
    this.btnReset.addEventListener("click", () => canvas.recenter());
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  private buildBadge(): void {
    this.badge = document.createElement("div");
    this.badge.style.cssText =
      "padding:6px 10px;font-size:10px;font-family:var(--font-mono);" +
      "color:var(--color-text-dim);letter-spacing:var(--tracking-wider);" +
      "background:color-mix(in oklch, var(--color-surface) 85%, transparent);" +
      "border:1px solid var(--color-border);border-radius:var(--radius-md);" +
      "backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);";
    this.el.appendChild(this.badge);
  }

  private buildStack(): void {
    const stack = document.createElement("div");
    stack.style.cssText =
      "display:flex;flex-direction:column;" +
      "background:color-mix(in oklch, var(--color-surface) 85%, transparent);" +
      "border:1px solid var(--color-border);border-radius:var(--radius-lg);" +
      "backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);overflow:hidden;";

    this.btnIn    = this.makeBtn("＋", "Acercar");
    this.btnReset = this.makeBtn("⌖", "Centrar");
    this.btnOut   = this.makeBtn("−",  "Alejar");

    stack.appendChild(this.btnIn);
    stack.appendChild(this.makeDivider());
    stack.appendChild(this.btnReset);
    stack.appendChild(this.makeDivider());
    stack.appendChild(this.btnOut);
    this.el.appendChild(stack);
  }

  private makeBtn(glyph: string, label: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = glyph;
    b.setAttribute("aria-label", label);
    b.style.cssText =
      "width:34px;height:34px;color:var(--color-text);font-size:16px;" +
      "display:flex;align-items:center;justify-content:center;" +
      "transition:background var(--duration-fast) var(--ease-out);";
    b.addEventListener("mouseenter", () => (b.style.background = "var(--color-surface-2)"));
    b.addEventListener("mouseleave", () => (b.style.background = "transparent"));
    return b;
  }

  private makeDivider(): HTMLElement {
    const d = document.createElement("div");
    d.style.cssText = "height:1px;background:var(--color-border);";
    return d;
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  private sync(s: ReturnType<typeof store.getState>): void {
    const label = s.viewport?.zoomLevel?.label?.toUpperCase() ?? "PANORAMA";
    const ratio = Math.max(0.01, Math.min(16, (s.zoomFactor || 0.05) * 16));
    this.badge.innerHTML =
      `<span style="color:var(--color-text-mute);">LVL </span>` +
      `<span style="color:var(--color-accent);">${label}</span>` +
      `<span style="color:var(--color-text-mute);"> · ${ratio.toFixed(1)}×</span>`;
  }
}
