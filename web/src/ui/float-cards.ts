import { store } from "@store/app-store.ts";
import { authStore } from "@store/auth-store.ts";
import { fetchAllNotes, deleteNote, type NoteDto } from "@api/notes.ts";
import { NoteEditor } from "@ui/note-editor.ts";
import { subscribeCameraUpdate, type CameraSnapshot } from "../camera.ts";
import { FLOAT_STYLE, type FloatCard, type FloatType } from "../data/floats.ts";
import { fetchFloats, fetchFloat } from "@api/content.ts";
import { cascadeDepths, CASCADE_PEEK } from "@ui/float-cascade.ts";

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
const LANE_TOP       = 40;
const LANE_HEIGHT    = 150;
const MAX_DISPLAYED  = 30;
const CARD_WIDTH     = { compact: 220, regular: 250, comfy: 290 } as const;

interface Placed {
  float: FloatCard;
  el: HTMLElement;
  yOffset: number;   // manual vertical drag
  baseTop: number;
  screenX: number;   // last computed horizontal position (for cascade)
}

export class FloatCards {
  readonly el: HTMLElement;
  private placed: Placed[] = [];
  private lastCamera: CameraSnapshot | null = null;
  private unsubCamera?: () => void;
  private unsubStore?:  () => void;
  private unsubAuth?:   () => void;
  private popup: FloatPopup;
  onStaticCardsLoaded?: (cards: readonly FloatCard[]) => void;
  private staticCards: FloatCard[] = [];
  private userNotes: FloatCard[] = [];
  private noteDtoMap = new Map<string, NoteDto>(); // floatCard.id → NoteDto

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
    this.unsubAuth   = authStore.subscribe(() => { void this.loadUserNotes(); });
    void this.loadStaticCards();
    void this.loadUserNotes();
  }

  destroy(): void {
    this.unsubCamera?.();
    this.unsubStore?.();
    this.unsubAuth?.();
  }

  reloadUserNotes(): void {
    void this.loadUserNotes();
  }

  private async loadStaticCards(): Promise<void> {
    try {
      this.staticCards = await fetchFloats();
    } catch {
      // content-api unavailable — keep empty; UI still shows user notes
      this.staticCards = [];
    }
    this.onStaticCardsLoaded?.(this.staticCards);
    this.rebuild();
  }

  private async loadUserNotes(): Promise<void> {
    if (!authStore.isAuthenticated()) {
      this.userNotes = [];
      this.noteDtoMap.clear();
      this.rebuild();
      return;
    }
    try {
      const result = await fetchAllNotes();
      this.noteDtoMap.clear();

      // Build a map of sequence → set of lanes already used by static cards
      const staticLanes = new Map<number, Set<0 | 1>>();
      for (const f of this.staticCards) {
        if (!staticLanes.has(f.sequence)) staticLanes.set(f.sequence, new Set());
        staticLanes.get(f.sequence)!.add(f.lane);
      }
      // Track lanes already assigned to user notes at each sequence
      const userLanes = new Map<number, Set<0 | 1>>();

      this.userNotes = result.notes
        .filter((n) => n.sequence != null)
        .map((n) => {
          const id = `user-note-${n.id}`;
          this.noteDtoMap.set(id, n);
          const seq = n.sequence!;
          const taken = new Set<0 | 1>([
            ...(staticLanes.get(seq) ?? []),
            ...(userLanes.get(seq) ?? []),
          ]);
          // Pick the lane not yet taken; if both taken fall back to lane 1 with x-offset handled in position
          const lane: 0 | 1 = !taken.has(0) ? 0 : 1;
          if (!userLanes.has(seq)) userLanes.set(seq, new Set());
          userLanes.get(seq)!.add(lane);
          return {
            id,
            type: "note" as FloatType,
            sequence: seq,
            lane,
            titleEs: `Nota · ${n.verseRef}`,
            titleEn: `Note · ${n.verseRef}`,
            bodyEs: n.content,
            bodyEn: n.content,
          };
        });
    } catch {
      this.userNotes = [];
    }
    this.rebuild();
  }

  // ── Build DOM ────────────────────────────────────────────────────────────

  private rebuild(): void {
    this.el.innerHTML = "";
    this.placed = [];

    const s = store.getState();
    if (!s.showFloats) return;

    const types = new Set(s.floatTypes);
    const staticList = this.staticCards.filter((f) => types.has(f.type));
    const userList   = types.has("note") ? this.userNotes : [];
    // Dedupe by content identity — duplicated rows in content-api data would
    // otherwise render the same card several times and eat the display budget.
    const seen = new Set<string>();
    const combined = [...staticList, ...userList]
      .filter((f) => {
        const key = `${f.type}:${f.sequence}:${f.titleEs}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_DISPLAYED);

    for (const float of combined) {
      const isUserNote = this.noteDtoMap.has(float.id);
      const card = isUserNote
        ? this.makeUserNoteCard(float, s.lang)
        : this.makeCard(float, s.lang);
      this.el.appendChild(card);
      const p: Placed = { float, el: card, yOffset: 0, baseTop: 0, screenX: 0 };
      this.placed.push(p);
      addVerticalDrag(card, p);
    }

    if (this.lastCamera) this.onCamera(this.lastCamera);
  }

  private makeCard(f: FloatCard, lang: string): HTMLElement {
    const style = FLOAT_STYLE[f.type];
    const color = typeColor(f.type);
    const density = store.getState().density;
    const width = CARD_WIDTH[density as keyof typeof CARD_WIDTH] ?? CARD_WIDTH.regular;

    const card = document.createElement("article");
    card.setAttribute("role", "listitem");
    card.setAttribute("aria-label", `${style.labelEs} · ${f.titleEs}`);
    card.dataset.noDrag = "1";
    card.style.cssText = cardBaseStyle(width, color);

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
    card.appendChild(guideEl(color));

    card.style.cursor = "pointer";
    card.addEventListener("click", (e) => {
      e.stopPropagation();
      this.popup.open(f, store.getState().lang);
    });

    return card;
  }

  private makeUserNoteCard(f: FloatCard, _lang: string): HTMLElement {
    const color = typeColor("note");
    const style = FLOAT_STYLE["note"];
    const density = store.getState().density;
    const width = CARD_WIDTH[density as keyof typeof CARD_WIDTH] ?? CARD_WIDTH.regular;
    const dto = this.noteDtoMap.get(f.id)!;

    const card = document.createElement("article");
    card.setAttribute("role", "listitem");
    card.setAttribute("aria-label", `Nota · ${f.titleEs}`);
    card.dataset.noDrag = "1";
    card.style.cssText = cardBaseStyle(width, color);

    const header = document.createElement("header");
    header.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;";

    const labelGroup = document.createElement("div");
    labelGroup.style.cssText = "display:flex;align-items:center;gap:6px;";
    const glyph = document.createElement("span");
    glyph.textContent = style.glyph;
    glyph.style.cssText = `color:${color};font-size:11px;`;
    const tag = document.createElement("span");
    tag.textContent = style.labelEs;
    tag.style.cssText =
      `font-size:9px;color:${color};letter-spacing:var(--tracking-widest);` +
      "font-weight:var(--font-semibold);";
    labelGroup.append(glyph, tag);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:4px;";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "✎";
    editBtn.title = "Editar";
    editBtn.style.cssText =
      "background:none;border:none;cursor:pointer;font-size:11px;" +
      `color:${color};padding:0 2px;line-height:1;`;
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const editor = new NoteEditor(dto.verseRef, dto.verseRef, dto,
        () => { void this.loadUserNotes(); },
        () => editor.unmount());
      editor.mount();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "✕";
    delBtn.title = "Eliminar";
    delBtn.style.cssText =
      "background:none;border:none;cursor:pointer;font-size:10px;" +
      "color:var(--color-text-mute);padding:0 2px;line-height:1;";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void deleteNote(dto.id).then(() => this.loadUserNotes());
    });

    actions.append(editBtn, delBtn);
    header.append(labelGroup, actions);

    const title = document.createElement("div");
    title.textContent = dto.verseRef;
    title.style.cssText =
      "font-family:var(--font-serif);font-size:var(--text-sm);color:var(--color-text);" +
      "margin-bottom:5px;font-weight:var(--font-medium);letter-spacing:-0.005em;";

    const body = document.createElement("p");
    body.textContent = dto.content.length > 120
      ? dto.content.slice(0, 120) + "…"
      : dto.content;
    body.style.cssText =
      "margin:0;font-size:var(--text-xs);color:var(--color-text-dim);" +
      "line-height:var(--leading-snug);text-wrap:pretty;";

    card.append(header, title, body, guideEl(color));

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
    const density = store.getState().density;
    const cardW = CARD_WIDTH[density as keyof typeof CARD_WIDTH] ?? CARD_WIDTH.regular;

    // Pass 1: position each card horizontally; hide the off-screen ones.
    const visible: Placed[] = [];
    for (const p of this.placed) {
      const screenX = (p.float.sequence - snap.focusSeq) * snap.pxPerVerse + cx + snap.panOffset;
      if (screenX < snap.sidebarW - 120 || screenX > snap.viewportW + 120) {
        p.el.style.display = "none";
        continue;
      }
      p.el.style.display = "block";
      p.el.style.left = `${Math.round(screenX)}px`;
      p.baseTop = Math.round(axisY + LANE_TOP + p.float.lane * (LANE_HEIGHT + LANE_GAP));
      p.screenX = screenX;
      visible.push(p);
    }

    // Pass 2: cascade overlapping cards downward so every header peeks, then
    // add the manual drag offset on top. Deeper cards paint above the previous
    // one (higher z-index) so each card in the stack shows its header strip;
    // user-raised cards keep the z-index bringToFront gave them.
    const depths = cascadeDepths(
      visible.map((p) => ({ lane: p.float.lane, screenX: p.screenX })),
      cardW,
    );
    for (let i = 0; i < visible.length; i++) {
      const p = visible[i]!;
      const top = p.baseTop + depths[i]! * CASCADE_PEEK + p.yOffset;
      p.el.style.top = `${top}px`;
      if (!p.el.dataset["raised"]) p.el.style.zIndex = String(1 + depths[i]!);
      const guide = p.el.querySelector<HTMLElement>('[data-guide="1"]');
      if (guide) guide.style.height = `${Math.max(0, Math.round(top - axisY))}px`;
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
    const color = typeColor(f.type as FloatType);
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
        <div id="popup-body" style="font-size:var(--text-base);color:var(--color-text-dim);
                  line-height:var(--leading-normal);">
          ${buildPopupBody(body)}
        </div>
      </div>
    `;
    this.el.querySelector("[data-close]")?.addEventListener("click", () => this.close());

    // Async-resolve [cardref:UUID] embeds
    const bodyEl = this.el.querySelector<HTMLElement>("#popup-body");
    if (bodyEl) void resolvePopupCardrefs(bodyEl, lang);
  }

  close(): void {
    this.el.style.display = "none";
    this.el.innerHTML = "";
  }
}

// ── Popup cardref helpers ─────────────────────────────────────────────────────

const CARDREF_RE = /\[cardref:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

function buildPopupBody(body: string): string {
  CARDREF_RE.lastIndex = 0;
  const pStyle =
    "margin:0 0 12px;text-wrap:pretty;white-space:pre-wrap;";
  let result = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = CARDREF_RE.exec(body)) !== null) {
    const before = body.slice(last, match.index);
    if (before.trim()) result += `<p style="${pStyle}">${h(before)}</p>`;
    result += `<div data-cardref="${match[1]}" style="
      display:flex;align-items:center;gap:8px;padding:10px 12px;margin:8px 0;
      border:1px dashed var(--color-surface-3);border-radius:var(--radius-md);
      color:var(--color-text-dim);font-size:var(--text-sm);">
      <span>◰</span><span>Cargando…</span>
    </div>`;
    last = match.index + match[0].length;
  }
  const after = body.slice(last);
  if (after.trim()) result += `<p style="${pStyle}">${h(after)}</p>`;
  return result || `<p style="${pStyle}">${h(body)}</p>`;
}

