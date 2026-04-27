import { store, type FloatType } from "@store/app-store.ts";
import { fetchVersions } from "@api/bible.ts";
import type { BibleVersion } from "@api/types.ts";
import type { Ads } from "@ui/ads.ts";
import { ERAS } from "../era-data.ts";

/**
 * Collapsible sidebar — matches the design prototype:
 *
 *   • Always-visible rail (52px wide) on the left: a hamburger toggle at the
 *     top, then quick-access icons (float toggle, bookmarks) with active
 *     states.
 *   • Expanded panel (288px wide) that slides out next to the rail: contains
 *     the Bible version picker, era jump menu, floating-card settings,
 *     bookmarks list, and a keyboard-shortcut footer.
 *
 * All state changes go through the app store so other components (canvas,
 * event-cards, float-cards) stay in sync.
 */

const RAIL_W  = 52;
const PANEL_W = 320;

const MAX_VERSIONS = 5;

export class Sidebar {
  readonly el: HTMLElement;
  private panel!: HTMLElement;
  private hamburger!: HTMLButtonElement;
  private availableVersions: BibleVersion[] = [];
  private ads?: Ads;

  constructor() {
    this.el = document.createElement("aside");
    this.el.setAttribute("aria-label", "Panel de configuración");
    this.el.dataset.noDrag = "1";
    this.el.style.cssText =
      "position:fixed;top:0;bottom:0;left:0;display:flex;" +
      `width:${RAIL_W}px;` +
      "background:var(--color-bg-deep);" +
      "border-right:1px solid var(--color-border);" +
      "transition:width var(--duration-slow) var(--ease-out);" +
      "overflow:hidden;z-index:var(--z-sidebar);";
  }

  setAds(ads: Ads): void {
    this.ads = ads;
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
    this.buildRail();
    this.buildPanel();
    store.subscribe((s) => this.syncFromStore(s));
    this.syncFromStore(store.getState());
    // Load available versions from API — populate version list when ready.
    fetchVersions().then((res) => {
      this.availableVersions = res.versions;
      this.rebuildVersionList();
    }).catch(() => {
      // Fallback to minimal hardcoded list if API unavailable
      this.availableVersions = [
        { versionId: "rv60", code: "RV60", title: "Reina-Valera 1960", language: "es", languageFamily: "es", isPrimary: true, verseCount: null },
        { versionId: "lxx",  code: "LXX",  title: "Septuaginta LXX",   language: "grc", languageFamily: "original-greek", isPrimary: false, verseCount: null },
      ];
      this.rebuildVersionList();
    });
  }

  // ── Rail ──────────────────────────────────────────────────────────────────

  private buildRail(): void {
    const rail = document.createElement("div");
    rail.style.cssText =
      `position:absolute;top:0;left:0;bottom:0;width:${RAIL_W}px;` +
      "display:flex;flex-direction:column;align-items:center;padding:14px 0;gap:6px;" +
      "z-index:1;";

    this.hamburger = this.makeRailBtn("☰", "Abrir panel", () => {
      store.update({ sidebarOpen: !store.getState().sidebarOpen });
    });
    rail.appendChild(this.hamburger);

    const spacer = document.createElement("div");
    spacer.style.cssText = "flex:1;";
    rail.appendChild(spacer);

    const floatIcon = this.makeRailIcon("◎", "Alternar cards flotantes", () => {
      store.update({ showFloats: !store.getState().showFloats });
    });
    floatIcon.dataset.role = "floats";
    rail.appendChild(floatIcon);

    const bookmarkIcon = this.makeRailIcon("★", "Abrir marcadores", () => {
      store.update({ sidebarOpen: true });
    });
    bookmarkIcon.dataset.role = "bookmarks";
    rail.appendChild(bookmarkIcon);

    this.el.appendChild(rail);
  }

