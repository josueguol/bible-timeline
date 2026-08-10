import DOMPurify from "dompurify";
import { marked } from "marked";
import type { FloatCard, FloatCardInput, FloatType } from "./api.ts";
import { createFloat, updateFloat, unfurlUrl, listFloats, getFloat } from "./api.ts";

const TYPES: FloatType[] = ["context", "prophecy", "xref", "note", "map", "people"];
const EMBED_URL_RE = /\[embed:(https?:\/\/[^\]]+)\]/g;
const CARDREF_RE   = /\[cardref:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;

// In-memory cache so the preview doesn't re-fetch on every keystroke
const cardCache = new Map<string, FloatCard>();

// ── Preview rendering ─────────────────────────────────────────────────────────

function renderPreviewBody(md: string): string {
  CARDREF_RE.lastIndex = 0;
  EMBED_URL_RE.lastIndex = 0;
  const html = (marked.parse(md, { async: false }) as string)
    .replace(EMBED_URL_RE, (_m, url: string) =>
      renderEmbedPlaceholder(url))
    .replace(CARDREF_RE, (_m, id: string) => {
      const normalizedId = id.toLowerCase();
      const cached = cardCache.get(normalizedId);
      return cached
        ? renderMiniCard(cached)
        : `<div class="cardref-placeholder" data-id="${normalizedId}">⬡ Cargando card…</div>`;
    });

  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "rel"],
    ALLOW_DATA_ATTR: true,
  });
}

function renderEmbedPlaceholder(rawUrl: string): string {
  const url = normalizeHttpUrl(rawUrl);
  if (!url) return h(`[embed:${rawUrl}]`);

  return `<div class="embed-placeholder" data-url="${h(url)}">
         <span class="embed-icon">🔗</span>
         <a href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(url)}</a>
       </div>`;
}

function normalizeHttpUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!url.port || url.port === "80" || url.port === "443") return url.toString();
    return null;
  } catch {
    return null;
  }
}

function renderMiniCard(c: FloatCard): string {
  return `
    <div class="mini-card type-${c.type}">
      <div class="mini-card-header">
        <span class="type-badge type-${c.type}">${c.type}</span>
        <span class="mini-card-seq">seq ${c.sequence}</span>
      </div>
      <div class="mini-card-title">${h(c.titleEs)}</div>
      <p class="mini-card-body">${h(c.bodyEs.slice(0, 120))}${c.bodyEs.length > 120 ? "…" : ""}</p>
    </div>
  `;
}

async function resolveCardrefs(container: HTMLElement): Promise<void> {
  const placeholders = container.querySelectorAll<HTMLElement>(".cardref-placeholder");
  for (const ph of placeholders) {
    const id = ph.dataset.id;
    if (!id) continue;
    try {
      let card = cardCache.get(id.toLowerCase());
      if (!card) {
        card = await getFloat(id);
        cardCache.set(id.toLowerCase(), card);
      }
      ph.outerHTML = renderMiniCard(card);
    } catch {
      ph.textContent = `⬡ Card no encontrada: ${id}`;
    }
  }
}

// ── Card picker modal ─────────────────────────────────────────────────────────

