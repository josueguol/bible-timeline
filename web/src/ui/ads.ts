/**
 * AdSense ad placements.
 *
 * Three non-obtrusive slots:
 *   1. Bottom strip — fixed at bottom edge, z-index 8.  Has ⌄/⌃ collapse button.
 *   2. Float card   — 300×250 right side, below era band.  Slides off-right
 *      via a ◂/▸ tab; only the 20px tab remains visible when collapsed.
 *   3. Sidebar panel — 300×250 in sidebar scroll area between sections.
 */

const AD_CLIENT    = "ca-pub-6627084457734509";
const SLOT_BOTTOM  = "9777831010";   // horizontal 728×90
const SLOT_SIDEBAR = "4745310816";   // rectangle  300×250 (sidebar)
const SLOT_FLOAT   = "2623289368";   // rectangle  300×250 (float right)

const STRIP_H_OPEN      = 90;   // px
const STRIP_H_COLLAPSED = 24;   // px — only the button row visible

const FLOAT_TAB_W = 20;    // px — always-visible tab on right edge
const FLOAT_AD_W  = 300;   // px — ad content

declare global {
  interface Window {
    adsbygoogle: unknown[];
  }
}

function pushAd(): void {
  try {
    (window.adsbygoogle = window.adsbygoogle ?? []).push({});
  } catch {
    // ad blocker — fail silently
  }
}

function makeIns(slot: string, style: string): HTMLElement {
  const ins = document.createElement("ins");
  ins.className = "adsbygoogle";
  ins.style.cssText = style + "display:block;";
  ins.setAttribute("data-ad-client", AD_CLIENT);
  if (slot) ins.setAttribute("data-ad-slot", slot);
  ins.setAttribute("data-ad-format", "auto");
  ins.setAttribute("data-full-width-responsive", "true");
  return ins;
}

// Hide float ad on narrow viewports (injected once at module load).
const _FLOAT_STYLE = (() => {
  const s = document.createElement("style");
  s.textContent = "@media(max-width:640px){.bt-float-ad{display:none!important}}";
  document.head.appendChild(s);
})();
void _FLOAT_STYLE;

const BOTTOM_TAB_H = 22;   // px — pestaña above the strip

const MINIMAP_BOTTOM_DEFAULT = 16;                                        // px
const MINIMAP_BOTTOM_PUSHED  = STRIP_H_OPEN + BOTTOM_TAB_H - 12;         // 100px