  private makeRailBtn(glyph: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.title = title;
    b.textContent = glyph;
    b.setAttribute("aria-label", title);
    b.style.cssText =
      "width:34px;height:34px;border-radius:var(--radius-md);" +
      "color:var(--color-text-dim);font-size:14px;" +
      "transition:background var(--duration-fast) var(--ease-out)," +
      "color var(--duration-fast) var(--ease-out);";
    b.addEventListener("mouseenter", () => (b.style.background = "var(--color-surface-2)"));
    b.addEventListener("mouseleave", () => (b.style.background = "transparent"));
    b.addEventListener("click", onClick);
    return b;
  }

  private makeRailIcon(glyph: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = glyph;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.style.cssText =
      "width:34px;height:34px;border-radius:var(--radius-md);" +
      "color:var(--color-text-mute);font-size:15px;" +
      "transition:background var(--duration-fast) var(--ease-out)," +
      "color var(--duration-fast) var(--ease-out);";
    b.addEventListener("click", onClick);
    return b;
  }

  // ── Expanded panel ────────────────────────────────────────────────────────

  private buildPanel(): void {
    this.panel = document.createElement("div");
    this.panel.style.cssText =
      `position:absolute;top:0;bottom:0;left:${RAIL_W}px;width:${PANEL_W - RAIL_W}px;` +
      "display:flex;flex-direction:column;" +
      "opacity:0;pointer-events:none;" +
      "transition:opacity var(--duration-normal) var(--ease-out);" +
      "overflow:hidden;";

    this.panel.appendChild(this.makeHeader());

    const scroll = document.createElement("div");
    scroll.setAttribute("data-scroll-host", "");
    scroll.style.cssText =
      "flex:1;overflow-y:auto;padding:14px 18px 24px;" +
      "display:flex;flex-direction:column;gap:18px;";
    scroll.className = "vc-scroll";
    scroll.appendChild(this.sectionVersion());
    scroll.appendChild(this.sectionEra());
    if (this.ads) scroll.appendChild(this.ads.makeSidebarSlot());
    scroll.appendChild(this.sectionFloats());
    scroll.appendChild(this.sectionBookmarks());
    scroll.appendChild(this.sectionKeyboardHints());
    this.panel.appendChild(scroll);

    this.el.appendChild(this.panel);
  }

