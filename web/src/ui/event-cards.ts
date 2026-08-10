import { store } from "@store/app-store.ts";
import type { StrongEntry, VerseRangeRow, VerseSegment, VisibleEvent } from "@api/types.ts";
import { eraForSeq } from "../era-data.ts";
import { subscribeCameraUpdate, type CameraSnapshot } from "../camera.ts";
import { VerseWindowFetcher } from "@canvas/verse-window-fetcher.ts";
import { authStore } from "@store/auth-store.ts";
import { AuthModal } from "@ui/auth-modal.ts";
import { NoteEditor } from "@ui/note-editor.ts";

const TOTAL          = 31102;
const CARD_GAP       = 10;
const CONNECTOR_DROP = 18;
const MAX_VERSE_CARDS = 80;     // safety cap so we don't mount thousands of DOM nodes

/**
 * Top of the first card row, measured from the viewport top.
 *
 *   68 px → era band top (matches the prototype; sits below the floating
 *           search palette which is at top:16 with ~44 px of height).
 *   32 px → era band height.
 *   16 px → breathing room between era band bottom and the first card.
 */
const CARDS_TOP_PX = 68 + 32 + 16;

/**
 * EventCards renders the cards that sit ABOVE the axis.
 *
 * It has two modes — the mode is chosen by the server-reported zoom level:
 *
 *   • Event mode (zoomLevel.label !== "Versículos"): draws one card per
 *     VisibleEvent from the viewport response. That list is already filtered
 *     by the server to the active zoom level (panorama / era / book /
 *     chapter), which is exactly the progressive retrieval the user asked
 *     for — level 1 events when zoomed out, then 2, 3, ... as the user zooms
 *     in.
 *
 *   • Verse mode (zoomLevel.label === "Versículos"): at max zoom the
 *     retrieval switches to a window of individual verses around the focus
 *     point. Each card renders one verse with the user's selected versions
 *     (RV60 + optionally NVI) side-by-side.
 *
 * Positioning is recomputed per camera update so the cards feel glued to
 * their verse sequences. Horizontal packing pushes overlapping cards to the
 * right and draws a thin connector back to the true axis position.
 */

type CardKind = "event" | "verse";

interface Placed {
  kind: CardKind;
  card: HTMLElement;
  connector: HTMLElement;
  axisSeq: number;       // verse sequence for axis anchoring
  cardWidth: number;     // measured width (depends on density)
  // For event mode we track start/end spans to draw wide cards when a single
  // node covers many verses (eg. "Monarquía" from seq 5k..12k).
  startSeq: number;
  endSeq:   number;
  ev?: VisibleEvent;
  verseRow?: VerseRangeRow;
  ancestryEl?: HTMLElement | null; // footer badge: "FOCUS" | "ANCESTRO" — updated in place
}

export class EventCards {
  readonly el: HTMLElement;
  private lastCamera: CameraSnapshot | null = null;
  private placed: Placed[] = [];

  /**
   * How many pixels past sequence TOTAL's natural screen position the
   * right-most packed card currently extends. Pan-invariant (shifts with
   * the pan but so do the cards), so a single measurement per layout is
   * enough. Read by `TimelineCanvas.clampPan` to expand the right-side
   * overscan dynamically — without this, clusters of cards packed horizontally
   * near the timeline end would get clipped at the viewport edge when the
   * user pans all the way right.
   *
   * Kept MONOTONICALLY NON-DECREASING within a single zoom level. Letting it
   * shrink mid-pan (as the user crosses from a dense cluster into a sparse
   * area) shrinks the clamp bounds too, which snaps panOffset back on the
   * next wheel event and the user feels a jump in the direction of travel.
   * We only reset the high-water mark when the zoom level actually changes.
   */
  rightOverflowPx = 0;
  private rightOverflowZoomLevel = -1;
  private rightOverflowHighWater = 0;

  // Accumulated events within the current zoom level. Cards are added as they
  // arrive from each viewport fetch but NEVER removed mid-pan — only cleared
  // when the zoom level changes (user zoomed out). This prevents the flash
  // where sub-events disappear because a pan-shifted focus-path excludes them
  // from the next server response even though they're still on screen.
  private readonly eventCache = new Map<string, VisibleEvent>();
  private cacheZoomLevel = -1;

  private unsubCamera?: () => void;
  private unsubStore?:  () => void;

  private openEventCard?: (id: string) => void;
  private readonly verseFetcher: VerseWindowFetcher;
  private verseRows: VerseRangeRow[] = [];
  private verseVersions: string[]   = [];
  private strongLexicon: Record<string, StrongEntry> = {};
  private lastVersionKey = "";

  // Skeleton ghost cards shown while a verse-window fetch is in flight
  // and there are no cached rows to display.
  private readonly skeletonEl: HTMLElement;
  private readonly skeletonCards: HTMLElement[];
  private isVerseLoading = false;

  // Number of skeleton placeholders shown side-by-side
  private static readonly SK_COUNT = 5;

