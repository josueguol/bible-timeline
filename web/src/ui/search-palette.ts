import { fetchSearch } from "@api/search.ts";
import type { SearchResult } from "@api/types.ts";
import { store } from "@store/app-store.ts";
import type { TimelineCanvas } from "@canvas/timeline-canvas.ts";

/**
 * Floating, always-visible search bar centered at the top of the canvas —
 * the design pulls it out of a modal palette into a permanent feature. The
 * suggestions dropdown renders underneath with a glass backdrop and
 * closes on Escape, click-outside, or selection.
 *
 * Keyboard shortcut: `/` or `⌘K` to focus it.
 */

const DEBOUNCE_MS = 200;

export class SearchPalette {
  readonly el: HTMLElement;
  private input!: HTMLInputElement;
  private dropdown!: HTMLElement;
  private debounceTimer = 0;
  private abortCtrl?: AbortController;
  private canvas?: TimelineCanvas;

  constructor() {
    this.el = document.createElement("div");
    this.el.setAttribute("role", "search");
    this.el.setAttribute("aria-label", "Buscar referencia o texto");
    this.el.dataset.noDrag = "1";
    this.el.style.cssText =
      "position:fixed;top:16px;left:50%;transform:translateX(-50%);" +
      "z-index:var(--z-search);width:min(520px, calc(100vw - 120px));";

    this.buildBar();
    this.wireKeyboard();
    // close when the user clicks outside
    document.addEventListener("mousedown", this.handleDocClick);
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
  }

  connect(canvas: TimelineCanvas): void {
    this.canvas = canvas;
  }