export class Ads {
  private stripCollapsed = false;
  private minimapEl: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.mountBottomStrip(container);
  }

  /** Wire the minimap element so the banner can push/restore it. */
  setMinimapEl(el: HTMLElement): void {
    this.minimapEl = el;
    el.style.transition =
      `bottom var(--duration-normal) var(--ease-out)`;
    el.style.bottom = `${MINIMAP_BOTTOM_PUSHED}px`;
  }

  // ── Bottom strip ────────────────────────────────────────────────────────────

  private mountBottomStrip(container: HTMLElement): void {
    // anchor: flex-column [tab][strip] pinned to bottom-center.
    // Tab is a flex sibling of strip (not inside it) so overflow:hidden on
    // the strip doesn't clip it.
    const anchor = document.createElement("div");
    anchor.setAttribute("aria-label", "Anuncio inferior");
    anchor.style.cssText =
      "position:fixed;bottom:0;left:50%;transform:translateX(-50%);" +
      "z-index:12;" +
      "width:728px;" +
      "display:flex;flex-direction:column;align-items:stretch;";

    // ── Pestaña — right-aligned above the strip ───────────────────────────────
    const tab = document.createElement("button");
    tab.textContent = "⌄";
    tab.title = "Ocultar anuncio";
    tab.setAttribute("aria-label", "Ocultar anuncio");
    tab.style.cssText =
      "align-self:flex-end;" +
      `width:32px;height:${BOTTOM_TAB_H}px;` +
      "background:var(--color-bg-deep);" +
      "border:1px solid var(--color-border);border-bottom:none;" +
      "border-radius:var(--radius-sm) var(--radius-sm) 0 0;" +
      "font-size:11px;color:var(--color-text-mute);cursor:pointer;" +
      "display:flex;align-items:center;justify-content:center;" +
      "transition:color var(--duration-fast) var(--ease-out);";
    tab.addEventListener("mouseenter", () => { tab.style.color = "var(--color-text-dim)"; });
    tab.addEventListener("mouseleave", () => { tab.style.color = "var(--color-text-mute)"; });

    // ── Strip ─────────────────────────────────────────────────────────────────
    const strip = document.createElement("div");
    strip.style.cssText =
      "position:relative;width:728px;overflow:hidden;" +
      `height:${STRIP_H_OPEN}px;` +
      "background:var(--color-bg-deep);" +
      "border-top:1px solid var(--color-border);" +
      "border-left:1px solid var(--color-border);" +
      "border-right:1px solid var(--color-border);" +
      "display:flex;align-items:center;justify-content:center;" +
      "transition:height var(--duration-normal) var(--ease-out);";

    const watermark = document.createElement("span");
    watermark.textContent = "Publicidad";
    watermark.style.cssText =
      "position:absolute;top:4px;left:8px;" +
      "font-size:9px;color:var(--color-text-mute);" +
      "letter-spacing:var(--tracking-widest);font-weight:var(--font-semibold);" +
      "pointer-events:none;z-index:1;";

    tab.addEventListener("click", () => {
      this.stripCollapsed = !this.stripCollapsed;
      strip.style.height = this.stripCollapsed ? "0" : `${STRIP_H_OPEN}px`;
      tab.textContent    = this.stripCollapsed ? "⌃" : "⌄";
      tab.title          = this.stripCollapsed ? "Mostrar anuncio" : "Ocultar anuncio";
      tab.setAttribute("aria-label", tab.title);
      if (this.minimapEl) {
        this.minimapEl.style.bottom = this.stripCollapsed
          ? `${MINIMAP_BOTTOM_DEFAULT}px`
          : `${MINIMAP_BOTTOM_PUSHED}px`;
      }
    });

    // Fixed 728×90 — no auto-format, matches the AdSense unit.
    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.cssText = "display:inline-block;width:728px;height:90px;";
    ins.setAttribute("data-ad-client", AD_CLIENT);
    ins.setAttribute("data-ad-slot", SLOT_BOTTOM);

    strip.appendChild(watermark);
    strip.appendChild(ins);
    anchor.appendChild(tab);
    anchor.appendChild(strip);
    container.appendChild(anchor);
    pushAd();
  }

  // ── Float right card ────────────────────────────────────────────────────────

  /**
   * 300×250 card anchored to the right edge just below the era band.
   * A 20px tab (◂/▸) on its left edge lets the user slide it off-screen.
   * Hidden entirely on viewports < 640px.
   */
  /**
   * 300×250 card on the right edge, below the era band, above event cards.
   * A small pestaña tab (◂/▸) on its left edge slides the card off-screen;
   * only the tab remains visible at the right edge when collapsed.
   */
  makeFloatAdCard(): HTMLElement {
    // Wrap: [tab 20px][content 300px] — slides right as a unit.
    const wrap = document.createElement("div");
    wrap.className = "bt-float-ad";
    wrap.setAttribute("aria-label", "Publicidad");
    wrap.style.cssText =
      "position:fixed;" +
      "right:0;" +
      "top:calc(var(--topbar-h) + var(--era-band-h) + 8px);" +
      `width:${FLOAT_TAB_W + FLOAT_AD_W}px;` +
      "height:281px;overflow:hidden;" +
      "z-index:11;" +          // above event-cards (10), below minimap (22)
      "display:flex;flex-direction:row;align-items:flex-start;" +
      "transition:right var(--duration-normal) var(--ease-out);";

    // Small pestaña — 20 × 40px, left-rounded, top-aligned.
    const tab = document.createElement("button");
    tab.textContent = "˃";
    tab.title = "Ocultar anuncio";
    tab.setAttribute("aria-label", "Ocultar anuncio");
    tab.style.cssText =
      `flex:0 0 ${FLOAT_TAB_W}px;height:40px;` +
      "align-self:flex-start;margin-top:8px;" +   // slight inset from top
      "background:color-mix(in oklch,var(--color-surface) 92%,transparent);" +
      "border:1px dashed var(--color-border);border-right:none;" +
      "border-radius:var(--radius-md) 0 0 var(--radius-md);" +
      "color:var(--color-text-mute);font-size:12px;cursor:pointer;" +
      "display:flex;align-items:center;justify-content:center;" +
      "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);" +
      "transition:color var(--duration-fast) var(--ease-out);";
    tab.addEventListener("mouseenter", () => { tab.style.color = "var(--color-text-dim)"; });
    tab.addEventListener("mouseleave", () => { tab.style.color = "var(--color-text-mute)"; });

    // 300×250 ad content card — height clamped so AdSense iframe can't expand it.
    // 6px pad-top + 17px label + 250px ins + 8px pad-bottom = 281px
    const content = document.createElement("div");
    content.style.cssText =
      `flex:0 0 ${FLOAT_AD_W}px;` +
      "height:281px;overflow:hidden;" +
      "background:color-mix(in oklch,var(--color-surface) 92%,transparent);" +
      "border:1px dashed var(--color-border);" +
      "border-radius:var(--radius-md) 0 var(--radius-md) var(--radius-md);" +
      "padding:6px 8px 8px;" +
      "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);";

    const label = document.createElement("div");
    label.textContent = "Publicidad";
    label.style.cssText =
      "font-size:9px;color:var(--color-text-mute);" +
      "letter-spacing:var(--tracking-widest);font-weight:var(--font-semibold);" +
      "margin-bottom:4px;";

    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.cssText = `display:inline-block;width:${FLOAT_AD_W}px;height:250px;`;
    ins.setAttribute("data-ad-client", AD_CLIENT);
    ins.setAttribute("data-ad-slot", SLOT_FLOAT);

    // Clip wrapper — position:relative creates a containing block so AdSense
    // iframes / injected elements can't escape via absolute positioning.
    const clip = document.createElement("div");
    clip.style.cssText =
      `width:${FLOAT_AD_W}px;height:250px;` +
      "overflow:hidden;position:relative;";
    clip.appendChild(ins);

    content.appendChild(label);
    content.appendChild(clip);

    let hidden = false;
    tab.addEventListener("click", () => {
      hidden = !hidden;
      wrap.style.right = hidden ? `-${FLOAT_AD_W}px` : "0";
      tab.textContent  = hidden ? "˂" : "˃";
      tab.title        = hidden ? "Mostrar anuncio" : "Ocultar anuncio";
      tab.setAttribute("aria-label", tab.title);
    });

    wrap.appendChild(tab);
    wrap.appendChild(content);
    requestAnimationFrame(pushAd);
    return wrap;
  }

  // ── Sidebar slot ────────────────────────────────────────────────────────────

  makeSidebarSlot(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText =
      "width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "padding:8px 0;border-radius:var(--radius-md);" +
      "overflow:hidden;height:110px;" +   /* 90px ad + 20px padding */
      "background:var(--color-bg-deep);border:1px solid var(--color-border);";

    const ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.cssText = "display:inline-block;width:198px;height:90px;";
    ins.setAttribute("data-ad-client", AD_CLIENT);
    ins.setAttribute("data-ad-slot", SLOT_SIDEBAR);

    wrap.appendChild(ins);
    requestAnimationFrame(pushAd);
    return wrap;
  }
}
