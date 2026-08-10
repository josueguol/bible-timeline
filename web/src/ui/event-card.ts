import { fetchEventDetail } from "@api/events.ts";
import type { EventDetailResponse } from "@api/types.ts";
import { store } from "@store/app-store.ts";

/**
 * Modal bottom-sheet that displays the full detail of an event — title,
 * ancestry breadcrumb, date range, summary, scripture refs, and sources.
 * Styling is driven entirely by design tokens so the sheet respects the
 * active theme.
 */

export class EventCard {
  readonly el: HTMLElement;
  private abortCtrl?: AbortController;
  private onJumpTo?: (seq: number) => void;

  constructor() {
    this.el = document.createElement("div");
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-modal", "true");
    this.el.setAttribute("aria-label", "Detalle del evento");
    this.el.dataset.noDrag = "1";
    this.el.style.cssText =
      "display:none;position:fixed;inset:0;z-index:var(--z-sheet);" +
      "background:color-mix(in oklch, oklch(0 0 0) 60%, transparent);" +
      "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);" +
      "align-items:flex-end;justify-content:center;";

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

  open(eventId: string): void {
    this.el.style.display = "flex";
    this.el.innerHTML = sheetWrap(
      `<div style="padding:24px;color:var(--color-text-mute);font-size:var(--text-sm);">Cargando…</div>`,
    );

    this.abortCtrl?.abort();
    this.abortCtrl = new AbortController();

    fetchEventDetail(eventId, store.getState().timelineId, this.abortCtrl.signal)
      .then((data) => this.render(data))
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        this.el.innerHTML = sheetWrap(
          `<div style="padding:24px;color:oklch(0.65 0.18 25);font-size:var(--text-sm);">Error al cargar evento.</div>`,
        );
      });
  }

  close(): void {
    this.abortCtrl?.abort();
    this.el.style.display = "none";
    this.el.innerHTML = "";
  }

  setJumpTo(fn: (seq: number) => void): void {
    this.onJumpTo = fn;
  }

  private render(data: EventDetailResponse): void {
    const ev = data.event;

    const crumbs = data.ancestors
      .map(
        (a) =>
          `<span style="color:var(--color-text-dim);font-size:var(--text-xs);">${h(a.title)}</span>` +
          `<span style="color:var(--color-text-mute);margin:0 6px;">›</span>`,
      )
      .join("");

    const dateStr = ev.startLabel !== ev.endLabel
      ? `${h(ev.startLabel)} – ${h(ev.endLabel)}`
      : h(ev.startLabel);

    const refsHtml = ev.scriptureRefs?.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;">
           ${ev.scriptureRefs
             .map(
               (r) =>
                 `<span style="font-size:var(--text-xs);background:var(--color-bg-deep);` +
                 `border:1px solid var(--color-border);border-radius:var(--radius-xs);` +
                 `padding:2px 8px;color:var(--color-text-dim);font-family:var(--font-mono);">${h(r)}</span>`,
             )
             .join("")}
         </div>`
      : "";

    const sourcesHtml = ev.sources?.length
      ? `<div style="margin-top:16px;border-top:1px solid var(--color-border);padding-top:16px;">
           <div style="color:var(--color-text-mute);font-size:10px;text-transform:uppercase;letter-spacing:var(--tracking-wider);margin-bottom:8px;">Fuentes</div>
           ${ev.sources
             .map(
               (s) =>
                 `<div style="font-size:var(--text-xs);color:var(--color-text);margin-bottom:4px;">` +
                 `${h(s.sourceRef)} <span style="color:var(--color-text-mute);">(${h(s.sourceType)})</span></div>`,
             )
             .join("")}
         </div>`
      : "";

    const childCount = data.childrenSummary.total;
    const childBadge = childCount > 0
      ? `<span style="margin-left:8px;font-size:10px;` +
        `background:color-mix(in oklch, var(--color-accent) 14%, transparent);` +
        `color:var(--color-accent);border-radius:var(--radius-pill);padding:2px 8px;` +
        `vertical-align:middle;">${childCount} sub-eventos</span>`
      : "";

    const startSeq = ev.startSequence;
    const jumpHtml = this.onJumpTo
      ? `<button data-jump
           style="display:inline-flex;align-items:center;gap:6px;margin-top:16px;padding:8px 16px;
                  border-radius:var(--radius-md);background:var(--color-accent);color:#fff;
                  font-size:var(--text-xs);font-family:var(--font-mono);letter-spacing:var(--tracking-wide);
                  font-weight:var(--font-semibold);cursor:pointer;border:none;
                  transition:opacity var(--duration-fast) var(--ease-out);">
           ↓ Leer versículos
         </button>`
      : "";

    this.el.innerHTML = sheetWrap(`
      <div style="position:sticky;top:0;background:var(--color-surface);padding:16px 20px 0;border-radius:var(--radius-xl) var(--radius-xl) 0 0;">
        <div style="width:36px;height:4px;background:var(--color-surface-2);border-radius:2px;margin:0 auto 12px;" aria-hidden="true"></div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
          <div style="flex:1;min-width:0;">
            ${crumbs ? `<div style="display:flex;align-items:center;flex-wrap:wrap;margin-bottom:6px;">${crumbs}</div>` : ""}
            <h2 style="margin:0;font-family:var(--font-serif);font-size:var(--text-lg);font-weight:var(--font-medium);color:var(--color-text);line-height:var(--leading-snug);">${h(ev.title)}${childBadge}</h2>
            <div style="margin-top:4px;font-size:var(--text-xs);color:var(--color-text-mute);font-family:var(--font-mono);">${dateStr}</div>
          </div>
          <button aria-label="Cerrar" data-close
            style="flex-shrink:0;width:32px;height:32px;border-radius:var(--radius-pill);background:var(--color-surface-2);color:var(--color-text-dim);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>
        </div>
      </div>
      <div style="padding:16px 20px 24px;">
        ${ev.summary ? `<p style="margin:0 0 12px;font-size:var(--text-base);color:var(--color-text);line-height:var(--leading-normal);">${h(ev.summary)}</p>` : ""}
        ${refsHtml}
        ${sourcesHtml}
        ${jumpHtml}
      </div>
    `);

    this.el.querySelector("[data-close]")?.addEventListener("click", () => this.close());
    this.el.querySelector("[data-jump]")?.addEventListener("click", () => {
      this.close();
      this.onJumpTo?.(startSeq);
    });
  }
}

function sheetWrap(inner: string): string {
  return (
    `<div data-scroll-host style="width:100%;max-width:560px;max-height:80vh;` +
    `background:var(--color-surface);` +
    `border-radius:var(--radius-xl) var(--radius-xl) 0 0;overflow-y:auto;` +
    `padding-bottom:env(safe-area-inset-bottom);` +
    `box-shadow:var(--shadow-xl);">${inner}</div>`
  );
}

function h(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