async function resolvePopupCardrefs(bodyEl: HTMLElement, lang: string): Promise<void> {
  const placeholders = bodyEl.querySelectorAll<HTMLElement>("[data-cardref]");
  for (const ph of placeholders) {
    const id = ph.dataset.cardref;
    if (!id) continue;
    try {
      const card = await fetchFloat(id);
      if (!card) { ph.textContent = "⬡ Card no encontrada"; continue; }
      const refColor = typeColor(card.type);
      const refStyle = FLOAT_STYLE[card.type as FloatType];
      const refTitle = lang === "es" ? card.titleEs : card.titleEn;
      const refBody  = lang === "es" ? card.bodyEs  : card.bodyEn;
      ph.style.cssText =
        `display:block;padding:12px 14px;margin:8px 0;` +
        `border:1px dashed ${refColor};border-radius:var(--radius-md);` +
        `background:color-mix(in oklch,var(--color-surface) 95%,transparent);`;
      ph.innerHTML =
        `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">` +
          `<span style="color:${h(refColor)};font-size:11px;">${h(refStyle.glyph)}</span>` +
          `<span style="font-size:9px;color:${h(refColor)};letter-spacing:var(--tracking-widest);font-weight:var(--font-semibold);">${h(refStyle.labelEs)}</span>` +
        `</div>` +
        `<div style="font-family:var(--font-serif);font-size:var(--text-sm);color:var(--color-text);margin-bottom:4px;">${h(refTitle)}</div>` +
        `<p style="margin:0;font-size:var(--text-xs);color:var(--color-text-dim);line-height:var(--leading-snug);">${h(refBody.slice(0, 140))}${refBody.length > 140 ? "…" : ""}</p>`;
    } catch {
      ph.textContent = "⬡ No se pudo cargar la card";
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function typeColor(type: string): string {
  const map: Record<string, string> = {
    prophecy: "var(--color-accent-2)",
    xref:     "var(--color-accent-3)",
    context:  "var(--color-text-dim)",
    note:     "var(--color-accent)",
    map:      "var(--color-accent-3)",
    people:   "var(--color-accent)",
  };
  return map[type] ?? "var(--color-text-dim)";
}

function cardBaseStyle(width: number, color: string): string {
  return (
    "position:fixed;transform:translateX(-50%);" +
    `width:${width}px;` +
    "background:color-mix(in oklch, var(--color-surface) 92%, transparent);" +
    `border:1px dashed ${color};` +
    "border-radius:var(--radius-md);padding:10px 12px 12px;" +
    "opacity:0.92;transition:opacity var(--duration-normal) var(--ease-out);" +
    "backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);" +
    "pointer-events:auto;user-select:none;"
  );
}

function guideEl(color: string): HTMLElement {
  const guide = document.createElement("span");
  guide.dataset.guide = "1";
  guide.style.cssText =
    "position:absolute;left:50%;bottom:100%;width:1px;" +
    `background:linear-gradient(to bottom, ${color} 10%, transparent 90%);` +
    "pointer-events:none;transform:translateX(-50%);opacity:0.6;";
  return guide;
}

// Base above any cascade depth so a grabbed card always jumps to the front and
// stays there (onCamera skips z-index for raised cards).
let cardStackTop = 1000;
function bringToFront(el: HTMLElement): void {
  el.style.zIndex = String(++cardStackTop);
  el.style.opacity = "1";
  el.dataset["raised"] = "1";
}

function addVerticalDrag(el: HTMLElement, p: Placed): void {
  let startY      = 0;
  let startOffset = 0;
  let moved       = false;

  const onMove = (clientY: number) => {
    const dy = clientY - startY;
    if (!moved && Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    p.yOffset = startOffset + dy;
    const top = p.baseTop + p.yOffset;
    el.style.top = `${top}px`;
    el.style.cursor = "grabbing";
    const guide = el.querySelector<HTMLElement>('[data-guide="1"]');
    if (guide) guide.style.height = `${Math.max(0, top - window.innerHeight / 2)}px`;
  };

  const onMouseMove = (e: MouseEvent) => { e.preventDefault(); onMove(e.clientY); };
  const onTouchMove = (e: TouchEvent) => { if (e.touches[0]) onMove(e.touches[0].clientY); };

  const cleanup = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup",   cleanup);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend",  cleanup);
    el.style.cursor = "grab";
  };

  el.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.stopPropagation();
    bringToFront(el);
    startY      = e.clientY;
    startOffset = p.yOffset;
    moved       = false;
    document.addEventListener("mousemove", onMouseMove, { passive: false });
    document.addEventListener("mouseup",   cleanup);
  });

  el.addEventListener("touchstart", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.stopPropagation();
    bringToFront(el);
    startY      = e.touches[0]?.clientY ?? 0;
    startOffset = p.yOffset;
    moved       = false;
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend",  cleanup);
  }, { passive: true });

  // Suppress click if user dragged
  el.addEventListener("click", (e) => {
    if (moved) { e.stopImmediatePropagation(); moved = false; }
  }, true);

  el.style.cursor = "grab";
}

function h(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
