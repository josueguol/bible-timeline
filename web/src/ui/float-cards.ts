import { store } from "@store/app-store.ts";
import { subscribeCameraUpdate, type CameraSnapshot } from "../camera.ts";
import { FLOATS, FLOAT_STYLE, type FloatCard, type FloatType } from "../data/floats.ts";

/**
 * Floating context cards rendered BELOW the axis.
 *
 * Purely client-side for now (data is baked into `data/floats.ts`). They
 * are absolutely positioned in viewport space, anchored to a verse sequence
 * and split across two horizontal lanes to keep clusters readable.
 *
 * Visibility is gated by `state.showFloats` and the `floatTypes` allowlist
 * — both controlled from the sidebar.
 */

const LANE_GAP       = 16;
const LANE_TOP       = 40;     // gap below the axis before the first lane
const LANE_HEIGHT    = 150;
const MAX_DISPLAYED  = 30;     // safety cap
const CARD_WIDTH     = { compact: 220, regular: 250, comfy: 290 } as const;

interface Placed {
  float: FloatCard;
  el: HTMLElement;
}

export class FloatCards {
  readonly el: HTMLElement;
  private placed: Placed[] = [];
  private lastCamera: CameraSnapshot | null = null;
  private unsubCamera?: () => void;
  private unsubStore?:  () => void;
  private popup: FloatPopup;

  constructor() {
    this.el = document.createElement("div");
    this.el.style.cssText =
      "position:fixed;inset:0;pointer-events:none;overflow:hidden;" +
      "z-index:var(--z-float-cards);";
    this.el.setAttribute("role", "list");
    this.el.setAttribute("aria-label", "Cards contextuales del timeline");
    this.popup = new FloatPopup();
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
    this.popup.mount(container);
    this.unsubCamera = subscribeCameraUpdate((snap) => this.onCamera(snap));
    this.unsubStore  = store.subscribe(() => this.rebuild());
    this.rebuild();
  }

  destroy(): void {
    this.unsubCamera?.();
    this.unsubStore?.();
  }

  // ── Build DOM ────────────────────────────────────────────────────────────

  private rebuild(): void {
    this.el.innerHTML = "";
    this.placed = [];

    const s = store.getState();
    if (!s.showFloats) return;

    const types = new Set(s.floatTypes);
    const list = FLOATS.filter((f) => types.has(f.type)).slice(0, MAX_DISPLAYED);

    for (const float of list) {
      const card = this.makeCard(float, s.lang);
      this.el.appendChild(card);
      this.placed.push({ float, el: card });
    }

    if (this.lastCamera) this.onCamera(this.lastCamera);
  }

  private makeCard(f: FloatCard, lang: string): HTMLElement {
    const style = FLOAT_STYLE[f.type];
    const typeVar: Record<string, string> = {
      prophecy: "var(--color-accent-2)",
      xref:     "var(--color-accent-3)",
      context:  "var(--color-text-dim)",
      note:     "var(--color-accent)",
      map:      "var(--color-accent-3)",
      people:   "var(--color-accent)",
    };
    const color = typeVar[f.type] ?? "var(--color-text-dim)";
    const density = store.getState().density;
    const width = CARD_WIDTH[density as keyof typeof CARD_WIDTH] ?? CARD_WIDTH.regular;

    const card = document.createElement("article");
    card.setAttribute("role", "listitem");
    card.setAttribute("aria-label", `${style.labelEs} · ${f.titleEs}`);
    card.dataset.noDrag = "1";
    card.style.cssText =
      "position:fixed;transform:translateX(-50%);" +
      `width:${width}px;` +
      "background:color-mix(in oklch, var(--color-surface) 92%, transparent);" +
      `border:1px dashed ${color};` +
      "border-radius:var(--radius-md);padding:10px 12px 12px;" +
      "opacity:0.92;transition:opacity var(--duration-normal) var(--ease-out);" +
      "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);" +
      "pointer-events:auto;";

    // Header tag with glyph + label + optional linked ref
    const header = document.createElement("header");
    header.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px;";
    const glyph = document.createElement("span");
    glyph.textContent = style.glyph;
    glyph.style.cssText = `color:${color};font-size:11px;`;
    const tag = document.createElement("span");
    tag.textContent = lang === "es" ? style.labelEs : style.labelEn;
    tag.style.cssText =
      `font-size:9px;color:${color};letter-spacing:var(--tracking-widest);` +
      "font-weight:var(--font-semibold);";
    header.appendChild(glyph);
    header.appendChild(tag);

    const title = document.createElement("div");
    title.textContent = lang === "es" ? f.titleEs : f.titleEn;
    title.style.cssText =
      "font-family:var(--font-serif);font-size:var(--text-sm);color:var(--color-text);" +
      "margin-bottom:5px;font-weight:var(--font-medium);letter-spacing:-0.005em;";

    const body = document.createElement("p");
    body.textContent = lang === "es" ? f.bodyEs : f.bodyEn;
    body.style.cssText =
      "margin:0;font-size:var(--text-xs);color:var(--color-text-dim);" +
      "line-height:var(--leading-snug);text-wrap:pretty;";

    card.appendChild(header);
    card.appendChild(title);
    card.appendChild(body);

    // Faint guide line that hints at the anchor; finished in onCamera with
    // the real vertical position.
    const guide = document.createElement("span");
    guide.dataset.guide = "1";
    guide.style.cssText =
      "position:absolute;left:50%;bottom:100%;width:1px;" +
      `background:linear-gradient(to bottom, ${color} 10%, transparent 90%);` +
      "pointer-events:none;transform:translateX(-50%);opacity:0.6;";
    card.appendChild(guide);

    card.style.cursor = "pointer";
    card.addEventListener("click", (e) => {
      e.stopPropagation();
      this.popup.open(f, store.getState().lang);
    });

    return card;
  }