  constructor() {
    this.el = document.createElement("div");
    this.el.style.cssText =
      "position:fixed;inset:0;pointer-events:none;overflow:hidden;" +
      "z-index:var(--z-cards);";
    this.el.setAttribute("aria-hidden", "false");
    this.el.setAttribute("role", "list");
    this.el.setAttribute("aria-label", "Eventos visibles del timeline");

    // Container for skeleton cards — separate element so it sits on top of
    // real cards without being confused with them during diff/rebuild.
    this.skeletonEl = document.createElement("div");
    this.skeletonEl.setAttribute("aria-hidden", "true");
    this.skeletonEl.style.cssText =
      "position:fixed;inset:0;pointer-events:none;overflow:hidden;" +
      "z-index:var(--z-cards);display:none;";

    this.skeletonCards = Array.from({ length: EventCards.SK_COUNT }, () => {
      const sk = makeSkeletonCard();
      sk.style.display = "none";   // hidden until positionSkeletons() sets left/top
      return sk;
    });
    for (const sk of this.skeletonCards) this.skeletonEl.appendChild(sk);

    this.verseFetcher = new VerseWindowFetcher(
      (rows, versions, lexicon) => {
        this.verseRows     = rows;
        this.verseVersions = versions;
        this.strongLexicon = lexicon;
        this.isVerseLoading = false;
        this.skeletonEl.style.display = "none";
        this.rebuild();
      },
      (err) => {
        this.isVerseLoading = false;
        this.skeletonEl.style.display = "none";
        console.warn("Verse window fetch failed:", err);
      },
      (loading) => {
        this.isVerseLoading = loading;
        // Show skeletons only when we have no cached rows to display.
        if (loading && this.verseRows.length === 0) {
          this.skeletonEl.style.display = "block";
          if (this.lastCamera) this.positionSkeletons(this.lastCamera);
        } else if (!loading) {
          this.skeletonEl.style.display = "none";
        }
      },
    );
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
    container.appendChild(this.skeletonEl);
    this.unsubCamera = subscribeCameraUpdate((snap) => this.onCamera(snap));
    this.unsubStore  = store.subscribe(() => this.rebuild());
    this.rebuild();
  }

  setOpenEventCard(fn: (id: string) => void): void {
    this.openEventCard = fn;
  }

  destroy(): void {
    this.unsubCamera?.();
    this.unsubStore?.();
    this.verseFetcher.destroy();
  }

  // ── Skeleton positioning ─────────────────────────────────────────────────

  private positionSkeletons(snap: CameraSnapshot): void {
    const density = store.getState().density;
    const cardW   = cardWidthForDensity(density);
    const axisY   = window.innerHeight / 2;
    const cardTop = CARDS_TOP_PX;
    const cardH   = Math.max(96, axisY - CONNECTOR_DROP - 6 - cardTop);
    const cx      = (snap.viewportW + snap.sidebarW) / 2;

    // Spread SK_COUNT skeletons around focusSeq, one per verse step.
    const half = Math.floor(EventCards.SK_COUNT / 2);
    for (let i = 0; i < EventCards.SK_COUNT; i++) {
      const seq      = snap.focusSeq + (i - half);
      const screenX  = (seq - snap.focusSeq) * snap.pxPerVerse + cx + snap.panOffset;
      const left     = Math.round(screenX - cardW / 2);
      const sk       = this.skeletonCards[i]!;
      const offscreen =
        left + cardW < snap.sidebarW - 40 ||
        left > snap.viewportW + 40;
      sk.style.display  = offscreen ? "none" : "flex";
      sk.style.left     = `${left}px`;
      sk.style.top      = `${cardTop}px`;
      sk.style.height   = `${Math.round(cardH)}px`;
      sk.style.width    = `${cardW}px`;
    }
  }

  // ── Mode selection ──────────────────────────────────────────────────────

  private isVerseMode(): boolean {
    const vp = store.getState().viewport;
    return vp?.zoomLevel?.label?.toLowerCase() === "versículos";
  }

  /** Which Bible versions to render stacked inside each card. */
  private activeVersionCodes(): string[] {
    return store.getState().activeVersions.filter(Boolean);
  }

  // ── Rebuild DOM (diff-based — avoids full DOM flash on every refresh) ──