  private makeHeader(): HTMLElement {
    const h = document.createElement("header");
    h.style.cssText =
      "padding:16px 18px 10px;border-bottom:1px solid var(--color-border);";
    const title = document.createElement("div");
    title.textContent = "Timeline Bíblico";
    title.style.cssText =
      "font-family:var(--font-serif);font-size:var(--text-xl);font-weight:var(--font-medium);" +
      "color:var(--color-text);letter-spacing:-0.01em;";
    const sub = document.createElement("div");
    sub.textContent = "Génesis → Apocalipsis";
    sub.style.cssText =
      "font-size:var(--text-2xs);color:var(--color-text-mute);" +
      "letter-spacing:var(--tracking-wider);text-transform:uppercase;margin-top:2px;";
    h.appendChild(title);
    h.appendChild(sub);
    return h;
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  private sectionVersion(): HTMLElement {
    const s = this.wrapSection("Versiones bíblicas");
    s.dataset.versionSection = "1";
    const col = document.createElement("div");
    col.dataset.versionList = "1";
    col.style.cssText = "display:flex;flex-direction:column;gap:4px;";
    // Populated by rebuildVersionList() once API responds
    const loading = document.createElement("div");
    loading.dataset.versionLoading = "1";
    loading.textContent = "Cargando versiones…";
    loading.style.cssText = "font-size:10px;color:var(--color-text-mute);padding:4px 2px;";
    col.appendChild(loading);
    s.appendChild(col);

    const hint = document.createElement("div");
    hint.style.cssText = "font-size:10px;color:var(--color-text-mute);margin-top:4px;";
    hint.textContent = `Hasta ${MAX_VERSIONS} versiones simultáneas`;
    s.appendChild(hint);
    return s;
  }

  private rebuildVersionList(): void {
    const col = this.panel.querySelector<HTMLElement>('[data-version-list="1"]');
    if (!col) return;
    col.innerHTML = "";

    const active = new Set(store.getState().activeVersions);

    // Group by languageFamily
    const groupLabels: Record<string, string> = {
      "es":              "Español",
      "original-greek":  "Griego original",
      "original-hebrew": "Hebreo original",
      "other":           "Otros",
    };
    const order = ["es", "original-greek", "original-hebrew", "other"];
    const grouped = new Map<string, BibleVersion[]>();
    for (const v of this.availableVersions) {
      const fam = v.languageFamily ?? "other";
      if (!grouped.has(fam)) grouped.set(fam, []);
      grouped.get(fam)!.push(v);
    }

    for (const fam of order) {
      const versions = grouped.get(fam);
      if (!versions?.length) continue;

      const groupLabel = document.createElement("div");
      groupLabel.textContent = groupLabels[fam] ?? fam;
      groupLabel.style.cssText =
        "font-size:9px;letter-spacing:var(--tracking-wider);text-transform:uppercase;" +
        "color:var(--color-text-mute);margin:8px 0 3px;font-weight:var(--font-semibold);";
      if (col.children.length === 0) groupLabel.style.marginTop = "0";
      col.appendChild(groupLabel);

      for (const v of versions) {
        col.appendChild(this.makeVersionRow(v, active));
      }
    }
  }

  private makeVersionRow(v: BibleVersion, active: Set<string>): HTMLElement {
    const on = active.has(v.code);
    const row = document.createElement("button");
    row.type = "button";
    row.dataset.version = v.code;
    row.style.cssText =
      "display:flex;align-items:center;gap:10px;padding:7px 10px;" +
      "border-radius:var(--radius-md);border:1px solid;" +
      `border-color:${on ? "var(--color-accent)" : "var(--color-border)"};` +
      `background:${on ? "color-mix(in oklch, var(--color-accent) 10%, transparent)" : "var(--color-surface)"};` +
      "color:var(--color-text);text-align:left;" +
      "transition:all var(--duration-fast) var(--ease-out);width:100%;";

    const check = document.createElement("span");
    check.dataset.check = "1";
    check.style.cssText =
      "width:14px;height:14px;border-radius:var(--radius-xs);flex:0 0 auto;" +
      "display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;" +
      `border:1.5px solid ${on ? "var(--color-accent)" : "var(--color-text-mute)"};` +
      `background:${on ? "var(--color-accent)" : "transparent"};` +
      `color:${on ? "var(--color-bg-deep)" : "transparent"};`;
    check.textContent = on ? "✓" : "";

    const info = document.createElement("span");
    info.style.cssText = "display:flex;flex-direction:column;min-width:0;";
    info.innerHTML =
      `<span style="font-size:var(--text-xs);font-weight:var(--font-semibold);">${v.code}</span>` +
      `<span style="font-size:10px;color:var(--color-text-mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${v.title}</span>`;

    row.appendChild(check);
    row.appendChild(info);
    row.addEventListener("click", () => this.toggleVersion(v.code));
    return row;
  }

  private toggleVersion(code: string): void {
    const active = new Set(store.getState().activeVersions);
    if (active.has(code)) {
      if (active.size === 1) return; // always keep at least one
      active.delete(code);
    } else {
      if (active.size >= MAX_VERSIONS) return; // cap at MAX_VERSIONS
      active.add(code);
    }
    store.update({ activeVersions: [...active] });
    this.rebuildVersionList();
  }

  private sectionEra(): HTMLElement {
    const s = this.wrapSection("Ir a era");
    const select = document.createElement("select");
    select.style.cssText = this.selectStyle();
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Selecciona una era…";
    select.appendChild(optAll);
    for (const e of ERAS) {
      const opt = document.createElement("option");
      opt.value = e.id;
      opt.textContent = e.nameEs;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      const era = ERAS.find((e) => e.id === select.value);
      if (!era) return;
      const seq = Math.max(1, Math.round(era.start * 31102) + 1);
      window.dispatchEvent(new CustomEvent("sidebar-jump-sequence", { detail: { sequence: seq } }));
      select.value = "";
    });
    s.appendChild(select);
    return s;
  }