  destroy(): void {
    document.removeEventListener("mousedown", this.handleDocClick);
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  private buildBar(): void {
    const bar = document.createElement("div");
    bar.style.cssText =
      "display:flex;align-items:center;gap:10px;padding:10px 14px;" +
      "background:color-mix(in oklch, var(--color-surface) 82%, transparent);" +
      "backdrop-filter:blur(14px) saturate(140%);" +
      "-webkit-backdrop-filter:blur(14px) saturate(140%);" +
      "border:1px solid var(--color-border);border-radius:var(--radius-xl);" +
      "box-shadow:var(--shadow-lg);" +
      "transition:border-radius var(--duration-fast) var(--ease-out);";

    bar.innerHTML =
      `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"` +
      ` style="color:var(--color-text-mute);flex:0 0 auto;">` +
      `<circle cx="6" cy="6" r="4.3" stroke="currentColor" stroke-width="1.3"/>` +
      `<path d="M9.5 9.5L12 12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>` +
      `</svg>`;

    this.input = document.createElement("input");
    this.input.type = "search";
    this.input.placeholder = "Buscar referencia o palabra… (ej. Juan 3:16)";
    this.input.setAttribute("aria-label", "Buscar");
    this.input.setAttribute("autocomplete", "off");
    this.input.style.cssText =
      "flex:1;border:none;outline:none;background:transparent;" +
      "color:var(--color-text);font-size:var(--text-sm);font-family:inherit;" +
      "caret-color:var(--color-accent);";
    this.input.addEventListener("input", () => this.onInput());
    this.input.addEventListener("focus", () => this.renderIfQuery());

    const kbd = document.createElement("kbd");
    kbd.textContent = "⌘K";
    kbd.style.cssText =
      "padding:2px 6px;font-size:10px;color:var(--color-text-mute);" +
      "border:1px solid var(--color-border);border-radius:var(--radius-xs);" +
      "font-family:var(--font-mono);";

    bar.appendChild(this.input);
    bar.appendChild(kbd);

    this.dropdown = document.createElement("div");
    this.dropdown.setAttribute("role", "listbox");
    this.dropdown.setAttribute("data-scroll-host", "");
    this.dropdown.style.cssText =
      "display:none;margin-top:0;border-top:none;" +
      "background:color-mix(in oklch, var(--color-surface) 92%, transparent);" +
      "backdrop-filter:blur(14px) saturate(140%);" +
      "-webkit-backdrop-filter:blur(14px) saturate(140%);" +
      "border:1px solid var(--color-border);border-top:none;" +
      "border-radius:0 0 var(--radius-xl) var(--radius-xl);" +
      "box-shadow:var(--shadow-lg);overflow:hidden;" +
      "max-height:60vh;overflow-y:auto;";

    this.el.appendChild(bar);
    this.el.appendChild(this.dropdown);
  }

  private wireKeyboard(): void {
    document.addEventListener("keydown", (e) => {
      const tag = (document.activeElement as HTMLElement).tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA";
      if (!isTyping && e.key === "/") {
        e.preventDefault();
        this.input.focus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        this.input.focus();
        return;
      }
      if (e.key === "Escape" && document.activeElement === this.input) {
        this.input.blur();
        this.closeDropdown();
      }
    });
  }

  private handleDocClick = (e: MouseEvent) => {
    if (!this.el.contains(e.target as Node)) this.closeDropdown();
  };

  private renderIfQuery(): void {
    if (this.input.value.trim().length > 0) this.dropdown.style.display = "block";
  }

  private closeDropdown(): void {
    this.dropdown.style.display = "none";
  }

  // ── Search lifecycle ──────────────────────────────────────────────────────

  private onInput(): void {
    clearTimeout(this.debounceTimer);
    const q = this.input.value.trim();
    if (!q) {
      this.closeDropdown();
      return;
    }
    this.dropdown.style.display = "block";
    this.debounceTimer = window.setTimeout(() => this.doSearch(q), DEBOUNCE_MS);
  }

  private doSearch(q: string): void {
    this.abortCtrl?.abort();
    this.abortCtrl = new AbortController();
    this.dropdown.innerHTML =
      `<div style="padding:14px 16px;font-size:var(--text-xs);color:var(--color-text-mute);">Buscando…</div>`;

    fetchSearch(q, this.abortCtrl.signal)
      .then((res) => this.showResults(res.results))
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        this.dropdown.innerHTML =
          `<div style="padding:14px 16px;font-size:var(--text-xs);color:oklch(0.65 0.18 25);">Error en búsqueda.</div>`;
      });
  }

  private showResults(results: SearchResult[]): void {
    this.dropdown.innerHTML = "";

    if (results.length === 0) {
      this.dropdown.innerHTML =
        `<div style="padding:14px 16px;font-size:var(--text-xs);color:var(--color-text-mute);">Sin resultados.</div>`;
      return;
    }

    const CAT_LABEL: Record<string, string> = {
      reference: "Referencia",
      event: "Evento",
      text: "Texto bíblico",
    };

    const order: string[] = [];
    const groups = new Map<string, SearchResult[]>();
    for (const r of results) {
      if (!groups.has(r.category)) {
        groups.set(r.category, []);
        order.push(r.category);
      }
      groups.get(r.category)!.push(r);
    }

    for (const cat of order) {
      const hdr = document.createElement("div");
      hdr.style.cssText =
        "padding:8px 16px 4px;font-size:10px;color:var(--color-text-mute);" +
        "text-transform:uppercase;letter-spacing:var(--tracking-wider);" +
        "font-weight:var(--font-medium);";
      hdr.textContent = CAT_LABEL[cat] ?? cat;
      this.dropdown.appendChild(hdr);

      for (const item of groups.get(cat)!) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("role", "option");
        btn.style.cssText =
          "width:100%;padding:10px 14px;text-align:left;display:flex;" +
          "align-items:flex-start;gap:10px;background:transparent;" +
          "border:none;border-top:1px solid var(--color-border);cursor:pointer;" +
          "color:var(--color-text);transition:background var(--duration-fast) var(--ease-out);";
        btn.addEventListener("mouseenter", () => (btn.style.background = "var(--color-surface-2)"));
        btn.addEventListener("mouseleave", () => (btn.style.background = "transparent"));

        const refChip = document.createElement("div");
        refChip.textContent = item.focus.focusRef ?? item.label;
        refChip.style.cssText =
          "font-family:var(--font-mono);font-size:10px;color:var(--color-accent);" +
          "letter-spacing:var(--tracking-wide);padding:3px 6px;border-radius:var(--radius-xs);" +
          "background:color-mix(in oklch, var(--color-accent) 12%, transparent);flex:0 0 auto;margin-top:1px;";

        const body = document.createElement("div");
        body.style.cssText =
          "font-size:var(--text-xs);color:var(--color-text-dim);line-height:var(--leading-snug);" +
          "overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;";
        body.textContent = item.preview ?? item.description ?? item.label;

        btn.appendChild(refChip);
        btn.appendChild(body);

        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.handlePick(item);
        });

        this.dropdown.appendChild(btn);
      }
    }
  }

  private handlePick(item: SearchResult): void {
    store.update({
      focusRef:     item.focus.focusRef     ?? null,
      focusEventId: item.focus.focusEventId ?? null,
    });
    if (this.canvas && item.focus.focusSequence) {
      this.canvas.jumpToSequenceAndZoom(item.focus.focusSequence, 0.55);
    }
    this.input.value = "";
    this.closeDropdown();
    this.input.blur();
  }
}