async function openCardPicker(onSelect: (id: string) => void): Promise<void> {
  let cards: FloatCard[];
  try { cards = await listFloats(); }
  catch { alert("No se pudo cargar la lista de cards."); return; }

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;" +
    "display:flex;align-items:center;justify-content:center;padding:24px;";

  overlay.innerHTML = `
    <div style="
      background:#1a1d26;border:1px solid #2e3148;border-radius:10px;
      width:100%;max-width:560px;max-height:80vh;
      display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:14px 16px;border-bottom:1px solid #2e3148;display:flex;align-items:center;gap:10px;">
        <input id="picker-search" type="text" placeholder="Buscar por título, tipo o secuencia…"
          style="flex:1;padding:7px 10px;border:1px solid #2e3148;border-radius:6px;
                 background:#0f1117;color:#c9cee0;font-size:13px;outline:none;">
        <button id="picker-close"
          style="background:none;border:none;color:#7a8099;font-size:22px;cursor:pointer;line-height:1;
                 padding:0 4px;">×</button>
      </div>
      <div id="picker-list"
        style="overflow-y:auto;flex:1;padding:8px;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const searchEl = overlay.querySelector<HTMLInputElement>("#picker-search")!;
  const listEl   = overlay.querySelector<HTMLElement>("#picker-list")!;

  const renderList = (filter: string) => {
    const q = filter.toLowerCase();
    const filtered = q
      ? cards.filter((c) =>
          c.titleEs.toLowerCase().includes(q) ||
          c.type.includes(q) ||
          String(c.sequence).includes(q))
      : cards;

    listEl.innerHTML = filtered.map((c) => `
      <div class="picker-item" data-id="${c.id}"
        style="display:flex;align-items:center;gap:10px;padding:8px 10px;
               border-radius:6px;cursor:pointer;margin-bottom:2px;">
        <span class="type-badge type-${c.type}" style="flex-shrink:0;">${c.type}</span>
        <span style="font-size:11px;color:#7a8099;flex-shrink:0;min-width:44px;">${c.sequence}</span>
        <span style="font-size:13px;color:#edf0fa;overflow:hidden;
                     text-overflow:ellipsis;white-space:nowrap;">${h(c.titleEs)}</span>
        ${!c.published ? `<span style="font-size:10px;color:#7a8099;flex-shrink:0;">(borrador)</span>` : ""}
      </div>
    `).join("") || `<p style="padding:16px;color:#7a8099;font-size:13px;">Sin resultados</p>`;

    for (const item of listEl.querySelectorAll<HTMLElement>(".picker-item")) {
      item.addEventListener("mouseenter", () => { item.style.background = "#23263a"; });
      item.addEventListener("mouseleave", () => { item.style.background = ""; });
      item.addEventListener("click", () => {
        overlay.remove();
        onSelect(item.dataset.id!);
      });
    }
  };

  renderList("");
  searchEl.addEventListener("input", () => renderList(searchEl.value));
  searchEl.focus();

  overlay.querySelector("#picker-close")!.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// ── Editor ────────────────────────────────────────────────────────────────────

export interface EditorCallbacks {
  onSaved: () => void;
  onCancel: () => void;
}

export function renderCardEditor(
  container: HTMLElement,
  existing: FloatCard | null,
  cbs: EditorCallbacks,
): void {
  container.innerHTML = `
    <div class="editor-layout">
      <div class="editor-form-col">
        <h2 class="editor-title">${existing ? "Editar card" : "Nueva card"}</h2>

        <label class="field-label">Tipo
          <select id="ed-type" class="field-input">
            ${TYPES.map((t) => `<option value="${t}"${existing?.type === t ? " selected" : ""}>${t}</option>`).join("")}
          </select>
        </label>

        <div class="field-row">
          <label class="field-label" style="flex:1">Secuencia (1–31102)
            <input id="ed-seq" type="number" min="1" max="31102" class="field-input"
              value="${existing?.sequence ?? ""}">
          </label>
          <label class="field-label" style="flex:0 0 90px">Lane
            <select id="ed-lane" class="field-input">
              <option value="0"${existing?.lane === 0 ? " selected" : ""}>0</option>
              <option value="1"${existing?.lane === 1 ? " selected" : ""}>1</option>
            </select>
          </label>
        </div>

        <label class="field-label">Título ES
          <input id="ed-title-es" type="text" class="field-input" value="${h(existing?.titleEs ?? "")}">
        </label>
        <label class="field-label">Título EN
          <input id="ed-title-en" type="text" class="field-input" value="${h(existing?.titleEn ?? "")}">
        </label>

        <label class="field-label">Cuerpo ES (Markdown)
          <div class="md-toolbar" id="toolbar-es">
            <button type="button" data-wrap="**" title="Negrita"><b>B</b></button>
            <button type="button" data-wrap="_"  title="Cursiva"><i>I</i></button>
            <button type="button" data-heading="##" title="Encabezado">H2</button>
            <button type="button" data-link="1" title="Enlace">🔗</button>
            <button type="button" data-unfurl="1" title="Embeber URL">⬡ URL</button>
            <button type="button" data-cardref="1" title="Insertar card">⬡ Card</button>
          </div>
          <textarea id="ed-body-es" class="field-textarea" rows="8">${h(existing?.bodyEs ?? "")}</textarea>
        </label>

        <label class="field-label">Cuerpo EN (Markdown)
          <div class="md-toolbar" id="toolbar-en">
            <button type="button" data-wrap="**" title="Bold"><b>B</b></button>
            <button type="button" data-wrap="_"  title="Italic"><i>I</i></button>
            <button type="button" data-heading="##" title="Heading">H2</button>
            <button type="button" data-link="1" title="Link">🔗</button>
            <button type="button" data-unfurl="1" title="Embed URL">⬡ URL</button>
            <button type="button" data-cardref="1" title="Insert card">⬡ Card</button>
          </div>
          <textarea id="ed-body-en" class="field-textarea" rows="8">${h(existing?.bodyEn ?? "")}</textarea>
        </label>

        <label class="field-label">Linked Event ID (opcional)
          <input id="ed-link" type="text" class="field-input" value="${h(existing?.linkedEventId ?? "")}">
        </label>
        <label class="field-label">Fulfilled By Event ID (opcional)
          <input id="ed-fulfill" type="text" class="field-input" value="${h(existing?.fulfilledByEventId ?? "")}">
        </label>

        <label class="field-checkbox">
          <input id="ed-published" type="checkbox" ${existing?.published !== false ? "checked" : ""}>
          Publicado
        </label>

        <div class="editor-actions">
          <button id="ed-cancel" class="btn btn-ghost">Cancelar</button>
          <button id="ed-save"   class="btn btn-primary">Guardar</button>
        </div>
        <p id="ed-error" class="editor-error" style="display:none"></p>
      </div>

      <div class="editor-preview-col">
        <h3 class="preview-heading">Vista previa · ES</h3>
        <div id="preview-es" class="preview-body"></div>
        <h3 class="preview-heading" style="margin-top:24px">Vista previa · EN</h3>
        <div id="preview-en" class="preview-body"></div>
      </div>
    </div>
  `;

  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!;

  const bodyEs    = q<HTMLTextAreaElement>("#ed-body-es");
  const bodyEn    = q<HTMLTextAreaElement>("#ed-body-en");
  const previewEs = q("#preview-es");
  const previewEn = q("#preview-en");

  const updatePreview = () => {
    previewEs.innerHTML = renderPreviewBody(bodyEs.value);
    previewEn.innerHTML = renderPreviewBody(bodyEn.value);
    void resolveCardrefs(previewEs);
    void resolveCardrefs(previewEn);
  };
  updatePreview();
  bodyEs.addEventListener("input", updatePreview);
  bodyEn.addEventListener("input", updatePreview);

  // Toolbar handlers
  for (const toolbar of container.querySelectorAll<HTMLElement>(".md-toolbar")) {
    const isEs = toolbar.id === "toolbar-es";
    const ta   = isEs ? bodyEs : bodyEn;

    toolbar.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!btn) return;

      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      const sel   = ta.value.slice(start, end);

      if (btn.dataset.wrap) {
        const w = btn.dataset.wrap;
        ta.setRangeText(`${w}${sel || "texto"}${w}`, start, end, "select");

      } else if (btn.dataset.heading) {
        const lineStart = ta.value.lastIndexOf("\n", start - 1) + 1;
        ta.setRangeText(`${btn.dataset.heading} `, lineStart, lineStart, "end");

      } else if (btn.dataset.link === "1") {
        const url = prompt("URL:");
        const normalizedUrl = url ? normalizeHttpUrl(url) : null;
        if (normalizedUrl) ta.setRangeText(`[${sel || "texto"}](${normalizedUrl})`, start, end, "end");
        else if (url) alert("URL inválida. Usa http/https en puerto 80 o 443.");

      } else if (btn.dataset.unfurl === "1") {
        const url = prompt("URL a embeber:");
        const normalizedUrl = url ? normalizeHttpUrl(url) : null;
        if (!normalizedUrl) {
          if (url) alert("URL inválida. Usa http/https en puerto 80 o 443.");
          return;
        }
        btn.textContent = "…";
        btn.disabled = true;
        try {
          await unfurlUrl(normalizedUrl);
          ta.setRangeText(`\n[embed:${normalizedUrl}]\n`, start, start, "end");
        } catch {
          alert("No se pudo obtener el preview del URL.");
        } finally {
          btn.textContent = "⬡ URL";
          btn.disabled = false;
        }

      } else if (btn.dataset.cardref === "1") {
        btn.disabled = true;
        await openCardPicker((id) => {
          ta.setRangeText(`[cardref:${id}]`, start, start, "end");
          updatePreview();
          ta.focus();
        });
        btn.disabled = false;
        return; // picker handles focus
      }

      updatePreview();
      ta.focus();
    });
  }

  // Cancel
  q("#ed-cancel").addEventListener("click", cbs.onCancel);

  // Save
  q("#ed-save").addEventListener("click", async () => {
    const errEl = q("#ed-error");
    errEl.style.display = "none";

    const seq = Number(q<HTMLInputElement>("#ed-seq").value);
    if (!seq || seq < 1 || seq > 31102) {
      showError(errEl, "Secuencia inválida (1–31102)."); return;
    }
    const titleEs = q<HTMLInputElement>("#ed-title-es").value.trim();
    if (!titleEs) { showError(errEl, "El título en español es requerido."); return; }

    const inp: FloatCardInput = {
      type:               q<HTMLSelectElement>("#ed-type").value as FloatType,
      sequence:           seq,
      lane:               Number(q<HTMLSelectElement>("#ed-lane").value) as 0 | 1,
      titleEs,
      titleEn:            q<HTMLInputElement>("#ed-title-en").value.trim(),
      bodyEs:             bodyEs.value.trim(),
      bodyEn:             bodyEn.value.trim(),
      linkedEventId:      q<HTMLInputElement>("#ed-link").value.trim() || null,
      fulfilledByEventId: q<HTMLInputElement>("#ed-fulfill").value.trim() || null,
      published:          q<HTMLInputElement>("#ed-published").checked,
    };

    const saveBtn = q<HTMLButtonElement>("#ed-save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando…";

    try {
      if (existing) { await updateFloat(existing.id, inp); }
      else          { await createFloat(inp); }
      cbs.onSaved();
    } catch (err) {
      showError(errEl, String(err));
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar";
    }
  });
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function h(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showError(el: HTMLElement, msg: string): void {
  el.textContent = msg;
  el.style.display = "block";
}