  private sectionFloats(): HTMLElement {
    const s = this.wrapSection("Cards contextuales");

    const toggleRow = document.createElement("label");
    toggleRow.style.cssText =
      "display:flex;align-items:center;gap:10px;cursor:pointer;" +
      "font-size:var(--text-xs);color:var(--color-text-dim);margin-bottom:8px;";
    const track = document.createElement("span");
    track.dataset.toggleTrack = "1";
    track.style.cssText =
      "width:28px;height:16px;border-radius:var(--radius-pill);" +
      "background:var(--color-surface-2);border:1px solid var(--color-border);" +
      "position:relative;flex:0 0 auto;transition:background var(--duration-fast) var(--ease-out);";
    track.innerHTML =
      `<span data-toggle-dot style="position:absolute;top:1px;left:1px;` +
      `width:12px;height:12px;border-radius:var(--radius-pill);` +
      `background:var(--color-text);transition:left var(--duration-fast) var(--ease-out);"></span>`;
    toggleRow.appendChild(track);
    toggleRow.appendChild(document.createTextNode("Mostrar información contextual"));
    toggleRow.addEventListener("click", (e) => {
      e.preventDefault();
      store.update({ showFloats: !store.getState().showFloats });
    });

    const chipRow = document.createElement("div");
    chipRow.dataset.floatChips = "1";
    chipRow.style.cssText = "display:flex;flex-wrap:wrap;gap:5px;";
    const opts: { id: FloatType; label: string }[] = [
      { id: "context",  label: "Contexto" },
      { id: "prophecy", label: "Profecía" },
      { id: "xref",     label: "Ref. cruzada" },
      { id: "note",     label: "Notas" },
      { id: "map",      label: "Mapas" },
      { id: "people",   label: "Personajes" },
    ];
    for (const o of opts) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.dataset.chip = o.id;
      chip.textContent = o.label;
      chip.style.cssText = this.chipStyle();
      chip.addEventListener("click", () => this.toggleFloatType(o.id));
      chipRow.appendChild(chip);
    }