  // ── Position ──────────────────────────────────────────────────────────────

  private onCamera(snap: CameraSnapshot): void {
    this.lastCamera = snap;
    if (this.placed.length === 0) return;

    const axisY = window.innerHeight / 2;
    const cx    = (snap.viewportW + snap.sidebarW) / 2;

    for (const { float, el } of this.placed) {
      const screenX = (float.sequence - snap.focusSeq) * snap.pxPerVerse + cx + snap.panOffset;

      // Hide cards that are off-screen horizontally
      if (screenX < snap.sidebarW - 120 || screenX > snap.viewportW + 120) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "block";

      const laneTop = axisY + LANE_TOP + float.lane * (LANE_HEIGHT + LANE_GAP);
      el.style.left = `${Math.round(screenX)}px`;
      el.style.top  = `${Math.round(laneTop)}px`;

      // Guide line stretches from the card top up to the axis.
      const guide = el.querySelector<HTMLElement>('[data-guide="1"]');
      if (guide) {
        guide.style.height = `${Math.round(laneTop - axisY)}px`;
      }
    }
  }
}

// ── Float card popup ──────────────────────────────────────────────────────────

class FloatPopup {
  private el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-modal", "true");
    this.el.setAttribute("aria-label", "Detalle de card contextual");
    this.el.dataset.noDrag = "1";
    this.el.style.cssText =
      "display:none;position:fixed;inset:0;z-index:var(--z-sheet);" +
      "background:color-mix(in oklch, oklch(0 0 0) 60%, transparent);" +
      "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);" +
      "align-items:center;justify-content:center;padding:24px;";

    this.el.addEventListener("click", (e) => {
      if (e.target === this.el) this.close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.el.style.display !== "none") this.close();
    });
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
  }

  open(f: FloatCard, lang: string): void {
    const style = FLOAT_STYLE[f.type as FloatType];
    const typeColors: Record<FloatType, string> = {
      prophecy: "var(--color-accent-2)",
      xref:     "var(--color-accent-3)",
      context:  "var(--color-text-dim)",
      note:     "var(--color-accent)",
      map:      "var(--color-accent-3)",
      people:   "var(--color-accent)",
    };
    const color = typeColors[f.type as FloatType] ?? "var(--color-text-dim)";
    const title = lang === "es" ? f.titleEs : f.titleEn;
    const body  = lang === "es" ? f.bodyEs  : f.bodyEn;
    const label = lang === "es" ? style.labelEs : style.labelEn;

    this.el.style.display = "flex";
    this.el.innerHTML = `
      <div data-scroll-host style="
        width:100%;max-width:480px;max-height:80vh;overflow-y:auto;
        background:var(--color-surface);
        border-radius:var(--radius-xl);
        border:1px solid ${h(color)};
        box-shadow:var(--shadow-xl);
        padding:24px;
      ">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="color:${h(color)};font-size:16px;">${h(style.glyph)}</span>
            <span style="font-size:10px;color:${h(color)};letter-spacing:var(--tracking-widest);font-weight:var(--font-semibold);">${h(label)}</span>
          </div>
          <button data-close aria-label="Cerrar"
            style="width:28px;height:28px;border-radius:var(--radius-pill);
                   background:var(--color-surface-2);color:var(--color-text-dim);
                   font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;
                   border:none;flex-shrink:0;">×</button>
        </div>
        <h2 style="margin:0 0 12px;font-family:var(--font-serif);font-size:var(--text-lg);
                   font-weight:var(--font-medium);color:var(--color-text);line-height:var(--leading-snug);">
          ${h(title)}
        </h2>
        <p style="margin:0;font-size:var(--text-base);color:var(--color-text-dim);
                  line-height:var(--leading-normal);text-wrap:pretty;">
          ${h(body)}
        </p>
      </div>
    `;
    this.el.querySelector("[data-close]")?.addEventListener("click", () => this.close());
  }

  close(): void {
    this.el.style.display = "none";
    this.el.innerHTML = "";
  }
}

function h(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
