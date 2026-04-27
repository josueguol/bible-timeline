import { store } from "@store/app-store.ts";
import { ERAS } from "../era-data.ts";
import { subscribeCameraUpdate, type CameraSnapshot } from "../camera.ts";

/**
 * Era band: the tinted strip at the very top of the canvas that labels each
 * biblical epoch. Each era segment is a fixed-position div that tracks the
 * camera so the label slides cleanly with pan/zoom.
 *
 * The band sits to the right of the sidebar (rail or expanded) and spans the
 * remaining viewport width. Labels hide automatically when the segment is
 * narrower than their natural width.
 */

const BAND_H = 32;
const TOTAL  = 31102;

/**
 * Vertical offset from the top of the viewport. The search palette floats at
 * top:16 with ~44 px of height, so the era band starts below it with a small
 * gap — matches the prototype where the world div is positioned at top:68.
 */
const BAND_TOP = 68;

export class EraBand {
  readonly el: HTMLElement;
  private world!: HTMLElement;
  private segments: { el: HTMLElement; label: HTMLElement }[] = [];
  private unsubCamera?: () => void;
  private unsubStore?: () => void;

  constructor() {
    this.el = document.createElement("div");
    this.el.setAttribute("aria-hidden", "true");
    this.el.dataset.noDrag = "1";
    this.el.style.cssText =
      `position:fixed;top:${BAND_TOP}px;right:0;height:${BAND_H}px;` +
      "z-index:var(--z-era-band);overflow:hidden;" +
      "border-top:1px solid var(--color-border);" +
      "border-bottom:1px solid var(--color-border);" +
      "background:color-mix(in oklch, var(--color-bg) 70%, transparent);" +
      "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);";

    this.world = document.createElement("div");
    this.world.style.cssText = "position:absolute;inset:0;will-change:transform;";
    this.el.appendChild(this.world);

    this.buildSegments();
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
    this.unsubCamera = subscribeCameraUpdate((snap) => this.onCamera(snap));
    this.unsubStore  = store.subscribe((s) => {
      this.el.style.left = `${s.sidebarOpen ? 288 : 52}px`;
    });
    // initial
    this.el.style.left = `${store.getState().sidebarOpen ? 288 : 52}px`;
  }

  destroy(): void {
    this.unsubCamera?.();
    this.unsubStore?.();
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  private buildSegments(): void {
    for (const era of ERAS) {
      const seg = document.createElement("div");
      seg.dataset.eraId = era.id;
      seg.style.cssText =
        `position:absolute;top:0;height:${BAND_H}px;` +
        `background:color-mix(in oklch, ${era.color} 18%, transparent);` +
        `border-right:1px solid var(--color-border);` +
        "display:flex;align-items:center;padding:0 12px;gap:10px;" +
        "overflow:hidden;white-space:nowrap;";

      const label = document.createElement("span");
      label.textContent = era.nameEs;
      label.style.cssText =
        "font-family:var(--font-serif);font-size:var(--text-xs);font-weight:var(--font-medium);" +
        `color:color-mix(in oklch, ${era.color} 70%, white);` +
        "letter-spacing:0.02em;";

      const date = document.createElement("span");
      date.textContent = era.approxDate;
      date.style.cssText =
        "font-family:var(--font-mono);font-size:10px;color:var(--color-text-mute);" +
        "letter-spacing:var(--tracking-wide);";
      date.dataset.role = "date";

      seg.appendChild(label);
      seg.appendChild(date);
      this.world.appendChild(seg);
      this.segments.push({ el: seg, label });
    }
  }

  // ── Layout per camera ─────────────────────────────────────────────────────

  private onCamera(snap: CameraSnapshot): void {
    const sidebarW = snap.sidebarW;
    const cx = (snap.viewportW + sidebarW) / 2;
    const pxPerVerse = snap.pxPerVerse;

    for (let i = 0; i < ERAS.length; i++) {
      const era = ERAS[i]!;
      const { el: seg, label } = this.segments[i]!;

      const startSeq = era.start * TOTAL + 1;
      const endSeq   = era.end   * TOTAL + 1;

      // Position relative to the era-band container (which starts at sidebarW)
      const x = (startSeq - snap.focusSeq) * pxPerVerse + cx - sidebarW + snap.panOffset;
      const w = (endSeq - startSeq) * pxPerVerse;

      seg.style.left  = `${x}px`;
      seg.style.width = `${w}px`;

      const dateEl = seg.querySelector<HTMLElement>('[data-role="date"]');
      label.style.display = w > 80 ? "inline" : "none";
      if (dateEl) dateEl.style.display = w > 160 ? "inline" : "none";
    }
  }
}