    s.appendChild(toggleRow);
    s.appendChild(chipRow);
    return s;
  }

  private toggleFloatType(type: FloatType): void {
    const cur = new Set(store.getState().floatTypes);
    if (cur.has(type)) cur.delete(type);
    else cur.add(type);
    store.update({ floatTypes: [...cur] });
  }

  private sectionBookmarks(): HTMLElement {
    const s = this.wrapSection("Marcadores");
    s.dataset.bookmarks = "1";
    const empty = document.createElement("div");
    empty.dataset.empty = "1";
    empty.textContent = "Sin marcadores todavía.";
    empty.style.cssText = "font-size:var(--text-xs);color:var(--color-text-mute);";
    s.appendChild(empty);
    return s;
  }

  private sectionKeyboardHints(): HTMLElement {
    const s = document.createElement("div");
    s.style.cssText =
      "margin-top:auto;padding-top:12px;font-size:10px;color:var(--color-text-mute);" +
      "line-height:var(--leading-relaxed);letter-spacing:var(--tracking-wide);";
    s.textContent = "Arrastra para desplazar · Rueda / pinch para zoom · ⌘K para buscar";
    return s;
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private wrapSection(title: string): HTMLElement {
    const wrap = document.createElement("section");
    const h = document.createElement("div");
    h.textContent = title;
    h.style.cssText =
      "font-size:10px;color:var(--color-text-mute);" +
      "letter-spacing:var(--tracking-wider);text-transform:uppercase;" +
      "margin-bottom:8px;font-weight:var(--font-medium);";
    wrap.appendChild(h);
    return wrap;
  }

  private selectStyle(): string {
    return (
      "width:100%;padding:7px 10px;" +
      "background:var(--color-surface);color:var(--color-text);font-size:var(--text-xs);" +
      "border:1px solid var(--color-border);border-radius:var(--radius-sm);" +
      "outline:none;font-family:inherit;"
    );
  }

  private chipStyle(): string {
    return (
      "padding:4px 10px;border-radius:var(--radius-pill);" +
      "border:1px solid var(--color-border);background:transparent;" +
      "color:var(--color-text-dim);font-size:11px;cursor:pointer;" +
      "transition:all var(--duration-fast) var(--ease-out);"
    );
  }

  // ── Sync with store ──────────────────────────────────────────────────────

  private syncFromStore(s: ReturnType<typeof store.getState>): void {
    const open = s.sidebarOpen;
    this.el.style.width = `${open ? PANEL_W : RAIL_W}px`;
    this.panel.style.opacity = open ? "1" : "0";
    this.panel.style.pointerEvents = open ? "auto" : "none";
    this.hamburger.textContent = open ? "✕" : "☰";

    // Version rows are rebuilt imperatively in toggleVersion/rebuildVersionList;
    // sync the visual state here for cases where store changes come from outside
    // (e.g., jumpTo from search also loads a version).
    const activeVer = new Set(s.activeVersions);
    this.panel.querySelectorAll<HTMLButtonElement>("[data-version]").forEach((btn) => {
      const on = activeVer.has(btn.dataset.version!);
      const check = btn.querySelector<HTMLElement>("[data-check]")!;
      btn.style.borderColor = on ? "var(--color-accent)" : "var(--color-border)";
      btn.style.background  = on
        ? "color-mix(in oklch, var(--color-accent) 10%, transparent)"
        : "var(--color-surface)";
      if (check) {
        check.style.borderColor = on ? "var(--color-accent)" : "var(--color-text-mute)";
        check.style.background  = on ? "var(--color-accent)" : "transparent";
        check.textContent       = on ? "✓" : "";
        check.style.color       = on ? "var(--color-bg-deep)" : "transparent";
      }
    });

    const dot = this.panel.querySelector<HTMLElement>("[data-toggle-dot]");
    const track = this.panel.querySelector<HTMLElement>("[data-toggle-track]");
    if (dot && track) {
      dot.style.left = s.showFloats ? "13px" : "1px";
      track.style.background = s.showFloats ? "var(--color-accent)" : "var(--color-surface-2)";
    }

    const activeFloats = new Set(s.floatTypes);
    const chipBox = this.panel.querySelector<HTMLElement>('[data-float-chips="1"]');
    if (chipBox) {
      chipBox.style.opacity = s.showFloats ? "1" : "0.4";
      chipBox.style.pointerEvents = s.showFloats ? "auto" : "none";
    }
    this.panel.querySelectorAll<HTMLButtonElement>("[data-chip]").forEach((btn) => {
      const on = activeFloats.has(btn.dataset.chip as FloatType);
      btn.style.borderColor = on ? "var(--color-accent)" : "var(--color-border)";
      btn.style.background = on
        ? "color-mix(in oklch, var(--color-accent) 16%, transparent)"
        : "transparent";
      btn.style.color = on ? "var(--color-accent)" : "var(--color-text-dim)";
    });

    const bm = this.panel.querySelector<HTMLElement>('[data-bookmarks="1"]');
    if (bm) {
      const empty = bm.querySelector<HTMLElement>('[data-empty="1"]');
      bm.querySelectorAll<HTMLElement>("[data-bookmark]").forEach((e) => e.remove());
      if (s.bookmarks.length === 0) {
        if (empty) empty.style.display = "block";
      } else {
        if (empty) empty.style.display = "none";
        for (const b of s.bookmarks) {
          const row = document.createElement("button");
          row.type = "button";
          row.dataset.bookmark = b.id;
          row.style.cssText =
            "display:flex;align-items:center;gap:8px;margin-bottom:4px;" +
            "padding:7px 10px;border-radius:var(--radius-sm);" +
            "border:1px solid var(--color-border);background:var(--color-surface);" +
            "color:var(--color-text);text-align:left;width:100%;" +
            "font-size:var(--text-xs);";
          row.innerHTML = `<span style="color:var(--color-accent);">★</span><span>${b.ref}</span>`;
          row.addEventListener("click", () => {
            window.dispatchEvent(new CustomEvent("sidebar-jump-sequence", { detail: { sequence: b.sequence } }));
          });
          bm.appendChild(row);
        }
      }
    }
  }
}
