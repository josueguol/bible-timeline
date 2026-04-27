import { store, type LangCode } from "@store/app-store.ts";
import type { ThemeName } from "../theme.ts";

/**
 * Minimal top-right toolbar that replaces the old opaque header. In the
 * design the only persistent top-bar affordances are a language toggle and a
 * theme switcher, both rendered as small glass pills. Everything else lives
 * in the sidebar or the search palette.
 */

const LANGS: { code: LangCode; label: string }[] = [
  { code: "es", label: "ES" },
  { code: "en", label: "EN" },
];

const THEMES: { name: ThemeName; label: string }[] = [
  { name: "inkwell",  label: "Inkwell" },
  { name: "vellum",   label: "Vellum" },
  { name: "midnight", label: "Midnight" },
];

export class Topbar {
  readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.setAttribute("role", "toolbar");
    this.el.dataset.noDrag = "1";
    this.el.style.cssText =
      "position:fixed;top:18px;right:20px;display:flex;gap:8px;align-items:center;" +
      "z-index:var(--z-topbar);pointer-events:auto;";

    this.el.appendChild(this.buildThemeSwitcher());
    this.el.appendChild(this.buildLangToggle());
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
    store.subscribe((s) => this.sync(s));
    this.sync(store.getState());
  }

  // ── Lang toggle ──────────────────────────────────────────────────────────

  private buildLangToggle(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.setAttribute("aria-label", "Idioma");
    wrap.style.cssText =
      "display:flex;border:1px solid var(--color-border);border-radius:var(--radius-sm);" +
      "overflow:hidden;" +
      "background:color-mix(in oklch, var(--color-surface) 85%, transparent);" +
      "backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);";

    for (const l of LANGS) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.langCode = l.code;
      b.textContent = l.label;
      b.style.cssText =
        "padding:5px 10px;font-size:10px;font-family:var(--font-mono);" +
        "letter-spacing:var(--tracking-wider);font-weight:var(--font-semibold);" +
        "color:var(--color-text-mute);cursor:pointer;" +
        "transition:all var(--duration-fast) var(--ease-out);";
      b.addEventListener("click", () => store.update({ lang: l.code }));
      wrap.appendChild(b);
    }
    return wrap;
  }

  // ── Theme switcher ───────────────────────────────────────────────────────

  private buildThemeSwitcher(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.setAttribute("aria-label", "Tema");
    wrap.style.cssText =
      "display:flex;border:1px solid var(--color-border);border-radius:var(--radius-sm);" +
      "overflow:hidden;" +
      "background:color-mix(in oklch, var(--color-surface) 85%, transparent);" +
      "backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);";

    for (const t of THEMES) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.theme = t.name;
      b.title = t.label;
      b.setAttribute("aria-label", `Tema ${t.label}`);
      b.textContent = t.label.slice(0, 1); // single glyph
      b.style.cssText =
        "width:26px;height:26px;font-size:11px;font-family:var(--font-mono);" +
        "font-weight:var(--font-semibold);color:var(--color-text-mute);cursor:pointer;" +
        "transition:all var(--duration-fast) var(--ease-out);";
      b.addEventListener("click", () => store.update({ theme: t.name }));
      wrap.appendChild(b);
    }
    return wrap;
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  private sync(s: ReturnType<typeof store.getState>): void {
    this.el.querySelectorAll<HTMLButtonElement>("[data-lang-code]").forEach((b) => {
      const on = b.dataset.langCode === s.lang;
      b.style.background = on ? "var(--color-surface-2)" : "transparent";
      b.style.color = on ? "var(--color-text)" : "var(--color-text-mute)";
    });
    this.el.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((b) => {
      const on = b.dataset.theme === s.theme;
      b.style.background = on ? "var(--color-surface-2)" : "transparent";
      b.style.color = on ? "var(--color-accent)" : "var(--color-text-mute)";
    });
  }
}