  /**
   * Diff-based update. When a new viewport response arrives most cards stay
   * the same — only the leading/trailing edge of the visible set changes.
   * Destroying every DOM node and recreating them (the old behaviour) caused
   * a visible flash on each fetch while the user pans continuously; diffing
   * by ID keeps the existing cards in place and just adds / removes the
   * small delta, so the scroll stays fluid across era transitions.
   */
  private rebuild(): void {
    const vp = store.getState().viewport;

    const level = vp?.zoomLevel?.level ?? -1;

    // Clear accumulated event cache on zoom-level change so that zooming out
    // discards sub-events that belong to the previous (deeper) level.
    if (level !== this.cacheZoomLevel) {
      this.cacheZoomLevel = level;
      this.eventCache.clear();
    }

    // Reset overflow high-water mark on level change.
    if (level !== this.rightOverflowZoomLevel) {
      this.rightOverflowZoomLevel = level;
      this.rightOverflowHighWater  = 0;
      this.rightOverflowPx         = 0;
    }

    if (!vp) {
      this.clearAllCards();
      return;
    }

    const mode: CardKind = this.isVerseMode() ? "verse" : "event";

    // When active versions change in verse mode, discard all verse cards so
    // they get recreated with the new version text after the fetcher responds.
    const versionKey = store.getState().activeVersions.join(",");
    if (mode === "verse" && versionKey !== this.lastVersionKey) {
      this.lastVersionKey = versionKey;
      const keepEvents = this.placed.filter((p) => p.kind === "event");
      const dropVerses = this.placed.filter((p) => p.kind === "verse");
      for (const p of dropVerses) { p.card.remove(); p.connector.remove(); }
      this.placed = keepEvents;
      this.verseRows = [];
      this.strongLexicon = {};
    }

    // Merge incoming events into the per-level cache. Already-seen events are
    // updated in place (refreshes isFocused / isFocusAncestor). New events are
    // appended. Nothing is removed — removal only happens via the level-change
    // clear above, preventing mid-pan disappearing of sub-events.
    if (mode === "event") {
      for (const ev of vp.visibleEvents) {
        this.eventCache.set(ev.id, ev);
      }
      // Update ancestry badges on already-rendered cards so FOCUS doesn't stick
      for (const p of this.placed) {
        if (p.kind !== "event" || !p.ev || !p.ancestryEl) continue;
        const fresh = this.eventCache.get(p.ev.id);
        if (fresh) {
          p.ev = fresh;
          if (p.ancestryEl) updateAncestryBadge(p.ancestryEl, fresh.isFocused, fresh.isFocusAncestor);
        }
      }
    }

    // A single ID scheme per mode so the diff can look cards up cheaply.
    const idOf = (p: Placed): string =>
      p.kind === "event" ? p.ev!.id : `verse-${p.verseRow!.sequence}`;

    // Build the wanted set from the ACCUMULATED cache (event mode) so that
    // cards loaded in a prior pan position are kept even when the new viewport
    // response omits them due to a focus-path shift.
    const wantedIds = new Set<string>();
    if (mode === "event") {
      for (const id of this.eventCache.keys()) wantedIds.add(id);
    } else {
      this.requestVerseWindow();
      for (const r of this.verseRows.slice(0, MAX_VERSE_CARDS)) {
        wantedIds.add(`verse-${r.sequence}`);
      }
    }

    // 1) Remove every placed card that's no longer wanted (either gone from
    //    the viewport or moved to a different mode). Keep the rest in place.
    const keep: Placed[] = [];
    for (const p of this.placed) {
      if (p.kind === mode && wantedIds.has(idOf(p))) {
        keep.push(p);
      } else {
        p.card.remove();
        p.connector.remove();
      }
    }
    this.placed = keep;

    // 2) Index what's still alive so step 3 can skip it.
    const existing = new Set<string>(this.placed.map(idOf));

    // 3) Append new cards for wanted IDs we don't have yet.
    if (mode === "event") {
      for (const ev of this.eventCache.values()) {
        if (existing.has(ev.id)) continue;
        this.appendEventCard(ev);
      }
    } else {
      const lang = store.getState().lang;
      for (const r of this.verseRows.slice(0, MAX_VERSE_CARDS)) {
        if (existing.has(`verse-${r.sequence}`)) continue;
        this.appendVerseCard(r, lang);
      }
    }

    // Reposition everything at the last known camera.
    if (this.lastCamera) this.onCamera(this.lastCamera);
  }

  private clearAllCards(): void {
    for (const p of this.placed) {
      p.card.remove();
      p.connector.remove();
    }
    this.placed = [];
  }

  private requestVerseWindow(): void {
    if (!this.lastCamera) return;
    const { focusSeq, pxPerVerse, viewportW, sidebarW } = this.lastCamera;
    // Visible range in sequence space (add a tiny pad for off-screen prefetch)
    const leftX  = sidebarW;
    const rightX = viewportW;
    const fromSeq = focusSeq - (((viewportW + sidebarW) / 2) - leftX) / pxPerVerse;
    const toSeq   = focusSeq + (rightX - ((viewportW + sidebarW) / 2)) / pxPerVerse;
    const versions = this.activeVersionCodes();
    this.verseFetcher.request(fromSeq, toSeq, versions);
  }

  // ── Event-mode DOM (single-append, used by the diff in `rebuild`) ──────

  private appendEventCard(ev: VisibleEvent): void {
    const density = store.getState().density;
    const cardWidth = cardWidthForDensity(density);
    const era = eraForSeq(ev.startSequence, TOTAL);
    const card = this.makeEventCard(ev, era.color);
    const connector = this.makeConnector(era.color);
    const ancestryEl = card.querySelector<HTMLElement>("[data-ancestry]");

    this.el.appendChild(card);
    this.el.appendChild(connector);

    const placed: Placed = {
      kind: "event",
      card,
      connector,
      axisSeq: (ev.startSequence + ev.endSequence) / 2,
      cardWidth,
      startSeq: ev.startSequence,
      endSeq:   ev.endSequence,
      ev,
    };
    if (ancestryEl) placed.ancestryEl = ancestryEl;
    this.placed.push(placed);
  }

  private makeEventCard(ev: VisibleEvent, eraColor: string): HTMLElement {
    const density = store.getState().density;
    const card = document.createElement("article");
    card.setAttribute("role", "listitem");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `${ev.title} · ${ev.scriptureRefs?.[0] ?? ""}`);
    card.dataset.noDrag = "1";
    card.style.cssText = eventCardStyle(density, ev, eraColor);

    card.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openEventCard?.(ev.id);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.openEventCard?.(ev.id);
      }
    });

    // Header: ref tag + zoom-level badge
    const header = document.createElement("header");
    header.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:6px;" +
      "padding:8px 12px 4px;";

    const refTag = document.createElement("span");
    refTag.textContent = ev.scriptureRefs?.[0] ?? "";
    refTag.style.cssText =
      `font-family:var(--font-mono);font-size:var(--text-2xs);` +
      `color:${eraColor};letter-spacing:var(--tracking-wide);font-weight:var(--font-semibold);` +
      `padding:2px 6px;border-radius:var(--radius-xs);` +
      `background:color-mix(in oklch, ${eraColor} 14%, transparent);`;

    const levelBadge = document.createElement("span");
    levelBadge.textContent = `L${ev.zoomLevel}`;
    levelBadge.style.cssText =
      `font-family:var(--font-mono);font-size:10px;color:var(--color-text-mute);` +
      `letter-spacing:var(--tracking-wide);`;

    header.appendChild(refTag);
    if (ev.isFocused) {
      const focusDot = document.createElement("span");
      focusDot.style.cssText =
        `width:6px;height:6px;border-radius:var(--radius-pill);` +
        `background:var(--color-accent);flex:0 0 auto;` +
        `box-shadow:0 0 10px var(--color-accent);`;
      header.appendChild(focusDot);
    }
    header.appendChild(levelBadge);

    // Title (serif, like the design)
    const title = document.createElement("h3");
    title.textContent = ev.title;
    title.style.cssText =
      "margin:0;padding:0 12px;font-family:var(--font-serif);" +
      "font-size:var(--text-base);font-weight:var(--font-medium);" +
      "color:var(--color-text);line-height:var(--leading-snug);" +
      "letter-spacing:-0.005em;";

    // Summary (only if the card is tall enough to afford it)
    if (ev.summary && density !== "compact") {
      const summary = document.createElement("p");
      summary.textContent = ev.summary;
      summary.style.cssText =
        "margin:6px 12px 0;font-size:var(--text-xs);color:var(--color-text-dim);" +
        "line-height:var(--leading-normal);display:-webkit-box;" +
        "-webkit-line-clamp:" + (density === "comfy" ? "4" : "3") + ";" +
        "-webkit-box-orient:vertical;overflow:hidden;";
      card.appendChild(header);
      card.appendChild(title);
      card.appendChild(summary);
    } else {
      card.appendChild(header);
      card.appendChild(title);
    }

    // Footer: range + ancestry breadcrumb for focused card
    const footer = document.createElement("footer");
    footer.style.cssText =
      "margin-top:auto;padding:8px 12px;border-top:1px solid var(--color-border);" +
      "font-size:10px;font-family:var(--font-mono);color:var(--color-text-mute);" +
      "letter-spacing:var(--tracking-wide);display:flex;justify-content:space-between;gap:6px;";
    const range = document.createElement("span");
    range.textContent = `${ev.startSequence}–${ev.endSequence}`;
    const ancestry = document.createElement("span");
    ancestry.dataset.ancestry = "1";
    ancestry.style.color = "var(--color-accent)";
    footer.appendChild(range);
    footer.appendChild(ancestry);
    card.appendChild(footer);

    updateAncestryBadge(ancestry, ev.isFocused, ev.isFocusAncestor);

    return card;
  }

  // ── Verse-mode DOM (single-append, used by the diff in `rebuild`) ──────

  private appendVerseCard(row: VerseRangeRow, lang: string): void {
    const density = store.getState().density;
    const cardWidth = cardWidthForDensity(density);
    const era = eraForSeq(row.sequence, TOTAL);
    const card = this.makeVerseCard(row, era.color, lang);
    const connector = this.makeConnector(era.color);

    this.el.appendChild(card);
    this.el.appendChild(connector);

    this.placed.push({
      kind: "verse",
      card,
      connector,
      axisSeq: row.sequence,
      cardWidth,
      startSeq: row.sequence,
      endSeq:   row.sequence,
      verseRow: row,
    });
  }

  private makeVerseCard(row: VerseRangeRow, eraColor: string, _lang: string): HTMLElement {
    const density = store.getState().density;
    const card = document.createElement("article");
    card.setAttribute("role", "listitem");
    card.setAttribute("aria-label", row.ref);
    card.dataset.noDrag = "1";
    card.style.cssText = verseCardStyle(density, eraColor);

    // Header row
    const header = document.createElement("header");
    header.style.cssText = "padding:8px 12px 4px;display:flex;justify-content:space-between;gap:6px;";
    const ref = document.createElement("span");
    ref.textContent = row.ref;
    ref.style.cssText =
      `font-family:var(--font-mono);font-size:var(--text-2xs);` +
      `color:${eraColor};letter-spacing:var(--tracking-wide);font-weight:var(--font-semibold);` +
      `padding:2px 6px;border-radius:var(--radius-xs);` +
      `background:color-mix(in oklch, ${eraColor} 14%, transparent);`;
    header.appendChild(ref);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "⧉";
    copyBtn.title = "Copiar";
    copyBtn.setAttribute("aria-label", "Copiar referencia");
    copyBtn.style.cssText =
      "color:var(--color-text-mute);font-family:var(--font-mono);font-size:12px;padding:2px 4px;";
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const parts = this.activeVersionCodes().map((code) => {
        const text = row.texts?.[code];
        return text ? `${code}: ${text}` : null;
      }).filter(Boolean) as string[];
      const payload = `${row.ref}\n${parts.join("\n")}`;
      navigator.clipboard?.writeText(payload);
      copyBtn.textContent = "✓";
      setTimeout(() => (copyBtn.textContent = "⧉"), 900);
    });
    header.appendChild(copyBtn);

    const noteBtn = document.createElement("button");
    noteBtn.type = "button";
    noteBtn.textContent = "✎";
    noteBtn.title = "Ver / agregar notas";
    noteBtn.setAttribute("aria-label", "Notas de este versículo");
    noteBtn.style.cssText =
      "background:oklch(0.72 0.20 50);color:oklch(0.14 0.015 260);" +
      "border:none;border-radius:5px;font-size:13px;font-weight:700;" +
      "width:22px;height:22px;cursor:pointer;flex-shrink:0;line-height:1;padding:0;";
    noteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!authStore.isAuthenticated()) {
        const modal = new AuthModal();
        modal.open();
        return;
      }
      const editor = new NoteEditor(row.ref, row.ref, null, () => {
        window.dispatchEvent(new Event("note-saved"));
      }, () => editor.unmount());
      editor.mount();
    });
    header.appendChild(noteBtn);

    // Scrollable body with each version
    const body = document.createElement("div");
    body.className = "vc-scroll";
    body.setAttribute("data-scroll-host", "");
    body.style.cssText =
      "flex:1;padding:0 12px 10px;overflow-y:auto;overscroll-behavior:contain;" +
      "display:flex;flex-direction:column;gap:10px;";
    body.addEventListener("wheel", (e) => {
      // Keep the wheel inside the card when the body can scroll — the
      // surrounding canvas must not hijack it. When there's nothing to scroll,
      // we let it bubble so pan/zoom still works over the card.
      const t = e.currentTarget as HTMLElement;
      if (t.scrollHeight > t.clientHeight) e.stopPropagation();
    });

    const codes = this.activeVersionCodes();
    for (const code of codes) {
      const text = row.texts?.[code];
      if (!text) continue;
      const block = document.createElement("div");
      const versionLabel = document.createElement("div");
      versionLabel.textContent = code;
      versionLabel.style.cssText =
        "font-family:var(--font-mono);font-size:9px;letter-spacing:var(--tracking-widest);" +
        "font-weight:var(--font-semibold);color:var(--color-text-mute);margin-bottom:3px;";
      const verseText = document.createElement("div");
      verseText.style.cssText =
        "font-family:var(--font-serif);font-size:var(--text-sm);line-height:var(--leading-snug);" +
        "color:var(--color-text);text-wrap:pretty;";
      const segments = row.segments?.[code];
      if (segments?.length) {
        renderSegmentedText(verseText, code, segments, this.strongLexicon);
      } else {
        verseText.textContent = text;
      }
      block.appendChild(versionLabel);
      block.appendChild(verseText);
      body.appendChild(block);
    }

    card.appendChild(header);
    card.appendChild(body);
    return card;
  }

  // ── Connector below the card ────────────────────────────────────────────

  private makeConnector(eraColor: string): HTMLElement {
    // Simple <div> with a vertical rule + dot. A more elaborate elbow is
    // drawn inline when the card is horizontally shifted (see onCamera).
    const el = document.createElement("div");
    el.dataset.connector = "1";
    el.style.cssText =
      "position:fixed;pointer-events:none;overflow:visible;" +
      "z-index:var(--z-cards);";
    el.innerHTML =
      `<div style="position:absolute;top:0;bottom:${CONNECTOR_DROP / 2 - 1}px;` +
      `width:1px;left:50%;transform:translateX(-0.5px);` +
      `background:color-mix(in oklch, ${eraColor} 65%, transparent);"></div>` +
      `<div style="position:absolute;bottom:0;left:50%;` +
      `width:7px;height:7px;border-radius:var(--radius-pill);` +
      `background:${eraColor};box-shadow:0 0 10px ${eraColor};` +
      `transform:translate(-50%, 50%);"></div>`;
    return el;
  }

  // ── Per-frame positioning — where the heavy lifting happens ─────────────

  private onCamera(snap: CameraSnapshot): void {
    this.lastCamera = snap;
    if (this.skeletonEl.style.display !== "none") this.positionSkeletons(snap);
    if (this.placed.length === 0) return;

    const axisY   = window.innerHeight / 2;
    const cardTop = CARDS_TOP_PX;
    const cardBottomMax = axisY - CONNECTOR_DROP - 6;
    const cardH = Math.max(96, cardBottomMax - cardTop);

    // Horizontal layout.
    //
    // Event cards: cascade packing — wide-span events (eras, narratives) can
    // overlap; the cascade pushes each card to the right of the previous one.
    //
    // Verse cards: stride-filtered natural positions. We hide cards that fall
    // off the stride grid (seq-1) % stride === 0, choosing stride so that
    // shown cards never overlap by more than half their width. Stride=1 (all
    // verses shown) whenever pxPerVerse ≥ cardWidth/2 (≥130px — true at 16×
    // max zoom where pxPerVerse=250). At lower zoom, every Nth verse shown.
    //
    // Why stride instead of cascade: cascade packing jumps by ~(cardWidth -
    // pxPerVerse) whenever a card crosses the off-screen boundary. Stride
    // filtering avoids cascade entirely. The stride is constant during pan
    // (pxPerVerse doesn't change while panning), so the visible set is stable
    // and all shown cards move by exactly panΔ each frame — smooth.
    const density    = store.getState().density;
    const verseCardW = cardWidthForDensity(density);
    // Minimum natural spacing between shown verse cards. We allow up to 50%
    // card-width overlap (cards remain readable). At max verse zoom (250 px/v,
    // card=260px) this gives stride=1 — every verse shown. Only when overlap
    // would exceed half the card (pxPerVerse < cardWidth/2) do we skip verses.
    const verseMinSpacing = verseCardW / 2;
    const verseStride = Math.max(1, Math.ceil(verseMinSpacing / snap.pxPerVerse));

    const sorted = [...this.placed].sort((a, b) => a.startSeq - b.startSeq);
    let prevRightEdge = -Infinity;
    let maxPackedRight = -Infinity;
    for (const p of sorted) {
      const centerScreen = seqToScreenPx(p.axisSeq, snap);
      const naturalLeft  = centerScreen - p.cardWidth / 2;

      // Verse stride filter: hide cards not on the (seq-1) % stride grid.
      // These would overlap their neighbor in natural position — hiding them
      // is safe because they slide back in as the user zooms in further.
      if (p.kind === "verse" && (p.startSeq - 1) % verseStride !== 0) {
        p.card.style.display      = "none";
        p.connector.style.display = "none";
        continue;
      }

      const left = (p.kind === "verse")
        ? naturalLeft
        : Math.max(naturalLeft, prevRightEdge + CARD_GAP);

      const cardCenterX = left + p.cardWidth / 2;
      const axisX       = centerScreen;
      const shifted     = Math.abs(cardCenterX - axisX) > 0.5;

      const offLeft  = left + p.cardWidth < snap.sidebarW - 40;
      const offRight = left > snap.viewportW + 40;

      p.card.style.display      = (offLeft || offRight) ? "none" : "flex";
      p.connector.style.display = (offLeft || offRight) ? "none" : "block";

      if (p.kind !== "verse" && !offRight) prevRightEdge = left + p.cardWidth;

      if (offLeft || offRight) continue;

      p.card.style.left   = `${Math.round(left)}px`;
      p.card.style.top    = `${cardTop}px`;
      p.card.style.height = `${Math.round(cardH)}px`;

      // Connector sits in the 18px strip between card bottom and axis.
      if (shifted) {
        // Elbow: span from card center down to axis position.
        const xMin = Math.min(cardCenterX, axisX);
        const w    = Math.abs(cardCenterX - axisX) + 4;
        p.connector.style.left   = `${Math.round(xMin - 2)}px`;
        p.connector.style.top    = `${Math.round(cardTop + cardH)}px`;
        p.connector.style.width  = `${Math.round(w)}px`;
        p.connector.style.height = `${CONNECTOR_DROP}px`;
        p.connector.innerHTML = elbowSvg(
          p.connector.style.width, CONNECTOR_DROP,
          cardCenterX - xMin + 2, axisX - xMin + 2,
          connectorColorFor(p),
        );
      } else {
        p.connector.style.left   = `${Math.round(axisX - 4)}px`;
        p.connector.style.top    = `${Math.round(cardTop + cardH)}px`;
        p.connector.style.width  = "8px";
        p.connector.style.height = `${CONNECTOR_DROP}px`;
      }

      if (p.kind !== "verse") {
        const right = left + p.cardWidth;
        if (right > maxPackedRight) maxPackedRight = right;
      }
    }

    // Report the rightmost packed card's overflow past sequence TOTAL so
    // the canvas can extend its right-side clamp and the user can pan all
    // the way right with the last card still fully visible + breathing
    // room. Monotonically grows within a zoom level (see property doc).
    if (maxPackedRight !== -Infinity) {
      const seqTotalScreen = seqToScreenPx(TOTAL, snap);
      const observed = Math.max(0, maxPackedRight - seqTotalScreen);
      if (observed > this.rightOverflowHighWater) {
        this.rightOverflowHighWater = observed;
      }
      this.rightOverflowPx = this.rightOverflowHighWater;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function seqToScreenPx(seq: number, snap: CameraSnapshot): number {
  const cx = (snap.viewportW + snap.sidebarW) / 2;
  return (seq - snap.focusSeq) * snap.pxPerVerse + cx + snap.panOffset;
}

function cardWidthForDensity(d: string): number {
  if (d === "compact") return 220;
  if (d === "comfy")   return 300;
  return 260;
}

function eventCardStyle(density: string, ev: VisibleEvent, eraColor: string): string {
  const expanded = ev.isFocused;
  return (
    "position:fixed;display:flex;flex-direction:column;" +
    `width:${cardWidthForDensity(density)}px;` +
    "background:var(--color-surface);" +
    `border:1px solid ${expanded ? eraColor : "var(--color-border)"};` +
    "border-radius:var(--radius-lg);overflow:hidden;cursor:pointer;" +
    `box-shadow:${expanded
      ? `0 18px 44px oklch(0 0 0 / 0.55), 0 0 0 2px ${eraColor}, 0 0 60px color-mix(in oklch, ${eraColor} 20%, transparent)`
      : "var(--shadow-md)"};` +
    "transition:box-shadow var(--duration-fast) var(--ease-out)," +
    "border-color var(--duration-fast) var(--ease-out);" +
    "pointer-events:auto;"
  );
}

function verseCardStyle(density: string, eraColor: string): string {
  return (
    "position:fixed;display:flex;flex-direction:column;" +
    `width:${cardWidthForDensity(density)}px;` +
    "background:var(--color-surface);" +
    "border:1px solid var(--color-border);" +
    "border-radius:var(--radius-lg);overflow:hidden;" +
    "box-shadow:var(--shadow-md);pointer-events:auto;" +
    `border-top:2px solid ${eraColor};`
  );
}

function renderSegmentedText(
  container: HTMLElement,
  versionCode: string,
  segments: VerseSegment[],
  lexicon: Record<string, StrongEntry>,
): void {
  const upperCode = versionCode.toUpperCase();
  const isHebrew = upperCode.startsWith("HEB");
  container.style.direction = isHebrew ? "rtl" : "ltr";
  container.style.textAlign = isHebrew ? "right" : "left";
  container.style.display = "flex";
  container.style.flexWrap = "wrap";
  container.style.gap = "0 0.32em";

  for (const segment of segments) {
    const primaryStrong = segment.strongs.find((strong) => lexicon[strong.strongNumber]);
    const entry = primaryStrong ? lexicon[primaryStrong.strongNumber] : undefined;
    if (!primaryStrong || !entry) {
      const text = document.createElement("span");
      text.textContent = segment.text;
      container.appendChild(text);
      continue;
    }

    const token = document.createElement("button");
    token.type = "button";
    token.textContent = segment.text;
    token.title = `${primaryStrong.strongNumber} · ${entry.lemma}`;
    token.setAttribute("aria-label", `${segment.text}: ${primaryStrong.strongNumber} ${entry.lemma}`);
    token.style.cssText =
      "font:inherit;color:var(--color-text);border:none;padding:0 1px;" +
      "border-bottom:1px dotted var(--color-accent);border-radius:2px;" +
      "background:transparent;cursor:pointer;pointer-events:auto;";
    token.addEventListener("click", (event) => {
      event.stopPropagation();
      showStrongPopover(token, primaryStrong.strongNumber, entry);
    });
    container.appendChild(token);
  }
}

function showStrongPopover(anchor: HTMLElement, strongNumber: string, entry: StrongEntry): void {
  document.querySelector('[data-strong-popover="1"]')?.remove();

  const popover = document.createElement("aside");
  popover.dataset.strongPopover = "1";
  popover.style.cssText =
    "position:fixed;z-index:calc(var(--z-cards) + 5);max-width:280px;" +
    "background:var(--color-surface);border:1px solid var(--color-border);" +
    "border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);" +
    "padding:12px;pointer-events:auto;color:var(--color-text);";

  const title = document.createElement("div");
  title.style.cssText =
    "display:flex;justify-content:space-between;gap:10px;align-items:baseline;" +
    "font-family:var(--font-serif);font-size:var(--text-base);";
  const lemma = document.createElement("strong");
  lemma.textContent = entry.lemma;
  const number = document.createElement("span");
  number.textContent = strongNumber;
  number.style.cssText =
    "font-family:var(--font-mono);font-size:10px;color:var(--color-accent);" +
    "letter-spacing:var(--tracking-wide);";
  title.appendChild(lemma);
  title.appendChild(number);

  const metaParts = [entry.transliteration, entry.pronunciation]
    .filter((value): value is string => Boolean(value?.trim()));
  const meta = document.createElement("div");
  meta.textContent = metaParts.join(" · ");
  meta.style.cssText = "margin-top:4px;font-size:11px;color:var(--color-text-mute);";

  const definition = document.createElement("p");
  definition.textContent = entry.definition;
  definition.style.cssText =
    "margin:8px 0 0;font-size:var(--text-xs);line-height:var(--leading-normal);" +
    "color:var(--color-text-dim);";

  popover.appendChild(title);
  if (metaParts.length) popover.appendChild(meta);
  popover.appendChild(definition);

  if (entry.definitionLanguage === "en") {
    const fallback = document.createElement("div");
    fallback.textContent = "Definición original en inglés; traducción española pendiente.";
    fallback.style.cssText =
      "margin-top:6px;font-size:10px;color:var(--color-text-mute);" +
      "line-height:var(--leading-normal);";
    popover.appendChild(fallback);
  }

  if (entry.kjvDefinition?.trim()) {
    const kjv = document.createElement("div");
    kjv.textContent = `Equivalentes KJV: ${entry.kjvDefinition}`;
    kjv.style.cssText =
      "margin-top:8px;font-size:10px;color:var(--color-text-mute);" +
      "font-family:var(--font-mono);line-height:var(--leading-normal);";
    popover.appendChild(kjv);
  }

  document.body.appendChild(popover);
  const rect = anchor.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const left = Math.min(window.innerWidth - popoverRect.width - 12, Math.max(12, rect.left));
  const top = Math.min(window.innerHeight - popoverRect.height - 12, rect.bottom + 8);
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;

  const close = (event: MouseEvent) => {
    if (!popover.contains(event.target as Node) && event.target !== anchor) {
      popover.remove();
      document.removeEventListener("mousedown", close, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", close, true), 0);
}

function connectorColorFor(p: Placed): string {
  const seq = p.axisSeq;
  const era = eraForSeq(seq, TOTAL);
  return era.color;
}

function elbowSvg(
  widthPx: string, heightPx: number,
  cardCenterRelX: number, axisRelX: number,
  color: string,
): string {
  const midY = heightPx / 2;
  const dir  = axisRelX >= cardCenterRelX ? 1 : -1;
  const x1 = cardCenterRelX;
  const x2 = axisRelX;
  const DOT = 7;
  const path =
    `M ${x1} 0 L ${x1} ${midY - 4} ` +
    `Q ${x1} ${midY} ${x1 + 4 * dir} ${midY} ` +
    `L ${x2 - 4 * dir} ${midY} ` +
    `Q ${x2} ${midY} ${x2} ${midY + 4} ` +
    `L ${x2} ${heightPx - DOT / 2}`;
  return (
    `<svg width="${widthPx}" height="${heightPx}" style="position:absolute;left:0;top:0;overflow:visible;">` +
    `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.2" stroke-opacity="0.75"/>` +
    `<circle cx="${x2}" cy="${heightPx}" r="${DOT / 2}" fill="${color}" ` +
    `style="filter:drop-shadow(0 0 6px ${color});"/>` +
    `</svg>`
  );
}

function makeSkeletonCard(): HTMLElement {
  const card = document.createElement("article");
  card.setAttribute("aria-hidden", "true");
  card.style.cssText =
    "position:fixed;display:flex;flex-direction:column;" +
    "background:var(--color-surface);" +
    "border:1px solid var(--color-border);" +
    "border-radius:var(--radius-lg);overflow:hidden;" +
    "box-shadow:var(--shadow-md);pointer-events:none;";

  const shimLine = (w: string, h = "10px", mt = "0px") =>
    `<div style="` +
    `height:${h};width:${w};border-radius:var(--radius-xs);margin-top:${mt};` +
    `background:linear-gradient(90deg,` +
    `var(--color-surface-2) 0%,` +
    `color-mix(in oklch,var(--color-surface-2) 40%,var(--color-text-mute)) 50%,` +
    `var(--color-surface-2) 100%);` +
    `background-size:260px 100%;` +
    `animation:sk-shimmer 1.4s ease-in-out infinite;` +
    `"></div>`;

  card.innerHTML =
    // header row: fake ref pill + fake badge
    `<div style="padding:8px 12px 4px;display:flex;justify-content:space-between;align-items:center;">` +
      shimLine("72px", "12px") +
      shimLine("22px", "12px") +
    `</div>` +
    // body: fake text lines with staggered delays
    `<div style="padding:6px 12px 12px;display:flex;flex-direction:column;gap:8px;flex:1;">` +
      shimLine("100%", "10px", "2px") +
      shimLine("88%",  "10px") +
      shimLine("78%",  "10px") +
      shimLine("92%",  "10px") +
      shimLine("65%",  "10px") +
    `</div>`;

  // Stagger the shimmer animation per card via animationDelay on each line.
  // We do it post-construction so innerHTML is already set.
  return card;
}

function updateAncestryBadge(el: HTMLElement, isFocused: boolean, isFocusAncestor: boolean): void {
  if (isFocused) {
    el.textContent = "FOCUS";
    el.style.display = "";
  } else if (isFocusAncestor) {
    el.textContent = "ANCESTRO";
    el.style.display = "";
  } else {
    el.textContent = "";
    el.style.display = "none";
  }
}
